import { isValidCoordinate } from '../../coordinates'
import { getCategoryByKey } from './categories'
import type { GeocodingProvider, GeocodingResult, PlaceAddress, SearchOptions } from './types'

export interface NominatimPlace {
  place_id?: number | string
  osm_type?: string
  osm_id?: number | string
  lat?: string | number
  lon?: string | number
  name?: string
  display_name?: string
  category?: string
  type?: string
  address?: {
    road?: string
    house_number?: string
    city?: string
    town?: string
    village?: string
    state?: string
    postcode?: string
    country?: string
  }
}

export function parseNominatimPlace(raw: unknown, fallbackIndex = 0): GeocodingResult | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as NominatimPlace
  const lat = typeof item.lat === 'string' ? parseFloat(item.lat) : item.lat
  const lon = typeof item.lon === 'string' ? parseFloat(item.lon) : item.lon
  if (typeof lat !== 'number' || typeof lon !== 'number' || !isValidCoordinate(lon, lat)) return null

  const addr = item.address || {}
  const city = addr.city || addr.town || addr.village
  const address: PlaceAddress = {
    street: addr.road,
    housenumber: addr.house_number,
    city,
    state: addr.state,
    postcode: addr.postcode,
    country: addr.country,
  }

  const name = (item.name || item.display_name?.split(',')[0] || 'Location').trim()
  const displayName = (item.display_name || name).trim()

  const osmType = item.osm_type || 'node'
  const osmId = item.osm_id != null ? String(item.osm_id) : String(fallbackIndex)
  const id = `osm-${osmType.slice(0, 1).toLowerCase()}-${osmId}`

  return {
    id,
    name,
    displayName,
    latitude: lat,
    longitude: lon,
    category: item.category,
    type: item.type,
    address,
    raw: item,
  }
}

export function parseNominatimResponse(data: unknown): GeocodingResult[] {
  if (!Array.isArray(data)) return []
  const results: GeocodingResult[] = []
  data.forEach((item, index) => {
    const parsed = parseNominatimPlace(item, index)
    if (parsed) results.push(parsed)
  })
  return results
}

function combineSignals(timeoutMs: number, userSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Search request timed out')), timeoutMs)
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

export class NominatimProvider implements GeocodingProvider {
  readonly id = 'nominatim'
  readonly name = 'Nominatim (OpenStreetMap)'
  readonly attribution = 'Data © OpenStreetMap contributors, ODbL 1.0 (Nominatim)'
  readonly baseUrl: string

  constructor(baseUrl = 'https://nominatim.openstreetmap.org') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async search(query: string, options?: SearchOptions): Promise<GeocodingResult[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const limit = options?.limit ?? 8
    const params = new URLSearchParams({
      q: trimmed,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(limit),
    })

    if (options?.center && isValidCoordinate(options.center[0], options.center[1])) {
      // viewbox around center (~0.3 deg)
      const [lon, lat] = options.center
      const delta = 0.25
      params.set('viewbox', `${(lon - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lon + delta).toFixed(4)},${(lat - delta).toFixed(4)}`)
      params.set('bounded', '0')
    }

    const url = `${this.baseUrl}/search?${params.toString()}`
    const { signal, cleanup } = combineSignals(8000, options?.signal)

    try {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`Nominatim search failed with status ${response.status}`)
      }
      const data = await response.json()
      return parseNominatimResponse(data)
    } finally {
      cleanup()
    }
  }

  async nearby(categoryKey: string, center: [number, number], options?: SearchOptions): Promise<GeocodingResult[]> {
    if (!isValidCoordinate(center[0], center[1])) return []
    const category = getCategoryByKey(categoryKey)
    const limit = options?.limit ?? 12

    const [lon, lat] = center
    const delta = 0.08 // ~8 km window
    const params = new URLSearchParams({
      q: category ? category.query : categoryKey,
      format: 'jsonv2',
      addressdetails: '1',
      viewbox: `${(lon - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lon + delta).toFixed(4)},${(lat - delta).toFixed(4)}`,
      bounded: '1',
      limit: String(limit),
    })

    const url = `${this.baseUrl}/search?${params.toString()}`
    const { signal, cleanup } = combineSignals(9000, options?.signal)

    try {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`Nominatim nearby failed with status ${response.status}`)
      }
      const data = await response.json()
      return parseNominatimResponse(data)
    } finally {
      cleanup()
    }
  }
}
