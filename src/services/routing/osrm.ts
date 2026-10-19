import { isValidCoordinate } from '../../coordinates'
import type { Route, RouteEndpoint, RouteRequest, RouteStep, RoutingProvider, TravelMode } from './types'

export interface OSRMManeuver {
  type?: string
  modifier?: string
  location?: [number, number]
  exit?: number
}

export interface OSRMStep {
  name?: string
  distance?: number
  duration?: number
  maneuver?: OSRMManeuver
  mode?: string
}

export interface OSRMLeg {
  summary?: string
  distance?: number
  duration?: number
  steps?: OSRMStep[]
}

export interface OSRMRoute {
  geometry?: {
    coordinates?: [number, number][]
    type?: string
  }
  distance?: number
  duration?: number
  legs?: OSRMLeg[]
  weight_name?: string
}

export interface OSRMResponse {
  code?: string
  message?: string
  routes?: OSRMRoute[]
}

export function formatOSRMStepInstruction(step: OSRMStep): string {
  const maneuver = step.maneuver || {}
  const type = maneuver.type || 'continue'
  const modifier = (maneuver.modifier || '').replace(/_/g, ' ')
  const name = (step.name || '').trim()

  if (type === 'depart') {
    return name ? `Depart on ${name}` : 'Depart on road'
  }
  if (type === 'arrive') {
    return 'Arrive at destination'
  }
  if (type === 'roundabout' || type === 'rotary') {
    const exitStr = maneuver.exit ? ` take exit ${maneuver.exit}` : ''
    return name ? `At roundabout,${exitStr} onto ${name}` : `At roundabout,${exitStr}`
  }
  if (type === 'turn') {
    return name ? `Turn ${modifier || ''} onto ${name}`.replace(/\s+/g, ' ') : `Turn ${modifier || ''}`.trim()
  }
  if (type === 'fork') {
    return name ? `Take ${modifier || ''} fork onto ${name}`.replace(/\s+/g, ' ') : `Take ${modifier || ''} fork`.trim()
  }
  if (type === 'end of road') {
    return name ? `At end of road, turn ${modifier || ''} onto ${name}`.replace(/\s+/g, ' ') : 'At end of road'
  }
  if (type === 'merge') {
    return name ? `Merge ${modifier || ''} onto ${name}`.replace(/\s+/g, ' ') : 'Merge'
  }
  if (type === 'on ramp' || type === 'off ramp') {
    return name ? `Take ramp onto ${name}` : 'Take ramp'
  }

  const prefix = modifier ? `Continue ${modifier}` : 'Continue'
  return name ? `${prefix} onto ${name}` : `${prefix} straight`
}

export function parseOSRMResponse(data: unknown, mode: TravelMode, waypoints?: RouteEndpoint[]): Route[] {
  if (!data || typeof data !== 'object') return []
  const res = data as OSRMResponse
  if (res.code !== 'Ok' || !Array.isArray(res.routes) || res.routes.length === 0) {
    if (res.code === 'NoRoute') {
      throw new Error('No navigable route found between these locations.')
    }
    throw new Error(res.message || 'Routing calculation failed.')
  }

  return res.routes.map((rawRoute, idx) => {
    const rawCoords = rawRoute.geometry?.coordinates || []
    const validCoords = rawCoords.filter(
      (coord): coord is [number, number] =>
        Array.isArray(coord) &&
        coord.length >= 2 &&
        isValidCoordinate(coord[0], coord[1])
    )

    const steps: RouteStep[] = []
    const legs = rawRoute.legs || []
    legs.forEach(leg => {
      (leg.steps || []).forEach(step => {
        const loc = step.maneuver?.location
        const validLoc: [number, number] =
          Array.isArray(loc) && loc.length >= 2 && isValidCoordinate(loc[0], loc[1])
            ? [loc[0], loc[1]]
            : validCoords[0] || [0, 0]

        steps.push({
          instruction: formatOSRMStepInstruction(step),
          distanceMeters: Math.round(step.distance || 0),
          durationSeconds: Math.round(step.duration || 0),
          modifier: step.maneuver?.modifier,
          type: step.maneuver?.type,
          name: step.name,
          location: validLoc,
        })
      })
    })

    const numStops = waypoints && waypoints.length > 0 ? waypoints.length : 0
    let summary = legs[0]?.summary || `Route ${idx + 1}`
    if (numStops > 0) {
      summary = `Via ${numStops} ${numStops === 1 ? 'stop' : 'stops'} · ${summary}`
    }

    return {
      id: `route-osrm-${idx}-${Date.now()}`,
      summary: summary || (idx === 0 ? 'Fastest route' : `Alternative ${idx}`),
      distanceMeters: Math.round(rawRoute.distance || 0),
      durationSeconds: Math.round(rawRoute.duration || 0),
      coordinates: validCoords,
      steps,
      mode,
      isAlternative: idx > 0,
      waypoints,
    }
  })
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

export class OSRMProvider implements RoutingProvider {
  readonly id = 'osrm'
  readonly name = 'OSRM (Open Source Routing Machine)'
  readonly attribution = 'Route data © OpenStreetMap contributors via OSRM'
  readonly supportedModes: TravelMode[] = ['driving', 'walking', 'cycling']
  readonly baseUrl: string

  constructor(baseUrl = 'https://router.project-osrm.org') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async calculateRoute(request: RouteRequest): Promise<Route[]> {
    const { origin, destination, waypoints = [], mode, alternatives } = request

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

    const allPoints = [origin, ...waypoints, destination]
    const profile = mode === 'walking' ? 'walking' : mode === 'cycling' ? 'cycling' : 'driving'
    const coordsStr = allPoints
      .map(p => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`)
      .join(';')
    const altParam = alternatives !== false && waypoints.length === 0 ? '&alternatives=true' : ''
    const url = `${this.baseUrl}/route/v1/${profile}/${coordsStr}?overview=full&geometries=geojson&steps=true${altParam}`

    const { signal, cleanup } = combineSignals(12000, request.signal)

    try {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) {
        if (response.status === 400 || response.status === 404) {
          throw new Error('No route could be found between these coordinates.')
        }
        throw new Error(`Routing service returned status ${response.status}`)
      }
      const data = await response.json()
      return parseOSRMResponse(data, mode, waypoints)
    } finally {
      cleanup()
    }
  }
}
