import { isValidCoordinate } from '../../coordinates'
import type { Route, RouteEndpoint, RouteRequest, RouteStep, RoutingProvider, TravelMode } from './types'

export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  let index = 0
  let lat = 0
  let lng = 0
  const coordinates: [number, number][] = []
  const factor = Math.pow(10, precision)

  while (index < encoded.length) {
    let b: number
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lat += dlat

    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lng += dlng

    const pLon = lng / factor
    const pLat = lat / factor
    if (isValidCoordinate(pLon, pLat)) {
      coordinates.push([pLon, pLat])
    }
  }
  return coordinates
}

export interface ValhallaManeuver {
  type?: number
  instruction?: string
  length?: number // km
  time?: number // seconds
  street_names?: string[]
  begin_shape_index?: number
  end_shape_index?: number
}

export interface ValhallaLeg {
  shape?: string
  summary?: {
    length?: number
    time?: number
  }
  maneuvers?: ValhallaManeuver[]
}

export interface ValhallaResponse {
  trip?: {
    status?: number
    status_message?: string
    summary?: {
      length?: number // km
      time?: number // seconds
    }
    legs?: ValhallaLeg[]
  }
}

export function parseValhallaResponse(data: unknown, mode: TravelMode, waypoints?: RouteEndpoint[]): Route[] {
  if (!data || typeof data !== 'object') return []
  const res = data as ValhallaResponse
  const trip = res.trip
  if (!trip || !Array.isArray(trip.legs) || trip.legs.length === 0) {
    throw new Error('No route found from Valhalla service.')
  }

  const coordinates: [number, number][] = []
  const steps: RouteStep[] = []
  let accumulatedKm = 0
  let accumulatedSeconds = 0

  for (const leg of trip.legs) {
    const legCoords = leg.shape ? decodePolyline(leg.shape, 6) : []
    const startIdx = coordinates.length
    coordinates.push(...legCoords)

    const rawManeuvers = leg.maneuvers || []
    rawManeuvers.forEach(maneuver => {
      const locIdx = (maneuver.begin_shape_index ?? 0) + startIdx
      const stepLocation = coordinates[locIdx] || legCoords[0] || [0, 0]
      steps.push({
        instruction: maneuver.instruction || 'Proceed on route',
        distanceMeters: Math.round((maneuver.length || 0) * 1000),
        durationSeconds: Math.round(maneuver.time || 0),
        type: maneuver.type != null ? String(maneuver.type) : undefined,
        name: maneuver.street_names?.[0],
        location: stepLocation,
      })
    })

    accumulatedKm += leg.summary?.length ?? 0
    accumulatedSeconds += leg.summary?.time ?? 0
  }

  const distanceKm = trip.summary?.length ?? accumulatedKm
  const durationSeconds = trip.summary?.time ?? accumulatedSeconds

  const numStops = waypoints && waypoints.length > 0 ? waypoints.length : 0
  let summary = `${mode.charAt(0).toUpperCase() + mode.slice(1)} Route`
  if (numStops > 0) {
    summary = `Via ${numStops} ${numStops === 1 ? 'stop' : 'stops'} · ${summary}`
  }

  return [
    {
      id: `route-valhalla-${Date.now()}`,
      summary,
      distanceMeters: Math.round(distanceKm * 1000),
      durationSeconds: Math.round(durationSeconds),
      coordinates,
      steps,
      mode,
      isAlternative: false,
      waypoints,
    },
  ]
}

function combineSignals(timeoutMs: number, userSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Routing request timed out')), timeoutMs)
  const onUserAbort = () => controller.abort(userSignal?.reason)
  if (userSignal) {
    if (userSignal.aborted) controller.abort(userSignal.reason)
    else userSignal.addEventListener('abort', onUserAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort)
    },
  }
}

export class ValhallaProvider implements RoutingProvider {
  readonly id = 'valhalla'
  readonly name = 'Valhalla (OpenStreetMap)'
  readonly attribution = 'Route data © OpenStreetMap contributors via Valhalla'
  readonly supportedModes: TravelMode[] = ['driving', 'walking', 'cycling']
  readonly baseUrl: string

  constructor(baseUrl = 'https://valhalla1.openstreetmap.de') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async calculateRoute(request: RouteRequest): Promise<Route[]> {
    const { origin, destination, waypoints = [], mode } = request

    if (!isValidCoordinate(origin.longitude, origin.latitude)) {
      throw new Error('Invalid origin coordinates.')
    }
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i]
      if (!isValidCoordinate(wp.longitude, wp.latitude)) {
        throw new Error(`Invalid coordinates for intermediate stop ${i + 1} (${wp.name || 'unnamed'}).`)
      }
    }
    if (!isValidCoordinate(destination.longitude, destination.latitude)) {
      throw new Error('Invalid destination coordinates.')
    }

    const costing = mode === 'walking' ? 'pedestrian' : mode === 'cycling' ? 'bicycle' : 'auto'
    const locations = [
      { lon: origin.longitude, lat: origin.latitude },
      ...waypoints.map(w => ({ lon: w.longitude, lat: w.latitude })),
      { lon: destination.longitude, lat: destination.latitude },
    ]
    const body = {
      locations,
      costing,
      directions_options: {
        units: 'kilometers',
      },
    }

    const url = `${this.baseUrl}/route`
    const { signal, cleanup } = combineSignals(12000, request.signal)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        throw new Error(`Valhalla routing failed with status ${response.status}`)
      }
      const data = await response.json()
      return parseValhallaResponse(data, mode, waypoints)
    } finally {
      cleanup()
    }
  }
}
