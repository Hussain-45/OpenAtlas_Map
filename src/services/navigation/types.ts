import type { RouteStep, TravelMode } from '../routing/types'

export type NavigationStatus = 'idle' | 'navigating' | 'paused' | 'arrived'

export type GPSAccuracyLevel = 'good' | 'medium' | 'poor' | 'unavailable'

export interface LiveLocation {
  longitude: number
  latitude: number
  accuracyMeters: number | null
  heading: number | null // in degrees (0..360)
  speedMps: number | null // meters per second
  timestamp: number
}

export interface NavigationProgress {
  currentStepIndex: number
  nextStep: RouteStep | null
  distanceToNextStepMeters: number
  remainingDistanceMeters: number
  remainingDurationSeconds: number
  isOffRoute: boolean
  offRouteDistanceMeters: number
  hasArrived: boolean
  closestPointOnRoute: [number, number]
  accuracyLevel: GPSAccuracyLevel
}

export interface NavigationOptions {
  spokenInstructions?: boolean
  travelMode?: TravelMode
  offRouteThresholdMeters?: number
}
