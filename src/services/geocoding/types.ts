export interface PlaceAddress {
  street?: string
  housenumber?: string
  city?: string
  state?: string
  postcode?: string
  country?: string
}

export interface GeocodingResult {
  id: string
  name: string
  displayName: string
  latitude: number
  longitude: number
  category?: string
  type?: string
  address?: PlaceAddress
  raw?: unknown
}

export interface SearchOptions {
  signal?: AbortSignal
  center?: [number, number] // [lon, lat]
  limit?: number
}

export interface NearbyCategory {
  key: string
  label: string
  iconName: string
  osmTag: string
  query: string
}

export interface GeocodingProvider {
  readonly id: string
  readonly name: string
  readonly attribution: string
  search(query: string, options?: SearchOptions): Promise<GeocodingResult[]>
  nearby(categoryKey: string, center: [number, number], options?: SearchOptions): Promise<GeocodingResult[]>
}
