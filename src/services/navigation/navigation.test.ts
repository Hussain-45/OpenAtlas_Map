import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Route } from '../routing/types'
import {
  calculateRemainingPolylineDistanceMeters,
  calculateRouteProgress,
  getAccuracyLevel,
  isSignificantlyOffRoute,
  type LiveLocation,
  SpeechNavigator,
} from './index'

describe('getAccuracyLevel', () => {
  it('categorizes GPS accuracy into good, medium, poor, and unavailable', () => {
    expect(getAccuracyLevel(8)).toBe('good')
    expect(getAccuracyLevel(20)).toBe('good')
    expect(getAccuracyLevel(35)).toBe('medium')
    expect(getAccuracyLevel(50)).toBe('medium')
    expect(getAccuracyLevel(65)).toBe('poor')
    expect(getAccuracyLevel(null)).toBe('unavailable')
    expect(getAccuracyLevel(undefined as unknown as number)).toBe('unavailable')
    expect(getAccuracyLevel(-5)).toBe('unavailable')
  })
})

describe('isSignificantlyOffRoute', () => {
  it('detects off-route when distance exceeds threshold', () => {
    // Driving base threshold is 55m
    expect(isSignificantlyOffRoute(30, 10, 'driving')).toBe(false)
    expect(isSignificantlyOffRoute(65, 10, 'driving')).toBe(true)

    // Walking base threshold is 35m
    expect(isSignificantlyOffRoute(25, 10, 'walking')).toBe(false)
    expect(isSignificantlyOffRoute(45, 10, 'walking')).toBe(true)
  })

  it('tolerates higher off-route distance when GPS accuracy is poor', () => {
    // Accuracy +-60m -> buffer 72m; off-route distance 65m is tolerated
    expect(isSignificantlyOffRoute(65, 60, 'driving')).toBe(false)
    // Exceeds 72m -> triggers off route
    expect(isSignificantlyOffRoute(80, 60, 'driving')).toBe(true)
  })

  it('returns false for invalid distance', () => {
    expect(isSignificantlyOffRoute(-10, 10, 'driving')).toBe(false)
    expect(isSignificantlyOffRoute(NaN, 10, 'driving')).toBe(false)
  })
})

describe('calculateRemainingPolylineDistanceMeters', () => {
  it('calculates remaining distance accurately along polyline', () => {
    const polyline: [number, number][] = [
      [77.200, 28.600],
      [77.210, 28.600],
      [77.220, 28.600],
    ]

    // Closest point is at (77.205, 28.600) on segment 0
    const remaining = calculateRemainingPolylineDistanceMeters([77.205, 28.600], 0, polyline)
    expect(remaining).toBeGreaterThan(1200)
    expect(remaining).toBeLessThan(1800)
  })

  it('returns 0 for empty or invalid polyline', () => {
    expect(calculateRemainingPolylineDistanceMeters([0, 0], -1, [])).toBe(0)
  })
})

describe('calculateRouteProgress', () => {
  const sampleRoute: Route = {
    id: 'test-route-1',
    summary: 'Connaught Place to Mandi House',
    distanceMeters: 1000,
    durationSeconds: 120,
    coordinates: [
      [77.219, 28.631],
      [77.225, 28.631],
      [77.230, 28.635],
    ],
    steps: [
      {
        instruction: 'Depart on Barakhamba Road',
        distanceMeters: 600,
        durationSeconds: 70,
        location: [77.219, 28.631],
      },
      {
        instruction: 'Turn right onto Sikandra Road',
        distanceMeters: 400,
        durationSeconds: 50,
        location: [77.225, 28.631],
      },
      {
        instruction: 'Arrive at Mandi House',
        distanceMeters: 0,
        durationSeconds: 0,
        location: [77.230, 28.635],
      },
    ],
    mode: 'driving',
  }

  it('tracks progress near route start', () => {
    const loc: LiveLocation = {
      longitude: 77.2192,
      latitude: 28.631,
      accuracyMeters: 10,
      heading: 90,
      speedMps: 12,
      timestamp: Date.now(),
    }

    const progress = calculateRouteProgress(loc, sampleRoute, 0, 'driving')
    expect(progress.hasArrived).toBe(false)
    expect(progress.isOffRoute).toBe(false)
    expect(progress.currentStepIndex).toBe(0)
    expect(progress.nextStep?.instruction).toBe('Depart on Barakhamba Road')
    expect(progress.remainingDistanceMeters).toBeGreaterThan(700)
    expect(progress.accuracyLevel).toBe('good')
  })

  it('advances to next step as user approaches or passes maneuver point', () => {
    // User is within 15m of step 1 maneuver location (77.225, 28.631)
    const loc: LiveLocation = {
      longitude: 77.2249,
      latitude: 28.631,
      accuracyMeters: 8,
      heading: 90,
      speedMps: 8,
      timestamp: Date.now(),
    }

    const progress = calculateRouteProgress(loc, sampleRoute, 0, 'driving')
    expect(progress.currentStepIndex).toBe(1)
    expect(progress.nextStep?.instruction).toBe('Turn right onto Sikandra Road')
  })

  it('detects arrival when within arrival radius of destination', () => {
    // User is within 10m of destination (77.230, 28.635)
    const loc: LiveLocation = {
      longitude: 77.23005,
      latitude: 28.63505,
      accuracyMeters: 5,
      heading: 45,
      speedMps: 1,
      timestamp: Date.now(),
    }

    const progress = calculateRouteProgress(loc, sampleRoute, 1, 'driving')
    expect(progress.hasArrived).toBe(true)
    expect(progress.remainingDistanceMeters).toBe(0)
    expect(progress.remainingDurationSeconds).toBe(0)
  })

  it('detects off-route condition when user deviates significantly', () => {
    // User is ~300m away from the route
    const loc: LiveLocation = {
      longitude: 77.219,
      latitude: 28.635,
      accuracyMeters: 12,
      heading: 0,
      speedMps: 10,
      timestamp: Date.now(),
    }

    const progress = calculateRouteProgress(loc, sampleRoute, 0, 'driving')
    expect(progress.isOffRoute).toBe(true)
    expect(progress.offRouteDistanceMeters).toBeGreaterThan(150)
  })
})

describe('SpeechNavigator', () => {
  let mockSpeak: ReturnType<typeof vi.fn>
  let mockCancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSpeak = vi.fn()
    mockCancel = vi.fn()

    // Mock window.speechSynthesis
    globalThis.window = {
      speechSynthesis: {
        speak: mockSpeak,
        cancel: mockCancel,
      },
      SpeechSynthesisUtterance: function (this: Record<string, unknown>, text: string) {
        this.text = text
        this.rate = 1
        this.pitch = 1
        this.lang = 'en-US'
      } as unknown as typeof SpeechSynthesisUtterance,
    } as unknown as Window & typeof globalThis
  })

  it('speaks instructions and handles deduplication cooldown', () => {
    const speech = new SpeechNavigator(false, 10000)
    expect(speech.isSupported()).toBe(true)

    // First call speaks
    const spoken1 = speech.speak('Turn right onto Barakhamba Road')
    expect(spoken1).toBe(true)
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    // Second immediate call with identical text is suppressed by cooldown
    const spoken2 = speech.speak('Turn right onto Barakhamba Road')
    expect(spoken2).toBe(false)
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    // Force call bypasses cooldown
    const spoken3 = speech.speak('Turn right onto Barakhamba Road', true)
    expect(spoken3).toBe(true)
    expect(mockSpeak).toHaveBeenCalledTimes(2)

    // Different text speaks immediately
    const spoken4 = speech.speak('In 200 meters, prepare to stop')
    expect(spoken4).toBe(true)
    expect(mockSpeak).toHaveBeenCalledTimes(3)
  })

  it('respects muted state and cancels audio when muted', () => {
    const speech = new SpeechNavigator(false)
    speech.setMuted(true)
    expect(speech.isMuted()).toBe(true)
    expect(mockCancel).toHaveBeenCalled()

    const spoken = speech.speak('Turn left')
    expect(spoken).toBe(false)
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  it('toggleMute flips state properly', () => {
    const speech = new SpeechNavigator(false)
    expect(speech.toggleMute()).toBe(true)
    expect(speech.toggleMute()).toBe(false)
  })

  it('reset cancels speech and clears cooldown history', () => {
    const speech = new SpeechNavigator(false, 10000)
    speech.speak('Continue straight')
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    // Reset allows speaking identical text immediately without waiting for cooldown
    speech.reset()
    expect(mockCancel).toHaveBeenCalled()
    const spokenAgain = speech.speak('Continue straight')
    expect(spokenAgain).toBe(true)
    expect(mockSpeak).toHaveBeenCalledTimes(2)
  })
})

describe('Travel mode navigation thresholds', () => {
  it('applies mode-specific off-route thresholds', () => {
    // 38m is off-route for walking (>35m), but NOT off-route for driving (<=55m)
    expect(isSignificantlyOffRoute(38, 5, 'walking')).toBe(true)
    expect(isSignificantlyOffRoute(38, 5, 'driving')).toBe(false)

    // 45m is off-route for cycling (>40m), but NOT off-route for driving (<=55m)
    expect(isSignificantlyOffRoute(45, 5, 'cycling')).toBe(true)
    expect(isSignificantlyOffRoute(45, 5, 'driving')).toBe(false)
  })
})
