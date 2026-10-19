import { OSRMProvider } from './osrm'
import type { Route, RouteRequest, RoutingProvider, TravelMode } from './types'
import { ValhallaProvider } from './valhalla'

export * from './types'
export * from './osrm'
export * from './valhalla'
export * from './mapRoute'
export * from './offlineDelhiRouting'

export class MultiModalRoutingProvider implements RoutingProvider {
  readonly id = 'multimodal'
  readonly name = 'OpenAtlas Router (OSRM + Valhalla)'
  readonly supportedModes: TravelMode[] = ['driving', 'walking', 'cycling']

  private osrm: OSRMProvider
  private valhalla: ValhallaProvider

  constructor(osrmUrl?: string, valhallaUrl?: string) {
    this.osrm = new OSRMProvider(osrmUrl)
    this.valhalla = new ValhallaProvider(valhallaUrl)
  }

  get attribution(): string {
    return 'Route data © OpenStreetMap contributors via OSRM & Valhalla'
  }

  async calculateRoute(request: RouteRequest): Promise<Route[]> {
    // For walking and cycling, Valhalla uses dedicated pedestrian/bicycle costing engines with realistic speeds
    if (request.mode === 'walking' || request.mode === 'cycling') {
      try {
        return await this.valhalla.calculateRoute(request)
      } catch {
        // Fallback to OSRM if Valhalla fails or is unreachable
        return await this.osrm.calculateRoute(request)
      }
    }
    return this.osrm.calculateRoute(request)
  }
}

export function getRoutingProvider(providerId?: string, customUrl?: string): RoutingProvider {
  const chosen = (providerId || import.meta.env.VITE_ROUTING_PROVIDER || 'auto').toLowerCase()
  const customBaseUrl = customUrl || import.meta.env.VITE_ROUTING_API_URL

  if (chosen === 'valhalla') {
    return new ValhallaProvider(customBaseUrl || undefined)
  }
  if (chosen === 'osrm') {
    return new OSRMProvider(customBaseUrl || undefined)
  }

  return new MultiModalRoutingProvider(
    undefined,
    import.meta.env.VITE_VALHALLA_API_URL || undefined
  )
}
