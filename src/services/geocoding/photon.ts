import { isValidCoordinate } from '../../coordinates'
import { getCategoryByKey } from './categories'
import type { GeocodingProvider, GeocodingResult, PlaceAddress, SearchOptions } from './types'

export interface PhotonFeature {
  type: string
  geometry?: {
    type?: string
    coordinates?: [number, number]
  }
  properties?: {
    osm_id?: number | string
    osm_type?: string
    osm_key?: string
    osm_value?: string
    type?: string
    name?: string
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    state?: string
    country?: string
    countrycode?: string
  }
}

export function parsePhotonFeature(raw: unknown, fallbackIndex = 0): GeocodingResult | null {
  if (!raw || typeof raw !== 'object') return null
  const feature = raw as PhotonFeature
  const coords = feature.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return null
  const [lon, lat] = coords
  if (typeof lon !== 'number' || typeof lat !== 'number' || !isValidCoordinate(lon, lat)) return null

  const props = feature.properties || {}
  const address: PlaceAddress = {
    street: props.street,
    housenumber: props.housenumber,
    city: props.city,
    state: props.state,
    postcode: props.postcode,
    country: props.country,
  }

  // Format primary name
  let name = (props.name || '').trim()
  if (!name) {
    if (props.street) {
      name = props.housenumber ? `${props.housenumber} ${props.street}` : props.street
    } else if (props.osm_value) {
      name = props.osm_value.charAt(0).toUpperCase() + props.osm_value.slice(1).replace(/_/g, ' ')
    } else if (props.city) {
      name = props.city
    } else {
      name = 'Location'
    }
  }

  // Format descriptive location / address line
  const parts: string[] = []
  if (props.street && props.name && props.street !== props.name) {
    parts.push(props.housenumber ? `${props.housenumber} ${props.street}` : props.street)
  }
  if (props.city && props.city !== props.name) parts.push(props.city)
  if (props.state && props.state !== props.city) parts.push(props.state)
  if (props.country) parts.push(props.country)
  const displayName = parts.length ? parts.join(', ') : name

  const osmType = props.osm_type || 'N'
  const osmId = props.osm_id != null ? String(props.osm_id) : String(fallbackIndex)
  const id = `osm-${osmType.toLowerCase()}-${osmId}`

  return {
    id,
    name,
    displayName,
    latitude: lat,
    longitude: lon,
    category: props.osm_key,
    type: props.osm_value || props.type,
    address,
    raw: feature,
  }
}

export function parsePhotonResponse(data: unknown): GeocodingResult[] {
  if (!data || typeof data !== 'object') return []
  const collection = data as { type?: string; features?: unknown[] }
  if (!Array.isArray(collection.features)) return []
  const results: GeocodingResult[] = []
  collection.features.forEach((feature, index) => {
    const parsed = parsePhotonFeature(feature, index)
    if (parsed) results.push(parsed)
  })
  return results
}

function combineSignals(timeoutMs: number, userSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Search request timed out')), timeoutMs)
  const onUserAbort = () => controller.abort(userSignal?.reason)
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason)
    } else {
      userSignal.addEventListener('abort', onUserAbort, { once: true })
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort)
    },
  }
}

export class PhotonProvider implements GeocodingProvider {
  readonly id = 'photon'
  readonly name = 'Photon (OpenStreetMap via Komoot)'
  readonly attribution = 'Search data © OpenStreetMap contributors via Photon'
  readonly baseUrl: string

  constructor(baseUrl = 'https://photon.komoot.io') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async search(query: string, options?: SearchOptions): Promise<GeocodingResult[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const limit = options?.limit ?? 8
    const params = new URLSearchParams({
      q: trimmed,
      limit: String(limit),
    })

    if (options?.center && isValidCoordinate(options.center[0], options.center[1])) {
      params.set('lon', options.center[0].toFixed(5))
      params.set('lat', options.center[1].toFixed(5))
    }

    const url = `${this.baseUrl}/api/?${params.toString()}`
    const { signal, cleanup } = combineSignals(8000, options?.signal)

    try {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`Photon search failed with status ${response.status}`)
      }
      const data = await response.json()
      return parsePhotonResponse(data)
    } finally {
      cleanup()
    }
  }

  async nearby(categoryKey: string, center: [number, number], options?: SearchOptions): Promise<GeocodingResult[]> {
    if (!isValidCoordinate(center[0], center[1])) return []
    const category = getCategoryByKey(categoryKey)
    const limit = options?.limit ?? 12

    const params = new URLSearchParams({
      q: category ? category.query : categoryKey,
      lon: center[0].toFixed(5),
      lat: center[1].toFixed(5),
      limit: String(limit),
    })

    if (category?.osmTag) {
      params.set('osm_tag', category.osmTag)
    }

    const url = `${this.baseUrl}/api/?${params.toString()}`
    const { signal, cleanup } = combineSignals(9000, options?.signal)

    try {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`Photon nearby query failed with status ${response.status}`)
      }
      const data = await response.json()
      return parsePhotonResponse(data)
    } finally {
      cleanup()
    }
  }
}
