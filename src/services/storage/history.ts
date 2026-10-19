import type { RecentSearch, RouteHistoryItem } from './types'

export function isValidRecentSearch(item: unknown): item is RecentSearch {
  if (!item || typeof item !== 'object') return false
  const s = item as Record<string, unknown>
  return typeof s.id === 'string' && typeof s.query === 'string' && typeof s.timestamp === 'number'
}

export function sanitizeRecentSearches(items: unknown): RecentSearch[] {
  if (!Array.isArray(items)) return []
  return items.filter(isValidRecentSearch)
}

export function saveRecentSearch(
  history: RecentSearch[],
  search: Omit<RecentSearch, 'id' | 'timestamp'>,
  maxEntries = 20
): RecentSearch[] {
  const queryTrimmed = search.query.trim()
  if (!queryTrimmed) return history

  // Filter out duplicate queries
  const filtered = history.filter(item => item.query.toLowerCase() !== queryTrimmed.toLowerCase())
  const newItem: RecentSearch = {
    id: `search-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    query: queryTrimmed,
    timestamp: Date.now(),
    placeName: search.placeName,
    longitude: search.longitude,
    latitude: search.latitude,
  }
  return [newItem, ...filtered].slice(0, maxEntries)
}

export function deleteRecentSearch(history: RecentSearch[], id: string): RecentSearch[] {
  return history.filter(item => item.id !== id)
}

export function clearRecentSearches(): RecentSearch[] {
  return []
}

export function isValidRouteHistoryItem(item: unknown): item is RouteHistoryItem {
  if (!item || typeof item !== 'object') return false
  const r = item as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    r.origin != null &&
    typeof r.origin === 'object' &&
    r.destination != null &&
    typeof r.destination === 'object' &&
    typeof r.mode === 'string' &&
    typeof r.distanceMeters === 'number' &&
    typeof r.durationSeconds === 'number' &&
    typeof r.timestamp === 'number'
  )
}

export function sanitizeRouteHistory(items: unknown): RouteHistoryItem[] {
  if (!Array.isArray(items)) return []
  return items.filter(isValidRouteHistoryItem)
}

export function saveRouteHistoryItem(
  history: RouteHistoryItem[],
  item: Omit<RouteHistoryItem, 'id' | 'timestamp'>,
  maxEntries = 30
): RouteHistoryItem[] {
  const title = item.title?.trim() || `${item.origin.name} → ${item.destination.name}`

  // Check if identical route (same origin coords and dest coords) was added very recently (e.g. within 60s)
  const isDuplicate = history.some(
    existing =>
      Math.abs(existing.origin.longitude - item.origin.longitude) < 0.0001 &&
      Math.abs(existing.origin.latitude - item.origin.latitude) < 0.0001 &&
      Math.abs(existing.destination.longitude - item.destination.longitude) < 0.0001 &&
      Math.abs(existing.destination.latitude - item.destination.latitude) < 0.0001 &&
      existing.mode === item.mode &&
      Date.now() - existing.timestamp < 60000
  )
  if (isDuplicate) return history

  const newItem: RouteHistoryItem = {
    id: `route-hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    origin: {
      id: item.origin.id,
      name: item.origin.name,
      longitude: item.origin.longitude,
      latitude: item.origin.latitude,
      type: item.origin.type,
    },
    destination: {
      id: item.destination.id,
      name: item.destination.name,
      longitude: item.destination.longitude,
      latitude: item.destination.latitude,
      type: item.destination.type,
    },
    waypoints: (item.waypoints || []).map(w => ({
      id: w.id,
      name: w.name,
      longitude: w.longitude,
      latitude: w.latitude,
      type: w.type,
    })),
    mode: item.mode,
    distanceMeters: Math.round(item.distanceMeters),
    durationSeconds: Math.round(item.durationSeconds),
    timestamp: Date.now(),
    isSaved: !!item.isSaved,
  }

  // Prepend new history item, keeping up to maxEntries
  return [newItem, ...history].slice(0, maxEntries)
}

export function updateRouteHistoryTitle(history: RouteHistoryItem[], id: string, newTitle: string): RouteHistoryItem[] {
  const trimmed = newTitle.trim()
  if (!trimmed) return history
  return history.map(item => (item.id === id ? { ...item, title: trimmed } : item))
}

export function toggleRouteHistorySaved(history: RouteHistoryItem[], id: string): RouteHistoryItem[] {
  return history.map(item => (item.id === id ? { ...item, isSaved: !item.isSaved } : item))
}

export function deleteRouteHistoryItem(history: RouteHistoryItem[], id: string): RouteHistoryItem[] {
  return history.filter(item => item.id !== id)
}

export function clearRouteHistory(): RouteHistoryItem[] {
  return []
}
