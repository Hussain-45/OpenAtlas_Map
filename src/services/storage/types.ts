import type { RouteEndpoint, TravelMode } from '../routing/types'

export interface Place {
  id: string
  name: string
  longitude: number
  latitude: number
  listIds?: string[]
  notes?: string
  updatedAt?: number
}

export interface PlaceList {
  id: string
  name: string
  icon?: string // 'heart' | 'briefcase' | 'home' | 'compass' | 'folder' | 'star'
  isDefault?: boolean
  createdAt?: number
}

export interface RecentSearch {
  id: string
  query: string
  timestamp: number
  placeName?: string
  longitude?: number
  latitude?: number
}

export interface RouteHistoryItem {
  id: string
  title: string
  origin: RouteEndpoint
  destination: RouteEndpoint
  waypoints?: RouteEndpoint[]
  mode: TravelMode
  distanceMeters: number
  durationSeconds: number
  timestamp: number
  isSaved?: boolean
}

export interface OpenAtlasExportData {
  $schema?: string
  version: 1
  app: 'OpenAtlas'
  exportedAt: string
  lists: PlaceList[]
  places: Place[]
  routeHistory?: RouteHistoryItem[]
  recentSearches?: RecentSearch[]
}
