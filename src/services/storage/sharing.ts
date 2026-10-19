import { isValidCoordinate } from '../../coordinates'
import type { RouteEndpoint, TravelMode } from '../routing/types'

export interface SharedPlacePayload {
  type: 'place'
  place: {
    name: string
    longitude: number
    latitude: number
  }
}

export interface SharedRoutePayload {
  type: 'route'
  route: {
    origin: RouteEndpoint
    destination: RouteEndpoint
    waypoints: RouteEndpoint[]
    mode: TravelMode
  }
}

export type ParsedSharePayload = SharedPlacePayload | SharedRoutePayload

export function generatePlaceShareUrl(
  place: { name: string; longitude: number; latitude: number },
  baseUrl?: string
): string {
  const base = baseUrl || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '')
  const params = new URLSearchParams()
  params.set('place', `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`)
  if (place.name) {
    params.set('name', place.name)
  }
  return `${base}?${params.toString()}`
}

export function generateRouteShareUrl(
  origin: RouteEndpoint,
  destination: RouteEndpoint,
  waypoints: RouteEndpoint[] = [],
  mode: TravelMode = 'driving',
  baseUrl?: string
): string {
  const base = baseUrl || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '')
  const params = new URLSearchParams()
  params.set('route', mode)
  params.set('origin', `${origin.latitude.toFixed(6)},${origin.longitude.toFixed(6)},${origin.name}`)
  params.set('dest', `${destination.latitude.toFixed(6)},${destination.longitude.toFixed(6)},${destination.name}`)

  if (waypoints.length > 0) {
    const stopsStr = waypoints
      .map(w => `${w.latitude.toFixed(6)},${w.longitude.toFixed(6)},${w.name}`)
      .join(';')
    params.set('stops', stopsStr)
  }

  return `${base}?${params.toString()}`
}

function parseEndpointString(str: string, fallbackType: RouteEndpoint['type']): RouteEndpoint | null {
  const parts = str.split(',')
  if (parts.length < 2) return null
  const lat = parseFloat(parts[0])
  const lon = parseFloat(parts[1])
  if (!isValidCoordinate(lon, lat)) return null
  const name = parts.slice(2).join(',').trim() || 'Stop'
  return {
    id: `shared-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    latitude: lat,
    longitude: lon,
    type: fallbackType,
  }
}

export function parseShareParams(searchOrUrl: string): ParsedSharePayload | null {
  try {
    let search = searchOrUrl
    if (search.includes('?')) {
      search = search.substring(search.indexOf('?'))
    }
    const params = new URLSearchParams(search)

    // Check for shared place
    const placeParam = params.get('place')
    if (placeParam) {
      const parts = placeParam.split(',')
      if (parts.length >= 2) {
        const lat = parseFloat(parts[0])
        const lon = parseFloat(parts[1])
        if (isValidCoordinate(lon, lat)) {
          const name = params.get('name') || 'Shared location'
          return {
            type: 'place',
            place: {
              name,
              longitude: lon,
              latitude: lat,
            },
          }
        }
      }
    }

    // Check for shared route
    const routeParam = params.get('route')
    const originParam = params.get('origin')
    const destParam = params.get('dest')

    if (routeParam && originParam && destParam) {
      const validMode: TravelMode =
        routeParam === 'walking' ? 'walking' : routeParam === 'cycling' ? 'cycling' : 'driving'

      const origin = parseEndpointString(originParam, 'custom')
      const destination = parseEndpointString(destParam, 'custom')

      if (origin && destination) {
        const waypoints: RouteEndpoint[] = []
        const stopsParam = params.get('stops')
        if (stopsParam) {
          const stopStrings = stopsParam.split(';')
          for (const stopStr of stopStrings) {
            const stop = parseEndpointString(stopStr, 'custom')
            if (stop) waypoints.push(stop)
          }
        }

        return {
          type: 'route',
          route: {
            origin,
            destination,
            waypoints,
            mode: validMode,
          },
        }
      }
    }

    return null
  } catch {
    return null
  }
}
