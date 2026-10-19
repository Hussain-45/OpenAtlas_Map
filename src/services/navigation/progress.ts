import {
  calculateDistanceMeters,
  distanceToPolylineMeters,
  isValidCoordinate,
} from '../../coordinates'
import type { Route, TravelMode } from '../routing/types'
import type { GPSAccuracyLevel, LiveLocation, NavigationProgress } from './types'

export function getAccuracyLevel(accuracyMeters: number | null): GPSAccuracyLevel {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    return 'unavailable'
  }
  if (accuracyMeters <= 20) return 'good'
  if (accuracyMeters <= 50) return 'medium'
  return 'poor'
}

export function isSignificantlyOffRoute(
  offRouteDistanceMeters: number,
  accuracyMeters: number | null,
  travelMode: TravelMode = 'driving',
  customThreshold?: number
): boolean {
  if (!Number.isFinite(offRouteDistanceMeters) || offRouteDistanceMeters < 0) return false

  const baseThreshold = customThreshold ?? (
    travelMode === 'walking' ? 35 : travelMode === 'cycling' ? 40 : 55
  )

  // Account for GPS inaccuracy: if accuracy is +-30m, don't trigger unless distance exceeds tolerance
  const gpsBuffer = (accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters > 0)
    ? accuracyMeters * 1.2
    : 0

  const effectiveThreshold = Math.max(baseThreshold, gpsBuffer)
  return offRouteDistanceMeters > effectiveThreshold
}

/**
 * Calculates remaining distance along the polyline starting from closest segment index.
 */
export function calculateRemainingPolylineDistanceMeters(
  closestPoint: [number, number],
  closestSegmentIndex: number,
  polyline: [number, number][]
): number {
  if (!polyline || polyline.length < 2 || closestSegmentIndex < 0 || closestSegmentIndex >= polyline.length - 1) {
    return 0
  }

  // Distance from closest point to end of the current segment
  const segEnd = polyline[closestSegmentIndex + 1]
  let total = calculateDistanceMeters(closestPoint[0], closestPoint[1], segEnd[0], segEnd[1])

  // Sum distances of all subsequent segments
  for (let i = closestSegmentIndex + 1; i < polyline.length - 1; i++) {
    total += calculateDistanceMeters(
      polyline[i][0],
      polyline[i][1],
      polyline[i + 1][0],
      polyline[i + 1][1]
    )
  }

  return total
}

export function calculateRouteProgress(
  location: LiveLocation,
  route: Route,
  previousStepIndex = 0,
  travelMode: TravelMode = 'driving'
): NavigationProgress {
  const accuracyLevel = getAccuracyLevel(location.accuracyMeters)

  if (!route.coordinates || route.coordinates.length === 0 || !isValidCoordinate(location.longitude, location.latitude)) {
    return {
      currentStepIndex: 0,
      nextStep: null,
      distanceToNextStepMeters: 0,
      remainingDistanceMeters: 0,
      remainingDurationSeconds: 0,
      isOffRoute: false,
      offRouteDistanceMeters: 0,
      hasArrived: false,
      closestPointOnRoute: [location.longitude, location.latitude],
      accuracyLevel,
    }
  }

  const destinationCoord = route.coordinates[route.coordinates.length - 1]
  const distToDestination = calculateDistanceMeters(
    location.longitude,
    location.latitude,
    destinationCoord[0],
    destinationCoord[1]
  )

  // Arrival threshold: 20m for walking, 25m for cycling, 35m for driving
  const arrivalThreshold = travelMode === 'walking' ? 20 : travelMode === 'cycling' ? 25 : 35
  const hasArrived = distToDestination <= arrivalThreshold

  // Polyline projection
  const polyDist = distanceToPolylineMeters(
    [location.longitude, location.latitude],
    route.coordinates
  )

  const isOffRoute = !hasArrived && isSignificantlyOffRoute(
    polyDist.distanceMeters,
    location.accuracyMeters,
    travelMode
  )

  // Step advancement
  const steps = route.steps || []
  let currentStepIndex = Math.max(0, Math.min(previousStepIndex, steps.length - 1))

  if (!hasArrived && steps.length > 1) {
    if (currentStepIndex === 0) {
      const departStep = steps[0]
      const nextStep = steps[1]
      const distToDepart = calculateDistanceMeters(
        location.longitude,
        location.latitude,
        departStep.location[0],
        departStep.location[1]
      )
      const distToNext = calculateDistanceMeters(
        location.longitude,
        location.latitude,
        nextStep.location[0],
        nextStep.location[1]
      )

      // If user is within 35m of depart location, they are just departing (stay on step 0)
      // Once user moves beyond 35m from start or gets close to step 1, advance to step 1
      if (distToNext <= 50 || (distToDepart > 35 && distToNext < distToDepart)) {
        currentStepIndex = 1
      }
    } else if (currentStepIndex < steps.length - 1) {
      const activeStep = steps[currentStepIndex]
      const distToActive = calculateDistanceMeters(
        location.longitude,
        location.latitude,
        activeStep.location[0],
        activeStep.location[1]
      )

      const nextStepCandidate = steps[currentStepIndex + 1]
      const distToNext = calculateDistanceMeters(
        location.longitude,
        location.latitude,
        nextStepCandidate.location[0],
        nextStepCandidate.location[1]
      )

      // Advance if within arrival radius of current maneuver or close to next
      if (distToActive <= arrivalThreshold || (distToNext < 50 && distToNext < distToActive)) {
        currentStepIndex = Math.min(steps.length - 1, currentStepIndex + 1)
      }
    }
  }

  const nextStep = steps[currentStepIndex] || null
  const distanceToNextStepMeters = nextStep
    ? calculateDistanceMeters(
        location.longitude,
        location.latitude,
        nextStep.location[0],
        nextStep.location[1]
      )
    : 0

  // Calculate remaining distance along route
  let remainingDistanceMeters = calculateRemainingPolylineDistanceMeters(
    polyDist.closestPoint,
    polyDist.closestSegmentIndex,
    route.coordinates
  )

  if (hasArrived) {
    remainingDistanceMeters = 0
  }

  // Calculate remaining duration
  let remainingDurationSeconds = 0
  if (!hasArrived && route.distanceMeters > 0) {
    const fractionRemaining = remainingDistanceMeters / route.distanceMeters
    remainingDurationSeconds = Math.max(15, Math.round(route.durationSeconds * fractionRemaining))
  }

  return {
    currentStepIndex,
    nextStep,
    distanceToNextStepMeters,
    remainingDistanceMeters,
    remainingDurationSeconds,
    isOffRoute,
    offRouteDistanceMeters: Math.round(polyDist.distanceMeters),
    hasArrived,
    closestPointOnRoute: polyDist.closestPoint,
    accuracyLevel,
  }
}
