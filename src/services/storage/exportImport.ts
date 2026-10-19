import type { OpenAtlasExportData, Place, PlaceList, RecentSearch, RouteHistoryItem } from './types'
import { sanitizeLists } from './lists'
import { sanitizeRecentSearches, sanitizeRouteHistory } from './history'
import { sanitizeSavedPlaces } from '../../places'

export function createExportData(
  places: Place[],
  lists: PlaceList[],
  routeHistory?: RouteHistoryItem[],
  recentSearches?: RecentSearch[]
): OpenAtlasExportData {
  return {
    $schema: 'https://openatlas.dev/schemas/places-v1.json',
    version: 1,
    app: 'OpenAtlas',
    exportedAt: new Date().toISOString(),
    lists,
    places,
    routeHistory: routeHistory || [],
    recentSearches: recentSearches || [],
  }
}

export function exportToJsonString(data: OpenAtlasExportData): string {
  return JSON.stringify(data, null, 2)
}

export function parseAndValidateImportData(jsonString: string): {
  success: boolean
  data?: {
    places: Place[]
    lists: PlaceList[]
    routeHistory: RouteHistoryItem[]
    recentSearches: RecentSearch[]
  }
  error?: string
} {
  try {
    const parsed: unknown = JSON.parse(jsonString)
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'File does not contain valid JSON data.' }
    }

    // Support legacy raw Place[] array
    if (Array.isArray(parsed)) {
      const places = sanitizeSavedPlaces(parsed)
      if (places.length === 0) {
        return { success: false, error: 'No valid places found in file.' }
      }
      return {
        success: true,
        data: {
          places,
          lists: sanitizeLists([]),
          routeHistory: [],
          recentSearches: [],
        },
      }
    }

    const obj = parsed as Record<string, unknown>
    const rawPlaces = Array.isArray(obj.places) ? obj.places : []
    const rawLists = Array.isArray(obj.lists) ? obj.lists : []
    const rawHistory = Array.isArray(obj.routeHistory) ? obj.routeHistory : []
    const rawSearches = Array.isArray(obj.recentSearches) ? obj.recentSearches : []

    const places = sanitizeSavedPlaces(rawPlaces)
    const lists = rawLists.length > 0 ? sanitizeLists(rawLists) : sanitizeLists([])
    const routeHistory = sanitizeRouteHistory(rawHistory)
    const recentSearches = sanitizeRecentSearches(rawSearches)

    if (places.length === 0 && rawLists.length === 0 && routeHistory.length === 0) {
      return { success: false, error: 'No valid places, lists, or route history found in file.' }
    }

    return {
      success: true,
      data: {
        places,
        lists,
        routeHistory,
        recentSearches,
      },
    }
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err instanceof Error ? err.message : 'Invalid syntax'}`,
    }
  }
}

export function downloadJsonFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
