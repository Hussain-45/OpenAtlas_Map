export function formatCoordinates(longitude: number, latitude: number): string {
  return `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`
}

export function isValidCoordinate(longitude: number, latitude: number): boolean {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  )
}

/**
 * Calculates distance between two points in meters using the Haversine formula.
 */
export function calculateDistanceMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  if (!isValidCoordinate(lon1, lat1) || !isValidCoordinate(lon2, lat2)) return 0
  const R = 6371000 // Earth radius in meters
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c)
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return ''
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const mins = Math.round(seconds / 60)
  if (mins < 1) return '< 1 min'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'}`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) {
    return remMins === 0
      ? `${hours} hr${hours === 1 ? '' : 's'}`
      : `${hours} hr${hours === 1 ? '' : 's'} ${remMins} min${remMins === 1 ? '' : 's'}`
  }
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours === 0
    ? `${days} day${days === 1 ? '' : 's'}`
    : `${days} day${days === 1 ? '' : 's'} ${remHours} hr${remHours === 1 ? '' : 's'}`
}

/**
 * Calculates initial bearing in degrees (0..360) from point 1 to point 2.
 * Returns null if points are virtually identical.
 */
export function calculateBearing(lon1: number, lat1: number, lon2: number, lat2: number): number | null {
  if (!isValidCoordinate(lon1, lat1) || !isValidCoordinate(lon2, lat2)) return null
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const lat1Rad = lat1 * (Math.PI / 180)
  const lat2Rad = lat2 * (Math.PI / 180)

  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null

  const bearing = (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360
  return Math.round(bearing * 10) / 10
}

/**
 * Calculates perpendicular/closest distance in meters from point P(px, py)
 * to line segment A(ax, ay) -> B(bx, by).
 */
export function distanceToSegmentMeters(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { distanceMeters: number; closestPoint: [number, number]; t: number } {
  if (!isValidCoordinate(px, py) || !isValidCoordinate(ax, ay) || !isValidCoordinate(bx, by)) {
    return { distanceMeters: Infinity, closestPoint: [ax, ay], t: 0 }
  }

  const midLat = ((ay + by) / 2) * (Math.PI / 180)
  const cosLat = Math.cos(midLat)
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * cosLat

  const dx = (bx - ax) * mPerDegLon
  const dy = (by - ay) * mPerDegLat
  const segLenSq = dx * dx + dy * dy

  if (segLenSq < 1e-4) {
    const dist = calculateDistanceMeters(px, py, ax, ay)
    return { distanceMeters: dist, closestPoint: [ax, ay], t: 0 }
  }

  const pxM = (px - ax) * mPerDegLon
  const pyM = (py - ay) * mPerDegLat

  let t = (pxM * dx + pyM * dy) / segLenSq
  t = Math.max(0, Math.min(1, t))

  const closestLon = ax + t * (bx - ax)
  const closestLat = ay + t * (by - ay)

  const distMeters = calculateDistanceMeters(px, py, closestLon, closestLat)
  return { distanceMeters: distMeters, closestPoint: [closestLon, closestLat], t }
}

/**
 * Calculates the shortest distance in meters from a coordinate point to a polyline,
 * along with the closest segment index and point on the polyline.
 */
export function distanceToPolylineMeters(
  point: [number, number],
  polyline: [number, number][]
): { distanceMeters: number; closestSegmentIndex: number; closestPoint: [number, number] } {
  if (!Array.isArray(polyline) || polyline.length === 0 || !isValidCoordinate(point[0], point[1])) {
    return { distanceMeters: Infinity, closestSegmentIndex: -1, closestPoint: [0, 0] }
  }

  if (polyline.length === 1) {
    const p0 = polyline[0]
    return {
      distanceMeters: calculateDistanceMeters(point[0], point[1], p0[0], p0[1]),
      closestSegmentIndex: 0,
      closestPoint: p0,
    }
  }

  let minDistance = Infinity
  let bestSegment = 0
  let bestPoint: [number, number] = polyline[0]

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]
    const { distanceMeters, closestPoint } = distanceToSegmentMeters(
      point[0],
      point[1],
      a[0],
      a[1],
      b[0],
      b[1]
    )

    if (distanceMeters < minDistance) {
      minDistance = distanceMeters
      bestSegment = i
      bestPoint = closestPoint
    }
  }

  return {
    distanceMeters: minDistance,
    closestSegmentIndex: bestSegment,
    closestPoint: bestPoint,
  }
}

