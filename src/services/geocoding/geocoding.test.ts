import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NEARBY_CATEGORIES, getCategoryByKey } from './categories'
import { getGeocodingProvider, getOfflineDelhiProvider, OfflineDelhiProvider } from './index'
import { NominatimProvider, parseNominatimPlace, parseNominatimResponse } from './nominatim'
import { parsePhotonFeature, parsePhotonResponse, PhotonProvider } from './photon'
import type { GeocodingResult } from './types'

describe('Photon feature parser', () => {
  const sampleFeature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [77.2197, 28.6315],
    },
    properties: {
      osm_id: 12345,
      osm_type: 'N',
      osm_key: 'amenity',
      osm_value: 'cafe',
      name: 'Cafe Central',
      street: 'Barakhamba Road',
      housenumber: '10',
      city: 'New Delhi',
      state: 'Delhi',
      country: 'India',
    },
  }

  it('correctly parses a complete Photon GeoJSON feature', () => {
    const result = parsePhotonFeature(sampleFeature)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('osm-n-12345')
    expect(result?.name).toBe('Cafe Central')
    expect(result?.latitude).toBe(28.6315)
    expect(result?.longitude).toBe(77.2197)
    expect(result?.category).toBe('amenity')
    expect(result?.type).toBe('cafe')
    expect(result?.address?.city).toBe('New Delhi')
    expect(result?.address?.street).toBe('Barakhamba Road')
    expect(result?.displayName).toContain('Barakhamba Road')
  })

  it('generates fallback name when properties.name is omitted', () => {
    const unnamedFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [13.4, 52.5] },
      properties: {
        osm_id: 999,
        osm_key: 'amenity',
        osm_value: 'hospital',
        city: 'Berlin',
      },
    }
    const result = parsePhotonFeature(unnamedFeature)
    expect(result?.name).toBe('Hospital')
  })

  it('rejects features with invalid coordinates', () => {
    expect(parsePhotonFeature(null)).toBeNull()
    expect(parsePhotonFeature({})).toBeNull()
    expect(parsePhotonFeature({ type: 'Feature', geometry: { coordinates: [200, 30] } })).toBeNull()
    expect(parsePhotonFeature({ type: 'Feature', geometry: { coordinates: [NaN, 30] } })).toBeNull()
    expect(parsePhotonFeature({ type: 'Feature', geometry: { coordinates: ['77', '28'] } })).toBeNull()
  })

  it('parses a FeatureCollection cleanly while filtering corrupt entries', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [sampleFeature, null, { type: 'Feature' }, sampleFeature],
    }
    const results = parsePhotonResponse(collection)
    expect(results).toHaveLength(2)
    expect(results[0].name).toBe('Cafe Central')
  })

  it('returns empty array on malformed collection', () => {
    expect(parsePhotonResponse(null)).toEqual([])
    expect(parsePhotonResponse({})).toEqual([])
    expect(parsePhotonResponse({ features: 'not an array' })).toEqual([])
  })
})

describe('Nominatim place parser', () => {
  const sampleNominatim = {
    place_id: 98765,
    osm_type: 'node',
    osm_id: 112233,
    lat: '28.6139',
    lon: '77.2090',
    name: 'India Gate',
    display_name: 'India Gate, Rajpath, New Delhi, Delhi, India',
    category: 'tourism',
    type: 'monument',
    address: {
      road: 'Rajpath',
      city: 'New Delhi',
      state: 'Delhi',
      country: 'India',
    },
  }

  it('parses string coordinates to numbers and builds result', () => {
    const result = parseNominatimPlace(sampleNominatim)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('osm-n-112233')
    expect(result?.name).toBe('India Gate')
    expect(result?.latitude).toBeCloseTo(28.6139)
    expect(result?.longitude).toBeCloseTo(77.2090)
    expect(result?.address?.street).toBe('Rajpath')
  })

  it('rejects invalid or missing coordinates in Nominatim item', () => {
    expect(parseNominatimPlace(null)).toBeNull()
    expect(parseNominatimPlace({ ...sampleNominatim, lat: 'not-a-number' })).toBeNull()
    expect(parseNominatimPlace({ ...sampleNominatim, lat: '120.0' })).toBeNull()
  })

  it('parses Nominatim array response', () => {
    expect(parseNominatimResponse([sampleNominatim, { invalid: true }])).toHaveLength(1)
    expect(parseNominatimResponse(null)).toEqual([])
  })
})

describe('Geocoding providers integration and HTTP handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PhotonProvider sends proper query with coordinate bias', async () => {
    const mockJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { coordinates: [77.2, 28.6] },
          properties: { name: 'Test Place', osm_id: 1 },
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new PhotonProvider('https://mock-photon.test')
    const results = await provider.search('test', { center: [77.2, 28.6], limit: 5 })

    expect(fetchMock).toHaveBeenCalled()
    const callUrl = fetchMock.mock.calls[0][0] as string
    expect(callUrl).toContain('https://mock-photon.test/api/?')
    expect(callUrl).toContain('q=test')
    expect(callUrl).toContain('lon=77.20000')
    expect(callUrl).toContain('lat=28.60000')
    expect(callUrl).toContain('limit=5')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Test Place')
  })

  it('PhotonProvider sends nearby request with category osm_tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new PhotonProvider('https://mock-photon.test')
    await provider.nearby('hospital', [77.209, 28.6139], { limit: 10 })

    const callUrl = fetchMock.mock.calls[0][0] as string
    expect(callUrl).toContain('osm_tag=amenity%3Ahospital')
    expect(callUrl).toContain('q=hospital')
    expect(callUrl).toContain('lon=77.20900')
    expect(callUrl).toContain('lat=28.61390')
  })

  it('handles HTTP error responses gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new PhotonProvider('https://mock-photon.test')
    await expect(provider.search('fail')).rejects.toThrow('Photon search failed with status 503')
  })

  it('NominatimProvider constructs viewbox parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new NominatimProvider('https://mock-nominatim.test')
    await provider.search('Delhi', { center: [77.2, 28.6] })

    const callUrl = fetchMock.mock.calls[0][0] as string
    expect(callUrl).toContain('format=jsonv2')
    expect(callUrl).toContain('viewbox=')
  })
})

describe('getGeocodingProvider factory', () => {
  it('defaults to PhotonProvider', () => {
    const provider = getGeocodingProvider()
    expect(provider.id).toBe('photon')
  })

  it('creates NominatimProvider when explicitly requested', () => {
    const provider = getGeocodingProvider('nominatim')
    expect(provider.id).toBe('nominatim')
  })
})

describe('NEARBY_CATEGORIES', () => {
  it('covers all essential categories', () => {
    const keys = NEARBY_CATEGORIES.map(c => c.key)
    expect(keys).toContain('hospital')
    expect(keys).toContain('restaurant')
    expect(keys).toContain('cafe')
    expect(keys).toContain('pharmacy')
    expect(keys).toContain('atm')
    expect(keys).toContain('fuel')
    expect(keys).toContain('bank')
    expect(keys).toContain('supermarket')
  })

  it('can look up category by key', () => {
    expect(getCategoryByKey('hospital')?.osmTag).toBe('amenity:hospital')
    expect(getCategoryByKey('nonexistent')).toBeUndefined()
  })
})

describe('OfflineDelhiProvider', () => {
  const mockPlaces: GeocodingResult[] = [
    {
      id: 'delhi-1',
      name: 'Connaught Place',
      displayName: 'Connaught Place, Delhi, India',
      longitude: 77.2195,
      latitude: 28.6315,
      category: 'place',
      type: 'suburb',
    },
    {
      id: 'delhi-2',
      name: 'India Gate',
      displayName: 'India Gate, Delhi, India',
      longitude: 77.2295,
      latitude: 28.6129,
      category: 'tourism',
      type: 'monument',
    },
    {
      id: 'delhi-3',
      name: 'AIIMS Hospital',
      displayName: 'AIIMS Hospital, Delhi, India',
      longitude: 77.2090,
      latitude: 28.5672,
      category: 'amenity',
      type: 'hospital',
    },
    {
      id: 'delhi-4',
      name: 'Cafe Coffee Day CP',
      displayName: 'Cafe Coffee Day CP, Delhi, India',
      longitude: 77.2180,
      latitude: 28.6320,
      category: 'amenity',
      type: 'cafe',
    },
    {
      id: 'delhi-5',
      name: 'State Bank of India ATM',
      displayName: 'State Bank of India ATM, Delhi, India',
      longitude: 77.2200,
      latitude: 28.6300,
      category: 'amenity',
      type: 'atm',
    },
    {
      id: 'delhi-6',
      name: 'Indian Oil Petrol Pump',
      displayName: 'Indian Oil Petrol Pump, Delhi, India',
      longitude: 77.2150,
      latitude: 28.6250,
      category: 'amenity',
      type: 'fuel',
    },
  ]

  it('initializes with metadata and custom places', () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    expect(provider.id).toBe('offline-delhi')
    expect(provider.name).toBe('Offline Delhi Index')
    expect(provider.attribution).toContain('Local Delhi Index')
  })

  it('returns empty array for queries with fewer than 2 characters', async () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    const results = await provider.search('c')
    expect(results).toEqual([])
  })

  it('finds exact and prefix matches', async () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    const results = await provider.search('Connaught Place')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].name).toBe('Connaught Place')
  })

  it('finds word boundary and substring matches', async () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    const results = await provider.search('Gate')
    expect(results.some(r => r.name === 'India Gate')).toBe(true)
  })

  it('boosts results near center coordinate', async () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    // Center very close to AIIMS Hospital (lat 28.5672, lon 77.2090)
    const results = await provider.search('Hospital', { center: [77.2091, 28.5673] })
    expect(results[0].name).toBe('AIIMS Hospital')
  })

  it('honors AbortSignal during search', async () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    const controller = new AbortController()
    controller.abort()
    await expect(provider.search('India', { signal: controller.signal })).rejects.toThrow('Aborted')
  })

  it('discovers nearby places filtered by category and sorted by distance', async () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    // CP center: [77.2195, 28.6315]
    const cafes = await provider.nearby('cafe', [77.2195, 28.6315])
    expect(cafes.length).toBeGreaterThan(0)
    expect(cafes[0].name).toBe('Cafe Coffee Day CP')

    const hospitals = await provider.nearby('hospital', [77.2195, 28.6315])
    expect(hospitals.length).toBeGreaterThan(0)
    expect(hospitals[0].name).toBe('AIIMS Hospital')
  })

  it('honors AbortSignal during nearby search', async () => {
    const provider = new OfflineDelhiProvider('/test.json', mockPlaces)
    const controller = new AbortController()
    controller.abort()
    await expect(provider.nearby('cafe', [77.2195, 28.6315], { signal: controller.signal })).rejects.toThrow('Aborted')
  })

  it('handles loadPlaces fetch failure gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OfflineDelhiProvider('/nonexistent.json')
    const results = await provider.search('Delhi')
    expect(results).toEqual([])
  })

  it('getOfflineDelhiProvider singleton returns instance', () => {
    const p1 = getOfflineDelhiProvider()
    const p2 = getOfflineDelhiProvider()
    expect(p1).toBe(p2)
    expect(p1.id).toBe('offline-delhi')
  })
})

