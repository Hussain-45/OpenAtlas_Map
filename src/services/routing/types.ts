export type TravelMode = 'driving' | 'walking' | 'cycling'

export interface RouteStep {
  instruction: string
  distanceMeters: number
  durationSeconds: number
  modifier?: string
  type?: string
  name?: string
  location: [number, number] // [lon, lat]
}

export interface RouteEndpoint {
  id?: string
  name: string
  latitude: number
  longitude: number
  type: 'search' | 'nearby' | 'pin' | 'gps' | 'saved' | 'custom'
}

export interface RouteRequest {
  origin: RouteEndpoint
  destination: RouteEndpoint
  waypoints?: RouteEndpoint[]
  mode: TravelMode
  alternatives?: boolean
  signal?: AbortSignal
}

export interface Route {
  id: string
  summary: string
  distanceMeters: number
  durationSeconds: number
  coordinates: [number, number][] // [lon, lat][]
  steps: RouteStep[]
  mode: TravelMode
  isAlternative?: boolean
  waypoints?: RouteEndpoint[]
}

export interface RoutingProvider {
  readonly id: string
  readonly name: string
  readonly attribution: string
  readonly supportedModes: TravelMode[]
  calculateRoute(request: RouteRequest): Promise<Route[]>
}
