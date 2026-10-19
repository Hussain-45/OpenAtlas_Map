import { describe, expect, it } from 'vitest'
import {
  calculateBearing,
  calculateDistanceMeters,
  distanceToPolylineMeters,
  distanceToSegmentMeters,
  formatCoordinates,
  formatDistance,
  formatDuration,
  isValidCoordinate,
} from './coordinates'

describe('formatCoordinates', () => {
  it('prints latitude before longitude with five decimal places', () => {
    expect(formatCoordinates(-73.9857, 40.7484)).toBe('40.74840°, -73.98570°')
  })

  it('handles zero coordinates', () => {
    expect(formatCoordinates(0, 0)).toBe('0.00000°, 0.00000°')
  })

  it('formats positive and negative extremes properly', () => {
    expect(formatCoordinates(180, 90)).toBe('90.00000°, 180.00000°')
    expect(formatCoordinates(-180, -90)).toBe('-90.00000°, -180.00000°')
  })
})

describe('isValidCoordinate', () => {
  it('accepts valid coordinates within boundaries', () => {
    expect(isValidCoordinate(0, 0)).toBe(true)
    expect(isValidCoordinate(77.209, 28.6139)).toBe(true)
    expect(isValidCoordinate(-180, -90)).toBe(true)
    expect(isValidCoordinate(180, 90)).toBe(true)
  })

  it('rejects coordinates exceeding longitude range (-180 to 180)', () => {
    expect(isValidCoordinate(180.1, 0)).toBe(false)
    expect(isValidCoordinate(-180.1, 0)).toBe(false)
  })

  it('rejects coordinates exceeding latitude range (-90 to 90)', () => {
    expect(isValidCoordinate(0, 90.1)).toBe(false)
    expect(isValidCoordinate(0, -90.1)).toBe(false)
  })

  it('rejects NaN and non-finite values', () => {
    expect(isValidCoordinate(NaN, 0)).toBe(false)
    expect(isValidCoordinate(0, Infinity)).toBe(false)
    expect(isValidCoordinate(-Infinity, 0)).toBe(false)
  })
})

describe('calculateDistanceMeters and formatDistance', () => {
  it('calculates approximate distance between known points', () => {
    // Connaught Place Delhi (77.2197, 28.6315) to India Gate (77.2295, 28.6129) is ~2.3 km
    const dist = calculateDistanceMeters(77.2197, 28.6315, 77.2295, 28.6129)
    expect(dist).toBeGreaterThan(2000)
    expect(dist).toBeLessThan(2500)
  })

  it('returns 0 for identical points', () => {
    expect(calculateDistanceMeters(77.2, 28.6, 77.2, 28.6)).toBe(0)
  })

  it('returns 0 for invalid coordinates', () => {
    expect(calculateDistanceMeters(NaN, 0, 77.2, 28.6)).toBe(0)
    expect(calculateDistanceMeters(77.2, 28.6, 190, 28.6)).toBe(0)
  })

  it('formats distance in meters and kilometers correctly', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(450)).toBe('450 m')
    expect(formatDistance(999)).toBe('999 m')
    expect(formatDistance(1250)).toBe('1.3 km')
    expect(formatDistance(15400)).toBe('15 km')
    expect(formatDistance(-10)).toBe('')
  })

  it('formats duration in minutes, hours, and days correctly', () => {
    expect(formatDuration(0)).toBe('< 1 min')
    expect(formatDuration(25)).toBe('< 1 min')
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(480)).toBe('8 mins')
    expect(formatDuration(3600)).toBe('1 hr')
    expect(formatDuration(4500)).toBe('1 hr 15 mins')
    expect(formatDuration(7200)).toBe('2 hrs')
    expect(formatDuration(86400)).toBe('1 day')
    expect(formatDuration(93600)).toBe('1 day 2 hrs')
    expect(formatDuration(-5)).toBe('')
    expect(formatDuration(NaN)).toBe('')
  })
})

describe('calculateBearing', () => {
  it('calculates cardinal bearings accurately', () => {
    // Due North
    expect(calculateBearing(0, 0, 0, 1)).toBeCloseTo(0, 0)
    // Due East
    expect(calculateBearing(0, 0, 1, 0)).toBeCloseTo(90, 0)
    // Due South
    expect(calculateBearing(0, 1, 0, 0)).toBeCloseTo(180, 0)
    // Due West
    expect(calculateBearing(1, 0, 0, 0)).toBeCloseTo(270, 0)
  })

  it('returns null for identical or invalid coordinates', () => {
    expect(calculateBearing(77.2, 28.6, 77.2, 28.6)).toBeNull()
    expect(calculateBearing(NaN, 0, 0, 0)).toBeNull()
    expect(calculateBearing(0, 0, 200, 0)).toBeNull()
  })
})

describe('distanceToSegmentMeters and distanceToPolylineMeters', () => {
  it('calculates point distance to line segment', () => {
    // Segment from (0, 0) to (2, 0) along equator
    // Point (1, 0) is directly in the middle on segment
    const onSeg = distanceToSegmentMeters(1, 0, 0, 0, 2, 0)
    expect(onSeg.distanceMeters).toBe(0)
    expect(onSeg.t).toBeCloseTo(0.5, 1)

    // Point (1, 0.001) is ~111m north of midpoint
    const offSeg = distanceToSegmentMeters(1, 0.001, 0, 0, 2, 0)
    expect(offSeg.distanceMeters).toBeGreaterThan(100)
    expect(offSeg.distanceMeters).toBeLessThan(125)

    // Point before start (-1, 0) clamps t to 0
    const beforeSeg = distanceToSegmentMeters(-1, 0, 0, 0, 2, 0)
    expect(beforeSeg.t).toBe(0)

    // Point after end (3, 0) clamps t to 1
    const afterSeg = distanceToSegmentMeters(3, 0, 0, 0, 2, 0)
    expect(afterSeg.t).toBe(1)
  })

  it('calculates shortest distance to polyline', () => {
    const polyline: [number, number][] = [
      [77.200, 28.600],
      [77.210, 28.600],
      [77.210, 28.610],
    ]

    // Point right on second segment
    const onRoute = distanceToPolylineMeters([77.210, 28.605], polyline)
    expect(onRoute.distanceMeters).toBe(0)
    expect(onRoute.closestSegmentIndex).toBe(1)

    // Point 50m away from first segment
    const offRoute = distanceToPolylineMeters([77.205, 28.6005], polyline)
    expect(offRoute.distanceMeters).toBeGreaterThan(40)
    expect(offRoute.distanceMeters).toBeLessThan(70)
    expect(offRoute.closestSegmentIndex).toBe(0)

    // Empty polyline or invalid point
    expect(distanceToPolylineMeters([0, 0], []).distanceMeters).toBe(Infinity)
  })
})

