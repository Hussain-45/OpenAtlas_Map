import { calculateDistanceMeters, isValidCoordinate } from '../../coordinates'
import { getActiveReleasePointer, getOpfsJson, isOpfsSupported } from '../offline/opfsStorage'
import { ACTIVE_PLACES_FILENAME } from '../offline/datasetUpdateService'
import type { GeocodingProvider, GeocodingResult, SearchOptions } from './types'

// Compact place tuple: [name, longitude, latitude, category, type]
export type CompactPlaceTuple = [string, number, number, string, string]

export class OfflineDelhiProvider implements GeocodingProvider {
  readonly id = 'offline-delhi'
  readonly name = 'Offline Delhi Index'
  readonly attribution = 'Local Delhi Index © OpenStreetMap contributors via BBBike Extract'

  private places: GeocodingResult[] | null = null
  private loadPromise: Promise<GeocodingResult[]> | null = null
  private customDataUrl: string

  constructor(customDataUrl = '/offline/delhi/places.json', initialPlaces?: GeocodingResult[]) {
    this.customDataUrl = customDataUrl
    if (initialPlaces) {
      this.places = initialPlaces
    }
  }

  /**
   * Pre-loads the offline Delhi places database into memory.
   */
  async loadPlaces(signal?: AbortSignal): Promise<GeocodingResult[]> {
    if (this.places) return this.places
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      // 0. Try active OPFS release first
      if (isOpfsSupported()) {
        try {
          const activePointer = await getActiveReleasePointer()
          if (activePointer && activePointer.verified) {
            const opfsTuples = await getOpfsJson<CompactPlaceTuple[]>(ACTIVE_PLACES_FILENAME)
            if (Array.isArray(opfsTuples) && opfsTuples.length > 0) {
              const parsed = this.parseTuples(opfsTuples)
              if (parsed.length > 0) {
                this.places = parsed
                return parsed
              }
            }
          }
        } catch {
          // Fall back to fetch
        }
      }

      try {
        const response = await fetch(this.customDataUrl, { signal })
        if (!response.ok) {
          throw new Error(`Failed to load offline places: HTTP ${response.status}`)
        }
        const data: unknown = await response.json()
        if (!Array.isArray(data)) {
          this.places = []
          return []
        }

        const parsed = this.parseTuples(data as CompactPlaceTuple[])
        this.places = parsed
        return parsed
      } catch (err) {
        if (signal?.aborted) throw err
        console.warn('Offline Delhi places could not be loaded:', err)
        this.places = []
        return []
      } finally {
        this.loadPromise = null
      }
    })()

    return this.loadPromise
  }

  /**
   * Parses compact place tuples into GeocodingResult objects.
   */
  parseTuples(data: CompactPlaceTuple[]): GeocodingResult[] {
    const parsed: GeocodingResult[] = []
    for (let i = 0; i < data.length; i++) {
      const item = data[i]
      if (!Array.isArray(item) || item.length < 3) continue
      const [name, lon, lat, category, type] = item
      if (!name || typeof lon !== 'number' || typeof lat !== 'number') continue
      if (!isValidCoordinate(lon, lat)) continue

      parsed.push({
        id: `delhi-poi-${i}`,
        name,
        displayName: `${name}, Delhi, India`,
        longitude: lon,
        latitude: lat,
        category: category || 'place',
        type: type || 'landmark',
        address: {
          city: 'Delhi',
          country: 'India',
        },
      })
    }
    return parsed
  }

  /**
   * Sets pre-loaded places directly in memory.
   */
  setPlaces(places: GeocodingResult[]): void {
    this.places = places
    this.loadPromise = null
  }

  /**
   * Forces a reload of places from OPFS or fetch.
   */
  async reloadPlaces(signal?: AbortSignal): Promise<GeocodingResult[]> {
    this.places = null
    this.loadPromise = null
    return this.loadPlaces(signal)
  }

  /**
   * Performs responsive local substring and token search ranked by relevance and proximity.
   */
  async search(query: string, options?: SearchOptions): Promise<GeocodingResult[]> {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const trimmed = query.trim().toLowerCase()
    if (trimmed.length < 2) return []

    const places = await this.loadPlaces(options?.signal)
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const center = options?.center
    const limit = options?.limit || 8

    interface ScoredResult {
      result: GeocodingResult
      score: number
      distanceMeters: number
    }

    const scored: ScoredResult[] = []

    for (let i = 0; i < places.length; i++) {
      const p = places[i]
      const nameLower = p.name.toLowerCase()

      let textScore = 0
      if (nameLower === trimmed) {
        textScore = 120 // Exact match
      } else if (nameLower.startsWith(trimmed)) {
        textScore = 90 // Prefix match
      } else {
        const words = nameLower.split(/[\s,.-]+/)
        if (words.some(w => w.startsWith(trimmed))) {
          textScore = 70 // Word boundary match
        } else if (nameLower.includes(trimmed)) {
          textScore = 45 // Substring match
        } else if (p.category?.toLowerCase().includes(trimmed) || p.type?.toLowerCase().includes(trimmed)) {
          textScore = 25 // Category / type match
        }
      }

      if (textScore === 0) continue

      let distance = 0
      if (center && isValidCoordinate(center[0], center[1])) {
        distance = calculateDistanceMeters(center[0], center[1], p.longitude, p.latitude)
        // Bonus for places within 10 km of current center
        if (distance < 5000) {
          textScore += 15
        } else if (distance < 12000) {
          textScore += 8
        }
      }

      scored.push({
        result: p,
        score: textScore,
        distanceMeters: distance,
      })
    }

    // Sort by text relevance score descending, then distance ascending
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.distanceMeters - b.distanceMeters
    })

    return scored.slice(0, limit).map(s => s.result)
  }

  /**
   * Discovers nearby POIs within the Delhi extract matching the requested category.
   */
  async nearby(categoryKey: string, center: [number, number], options?: SearchOptions): Promise<GeocodingResult[]> {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const places = await this.loadPlaces(options?.signal)
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const cleanCat = categoryKey.toLowerCase().trim()
    const limit = options?.limit || 12

    // Category matching filters
    const matched = places.filter(p => {
      const c = (p.category || '').toLowerCase()
      const t = (p.type || '').toLowerCase()
      const n = p.name.toLowerCase()

      switch (cleanCat) {
        case 'hospital':
          return c === 'hospital' || t === 'hospital' || c === 'clinic' || t === 'clinic' || n.includes('hospital') || n.includes('clinic')
        case 'restaurant':
          return c === 'restaurant' || t === 'restaurant' || c === 'food' || n.includes('restaurant') || n.includes('dhaba')
        case 'cafe':
          return c === 'cafe' || t === 'cafe' || n.includes('cafe') || n.includes('coffee')
        case 'pharmacy':
          return c === 'pharmacy' || t === 'pharmacy' || c === 'chemist' || n.includes('pharmacy') || n.includes('chemist') || n.includes('medicos')
        case 'atm':
          return c === 'atm' || t === 'atm' || c === 'bank' || n.includes('atm')
        case 'fuel':
          return c === 'fuel' || t === 'fuel' || n.includes('petrol') || n.includes('cng') || n.includes('fuel')
        case 'bank':
          return c === 'bank' || t === 'bank' || n.includes('bank')
        case 'supermarket':
          return c === 'supermarket' || t === 'supermarket' || c === 'shop' || n.includes('supermarket') || n.includes('bazaar') || n.includes('mart')
        default:
          return c.includes(cleanCat) || t.includes(cleanCat) || n.includes(cleanCat)
      }
    })

    // Calculate distance from center and sort ascending
    const withDistance = matched.map(p => ({
      place: p,
      dist: calculateDistanceMeters(center[0], center[1], p.longitude, p.latitude),
    }))

    withDistance.sort((a, b) => a.dist - b.dist)

    return withDistance.slice(0, limit).map(item => item.place)
  }
}

let cachedOfflineProvider: OfflineDelhiProvider | null = null

export function getOfflineDelhiProvider(customDataUrl?: string): OfflineDelhiProvider {
  if (!cachedOfflineProvider) {
    cachedOfflineProvider = new OfflineDelhiProvider(customDataUrl)
  }
  return cachedOfflineProvider
}
