import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LISTS,
  addPlaceToList,
  clearRecentSearches,
  clearRouteHistory,
  createExportData,
  createList,
  deleteList,
  deleteRecentSearch,
  deleteRouteHistoryItem,
  exportToJsonString,
  filterPlacesByList,
  generatePlaceShareUrl,
  generateRouteShareUrl,
  parseAndValidateImportData,
  parseShareParams,
  removePlaceFromList,
  renameList,
  sanitizeLists,
  sanitizeRecentSearches,
  sanitizeRouteHistory,
  saveRecentSearch,
  saveRouteHistoryItem,
  setPlaceLists,
  updateRouteHistoryTitle,
  type Place,
  type RouteHistoryItem,
} from './index'

const samplePlace: Place = {
  id: 'place-1',
  name: 'Connaught Place',
  longitude: 77.21938,
  latitude: 28.63177,
  listIds: ['favorites'],
}

describe('custom lists and place categorization', () => {
  it('initializes with default lists and sanitizes corrupt data', () => {
    expect(DEFAULT_LISTS.length).toBe(4)
    expect(sanitizeLists(null)).toEqual(DEFAULT_LISTS)
    expect(sanitizeLists([])).toEqual(DEFAULT_LISTS)
    expect(sanitizeLists([{ corrupted: true }])).toEqual(DEFAULT_LISTS)
  })

  it('creates, renames, and deletes a custom list', () => {
    const { lists, newList } = createList(DEFAULT_LISTS, 'Client Sites', 'briefcase')
    expect(newList.name).toBe('Client Sites')
    expect(newList.isDefault).toBe(false)
    expect(lists.length).toBe(DEFAULT_LISTS.length + 1)

    // Rename
    const renamed = renameList(lists, newList.id, 'Top Client Sites')
    expect(renamed.find(l => l.id === newList.id)?.name).toBe('Top Client Sites')

    // Delete custom list
    const afterDelete = deleteList(renamed, newList.id)
    expect(afterDelete.length).toBe(DEFAULT_LISTS.length)

    // Default lists cannot be deleted
    const attemptDeleteDefault = deleteList(DEFAULT_LISTS, 'favorites')
    expect(attemptDeleteDefault).toEqual(DEFAULT_LISTS)
  })

  it('rejects empty list names', () => {
    expect(() => createList(DEFAULT_LISTS, '   ')).toThrow('List name cannot be empty.')
  })

  it('adds, removes, and filters places by list', () => {
    const places = [samplePlace]
    const updated = addPlaceToList(places, samplePlace.id, 'work')
    expect(updated[0].listIds).toContain('favorites')
    expect(updated[0].listIds).toContain('work')

    // Filter by list
    expect(filterPlacesByList(updated, 'work')).toEqual(updated)
    expect(filterPlacesByList(updated, 'trips')).toEqual([])
    expect(filterPlacesByList(updated, 'all')).toEqual(updated)

    // Remove from list
    const removed = removePlaceFromList(updated, samplePlace.id, 'work')
    expect(removed[0].listIds).toEqual(['favorites'])

    // Set multiple lists directly
    const directSet = setPlaceLists(removed, samplePlace.id, ['work', 'home'])
    expect(directSet[0].listIds).toEqual(['work', 'home'])
  })
})

describe('recent searches and route history', () => {
  it('saves and dedupes recent searches with limit', () => {
    let searches = saveRecentSearch([], { query: 'Delhi' })
    expect(searches.length).toBe(1)
    expect(searches[0].query).toBe('Delhi')

    // Searching same query updates to top
    searches = saveRecentSearch(searches, { query: 'Mumbai' })
    searches = saveRecentSearch(searches, { query: 'delhi' })
    expect(searches.length).toBe(2)
    expect(searches[0].query).toBe('delhi')

    // Delete single search
    searches = deleteRecentSearch(searches, searches[0].id)
    expect(searches.length).toBe(1)

    // Clear all
    expect(clearRecentSearches()).toEqual([])
  })

  it('saves route history without storing continuous GPS traces', () => {
    const historyItem: Omit<RouteHistoryItem, 'id' | 'timestamp'> = {
      title: 'Delhi to Agra',
      origin: { name: 'New Delhi', latitude: 28.6139, longitude: 77.209, type: 'search' },
      destination: { name: 'Agra', latitude: 27.1767, longitude: 78.0081, type: 'search' },
      waypoints: [{ name: 'Mathura', latitude: 27.4924, longitude: 77.6737, type: 'custom' }],
      mode: 'driving',
      distanceMeters: 210000,
      durationSeconds: 12600,
    }

    const history = saveRouteHistoryItem([], historyItem)
    expect(history.length).toBe(1)
    expect(history[0].title).toBe('Delhi to Agra')
    expect(history[0].waypoints?.length).toBe(1)
    // Verify privacy: no coordinates array / live GPS traces stored in the record
    expect((history[0] as unknown as Record<string, unknown>).coordinates).toBeUndefined()
    expect((history[0] as unknown as Record<string, unknown>).steps).toBeUndefined()

    // Update title
    const renamed = updateRouteHistoryTitle(history, history[0].id, 'Agra Heritage Trip')
    expect(renamed[0].title).toBe('Agra Heritage Trip')

    // Delete and clear
    const deleted = deleteRouteHistoryItem(renamed, history[0].id)
    expect(deleted.length).toBe(0)
    expect(clearRouteHistory()).toEqual([])
  })

  it('sanitizes malformed history values', () => {
    expect(sanitizeRecentSearches('bad')).toEqual([])
    expect(sanitizeRouteHistory(null)).toEqual([])
    expect(sanitizeRouteHistory([{ id: '1' }])).toEqual([])
  })
})

describe('data export and import', () => {
  it('creates valid OpenAtlas export schema', () => {
    const exportData = createExportData([samplePlace], DEFAULT_LISTS)
    expect(exportData.version).toBe(1)
    expect(exportData.app).toBe('OpenAtlas')
    expect(exportData.places.length).toBe(1)
    expect(exportData.lists.length).toBe(4)

    const jsonStr = exportToJsonString(exportData)
    expect(typeof jsonStr).toBe('string')

    const parsed = parseAndValidateImportData(jsonStr)
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data) {
      expect(parsed.data.places.length).toBe(1)
      expect(parsed.data.lists.length).toBe(4)
    }
  })

  it('supports legacy raw Place[] array import for backwards compatibility', () => {
    const legacyRaw = JSON.stringify([samplePlace])
    const parsed = parseAndValidateImportData(legacyRaw)
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data) {
      expect(parsed.data.places.length).toBe(1)
      expect(parsed.data.places[0].name).toBe('Connaught Place')
    }
  })

  it('rejects corrupted or empty import data', () => {
    expect(parseAndValidateImportData('not valid json').success).toBe(false)
    expect(parseAndValidateImportData('{}').success).toBe(false)
    expect(parseAndValidateImportData('[]').success).toBe(false)
  })
})

describe('location and route URL sharing', () => {
  it('generates and parses shareable place URL', () => {
    const url = generatePlaceShareUrl({ name: 'India Gate', latitude: 28.6129, longitude: 77.2295 }, 'https://atlas.local')
    expect(url).toContain('place=28.612900%2C77.229500')
    expect(url).toContain('name=India+Gate')

    const parsed = parseShareParams(url)
    expect(parsed).not.toBeNull()
    if (parsed && parsed.type === 'place') {
      expect(parsed.place.name).toBe('India Gate')
      expect(parsed.place.latitude).toBeCloseTo(28.6129)
      expect(parsed.place.longitude).toBeCloseTo(77.2295)
    }
  })

  it('generates and parses multi-stop route share URL', () => {
    const origin = { name: 'Connaught Place', latitude: 28.6318, longitude: 77.2194, type: 'search' as const }
    const destination = { name: 'India Gate', latitude: 28.6129, longitude: 77.2295, type: 'search' as const }
    const stop1 = { name: 'Janpath', latitude: 28.6200, longitude: 77.2200, type: 'custom' as const }

    const url = generateRouteShareUrl(origin, destination, [stop1], 'cycling', 'https://atlas.local')
    expect(url).toContain('route=cycling')
    expect(url).toContain('origin=28.631800')
    expect(url).toContain('dest=28.612900')
    expect(url).toContain('stops=28.620000')

    const parsed = parseShareParams(url)
    expect(parsed).not.toBeNull()
    if (parsed && parsed.type === 'route') {
      expect(parsed.route.mode).toBe('cycling')
      expect(parsed.route.origin.name).toBe('Connaught Place')
      expect(parsed.route.destination.name).toBe('India Gate')
      expect(parsed.route.waypoints.length).toBe(1)
      expect(parsed.route.waypoints[0].name).toBe('Janpath')
    }
  })

  it('handles malformed or out-of-bounds share URLs gracefully', () => {
    expect(parseShareParams('')).toBeNull()
    expect(parseShareParams('?place=invalid,coords')).toBeNull()
    expect(parseShareParams('?place=999.0,999.0')).toBeNull() // invalid lat/lon
    expect(parseShareParams('?route=driving&origin=invalid')).toBeNull()
  })
})
