import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'
import maplibreglWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  Bike,
  Bookmark,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coffee,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Download,
  Edit2,
  Footprints,
  Fuel,
  History,
  Landmark,
  Layers,
  Map as MapIcon,
  MapPin,
  Menu,
  Milestone,
  Minus,
  Navigation,
  Pause,
  Pill,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  Utensils,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

maplibregl.setWorkerUrl(maplibreglWorkerUrl)

import { offlineManager } from './services/offline/offlineManager'
import {
  DELHI_PACKAGE_METADATA,
  type DownloadProgress,
  type OfflinePackageState,
} from './services/offline/types'
import {
  datasetUpdateService,
} from './services/offline/datasetUpdateService'
import type {
  DatasetUpdateProgress,
  InstalledDatasetRelease,
  UpdateCheckResult,
} from './services/offline/manifestTypes'

offlineManager.registerProtocol(maplibregl)

import {
  calculateBearing,
  calculateDistanceMeters,
  formatCoordinates,
  formatDistance,
  formatDuration,
  isValidCoordinate,
} from './coordinates'
import { deletePlace, filterSavedPlaces, sanitizeSavedPlaces, savePlace, type Place } from './places'
import {
  NEARBY_CATEGORIES,
  getGeocodingProvider,
  getOfflineDelhiProvider,
  OfflineDelhiProvider,
  type GeocodingProvider,
  type GeocodingResult,
} from './services/geocoding'
import {
  clearRoutesFromMap,
  createEndpointMarker,
  ensureRouteLayers,
  fitRouteBounds,
  getOfflineDelhiRoutingProvider,
  getRoutingProvider,
  isCoordinateInsideDelhi,
  OfflineDelhiRoutingProvider,
  renderRoutesOnMap,
  type Route,
  type RouteEndpoint,
  type RoutingProvider,
  type TravelMode,
} from './services/routing'
import {
  calculateRouteProgress,
  SpeechNavigator,
  type LiveLocation,
  type NavigationProgress,
  type NavigationStatus,
} from './services/navigation'
import {
  DEFAULT_LISTS,
  clearRecentSearches,
  clearRouteHistory,
  createExportData,
  createList,
  deleteList,
  deleteRecentSearch,
  deleteRouteHistoryItem,
  downloadJsonFile,
  exportToJsonString,
  filterPlacesByList,
  generatePlaceShareUrl,
  generateRouteShareUrl,
  parseAndValidateImportData,
  parseShareParams,
  sanitizeLists,
  sanitizeRecentSearches,
  sanitizeRouteHistory,
  saveRecentSearch,
  saveRouteHistoryItem,
  setPlaceLists,
  updateRouteHistoryTitle,
  type PlaceList,
  type RecentSearch,
  type RouteHistoryItem,
} from './services/storage'

export interface SelectedPlace {
  id: string
  name: string
  displayName?: string
  longitude: number
  latitude: number
  category?: string
  type?: string
  source: 'pin' | 'search' | 'nearby' | 'saved'
}

type MapStyleOption = { name: string; url: string }
const LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const envStyle = import.meta.env.VITE_MAP_STYLE_URL
const isCustomStyle = Boolean(envStyle && envStyle !== LIBERTY_STYLE)
const defaultStyle = envStyle || LIBERTY_STYLE
const defaultStyleName = isCustomStyle ? 'Custom' : 'Liberty'

const styles: MapStyleOption[] = [
  ...(isCustomStyle ? [{ name: 'Custom', url: defaultStyle }] : []),
  { name: 'Liberty', url: LIBERTY_STYLE },
  { name: 'Positron', url: 'https://tiles.openfreemap.org/styles/positron' },
  { name: 'Bright', url: 'https://tiles.openfreemap.org/styles/bright' },
  { name: 'Dark', url: 'https://tiles.openfreemap.org/styles/dark' },
]
const savedKey = 'openatlas.saved-places'
const listsKey = 'openatlas.saved-lists'
const routeHistoryKey = 'openatlas.route-history'
const recentSearchesKey = 'openatlas.recent-searches'
const mapModeKey = 'openatlas.map-mode'

export type MapMode = 'online' | 'offline-delhi'
export const OFFLINE_STYLE_URL = '/offline/assets/style.json'
export const DELHI_BOUNDS_LABEL = `${DELHI_PACKAGE_METADATA.bounds[0]}°E–${DELHI_PACKAGE_METADATA.bounds[2]}°E, ${DELHI_PACKAGE_METADATA.bounds[1]}°N–${DELHI_PACKAGE_METADATA.bounds[3]}°N`

function readMapModePreference(): MapMode {
  try {
    const val = localStorage.getItem(mapModeKey)
    return val === 'offline-delhi' ? 'offline-delhi' : 'online'
  } catch {
    return 'online'
  }
}

function readSavedPlaces(): Place[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savedKey) || '[]')
    return sanitizeSavedPlaces(value)
  } catch {
    return []
  }
}

function readSavedLists(): PlaceList[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(listsKey) || '[]')
    return sanitizeLists(value)
  } catch {
    return [...DEFAULT_LISTS]
  }
}

function readRouteHistory(): RouteHistoryItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(routeHistoryKey) || '[]')
    return sanitizeRouteHistory(value)
  } catch {
    return []
  }
}

function readRecentSearches(): RecentSearch[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentSearchesKey) || '[]')
    return sanitizeRecentSearches(value)
  } catch {
    return []
  }
}

function renderCategoryIcon(categoryKey?: string, size = 15) {
  switch (categoryKey) {
    case 'hospital': return <Activity size={size} />
    case 'restaurant': return <Utensils size={size} />
    case 'cafe': return <Coffee size={size} />
    case 'pharmacy': return <Pill size={size} />
    case 'atm': return <Banknote size={size} />
    case 'fuel': return <Fuel size={size} />
    case 'bank': return <Landmark size={size} />
    case 'supermarket': return <ShoppingBag size={size} />
    default: return <MapPin size={size} />
  }
}

function renderManeuverIcon(type?: string, modifier?: string, size = 16) {
  if (type === 'depart') return <MapPin size={size} />
  if (type === 'arrive') return <Milestone size={size} />
  if (type === 'roundabout' || type === 'rotary') return <RotateCcw size={size} />
  if (type === 'turn' || type === 'fork' || type === 'end of road') {
    if (modifier?.includes('left')) return <CornerUpLeft size={size} />
    if (modifier?.includes('right')) return <CornerUpRight size={size} />
  }
  return <Navigation size={size} style={{ transform: 'rotate(45deg)' }} />
}

function formatETA(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return ''
  const etaDate = new Date(Date.now() + durationSeconds * 1000)
  return `ETA ${etaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const temporaryMarker = useRef<Marker | null>(null)
  const searchMarker = useRef<Marker | null>(null)
  const userMarker = useRef<Marker | null>(null)
  const nearbyMarkers = useRef<Marker[]>([])

  // Routing markers
  const originMarkerRef = useRef<Marker | null>(null)
  const destinationMarkerRef = useRef<Marker | null>(null)
  const stepMarkerRef = useRef<Marker | null>(null)
  const stopMarkersRef = useRef<Marker[]>([])

  // Navigation live puck marker and speech
  const navMarkerRef = useRef<Marker | null>(null)
  const gpsWatchIdRef = useRef<number | null>(null)
  const speechRef = useRef<SpeechNavigator>(new SpeechNavigator())
  const prevLiveLocRef = useRef<LiveLocation | null>(null)
  const navProgressRef = useRef<NavigationProgress | null>(null)
  const isCameraLockedRef = useRef(true)
  const activeRouteRef = useRef<Route | null>(null)
  const lastSpokenStepIndexRef = useRef<number>(-1)

  const appliedStyle = useRef(defaultStyle)
  const providerRef = useRef<GeocodingProvider>(getGeocodingProvider())
  const offlineDelhiProviderRef = useRef<OfflineDelhiProvider>(getOfflineDelhiProvider())
  const routingProviderRef = useRef<RoutingProvider>(getRoutingProvider())
  const offlineDelhiRoutingRef = useRef<OfflineDelhiRoutingProvider>(getOfflineDelhiRoutingProvider())
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchRequestIdRef = useRef(0)
  const nearbyAbortRef = useRef<AbortController | null>(null)
  const routeAbortRef = useRef<AbortController | null>(null)
  const endpointSearchAbortRef = useRef<AbortController | null>(null)
  const offlineAbortRef = useRef<AbortController | null>(null)

  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activePanel, setActivePanel] = useState<'styles' | 'saved' | 'settings' | 'nearby' | 'directions' | 'history' | 'offline' | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>(readMapModePreference)
  const activeGeocodingProvider = mapMode === 'offline-delhi' ? offlineDelhiProviderRef.current : providerRef.current
  const activeRoutingProvider = mapMode === 'offline-delhi' ? offlineDelhiRoutingRef.current : routingProviderRef.current
  const [offlineState, setOfflineState] = useState<OfflinePackageState>({ status: 'not_downloaded' })
  const [isOfflineChecked, setIsOfflineChecked] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false)
  const [offlineError, setOfflineError] = useState('')

  // Map Data Updates State
  const [installedRelease, setInstalledRelease] = useState<InstalledDatasetRelease | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null)
  const [isUpdatingDataset, setIsUpdatingDataset] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<DatasetUpdateProgress | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [updateSuccess, setUpdateSuccess] = useState('')
  const [styleUrl, setStyleUrl] = useState(defaultStyle)
  const [styleName, setStyleName] = useState(defaultStyleName)
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([])
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false)
  const [saved, setSaved] = useState<Place[]>(readSavedPlaces)
  const [selected, setSelected] = useState<SelectedPlace | null>(null)
  const [geoMessage, setGeoMessage] = useState('')
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number]>([77.209, 28.6139])
  const [showCoordinates, setShowCoordinates] = useState(true)

  // Phase 5: Custom lists and categories state
  const [lists, setLists] = useState<PlaceList[]>(readSavedLists)
  const [activeListId, setActiveListId] = useState<string>('all')
  const [isCreatingList, setIsCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [editingPlaceListId, setEditingPlaceListId] = useState<string | null>(null)

  // Nearby discovery state
  const [nearbyCategory, setNearbyCategory] = useState<string | null>(null)
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyError, setNearbyError] = useState('')
  const [nearbyResults, setNearbyResults] = useState<GeocodingResult[]>([])

  // Phase 3 & 5: Route Planning and Multi-Stop State
  type EndpointTarget = 'origin' | 'destination' | number
  const [travelMode, setTravelMode] = useState<TravelMode>('driving')
  const [routeOrigin, setRouteOrigin] = useState<RouteEndpoint | null>(null)
  const [routeDestination, setRouteDestination] = useState<RouteEndpoint | null>(null)
  const [routeStops, setRouteStops] = useState<RouteEndpoint[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [activeRouteIndex, setActiveRouteIndex] = useState(0)
  const [isRouting, setIsRouting] = useState(false)
  const [routingError, setRoutingError] = useState('')
  const [stepsExpanded, setStepsExpanded] = useState(true)
  const [pickingEndpoint, setPickingEndpoint] = useState<EndpointTarget | null>(null)
  const [editingEndpoint, setEditingEndpoint] = useState<EndpointTarget | null>(null)
  const [endpointQuery, setEndpointQuery] = useState('')
  const [endpointResults, setEndpointResults] = useState<GeocodingResult[]>([])
  const [isSearchingEndpoint, setIsSearchingEndpoint] = useState(false)

  const isOriginOutsideDelhi = useMemo(() => {
    return Boolean(
      mapMode === 'offline-delhi' &&
      routeOrigin &&
      !isCoordinateInsideDelhi(routeOrigin.longitude, routeOrigin.latitude)
    )
  }, [mapMode, routeOrigin])

  const isDestinationOutsideDelhi = useMemo(() => {
    return Boolean(
      mapMode === 'offline-delhi' &&
      routeDestination &&
      !isCoordinateInsideDelhi(routeDestination.longitude, routeDestination.latitude)
    )
  }, [mapMode, routeDestination])

  // Phase 5: Trip history and recent searches state
  const [routeHistory, setRouteHistory] = useState<RouteHistoryItem[]>(readRouteHistory)
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(readRecentSearches)
  const [historyTab, setHistoryTab] = useState<'routes' | 'searches'>('routes')
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null)
  const [editingHistoryTitle, setEditingHistoryTitle] = useState('')

  // Phase 5: Location sharing feedback toast
  const [shareToast, setShareToast] = useState('')

  // Phase 4: Live GPS Navigation State
  const [navStatus, setNavStatus] = useState<NavigationStatus>('idle')
  const [liveLocation, setLiveLocation] = useState<LiveLocation | null>(null)
  const [navProgress, setNavProgress] = useState<NavigationProgress | null>(null)
  const [isVoiceMuted, setIsVoiceMuted] = useState(false)
  const [isCameraLocked, setIsCameraLocked] = useState(true)
  const [offRouteDismissed, setOffRouteDismissed] = useState(false)
  const [gpsErrorMessage, setGpsErrorMessage] = useState('')

  isCameraLockedRef.current = isCameraLocked
  navProgressRef.current = navProgress

  // Use ref to read latest pickingEndpoint inside map click listener
  const pickingEndpointRef = useRef<EndpointTarget | null>(pickingEndpoint)
  pickingEndpointRef.current = pickingEndpoint

  const clearNearbyMarkers = useCallback(() => {
    nearbyMarkers.current.forEach(m => m.remove())
    nearbyMarkers.current = []
  }, [])

  const flyTo = useCallback((longitude: number, latitude: number, zoom = 15) => {
    if (!isValidCoordinate(longitude, latitude)) return
    mapRef.current?.flyTo({ center: [longitude, latitude], zoom, essential: true })
  }, [])

  const updateNavPuck = useCallback((loc: LiveLocation) => {
    if (!mapRef.current) return
    if (!navMarkerRef.current) {
      const el = document.createElement('div')
      el.className = 'nav-puck-container'
      el.innerHTML = `
        <div class="nav-puck-halo"></div>
        <div class="nav-puck-arrow"></div>
        <div class="nav-puck-dot"></div>
      `
      navMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([loc.longitude, loc.latitude])
        .addTo(mapRef.current)
    } else {
      navMarkerRef.current.setLngLat([loc.longitude, loc.latitude])
    }

    const markerEl = navMarkerRef.current.getElement()
    const arrowEl = markerEl.querySelector('.nav-puck-arrow') as HTMLElement | null
    if (arrowEl) {
      if (loc.heading != null && Number.isFinite(loc.heading)) {
        arrowEl.style.display = 'block'
        arrowEl.style.transform = `translateX(-50%) rotate(${loc.heading}deg)`
      } else {
        arrowEl.style.display = 'none'
      }
    }
  }, [])

  const handleSelectPlace = useCallback((
    place: GeocodingResult | Place | SelectedPlace,
    source: 'search' | 'nearby' | 'pin' | 'saved'
  ) => {
    if (!isValidCoordinate(place.longitude, place.latitude)) return
    setSearchDropdownOpen(false)
    flyTo(place.longitude, place.latitude, 16)

    temporaryMarker.current?.remove()
    searchMarker.current?.remove()

    if (mapRef.current) {
      const markerColor = source === 'pin' ? '#e76545' : source === 'saved' ? '#d97706' : '#2563eb'
      searchMarker.current = new maplibregl.Marker({ color: markerColor })
        .setLngLat([place.longitude, place.latitude])
        .addTo(mapRef.current)
    }

    const geo = place as Partial<GeocodingResult>
    const displayName = geo.displayName || (geo.address ? [geo.address.street, geo.address.city, geo.address.country].filter(Boolean).join(', ') : undefined)

    setSelected({
      id: place.id,
      name: place.name,
      displayName,
      longitude: place.longitude,
      latitude: place.latitude,
      category: geo.category,
      type: geo.type,
      source,
    })

    if (source === 'search' && place.name) {
      setRecentSearches(current =>
        saveRecentSearch(current, {
          query: place.name,
          placeName: displayName,
          longitude: place.longitude,
          latitude: place.latitude,
        })
      )
    }
  }, [flyTo])

  useEffect(() => {
    if (!isOfflineChecked || !mapContainer.current || mapRef.current) return
    if (!('WebGLRenderingContext' in window)) {
      setMapError('WebGL is unavailable in this browser. Try enabling hardware acceleration.')
      return
    }
    try {
      const initialStyle = mapMode === 'offline-delhi' ? OFFLINE_STYLE_URL : styleUrl
      appliedStyle.current = initialStyle
      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: initialStyle,
        center: [77.209, 28.6139],
        zoom: 12,
        pitchWithRotate: true,
        dragRotate: true,
        maxZoom: 20,
        minZoom: 2,
      })
      mapRef.current = map
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
      map.addControl(new maplibregl.FullscreenControl(), 'bottom-right')

      map.on('load', () => {
        setMapReady(true)
        setMapError('')
        ensureRouteLayers(map)
      })

      map.on('moveend', () => {
        const center = map.getCenter()
        setMapCenter([center.lng, center.lat])
      })

      map.on('dragstart', () => {
        setIsCameraLocked(false)
      })

      map.on('error', event => {
        const message = event.error?.message?.toLowerCase() || ''
        if (message.includes('webgl')) {
          setMapError('The map renderer ran into a WebGL issue.')
        } else if (
          message &&
          !message.includes('image') &&
          !message.includes('sprite') &&
          !message.includes('glyph') &&
          !message.includes('icon')
        ) {
          setMapError('Some map data could not be loaded. Check your connection or try another map style.')
        }
      })

      map.on('click', event => {
        const currentPicking = pickingEndpointRef.current
        if (currentPicking !== null && currentPicking !== undefined) {
          const endpoint: RouteEndpoint = {
            id: `point-${Date.now()}`,
            name: `${formatCoordinates(event.lngLat.lng, event.lngLat.lat)}`,
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
            type: 'pin',
          }
          if (currentPicking === 'origin') {
            setRouteOrigin(endpoint)
          } else if (currentPicking === 'destination') {
            setRouteDestination(endpoint)
          } else if (typeof currentPicking === 'number') {
            setRouteStops(current => current.map((s, idx) => idx === currentPicking ? endpoint : s))
          }
          setPickingEndpoint(null)
          setActivePanel('directions')
          return
        }

        const place: SelectedPlace = {
          id: `pin-${Date.now()}`,
          name: 'Dropped pin',
          longitude: event.lngLat.lng,
          latitude: event.lngLat.lat,
          source: 'pin',
        }
        temporaryMarker.current?.remove()
        searchMarker.current?.remove()
        temporaryMarker.current = new maplibregl.Marker({ color: '#e76545' }).setLngLat(event.lngLat).addTo(map)
        setSelected(place)
        setSearchDropdownOpen(false)
      })
    } catch (error) {
      setMapError(error instanceof Error ? `Map could not start: ${error.message}` : 'Map could not start. Your browser may not support WebGL.')
    }
    const speech = speechRef.current
    return () => {
      clearNearbyMarkers()
      if (gpsWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current)
        gpsWatchIdRef.current = null
      }
      speech.cancel()
      originMarkerRef.current?.remove()
      destinationMarkerRef.current?.remove()
      stepMarkerRef.current?.remove()
      stopMarkersRef.current.forEach(m => m.remove())
      stopMarkersRef.current = []
      navMarkerRef.current?.remove()
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOfflineChecked])

  // Check initial OPFS package status and attach file to PMTiles protocol if ready
  useEffect(() => {
    let isMounted = true
    async function initOffline() {
      try {
        const [state, release] = await Promise.all([
          offlineManager.getPackageState(),
          datasetUpdateService.getInstalledRelease(),
        ])
        if (!isMounted) return
        setOfflineState(state)
        setInstalledRelease(release)

        if (state.status === 'ready') {
          const file = await offlineManager.getPackageFile()
          if (file && isMounted) {
            offlineManager.attachPmtilesFile(file)
            void offlineDelhiRoutingRef.current.ensureGraphLoaded()
          }
        } else if (mapMode === 'offline-delhi') {
          setMapMode('online')
        }
      } catch (err) {
        if (isMounted) {
          setOfflineState({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
          if (mapMode === 'offline-delhi') {
            setMapMode('online')
          }
        }
      } finally {
        if (isMounted) {
          setIsOfflineChecked(true)
        }
      }
    }
    initOffline()

    const unsubscribeUpdate = datasetUpdateService.onUpdateActivated(async newRelease => {
      if (!isMounted) return
      setInstalledRelease(newRelease)
      try {
        await offlineDelhiProviderRef.current.reloadPlaces?.()
        await offlineDelhiRoutingRef.current.reloadGraph?.()
        const state = await offlineManager.getPackageState()
        setOfflineState(state)
        const file = await offlineManager.getPackageFile()
        if (file) {
          offlineManager.attachPmtilesFile(file)
        }
      } catch (refreshErr) {
        console.warn('Failed refreshing services after update activation:', refreshErr)
      }
    })

    return () => {
      isMounted = false
      unsubscribeUpdate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist offline mode preference
  useEffect(() => {
    try {
      localStorage.setItem(mapModeKey, mapMode)
    } catch {
      // Ignore
    }
  }, [mapMode])

  const activeEffectiveStyle = mapMode === 'offline-delhi' ? OFFLINE_STYLE_URL : styleUrl
  const activeEffectiveStyleName = mapMode === 'offline-delhi' ? 'VersaTiles Colorful (Offline Delhi)' : styleName

  useEffect(() => {
    if (mapRef.current && appliedStyle.current !== activeEffectiveStyle) {
      appliedStyle.current = activeEffectiveStyle
      mapRef.current.setStyle(activeEffectiveStyle)
      setMapError('')
      setMapReady(false)
      mapRef.current.once('style.load', () => {
        setMapReady(true)
        if (mapRef.current) {
          ensureRouteLayers(mapRef.current)
          if (routes.length > 0) {
            renderRoutesOnMap(mapRef.current, routes, activeRouteIndex)
          }
        }
      })
    }
  }, [activeEffectiveStyle, routes, activeRouteIndex])

  useEffect(() => {
    localStorage.setItem(savedKey, JSON.stringify(saved))
  }, [saved])

  useEffect(() => {
    localStorage.setItem(listsKey, JSON.stringify(lists))
  }, [lists])

  useEffect(() => {
    localStorage.setItem(routeHistoryKey, JSON.stringify(routeHistory))
  }, [routeHistory])

  useEffect(() => {
    localStorage.setItem(recentSearchesKey, JSON.stringify(recentSearches))
  }, [recentSearches])

  useEffect(() => {
    if (!shareToast) return
    const timer = setTimeout(() => setShareToast(''), 3500)
    return () => clearTimeout(timer)
  }, [shareToast])

  // Sync intermediate stop markers on map
  useEffect(() => {
    stopMarkersRef.current.forEach(m => m.remove())
    stopMarkersRef.current = []

    if (mapRef.current && routeStops.length > 0) {
      routeStops.forEach((stop, idx) => {
        if (isValidCoordinate(stop.longitude, stop.latitude) && mapRef.current) {
          const marker = createEndpointMarker('waypoint', stop, mapRef.current, idx)
          stopMarkersRef.current.push(marker)
        }
      })
    }
  }, [routeStops])

  // Parse shareable URL parameters on initial load
  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = window.location.search
    if (!search) return
    const parsed = parseShareParams(search)
    if (!parsed) return

    if (parsed.type === 'place') {
      const { name, longitude, latitude } = parsed.place
      const place: SelectedPlace = {
        id: `shared-${Date.now()}`,
        name,
        longitude,
        latitude,
        source: 'pin',
      }
      setSelected(place)
      flyTo(longitude, latitude, 15)
      if (mapRef.current) {
        temporaryMarker.current?.remove()
        temporaryMarker.current = new maplibregl.Marker({ color: '#2563eb' })
          .setLngLat([longitude, latitude])
          .addTo(mapRef.current)
      }
      setShareToast(`Opened shared location: ${name}`)
    } else if (parsed.type === 'route') {
      const { origin, destination, waypoints, mode } = parsed.route
      setRouteOrigin(origin)
      setRouteDestination(destination)
      setRouteStops(waypoints)
      setTravelMode(mode)
      setActivePanel('directions')
      setShareToast('Opened shared route')
    }
  }, [flyTo])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
        setSearchDropdownOpen(true)
      }
      if (event.key === 'Escape') {
        if (pickingEndpoint) {
          setPickingEndpoint(null)
          setActivePanel('directions')
        }
        setSearchDropdownOpen(false)
        setEditingEndpoint(null)
      }
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchDropdownOpen(false)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [pickingEndpoint])

  // Debounced global place search
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      searchAbortRef.current?.abort()
      setSearchResults([])
      setIsSearching(false)
      setSearchError('')
      return
    }

    setIsSearching(true)
    setSearchError('')
    const requestId = ++searchRequestIdRef.current

    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort()
      const controller = new AbortController()
      searchAbortRef.current = controller

      const center = mapRef.current ? mapRef.current.getCenter() : null
      const centerCoords: [number, number] | undefined = center ? [center.lng, center.lat] : undefined

      try {
        const results = await activeGeocodingProvider.search(trimmed, {
          signal: controller.signal,
          center: centerCoords,
          limit: 8,
        })
        if (requestId === searchRequestIdRef.current) {
          setSearchResults(results)
          setIsSearching(false)
        }
      } catch (err) {
        if (requestId === searchRequestIdRef.current) {
          if (err instanceof Error && err.name === 'AbortError') return
          setSearchError(err instanceof Error ? err.message : 'Search failed. Please check your connection.')
          setSearchResults([])
          setIsSearching(false)
        }
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [query, activeGeocodingProvider])

  // Debounced endpoint search within directions panel
  useEffect(() => {
    const trimmed = endpointQuery.trim()
    if (trimmed.length < 2) {
      endpointSearchAbortRef.current?.abort()
      setEndpointResults([])
      setIsSearchingEndpoint(false)
      return
    }

    setIsSearchingEndpoint(true)
    const timer = setTimeout(async () => {
      endpointSearchAbortRef.current?.abort()
      const controller = new AbortController()
      endpointSearchAbortRef.current = controller

      try {
        const results = await activeGeocodingProvider.search(trimmed, {
          signal: controller.signal,
          center: mapCenter,
          limit: 5,
        })
        setEndpointResults(results)
        setIsSearchingEndpoint(false)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setEndpointResults([])
        setIsSearchingEndpoint(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [endpointQuery, mapCenter, activeGeocodingProvider])

  // Calculate route when origin and destination are both set
  useEffect(() => {
    if (!routeOrigin || !routeDestination) {
      setRoutes([])
      setRoutingError('')
      setIsRouting(false)
      if (mapRef.current) clearRoutesFromMap(mapRef.current)
      originMarkerRef.current?.remove()
      originMarkerRef.current = null
      destinationMarkerRef.current?.remove()
      destinationMarkerRef.current = null
      stepMarkerRef.current?.remove()
      stepMarkerRef.current = null
      stopMarkersRef.current.forEach(m => m.remove())
      stopMarkersRef.current = []

      if (mapRef.current && routeOrigin) {
        originMarkerRef.current = createEndpointMarker('origin', routeOrigin, mapRef.current)
      } else if (mapRef.current && routeDestination) {
        destinationMarkerRef.current = createEndpointMarker('destination', routeDestination, mapRef.current)
      }
      return
    }

    routeAbortRef.current?.abort()
    const controller = new AbortController()
    routeAbortRef.current = controller

    setIsRouting(true)
    setRoutingError('')

    const performRouting = async () => {
      try {
        const validStops = routeStops.filter(s => isValidCoordinate(s.longitude, s.latitude))
        const calculatedRoutes = await activeRoutingProvider.calculateRoute({
          origin: routeOrigin,
          destination: routeDestination,
          waypoints: validStops,
          mode: travelMode,
          alternatives: validStops.length === 0,
          signal: controller.signal,
        })

        setRoutes(calculatedRoutes)
        setActiveRouteIndex(0)
        setIsRouting(false)

        if (mapRef.current && calculatedRoutes.length > 0) {
          renderRoutesOnMap(mapRef.current, calculatedRoutes, 0)

          originMarkerRef.current?.remove()
          destinationMarkerRef.current?.remove()
          originMarkerRef.current = createEndpointMarker('origin', routeOrigin, mapRef.current)
          destinationMarkerRef.current = createEndpointMarker('destination', routeDestination, mapRef.current)

          stopMarkersRef.current.forEach(m => m.remove())
          stopMarkersRef.current = []
          validStops.forEach((stop, idx) => {
            if (mapRef.current) {
              const marker = createEndpointMarker('waypoint', stop, mapRef.current, idx)
              stopMarkersRef.current.push(marker)
            }
          })

          fitRouteBounds(mapRef.current, calculatedRoutes[0], {
            top: 90,
            bottom: 90,
            left: sidebarOpen ? 340 : 60,
            right: 60,
          })

          // Save completed/calculated route to history (privacy-friendly, endpoints only!)
          const topRoute = calculatedRoutes[0]
          setRouteHistory(current =>
            saveRouteHistoryItem(current, {
              title: `${routeOrigin.name} → ${routeDestination.name}`,
              origin: routeOrigin,
              destination: routeDestination,
              waypoints: validStops,
              mode: travelMode,
              distanceMeters: topRoute.distanceMeters,
              durationSeconds: topRoute.durationSeconds,
            })
          )
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setIsRouting(false)
        setRoutes([])
        setRoutingError(err instanceof Error ? err.message : 'Routing calculation failed.')
        if (mapRef.current) clearRoutesFromMap(mapRef.current)
      }
    }

    void performRouting()

    return () => controller.abort()
  }, [routeOrigin, routeDestination, routeStops, travelMode, sidebarOpen, activeRoutingProvider])

  // When active route index changes, re-render routes on map
  useEffect(() => {
    if (mapRef.current && routes.length > 0) {
      renderRoutesOnMap(mapRef.current, routes, activeRouteIndex)
      const active = routes[activeRouteIndex]
      if (active) {
        fitRouteBounds(mapRef.current, active, {
          top: 90,
          bottom: 90,
          left: sidebarOpen ? 340 : 60,
          right: 60,
        })
      }
    }
  }, [activeRouteIndex, routes, sidebarOpen])

  const openPanel = (panel: 'styles' | 'saved' | 'settings' | 'nearby' | 'directions' | 'history' | 'offline') =>
    setActivePanel(current => current === panel ? null : panel)

  const locateMe = () => {
    setGeoMessage('')
    if (!navigator.geolocation) {
      setGeoMessage('Location is not available in this browser.')
      return
    }
    setGeoMessage('Finding your location…')
    navigator.geolocation.getCurrentPosition(position => {
      const { longitude, latitude } = position.coords
      if (!isValidCoordinate(longitude, latitude)) {
        setGeoMessage('Invalid coordinates received from browser location.')
        return
      }
      setUserLocation([longitude, latitude])
      flyTo(longitude, latitude, 15)
      userMarker.current?.remove()
      if (mapRef.current) {
        userMarker.current = new maplibregl.Marker({ color: '#438f78' })
          .setLngLat([longitude, latitude])
          .addTo(mapRef.current)
      }
      setGeoMessage(`You are here · ${formatCoordinates(longitude, latitude)}`)
    }, error => {
      setGeoMessage(
        error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access in your browser settings and try again.'
          : error.code === error.POSITION_UNAVAILABLE
          ? 'Your location could not be determined. Check your device location settings.'
          : 'Location request timed out. Please try again.'
      )
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  }

  const discoverNearby = useCallback(async (categoryKey: string) => {
    if (!mapRef.current) return
    setNearbyCategory(categoryKey)
    setNearbyLoading(true)
    setNearbyError('')
    clearNearbyMarkers()

    nearbyAbortRef.current?.abort()
    const controller = new AbortController()
    nearbyAbortRef.current = controller

    const center = mapRef.current.getCenter()
    const centerCoords: [number, number] = [center.lng, center.lat]

    try {
      const results = await activeGeocodingProvider.nearby(categoryKey, centerCoords, {
        signal: controller.signal,
        limit: 14,
      })
      setNearbyResults(results)
      setNearbyLoading(false)

      if (mapRef.current) {
        results.forEach(item => {
          if (!mapRef.current) return
          const marker = new maplibregl.Marker({ color: '#0d9488' })
            .setLngLat([item.longitude, item.latitude])
            .addTo(mapRef.current)
          marker.getElement().addEventListener('click', (e) => {
            e.stopPropagation()
            handleSelectPlace(item, 'nearby')
          })
          nearbyMarkers.current.push(marker)
        })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setNearbyError(err instanceof Error ? err.message : 'Failed to discover nearby places. Check your connection.')
      setNearbyResults([])
      setNearbyLoading(false)
    }
  }, [clearNearbyMarkers, handleSelectPlace, activeGeocodingProvider])

  const isSelectedSaved = useMemo(() => {
    if (!selected) return false
    return saved.some(
      s => s.id === selected.id || (Math.abs(s.longitude - selected.longitude) < 0.0001 && Math.abs(s.latitude - selected.latitude) < 0.0001)
    )
  }, [selected, saved])

  const saveSelected = () => {
    if (!selected) return
    if (isSelectedSaved) {
      setSaved(current => current.filter(s => s.id !== selected.id && !(Math.abs(s.longitude - selected.longitude) < 0.0001 && Math.abs(s.latitude - selected.latitude) < 0.0001)))
      return
    }
    const placeToSave: Place = {
      id: selected.id,
      name: selected.name,
      longitude: selected.longitude,
      latitude: selected.latitude,
      listIds: ['favorites'],
    }
    setSaved(current => savePlace(current, placeToSave))
  }

  const handleDirectionsToPlace = (place: SelectedPlace) => {
    const dest: RouteEndpoint = {
      id: place.id,
      name: place.name,
      longitude: place.longitude,
      latitude: place.latitude,
      type: place.source,
    }
    setRouteDestination(dest)
    if (!routeOrigin) {
      if (userLocation) {
        setRouteOrigin({
          name: 'My Location',
          longitude: userLocation[0],
          latitude: userLocation[1],
          type: 'gps',
        })
      }
    }
    setActivePanel('directions')
  }

  const handleDirectionsFromPlace = (place: SelectedPlace) => {
    const orig: RouteEndpoint = {
      id: place.id,
      name: place.name,
      longitude: place.longitude,
      latitude: place.latitude,
      type: place.source,
    }
    setRouteOrigin(orig)
    setActivePanel('directions')
  }

  const handleSwapEndpoints = () => {
    setRouteOrigin(routeDestination)
    setRouteDestination(routeOrigin)
    setRouteStops(current => [...current].reverse())
  }

  const handleClearRoute = () => {
    setRouteOrigin(null)
    setRouteDestination(null)
    setRouteStops([])
    setRoutes([])
    setRoutingError('')
    originMarkerRef.current?.remove()
    originMarkerRef.current = null
    destinationMarkerRef.current?.remove()
    destinationMarkerRef.current = null
    stepMarkerRef.current?.remove()
    stepMarkerRef.current = null
    stopMarkersRef.current.forEach(m => m.remove())
    stopMarkersRef.current = []
    if (mapRef.current) clearRoutesFromMap(mapRef.current)
  }

  const handleAddStop = () => {
    setRouteStops(current => [
      ...current,
      {
        id: `stop-${Date.now()}-${current.length + 1}`,
        name: '',
        longitude: 0,
        latitude: 0,
        type: 'custom',
      },
    ])
    setEditingEndpoint(routeStops.length)
  }

  const handleRemoveStop = (index: number) => {
    setRouteStops(current => current.filter((_, i) => i !== index))
    if (editingEndpoint === index) {
      setEditingEndpoint(null)
    }
  }

  const handleMoveStop = (index: number, direction: 'up' | 'down') => {
    setRouteStops(current => {
      const next = [...current]
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= next.length) return current
      const temp = next[index]
      next[index] = next[targetIndex]
      next[targetIndex] = temp
      return next
    })
  }

  const handleSelectEndpointOption = (
    endpoint: RouteEndpoint,
    target: EndpointTarget
  ) => {
    if (target === 'origin') {
      setRouteOrigin(endpoint)
    } else if (target === 'destination') {
      setRouteDestination(endpoint)
    } else if (typeof target === 'number') {
      setRouteStops(current => current.map((s, idx) => idx === target ? endpoint : s))
    }
    setEditingEndpoint(null)
    setEndpointQuery('')
    setEndpointResults([])
  }

  const handlePickFromMap = (target: EndpointTarget) => {
    setPickingEndpoint(target)
    setEditingEndpoint(null)
    setActivePanel(null)
  }

  // Phase 5: Location Sharing Handlers
  const handleSharePlace = (place: { name: string; longitude: number; latitude: number }) => {
    const url = generatePlaceShareUrl({
      name: place.name,
      longitude: place.longitude,
      latitude: place.latitude,
    })
    navigator.clipboard.writeText(url).then(
      () => setShareToast('Location link copied to clipboard!'),
      () => setShareToast(`Share URL: ${url}`)
    )
  }

  const handleShareRoute = () => {
    if (!routeOrigin || !routeDestination) return
    const url = generateRouteShareUrl(routeOrigin, routeDestination, routeStops, travelMode)
    navigator.clipboard.writeText(url).then(
      () => setShareToast('Route link copied to clipboard!'),
      () => setShareToast(`Share URL: ${url}`)
    )
  }

  // Phase 5: Custom Lists Handlers
  const handleCreateNewList = () => {
    try {
      const { lists: updatedLists, newList } = createList(lists, newListName)
      setLists(updatedLists)
      setActiveListId(newList.id)
      setNewListName('')
      setIsCreatingList(false)
      setShareToast(`Created list "${newList.name}"`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create list.')
    }
  }

  const handleDeleteList = (listId: string) => {
    const target = lists.find(l => l.id === listId)
    if (!target) return
    if (window.confirm(`Delete list "${target.name}"? Saved places will remain in All Places.`)) {
      setLists(current => deleteList(current, listId))
      if (activeListId === listId) setActiveListId('all')
    }
  }

  const handleTogglePlaceList = (place: SelectedPlace | Place, listId: string) => {
    const currentPlace = saved.find(p => p.id === place.id)
    if (!currentPlace) {
      const placeToSave: Place = {
        id: place.id,
        name: place.name,
        longitude: place.longitude,
        latitude: place.latitude,
        listIds: [listId],
      }
      setSaved(current => savePlace(current, placeToSave))
      setShareToast(`Saved to ${lists.find(l => l.id === listId)?.name || 'list'}`)
    } else {
      const currentListIds = currentPlace.listIds || ['favorites']
      const inList = currentListIds.includes(listId)
      const nextListIds = inList ? currentListIds.filter(id => id !== listId) : [...currentListIds, listId]
      setSaved(current => setPlaceLists(current, place.id, nextListIds))
    }
  }

  // Phase 5: Export / Import / Clear Data Handlers
  const handleExportData = () => {
    const data = createExportData(saved, lists, routeHistory, recentSearches)
    const jsonStr = exportToJsonString(data)
    const dateStr = new Date().toISOString().slice(0, 10)
    downloadJsonFile(`openatlas-backup-${dateStr}.json`, jsonStr)
    setShareToast('Exported OpenAtlas backup JSON')
  }

  const handleImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (!text) return
      const result = parseAndValidateImportData(text)
      if (!result.success || !result.data) {
        alert(result.error || 'Failed to import JSON.')
        return
      }

      const importedPlaces = result.data.places
      const importedLists = result.data.lists
      const importedHistory = result.data.routeHistory

      setSaved(current => {
        const existingIds = new Set(current.map(p => p.id))
        const newPlaces = importedPlaces.filter(p => !existingIds.has(p.id))
        return [...current, ...newPlaces]
      })

      setLists(current => {
        const existingIds = new Set(current.map(l => l.id))
        const newLists = importedLists.filter(l => !existingIds.has(l.id))
        return [...current, ...newLists]
      })

      if (importedHistory.length > 0) {
        setRouteHistory(current => {
          const existingIds = new Set(current.map(h => h.id))
          const newItems = importedHistory.filter(h => !existingIds.has(h.id))
          return [...newItems, ...current].slice(0, 30)
        })
      }

      setShareToast(`Imported ${importedPlaces.length} places & ${importedLists.length} lists!`)
    }
    reader.readAsText(file)
  }

  const handleClearAllData = () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete all saved places, lists, and trip history? We strongly recommend exporting a backup first.'
    )
    if (!confirmed) return
    setSaved([])
    setLists(DEFAULT_LISTS)
    setRouteHistory([])
    setRecentSearches([])
    localStorage.removeItem(savedKey)
    localStorage.removeItem(listsKey)
    localStorage.removeItem(routeHistoryKey)
    localStorage.removeItem(recentSearchesKey)
    setShareToast('All personal data cleared.')
  }

  const handleStepClick = (stepLoc: [number, number]) => {
    flyTo(stepLoc[0], stepLoc[1], 17)
    stepMarkerRef.current?.remove()
    if (mapRef.current) {
      stepMarkerRef.current = new maplibregl.Marker({ color: '#2563eb' })
        .setLngLat(stepLoc)
        .addTo(mapRef.current)
    }
  }

  // Phase 4: Navigation Handlers
  const activeRoute = routes[activeRouteIndex]

  useEffect(() => {
    activeRouteRef.current = activeRoute || null
  }, [activeRoute])

  const handleStartNavigation = () => {
    if (!activeRoute) return
    if (!navigator.geolocation) {
      setGpsErrorMessage('Geolocation is not supported by your browser.')
      return
    }

    setNavStatus('navigating')
    setOffRouteDismissed(false)
    setIsCameraLocked(true)
    setSidebarOpen(false)
    setActivePanel(null)

    if (gpsWatchIdRef.current != null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current)
      gpsWatchIdRef.current = null
    }

    speechRef.current.reset()
    lastSpokenStepIndexRef.current = -1
    if (activeRoute.steps && activeRoute.steps.length > 0) {
      speechRef.current.speak(`Starting navigation. ${activeRoute.steps[0].instruction}`)
    }

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      position => {
        const { longitude, latitude, accuracy, heading, speed } = position.coords
        if (!isValidCoordinate(longitude, latitude)) return

        let calculatedHeading = heading != null && Number.isFinite(heading) && heading >= 0 ? heading : null
        const prev = prevLiveLocRef.current

        // If sensor heading is absent, compute bearing from movement if moved >= 3m
        if (calculatedHeading == null && prev) {
          const distMoved = calculateDistanceMeters(prev.longitude, prev.latitude, longitude, latitude)
          if (distMoved >= 3) {
            calculatedHeading = calculateBearing(prev.longitude, prev.latitude, longitude, latitude)
          } else {
            calculatedHeading = prev.heading
          }
        }

        const liveLoc: LiveLocation = {
          longitude,
          latitude,
          accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
          heading: calculatedHeading,
          speedMps: Number.isFinite(speed) ? speed : null,
          timestamp: position.timestamp,
        }
        prevLiveLocRef.current = liveLoc
        setLiveLocation(liveLoc)
        setGpsErrorMessage('')

        const routeToTrack = activeRouteRef.current || activeRoute
        const prevStepIdx = navProgressRef.current ? navProgressRef.current.currentStepIndex : 0
        const progress = calculateRouteProgress(liveLoc, routeToTrack, prevStepIdx, travelMode)
        navProgressRef.current = progress
        setNavProgress(progress)

        // Spoken turn guidance
        if (progress.hasArrived) {
          speechRef.current.speak('You have arrived at your destination.')
          setNavStatus('arrived')
        } else if (progress.nextStep) {
          if (progress.currentStepIndex !== prevStepIdx) {
            speechRef.current.speak(`In ${formatDistance(progress.distanceToNextStepMeters)}, ${progress.nextStep.instruction}`)
            lastSpokenStepIndexRef.current = -1
          } else if (progress.distanceToNextStepMeters <= 50 && lastSpokenStepIndexRef.current !== progress.currentStepIndex) {
            speechRef.current.speak(progress.nextStep.instruction)
            lastSpokenStepIndexRef.current = progress.currentStepIndex
          }
        }

        updateNavPuck(liveLoc)

        // Follow user if camera lock is active
        if (isCameraLockedRef.current && mapRef.current) {
          mapRef.current.easeTo({
            center: [longitude, latitude],
            zoom: 17,
            pitch: 45,
            bearing: calculatedHeading || 0,
            duration: 700,
          })
        }
      },
      error => {
        const msg =
          error.code === error.PERMISSION_DENIED
            ? 'GPS location permission was denied. Allow location in browser settings.'
            : error.code === error.POSITION_UNAVAILABLE
            ? 'GPS signal is currently unavailable.'
            : 'GPS request timed out searching for location.'
        setGpsErrorMessage(msg)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
    )
  }

  const handlePauseNavigation = () => {
    setNavStatus('paused')
    speechRef.current.cancel()
  }

  const handleResumeNavigation = () => {
    setNavStatus('navigating')
    setIsCameraLocked(true)
    if (navProgress?.nextStep) {
      speechRef.current.speak(`Resuming navigation. In ${formatDistance(navProgress.distanceToNextStepMeters)}, ${navProgress.nextStep.instruction}`)
    }
  }

  const handleEndNavigation = () => {
    if (gpsWatchIdRef.current != null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current)
      gpsWatchIdRef.current = null
    }
    speechRef.current.cancel()
    navMarkerRef.current?.remove()
    navMarkerRef.current = null
    setNavStatus('idle')
    setLiveLocation(null)
    setNavProgress(null)
    prevLiveLocRef.current = null
    lastSpokenStepIndexRef.current = -1
    activeRouteRef.current = null
    setActivePanel('directions')
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 400 })
  }

  const handleRecalculateRoute = () => {
    if (!liveLocation || !routeDestination) return
    speechRef.current.speak('Recalculating route from current location.', true)
    setRouteOrigin({
      name: 'Current Location',
      longitude: liveLocation.longitude,
      latitude: liveLocation.latitude,
      type: 'gps',
    })
    setOffRouteDismissed(true)
  }

  const handleToggleVoice = () => {
    const isNowMuted = speechRef.current.toggleMute()
    setIsVoiceMuted(isNowMuted)
  }

  const handleRecenterCamera = () => {
    setIsCameraLocked(true)
    if (liveLocation && mapRef.current) {
      mapRef.current.easeTo({
        center: [liveLocation.longitude, liveLocation.latitude],
        zoom: 17,
        pitch: 45,
        bearing: liveLocation.heading || 0,
        duration: 500,
      })
    }
  }

  const handleSaveHistoryTitle = (id: string, newTitle: string) => {
    if (!newTitle.trim()) return
    setRouteHistory(current => updateRouteHistoryTitle(current, id, newTitle.trim()))
    setEditingHistoryId(null)
    setEditingHistoryTitle('')
  }

  const filteredSaved = useMemo(() => filterSavedPlaces(saved, query), [saved, query])
  const displayedSavedPlaces = useMemo(() => {
    const byList = filterPlacesByList(saved, activeListId)
    return filterSavedPlaces(byList, query)
  }, [saved, activeListId, query])
  const chooseStyle = (option: MapStyleOption) => {
    if (mapMode === 'offline-delhi') {
      setMapMode('online')
    }
    setStyleName(option.name)
    setStyleUrl(option.url)
    setActivePanel(null)
  }

  const handleDownloadOfflinePackage = async () => {
    if (isDownloadingOffline) return
    setIsDownloadingOffline(true)
    setOfflineError('')
    setDownloadProgress({ bytesDownloaded: 0, totalBytes: DELHI_PACKAGE_METADATA.expectedSize, percentage: 0 })

    const controller = new AbortController()
    offlineAbortRef.current = controller

    try {
      const result = await offlineManager.downloadPackage(
        DELHI_PACKAGE_METADATA,
        (progress) => setDownloadProgress(progress),
        controller.signal,
      )

      setOfflineState(result)
      if (result.status === 'ready') {
        void offlineDelhiRoutingRef.current.ensureGraphLoaded()
        setShareToast('Offline Delhi package is ready to use.')
        setMapMode('offline-delhi')
        flyTo(DELHI_PACKAGE_METADATA.center[0], DELHI_PACKAGE_METADATA.center[1], 12)
      } else if (result.status === 'not_downloaded') {
        setOfflineError(result.error || 'Download was cancelled.')
      } else if (result.status === 'error') {
        setOfflineError(result.error || 'Failed to download offline package.')
      }
    } catch (err) {
      setOfflineError(err instanceof Error ? err.message : 'Download failed.')
    } finally {
      setIsDownloadingOffline(false)
      offlineAbortRef.current = null
      setDownloadProgress(null)
    }
  }

  const handleCancelDownload = () => {
    if (offlineAbortRef.current) {
      offlineAbortRef.current.abort()
      offlineManager.cancelDownload()
    }
  }

  const handleDeleteOfflinePackage = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete the downloaded Offline Delhi map package (~15.4 MB) from this device?'
    )
    if (!confirmed) return

    if (mapMode === 'offline-delhi') {
      setMapMode('online')
    }

    try {
      const res = await offlineManager.deletePackage()
      setOfflineState(res)
      offlineDelhiRoutingRef.current.resetGraph?.()
      if (typeof caches !== 'undefined') {
        void caches.delete('openatlas-offline-routing-v1')
      }
      setShareToast('Offline Delhi package deleted from device.')
    } catch (err) {
      setOfflineError(err instanceof Error ? err.message : 'Failed to delete package.')
    }
  }

  const handleCheckForUpdates = async () => {
    if (isCheckingUpdate || isUpdatingDataset) return
    setIsCheckingUpdate(true)
    setUpdateError('')
    setUpdateSuccess('')
    try {
      const result = await datasetUpdateService.checkForUpdates()
      setUpdateCheckResult(result)
      if (result.error) {
        setUpdateError(result.error)
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to check for updates.')
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const handleApplyDatasetUpdate = async () => {
    if (!updateCheckResult?.latestManifest || isUpdatingDataset) return
    setIsUpdatingDataset(true)
    setUpdateError('')
    setUpdateSuccess('')
    setUpdateProgress({
      currentAsset: 'places',
      assetIndex: 1,
      totalAssets: 3,
      assetBytesDownloaded: 0,
      assetTotalBytes: updateCheckResult.latestManifest.assets.places.sizeBytes,
      totalBytesDownloaded: 0,
      totalBytesToDownload:
        updateCheckResult.latestManifest.assets.places.sizeBytes +
        updateCheckResult.latestManifest.assets.routingGraph.sizeBytes +
        updateCheckResult.latestManifest.assets.pmtiles.sizeBytes,
      percentage: 0,
    })

    try {
      const updated = await datasetUpdateService.downloadAndInstallUpdate(
        updateCheckResult.latestManifest,
        (progress) => setUpdateProgress(progress),
      )
      setUpdateSuccess(`Offline map dataset successfully updated to v${updated.manifest.version}!`)
      setUpdateCheckResult(null)
      setShareToast(`Delhi offline dataset updated to v${updated.manifest.version}`)
    } catch (err) {
      const isAbort = (err instanceof Error && err.name === 'AbortError') || (err instanceof DOMException && err.name === 'AbortError')
      if (isAbort) {
        setUpdateError('Update cancelled. Your previous offline dataset is safely preserved.')
      } else {
        setUpdateError((err instanceof Error ? err.message : 'Update failed.') + ' Existing offline map data is safely preserved.')
      }
    } finally {
      setIsUpdatingDataset(false)
      setUpdateProgress(null)
    }
  }

  const handleCancelDatasetUpdate = () => {
    datasetUpdateService.cancelUpdate()
  }

  const handleRevertToBundled = async () => {
    const confirmed = window.confirm(
      'Revert offline map data to original bundled version (v2026.10.20)?'
    )
    if (!confirmed) return
    try {
      const reverted = await datasetUpdateService.revertToBundledRelease()
      setInstalledRelease(reverted)
      setUpdateSuccess('Reverted to bundled offline release.')
      setUpdateCheckResult(null)
      setShareToast('Reverted to bundled offline release.')
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to revert dataset.')
    }
  }

  const handleSwitchMode = async (nextMode: MapMode) => {
    if (nextMode === 'offline-delhi') {
      if (offlineState.status === 'unsupported') {
        setShareToast('OPFS storage is not supported in this browser.')
        setActivePanel('offline')
        return
      }
      if (offlineState.status !== 'ready') {
        setActivePanel('offline')
        setShareToast('Please download the Offline Delhi package first.')
        return
      }

      const file = await offlineManager.getPackageFile()
      if (file) {
        offlineManager.attachPmtilesFile(file)
      }
      void offlineDelhiRoutingRef.current.ensureGraphLoaded()
      setMapMode('offline-delhi')
      setShareToast('Switched to Offline Delhi mode.')
      if (!offlineManager.isCoordinateInsideBounds(mapCenter[0], mapCenter[1])) {
        flyTo(DELHI_PACKAGE_METADATA.center[0], DELHI_PACKAGE_METADATA.center[1], 12)
      }
    } else {
      setMapMode('online')
      setShareToast('Switched to Online mode.')
    }
  }

  const isOutsideOfflineBounds = useMemo(() => {
    if (mapMode !== 'offline-delhi') return false
    return !offlineManager.isCoordinateInsideBounds(mapCenter[0], mapCenter[1])
  }, [mapMode, mapCenter])
  const mapZoom = (delta: number) => {
    const map = mapRef.current
    if (map) map.zoomTo(map.getZoom() + delta, { duration: 250 })
  }

  const selectedDistance = useMemo(() => {
    if (!selected) return null
    const ref = userLocation || mapCenter
    const meters = calculateDistanceMeters(ref[0], ref[1], selected.longitude, selected.latitude)
    return formatDistance(meters)
  }, [selected, userLocation, mapCenter])

  return (
    <main className="app-shell">
      {shareToast && <div className="share-toast" role="status">{shareToast}</div>}
      <div className="map-canvas" ref={mapContainer} aria-label="Interactive map" />
      {!mapReady && !mapError && <div className="map-loading"><span className="spinner" />Loading your map</div>}
      {!!mapError && (
        <div className="map-warning" role="status">
          <span className="warning-dot" />{mapError}
          <button onClick={() => { setMapError(''); mapRef.current?.setStyle(activeEffectiveStyle) }} aria-label="Retry map loading">Retry</button>
        </div>
      )}

      {isOutsideOfflineBounds && navStatus === 'idle' && (
        <div className="coverage-warning-banner" role="alert">
          <AlertCircle size={16} />
          <div className="coverage-warning-text">
            <strong>Outside Offline Extract:</strong> Delhi NCT extract covers {DELHI_BOUNDS_LABEL}. Vector tiles outside this region are not available offline.
          </div>
          <button
            className="coverage-return-btn"
            onClick={() => flyTo(DELHI_PACKAGE_METADATA.center[0], DELHI_PACKAGE_METADATA.center[1], 12)}
            aria-label="Return to Delhi center"
          >
            Return to Delhi
          </button>
        </div>
      )}

      {pickingEndpoint !== null && pickingEndpoint !== undefined && (
        <div className="picking-banner" role="alert">
          <span>
            Click on the map to set{' '}
            {pickingEndpoint === 'origin'
              ? 'starting point (A)'
              : pickingEndpoint === 'destination'
              ? 'destination (B)'
              : `intermediate stop #${Number(pickingEndpoint) + 1}`}
          </span>
          <button onClick={() => { setPickingEndpoint(null); setActivePanel('directions') }} aria-label="Cancel map selection">Cancel</button>
        </div>
      )}

      {/* Phase 4: Live Navigation Heads-Up Displays (HUD) */}
      {navStatus !== 'idle' && (
        <>
          {/* Top Maneuver HUD */}
          <div className="nav-hud-top" role="region" aria-label="Navigation guidance">
            <div className="nav-hud-top-icon">
              {renderManeuverIcon(navProgress?.nextStep?.type, navProgress?.nextStep?.modifier, 24)}
            </div>
            <div className="nav-hud-top-details">
              <div className="nav-hud-distance">
                {navProgress ? formatDistance(navProgress.distanceToNextStepMeters) : '--'}
              </div>
              <div className="nav-hud-instruction">
                {navProgress?.nextStep ? navProgress.nextStep.instruction : 'Follow planned route'}
              </div>
            </div>
          </div>

          {/* Off-Route Alert Banner */}
          {navProgress?.isOffRoute && !offRouteDismissed && (
            <div className="nav-offroute-banner" role="alert">
              <span>Off route by {navProgress.offRouteDistanceMeters} m. Recalculate?</span>
              <div className="nav-offroute-actions">
                <button className="nav-reroute-btn" onClick={handleRecalculateRoute} aria-label="Recalculate route">
                  Recalculate
                </button>
                <button className="nav-dismiss-btn" onClick={() => setOffRouteDismissed(true)} aria-label="Dismiss off route warning">
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Out of Bounds Warning during Offline Navigation */}
          {mapMode === 'offline-delhi' && liveLocation && !isCoordinateInsideDelhi(liveLocation.longitude, liveLocation.latitude) && (
            <div className="nav-offroute-banner" role="alert" style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#b91c1c' }}>
              <span>You are outside the Offline Delhi coverage area. Offline map tiles and rerouting are unavailable.</span>
            </div>
          )}

          {/* GPS Error Alert Banner during Navigation */}
          {gpsErrorMessage && (
            <div className="nav-offroute-banner" role="alert" style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#b91c1c' }}>
              <span>{gpsErrorMessage}</span>
            </div>
          )}

          {/* Bottom Navigation Control Bar */}
          <div className="nav-hud-bottom" role="region" aria-label="Navigation controls and trip status">
            <div className="nav-hud-stats-row">
              <div>
                <span className="nav-hud-time">
                  {navProgress ? formatDuration(navProgress.remainingDurationSeconds) : '--'}
                </span>
                <span className="nav-hud-meta">
                  · {navProgress ? formatDistance(navProgress.remainingDistanceMeters) : '--'} · {navProgress ? formatETA(navProgress.remainingDurationSeconds) : ''}
                </span>
              </div>

              <div className={`nav-gps-badge gps-${navProgress?.accuracyLevel || 'unavailable'}`}>
                <span className="nav-gps-dot" />
                <span>
                  {liveLocation?.accuracyMeters != null
                    ? `GPS ±${Math.round(liveLocation.accuracyMeters)}m`
                    : 'GPS Searching'}
                </span>
              </div>
            </div>

            <div className="nav-hud-controls-row">
              <button
                className={`nav-control-btn ${isCameraLocked ? 'active' : ''}`}
                onClick={handleRecenterCamera}
                title={isCameraLocked ? 'Camera locked on GPS' : 'Recenter camera'}
                aria-label="Recenter camera"
              >
                <Crosshair size={15} />
                <span>Recenter</span>
              </button>

              <button
                className={`nav-control-btn ${isVoiceMuted ? 'active' : ''}`}
                onClick={handleToggleVoice}
                title={isVoiceMuted ? 'Unmute spoken guidance' : 'Mute spoken guidance'}
                aria-label={isVoiceMuted ? 'Unmute voice' : 'Mute voice'}
              >
                {isVoiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                <span>{isVoiceMuted ? 'Muted' : 'Voice'}</span>
              </button>

              {navStatus === 'navigating' ? (
                <button
                  className="nav-control-btn"
                  onClick={handlePauseNavigation}
                  title="Pause navigation"
                  aria-label="Pause navigation"
                >
                  <Pause size={15} />
                  <span>Pause</span>
                </button>
              ) : (
                <button
                  className="nav-control-btn"
                  onClick={handleResumeNavigation}
                  title="Resume navigation"
                  aria-label="Resume navigation"
                >
                  <Play size={15} />
                  <span>Resume</span>
                </button>
              )}

              <button
                className="nav-control-btn btn-end"
                onClick={handleEndNavigation}
                title="End navigation"
                aria-label="End navigation"
              >
                <X size={15} />
                <span>Exit</span>
              </button>
            </div>

            <div className="nav-safety-notice">
              Follow road laws · Do not operate while driving · Speeds & estimates may vary without live traffic
            </div>
          </div>
        </>
      )}

      {/* Arrived Dialog */}
      {navStatus === 'arrived' && (
        <div className="nav-arrived-banner" role="dialog" aria-label="Arrival notice">
          <div className="nav-arrived-icon">
            <CheckCircle2 size={32} />
          </div>
          <h3>You have arrived!</h3>
          <p>You reached {routeDestination?.name || 'your destination'}.</p>
          <button className="nav-arrived-btn" onClick={handleEndNavigation}>
            Done
          </button>
        </div>
      )}

      {/* App Topbar (hidden during active navigation to reduce distraction) */}
      {navStatus === 'idle' && (
        <header className="topbar">
          <div className="search-box" ref={searchBoxRef}>
            <button
              className="icon-button menu-button"
              onClick={() => setSidebarOpen(value => !value)}
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
            >
              <Menu size={19} />
            </button>
            <input
              ref={searchInput}
              value={query}
              onFocus={() => setSearchDropdownOpen(true)}
              onChange={event => {
                setQuery(event.target.value)
                setSearchDropdownOpen(true)
              }}
              placeholder={mapMode === 'offline-delhi' ? 'Search Delhi places, landmarks or saved (offline)' : 'Search Google Maps style places, addresses or saved'}
              aria-label={mapMode === 'offline-delhi' ? 'Search Delhi places, landmarks or saved (offline)' : 'Search global places, addresses or saved'}
            />
            {query ? (
              <button className="search-clear" onClick={() => { setQuery(''); setSearchResults([]); setSearchDropdownOpen(false) }} aria-label="Clear search">
                <X size={15} />
              </button>
            ) : null}
            {isSearching ? <span className="search-spinner" title="Searching…" /> : <kbd>⌘ K</kbd>}
            <span className="omnibox-divider" />
            <button
              className="icon-button omnibox-directions-btn"
              onClick={() => openPanel('directions')}
              title="Directions & Routes"
              aria-label="Directions & Routes"
            >
              <Navigation size={18} />
            </button>

            {searchDropdownOpen && (
              <div className="search-dropdown" role="listbox" aria-label="Search suggestions">
                {query.trim().length === 0 && (
                  <>
                    {recentSearches.length > 0 && (
                      <div className="recent-searches-container" style={{ marginBottom: 10 }}>
                        <div className="dropdown-header">
                          <span>RECENT SEARCHES</span>
                          <button
                            className="manage-lists-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              setRecentSearches([])
                              clearRecentSearches()
                            }}
                            aria-label="Clear recent searches"
                          >
                            Clear
                          </button>
                        </div>
                        {recentSearches.slice(0, 5).map(item => (
                          <div
                            key={item.id}
                            className="suggestion-row"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                          >
                            <button
                              className="suggestion-row-btn"
                              style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
                              onClick={() => {
                                if (item.longitude != null && item.latitude != null) {
                                  handleSelectPlace({
                                    id: item.id,
                                    name: item.query,
                                    displayName: item.placeName,
                                    longitude: item.longitude,
                                    latitude: item.latitude,
                                    source: 'search',
                                  }, 'search')
                                } else {
                                  setQuery(item.query)
                                }
                                setSearchDropdownOpen(false)
                              }}
                            >
                              <span className="suggestion-icon"><Clock size={14} /></span>
                              <div className="suggestion-info">
                                <strong>{item.query}</strong>
                                {item.placeName && <small>{item.placeName}</small>}
                              </div>
                            </button>
                            <button
                              className="icon-button subtle"
                              style={{ width: 22, height: 22, padding: 0 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                setRecentSearches(current => deleteRecentSearch(current, item.id))
                              }}
                              aria-label={`Remove ${item.query} from history`}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="quick-chips-container">
                      <div className="dropdown-header"><span>EXPLORE NEARBY</span></div>
                      <div className="quick-chips">
                        {NEARBY_CATEGORIES.map(cat => (
                          <button
                            key={cat.key}
                            className="quick-chip"
                            onClick={() => {
                              setSearchDropdownOpen(false)
                              setActivePanel('nearby')
                              discoverNearby(cat.key)
                            }}
                          >
                            {renderCategoryIcon(cat.key, 14)}
                            <span>{cat.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {query.trim().length > 0 && query.trim().length < 2 && (
                  <div className="dropdown-message">
                    {mapMode === 'offline-delhi' ? 'Type at least 2 characters to search Delhi.' : 'Type at least 2 characters to search worldwide.'}
                  </div>
                )}

                {filteredSaved.length > 0 && (
                  <div>
                    <div className="dropdown-header"><span>SAVED PLACES</span><span className="count">{filteredSaved.length}</span></div>
                    {filteredSaved.slice(0, 4).map(place => {
                      const dist = formatDistance(calculateDistanceMeters(mapCenter[0], mapCenter[1], place.longitude, place.latitude))
                      return (
                        <button key={place.id} className="suggestion-row" onClick={() => handleSelectPlace(place, 'saved')}>
                          <span className="suggestion-icon saved-pin"><Bookmark size={15} /></span>
                          <div className="suggestion-info">
                            <strong>{place.name}</strong>
                            <small>{formatCoordinates(place.longitude, place.latitude)}</small>
                          </div>
                          {dist && <span className="suggestion-distance">{dist}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}

                {query.trim().length >= 2 && (
                  <div>
                    <div className="dropdown-header">
                      <span>{mapMode === 'offline-delhi' ? 'OFFLINE DELHI PLACES' : 'OPENSTREETMAP RESULTS'}</span>
                    </div>
                    {searchError && <div className="dropdown-error">{searchError}</div>}
                    {!isSearching && !searchError && searchResults.length === 0 && (
                      <div className="dropdown-message">
                        {mapMode === 'offline-delhi'
                          ? `No offline places found in Delhi for “${query.trim()}”. Offline search covers the Delhi NCT extract (76.98°E–77.50°E, 28.44°N–28.74°N). Switch to Online mode for global search.`
                          : <>No places found matching &ldquo;{query.trim()}&rdquo;.</>}
                      </div>
                    )}
                    {searchResults.map(result => {
                      const dist = formatDistance(calculateDistanceMeters(mapCenter[0], mapCenter[1], result.longitude, result.latitude))
                      return (
                        <button key={result.id} className="suggestion-row" onClick={() => handleSelectPlace(result, 'search')}>
                          <span className="suggestion-icon">{renderCategoryIcon(result.type || result.category, 15)}</span>
                          <div className="suggestion-info">
                            <strong>{result.name}</strong>
                            <small>{result.displayName}</small>
                          </div>
                          {dist && <span className="suggestion-distance">{dist}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <a className="brand" href="#" aria-label="OpenAtlas home">
            <span className="brand-mark"><MapIcon size={18} strokeWidth={2.5} /></span>
            <span>open<span className="brand-accent">atlas</span></span>
          </a>

          <button className="avatar" aria-label="Your profile">S</button>
        </header>
      )}

      {/* Quick Category Chips Bar (Google Maps style pill bar) */}
      {navStatus === 'idle' && !activePanel && (
        <nav className="quick-chips-bar" role="toolbar" aria-label="Explore nearby categories">
          {NEARBY_CATEGORIES.map(cat => (
            <button
              key={cat.key}
              className="quick-chip-pill"
              onClick={() => {
                setActivePanel('nearby')
                discoverNearby(cat.key)
              }}
            >
              {renderCategoryIcon(cat.key, 14)}
              <span>{cat.label}</span>
            </button>
          ))}
        </nav>
      )}

      {/* Sidebar (hidden during active navigation) */}
      {/* Sidebar (hidden during active navigation) */}
      {navStatus === 'idle' && (
        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
          <div className="sidebar-heading">
            <span>YOUR ATLAS</span>
            <button className="icon-button subtle" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={16} /></button>
          </div>

          {/* Phase 6B: Mode Switcher */}
          <div className="mode-selector-container">
            <div className="mode-selector-label">
              <span>MAP MODE</span>
              <span className={`mode-badge ${mapMode === 'offline-delhi' ? 'offline' : 'online'}`}>
                {mapMode === 'offline-delhi' ? 'Offline Delhi' : 'Online'}
              </span>
            </div>
            <div className="mode-toggle-group">
              <button
                className={`mode-toggle-btn ${mapMode === 'online' ? 'active' : ''}`}
                onClick={() => handleSwitchMode('online')}
              >
                Online
              </button>
              <button
                className={`mode-toggle-btn ${mapMode === 'offline-delhi' ? 'active' : ''}`}
                onClick={() => handleSwitchMode('offline-delhi')}
                disabled={offlineState.status !== 'ready'}
                title={offlineState.status !== 'ready' ? 'Download package first to enable offline mode' : 'Switch to Offline Delhi'}
              >
                Offline Delhi
              </button>
            </div>
          </div>

          <button className={`sidebar-item ${activePanel === 'directions' ? 'active' : ''}`} onClick={() => openPanel('directions')}>
            <Navigation size={17} />
            <span>Directions & Route</span>
            {routes.length > 0 && <span className="count">{routes.length}</span>}
          </button>
          <button className={`sidebar-item ${activePanel === 'saved' ? 'active' : ''}`} onClick={() => openPanel('saved')}>
            <Bookmark size={17} />
            <span>Saved places</span>
            <span className="count">{saved.length}</span>
          </button>
          <button className={`sidebar-item ${activePanel === 'history' ? 'active' : ''}`} onClick={() => openPanel('history')}>
            <History size={17} />
            <span>Trip & search history</span>
            {routeHistory.length > 0 && <span className="count">{routeHistory.length}</span>}
          </button>
          <div className="sidebar-section-label">EXPLORE</div>
          <button className={`sidebar-item ${activePanel === 'nearby' ? 'active' : ''}`} onClick={() => openPanel('nearby')}>
            <Sparkles size={17} />
            <span>Nearby places</span>
          </button>
          <button className={`sidebar-item ${activePanel === 'offline' ? 'active' : ''}`} onClick={() => openPanel('offline')}>
            <Download size={17} />
            <span>Offline maps (Delhi)</span>
            {offlineState.status === 'ready' && <span className="mode-badge offline" style={{ marginLeft: 'auto' }}>Ready</span>}
            {isDownloadingOffline && <span className="mode-badge online" style={{ marginLeft: 'auto' }}>Downloading</span>}
          </button>
          <button className={`sidebar-item ${activePanel === 'styles' ? 'active' : ''}`} onClick={() => openPanel('styles')}>
            <Layers size={17} />
            <span>Map styles</span>
            <ChevronDown className="item-chevron" size={15} />
          </button>
          <button className={`sidebar-item ${activePanel === 'settings' ? 'active' : ''}`} onClick={() => openPanel('settings')}>
            <Settings2 size={17} />
            <span>Map settings</span>
          </button>
          <div className="sidebar-footer">
            <div className="footer-pip" />
            <span>Open data, open world.</span>
            <span className="version">PHASE 6B</span>
          </div>
        </aside>
      )}

      {/* Map Tools Controls (hidden during navigation) */}
      {navStatus === 'idle' && (
        <section className="map-tools" aria-label="Map controls">
          {!sidebarOpen && (
            <button className="tool-button" onClick={() => setSidebarOpen(true)} title="Open sidebar" aria-label="Open sidebar">
              <Menu size={18} />
            </button>
          )}
          <button className={`tool-button ${activePanel === 'directions' ? 'active' : ''}`} onClick={() => openPanel('directions')} title="Directions & Routes" aria-label="Directions & Routes">
            <Navigation size={18} />
          </button>
          <button className={`tool-button ${activePanel === 'nearby' ? 'active' : ''}`} onClick={() => openPanel('nearby')} title="Discover nearby places" aria-label="Discover nearby places">
            <Sparkles size={18} />
          </button>
          <button className={`tool-button ${activePanel === 'offline' ? 'active' : ''}`} onClick={() => openPanel('offline')} title="Offline Maps (Delhi)" aria-label="Offline Maps (Delhi)">
            <Download size={18} />
          </button>
          <button className="tool-button" onClick={() => openPanel('styles')} title="Change map style" aria-label="Change map style">
            <Layers size={18} />
          </button>
          <button className="tool-button" onClick={() => openPanel('saved')} title="Saved places" aria-label="Saved places">
            <Bookmark size={18} />
          </button>
          <button className={`tool-button ${activePanel === 'history' ? 'active' : ''}`} onClick={() => openPanel('history')} title="Trip & search history" aria-label="Trip & search history">
            <History size={18} />
          </button>
          <div className="tool-divider" />
          <button className="tool-button" onClick={() => mapZoom(1)} title="Zoom in" aria-label="Zoom in"><Plus size={18} /></button>
          <button className="tool-button" onClick={() => mapZoom(-1)} title="Zoom out" aria-label="Zoom out"><Minus size={18} /></button>
          <button className="tool-button" onClick={() => mapRef.current?.resetNorth({ duration: 400 })} title="Reset bearing" aria-label="Reset map bearing"><Compass size={18} /></button>
        </section>
      )}

      {navStatus === 'idle' && (
        <button className="locate-button" onClick={locateMe} aria-label="Find my location" title="Find my location">
          <Crosshair size={19} />
        </button>
      )}

      {navStatus === 'idle' && (
        <button
          className="layer-fab"
          onClick={() => openPanel('styles')}
          title="Map styles & layers"
          aria-label="Map styles & layers"
        >
          <Layers size={18} />
          <span>Layers</span>
        </button>
      )}

      {geoMessage && navStatus === 'idle' && (
        <div className="geo-message" role="status">
          {geoMessage}
          <button onClick={() => setGeoMessage('')} aria-label="Dismiss location message"><X size={14} /></button>
        </div>
      )}

      {gpsErrorMessage && (
        <div className="geo-message" role="status">
          {gpsErrorMessage}
          <button onClick={() => setGpsErrorMessage('')} aria-label="Dismiss GPS error"><X size={14} /></button>
        </div>
      )}

      {activePanel && navStatus === 'idle' && (
        <section className="floating-panel" aria-label={`${activePanel} panel`}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">OPENATLAS</span>
              <h2>
                {activePanel === 'styles'
                  ? 'Map style'
                  : activePanel === 'saved'
                  ? 'Saved places'
                  : activePanel === 'nearby'
                  ? 'Nearby places'
                  : activePanel === 'directions'
                  ? 'Directions'
                  : activePanel === 'history'
                  ? 'Trip & search history'
                  : activePanel === 'offline'
                  ? 'Offline Delhi Mode'
                  : 'Map settings'}
              </h2>
            </div>
            <button
              className="icon-button subtle"
              onClick={() => {
                setActivePanel(null)
                clearNearbyMarkers()
              }}
              aria-label="Close panel"
            >
              <X size={17} />
            </button>
          </div>

          {activePanel === 'directions' && (
            <div>
              {/* Phase 6B Stage 5: Offline Delhi Routing Active Notice */}
              {mapMode === 'offline-delhi' && (
                <div className="offline-routing-notice ready">
                  <div className="offline-routing-notice-header">
                    <span className="mode-badge offline">Offline Delhi</span>
                    <span className="offline-routing-status-badge">Road Routing Active</span>
                  </div>
                  <p>
                    Genuine turn-by-turn road routing is active across Delhi NCT for Driving, Walking, and Cycling. 33,000+ km of roads indexed locally with zero internet usage.
                  </p>
                </div>
              )}

              {/* Travel Mode Selector */}
              <div className="directions-modes-row" role="tablist" aria-label="Travel mode">
                <button
                  role="tab"
                  aria-selected={travelMode === 'driving'}
                  className={`mode-btn ${travelMode === 'driving' ? 'active' : ''}`}
                  onClick={() => setTravelMode('driving')}
                >
                  <Car size={15} />
                  <span>Drive</span>
                </button>
                <button
                  role="tab"
                  aria-selected={travelMode === 'walking'}
                  className={`mode-btn ${travelMode === 'walking' ? 'active' : ''}`}
                  onClick={() => setTravelMode('walking')}
                >
                  <Footprints size={15} />
                  <span>Walk</span>
                </button>
                <button
                  role="tab"
                  aria-selected={travelMode === 'cycling'}
                  className={`mode-btn ${travelMode === 'cycling' ? 'active' : ''}`}
                  onClick={() => setTravelMode('cycling')}
                >
                  <Bike size={15} />
                  <span>Cycle</span>
                </button>
              </div>

              {/* Endpoints Inputs */}
              <div className="endpoints-container">
                <div className="endpoints-inputs" style={{ flex: 1 }}>
                  <div
                    className={`endpoint-box ${editingEndpoint === 'origin' ? 'active' : ''}`}
                    onClick={() => {
                      setEditingEndpoint(editingEndpoint === 'origin' ? null : 'origin')
                      setEndpointQuery('')
                      setEndpointResults([])
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label="Select origin"
                  >
                    <span className="stop-badge-num" style={{ background: '#2563eb', width: 18, height: 18, fontSize: 10, marginRight: 6 }}>A</span>
                    <span className={`endpoint-box-text ${!routeOrigin ? 'placeholder' : ''}`}>
                      {routeOrigin ? routeOrigin.name : 'Choose starting point…'}
                    </span>
                    {isOriginOutsideDelhi && (
                      <span className="endpoint-out-of-bounds-badge" title="Coordinate is outside Delhi NCT extract bounds">Outside Delhi</span>
                    )}
                    {routeOrigin && (
                      <button
                        className="endpoint-clear-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRouteOrigin(null)
                        }}
                        aria-label="Clear starting point"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Intermediate Stops */}
                  {routeStops.map((stop, sIdx) => (
                    <div key={stop.id || `stop-${sIdx}`} className="stop-row-box" style={{ marginTop: 4 }}>
                      <span className="stop-badge-num" style={{ width: 18, height: 18, fontSize: 10 }}>{sIdx + 1}</span>
                      <div
                        className={`stop-box-input ${editingEndpoint === sIdx ? 'active' : ''}`}
                        onClick={() => {
                          setEditingEndpoint(editingEndpoint === sIdx ? null : sIdx)
                          setEndpointQuery('')
                          setEndpointResults([])
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`Select intermediate stop ${sIdx + 1}`}
                      >
                        <span className={`endpoint-box-text ${!stop.name ? 'placeholder' : ''}`}>
                          {stop.name || `Choose stop #${sIdx + 1}…`}
                        </span>
                        {stop.name && (
                          <button
                            className="endpoint-clear-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveStop(sIdx)
                            }}
                            aria-label={`Clear stop ${sIdx + 1}`}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      <button
                        className="stop-reorder-btn"
                        disabled={sIdx === 0}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMoveStop(sIdx, 'up')
                        }}
                        title="Move stop up"
                        aria-label="Move stop up"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        className="stop-reorder-btn"
                        disabled={sIdx === routeStops.length - 1}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMoveStop(sIdx, 'down')
                        }}
                        title="Move stop down"
                        aria-label="Move stop down"
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        className="stop-reorder-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveStop(sIdx)
                        }}
                        title="Remove stop"
                        aria-label="Remove stop"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}

                  <div
                    className={`endpoint-box ${editingEndpoint === 'destination' ? 'active' : ''}`}
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      setEditingEndpoint(editingEndpoint === 'destination' ? null : 'destination')
                      setEndpointQuery('')
                      setEndpointResults([])
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label="Select destination"
                  >
                    <span className="stop-badge-num" style={{ background: '#dc2626', width: 18, height: 18, fontSize: 10, marginRight: 6 }}>B</span>
                    <span className={`endpoint-box-text ${!routeDestination ? 'placeholder' : ''}`}>
                      {routeDestination ? routeDestination.name : 'Choose destination…'}
                    </span>
                    {isDestinationOutsideDelhi && (
                      <span className="endpoint-out-of-bounds-badge" title="Coordinate is outside Delhi NCT extract bounds">Outside Delhi</span>
                    )}
                    {routeDestination && (
                      <button
                        className="endpoint-clear-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRouteDestination(null)
                        }}
                        aria-label="Clear destination"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <button
                  className="swap-endpoints-btn"
                  onClick={handleSwapEndpoints}
                  title="Swap starting point and destination"
                  aria-label="Swap starting point and destination"
                >
                  <ArrowUpDown size={15} />
                </button>
              </div>

              {routeStops.length < 5 && (
                <button className="add-stop-action-btn" onClick={handleAddStop} aria-label="Add intermediate stop">
                  <Plus size={13} />
                  <span>Add intermediate stop</span>
                </button>
              )}
              {routeStops.length > 0 && (
                <div className="routing-optimization-disclaimer">
                  Stops are visited in the order listed above. Automatic stop reordering is not applied.
                </div>
              )}

              {/* Endpoint Picker Box (when editing an endpoint) */}
              {editingEndpoint !== null && editingEndpoint !== undefined && (
                <div className="endpoint-picker-box">
                  <div className="picker-quick-actions">
                    <button
                      className="picker-quick-btn"
                      onClick={() => {
                        if (userLocation) {
                          handleSelectEndpointOption({
                            name: 'My Location',
                            longitude: userLocation[0],
                            latitude: userLocation[1],
                            type: 'gps',
                          }, editingEndpoint)
                        } else {
                          locateMe()
                          setGeoMessage('Tap again once your GPS location is retrieved.')
                        }
                      }}
                    >
                      <Crosshair size={13} />
                      <span>My Location</span>
                    </button>

                    <button
                      className="picker-quick-btn"
                      onClick={() => handlePickFromMap(editingEndpoint)}
                    >
                      <MapPin size={13} />
                      <span>Choose on Map</span>
                    </button>
                  </div>

                  <input
                    className="endpoint-search-field"
                    placeholder={`Search address or place for ${
                      editingEndpoint === 'origin'
                        ? 'origin (A)'
                        : editingEndpoint === 'destination'
                        ? 'destination (B)'
                        : `intermediate stop #${Number(editingEndpoint) + 1}`
                    }…`}
                    value={endpointQuery}
                    onChange={(e) => setEndpointQuery(e.target.value)}
                    autoFocus
                  />

                  {isSearchingEndpoint && (
                    <div className="dropdown-message">Searching places…</div>
                  )}

                  {endpointResults.length > 0 && (
                    <div className="picker-results-list">
                      {endpointResults.map(res => (
                        <button
                          key={res.id}
                          className="picker-result-row"
                          onClick={() => handleSelectEndpointOption({
                            id: res.id,
                            name: res.name,
                            longitude: res.longitude,
                            latitude: res.latitude,
                            type: 'search',
                          }, editingEndpoint)}
                        >
                          <span className="suggestion-icon">{renderCategoryIcon(res.type || res.category, 13)}</span>
                          <div className="picker-result-info">
                            <strong>{res.name}</strong>
                            <small>{res.displayName}</small>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {endpointQuery.trim().length === 0 && saved.length > 0 && (
                    <div className="picker-results-list">
                      <div className="dropdown-header"><span>FROM SAVED PLACES</span></div>
                      {saved.map(place => (
                        <button
                          key={place.id}
                          className="picker-result-row"
                          onClick={() => handleSelectEndpointOption({
                            id: place.id,
                            name: place.name,
                            longitude: place.longitude,
                            latitude: place.latitude,
                            type: 'saved',
                          }, editingEndpoint)}
                        >
                          <span className="suggestion-icon saved-pin"><Bookmark size={13} /></span>
                          <div className="picker-result-info">
                            <strong>{place.name}</strong>
                            <small>{formatCoordinates(place.longitude, place.latitude)}</small>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Routing status & errors */}
              {isRouting && (
                <div className="dropdown-message">
                  <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />
                  Calculating optimal {travelMode} route…
                </div>
              )}

              {routingError && (
                <div className="dropdown-error">
                  <AlertCircle size={14} style={{ display: 'inline', verticalAlign: 'sub', marginRight: 5 }} />
                  {routingError}
                </div>
              )}

              {/* Route Summary, Start Navigation & Alternative Routes */}
              {activeRoute && !isRouting && (
                <div className="route-summary-card">
                  <div className="route-duration-hero">
                    <h3>{formatDuration(activeRoute.durationSeconds)}</h3>
                    <span className="route-distance-pill">{formatDistance(activeRoute.distanceMeters)}</span>
                  </div>

                  <div className="route-disclaimer">
                    <Clock size={11} />
                    <span>Estimated travel duration · No live traffic</span>
                  </div>

                  {/* Start Navigation Primary Button */}
                  <button className="start-nav-btn" onClick={handleStartNavigation} aria-label="Start live GPS navigation">
                    <Play size={16} fill="currentColor" />
                    <span>Start Navigation</span>
                  </button>

                  {routes.length > 1 && (
                    <div className="route-alternatives-tabs">
                      {routes.map((rt, idx) => (
                        <button
                          key={rt.id}
                          className={`alt-tab-btn ${idx === activeRouteIndex ? 'active' : ''}`}
                          onClick={() => setActiveRouteIndex(idx)}
                        >
                          <strong>{idx === 0 ? 'Fastest' : `Alt ${idx}`}</strong>
                          <span>{formatDuration(rt.durationSeconds)} ({formatDistance(rt.distanceMeters)})</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Step-by-Step Maneuvers */}
                  {activeRoute.steps.length > 0 && (
                    <div className="route-steps-section">
                      <button
                        className="steps-toggle-btn"
                        onClick={() => setStepsExpanded(v => !v)}
                        aria-expanded={stepsExpanded}
                      >
                        <span>TURN-BY-TURN ({activeRoute.steps.length} STEPS)</span>
                        <ChevronRight
                          size={14}
                          style={{
                            transform: stepsExpanded ? 'rotate(90deg)' : 'none',
                            transition: 'transform .15s',
                          }}
                        />
                      </button>

                      {stepsExpanded && (
                        <div className="steps-list" role="list">
                          {activeRoute.steps.map((step, sIdx) => (
                            <button
                              key={`step-${sIdx}`}
                              className="step-row-btn"
                              onClick={() => handleStepClick(step.location)}
                              title="Click to view this step on the map"
                            >
                              <span className="step-icon-badge">
                                {renderManeuverIcon(step.type, step.modifier, 14)}
                              </span>
                              <div className="step-details">
                                <div className="step-instruction-text">{step.instruction}</div>
                                <div className="step-meta-text">
                                  {step.distanceMeters > 0 && <span>{formatDistance(step.distanceMeters)}</span>}
                                  {step.durationSeconds > 0 && <span> · {formatDuration(step.durationSeconds)}</span>}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="route-actions-bar">
                    <button className="share-action-btn" onClick={handleShareRoute} title="Copy shareable link for this route">
                      <Share2 size={13} />
                      <span>Share Route</span>
                    </button>
                    <button className="clear-route-btn" onClick={handleClearRoute}>
                      <X size={14} />
                      <span>Clear Route</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === 'offline' && (
            <div className="offline-panel">
              {/* Mode Switcher */}
              <div className="offline-mode-card">
                <div className="offline-card-header">
                  <div>
                    <strong>Map Mode</strong>
                    <div className="offline-package-meta">Toggle online tile serving vs. local offline vector tiles</div>
                  </div>
                  <span className={`mode-badge ${mapMode === 'offline-delhi' ? 'offline' : 'online'}`}>
                    {mapMode === 'offline-delhi' ? 'Offline Delhi' : 'Online'}
                  </span>
                </div>
                <div className="mode-toggle-group">
                  <button
                    className={`mode-toggle-btn ${mapMode === 'online' ? 'active' : ''}`}
                    onClick={() => handleSwitchMode('online')}
                  >
                    Online Mode
                  </button>
                  <button
                    className={`mode-toggle-btn ${mapMode === 'offline-delhi' ? 'active' : ''}`}
                    onClick={() => handleSwitchMode('offline-delhi')}
                    disabled={offlineState.status !== 'ready'}
                    title={offlineState.status !== 'ready' ? 'Download package first to enable offline mode' : 'Switch to Offline Delhi'}
                  >
                    Offline Delhi
                  </button>
                </div>
              </div>

              {/* Package Management Card */}
              <div className="offline-package-card">
                <div className="offline-card-header">
                  <div>
                    <strong>Delhi NCT Core Extract</strong>
                    <div className="offline-package-meta">PMTiles v3 (Shortbread MVT) · 15.36 MB</div>
                  </div>
                  <span className={`package-status-tag ${offlineState.status}`}>
                    {offlineState.status === 'ready' ? 'Ready' :
                     offlineState.status === 'downloading' ? 'Downloading' :
                     offlineState.status === 'unsupported' ? 'Unsupported' :
                     offlineState.status === 'error' ? 'Error' : 'Not Downloaded'}
                  </span>
                </div>

                <p className="offline-package-coverage">
                  Covers Central Delhi, New Delhi, Rohini, Dwarka, Hauz Khas, and immediate border ring (bounds: {DELHI_BOUNDS_LABEL}). Stored directly in browser private storage (OPFS).
                </p>

                {offlineError && (
                  <div className="offline-error-alert" role="alert">
                    <AlertCircle size={15} />
                    <span>{offlineError}</span>
                  </div>
                )}

                {isDownloadingOffline && downloadProgress && (
                  <div className="offline-progress-box">
                    <div className="progress-bar-track">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.max(2, downloadProgress.percentage)}%` }}
                      />
                    </div>
                    <div className="progress-labels">
                      <span>{downloadProgress.percentage.toFixed(0)}%</span>
                      <span>
                        {(downloadProgress.bytesDownloaded / (1024 * 1024)).toFixed(1)} / {(downloadProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    </div>
                    <button className="offline-cancel-btn" onClick={handleCancelDownload}>
                      Cancel Download
                    </button>
                  </div>
                )}

                {!isDownloadingOffline && offlineState.status === 'not_downloaded' && (
                  <button className="offline-action-btn primary" onClick={handleDownloadOfflinePackage}>
                    <Download size={14} />
                    <span>Download Offline Package (~15.4 MB)</span>
                  </button>
                )}

                {!isDownloadingOffline && offlineState.status === 'error' && (
                  <button className="offline-action-btn primary" onClick={handleDownloadOfflinePackage}>
                    <RotateCcw size={14} />
                    <span>Retry Download</span>
                  </button>
                )}

                {!isDownloadingOffline && offlineState.status === 'ready' && (
                  <div className="offline-ready-actions">
                    <button
                      className="offline-action-btn primary"
                      onClick={() => {
                        handleSwitchMode('offline-delhi')
                        flyTo(DELHI_PACKAGE_METADATA.center[0], DELHI_PACKAGE_METADATA.center[1], 12)
                      }}
                    >
                      <Check size={14} />
                      <span>{mapMode === 'offline-delhi' ? 'Active on Map' : 'Switch to Offline Delhi'}</span>
                    </button>
                    <button
                      className="offline-action-btn danger"
                      onClick={handleDeleteOfflinePackage}
                    >
                      <Trash2 size={14} />
                      <span>Delete Package</span>
                    </button>
                  </div>
                )}

                {offlineState.status === 'unsupported' && (
                  <div className="offline-unsupported-note">
                    Your browser does not support the Origin Private File System (OPFS) API. Please use a modern browser (Chrome 86+, Safari 15.2+, Edge 86+, Firefox 111+) in a secure HTTPS context.
                  </div>
                )}
              </div>

              {/* Map Data Updates Card */}
              <div className="offline-update-card">
                <div className="offline-card-header">
                  <div>
                    <strong>Map Data Updates</strong>
                    <div className="offline-package-meta">
                      OSM & OpenAtlas versioned releases for offline navigation
                    </div>
                  </div>
                  <span className={`offline-version-badge ${installedRelease?.source === 'updated' ? 'updated' : ''}`}>
                    v{installedRelease?.manifest.version || '2026.10.20'} ({installedRelease?.source === 'updated' ? 'Updated' : 'Bundled'})
                  </span>
                </div>

                <div className="offline-version-row">
                  <span className="offline-card-desc">
                    Includes road network (33,000+ km), {installedRelease?.manifest.metadata?.placeCount?.toLocaleString() || '13,594'} POIs, and vector basemap.
                  </span>
                </div>

                {updateSuccess && (
                  <div className="offline-update-uptodate-banner" role="status">
                    <CheckCircle2 size={16} />
                    <span>{updateSuccess}</span>
                  </div>
                )}

                {updateError && (
                  <div className="offline-error-alert" role="alert">
                    <AlertCircle size={15} />
                    <span>{updateError}</span>
                  </div>
                )}

                {/* Staged Download Progress */}
                {isUpdatingDataset && updateProgress && (
                  <div className="offline-progress-box">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="offline-update-asset-label">
                        {updateProgress.currentAsset === 'activating' ? 'Verifying & Activating...' : `Downloading ${updateProgress.currentAsset} (${updateProgress.assetIndex} of ${updateProgress.totalAssets})`}
                      </span>
                      <span style={{ fontSize: 11, color: '#5f6368', fontWeight: 600 }}>
                        {updateProgress.percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="progress-bar-track">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.max(2, updateProgress.percentage)}%` }}
                      />
                    </div>
                    <div className="progress-labels">
                      <span>{(updateProgress.totalBytesDownloaded / (1024 * 1024)).toFixed(1)} / {(updateProgress.totalBytesToDownload / (1024 * 1024)).toFixed(1)} MB</span>
                      <span>Safe staging</span>
                    </div>
                    <button className="offline-cancel-btn" onClick={handleCancelDatasetUpdate}>
                      Cancel Update
                    </button>
                  </div>
                )}

                {/* Update Available Banner */}
                {!isUpdatingDataset && updateCheckResult?.hasUpdate && updateCheckResult.latestManifest && (
                  <div className="offline-update-available-banner">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 13, color: '#202124' }}>
                        Update Available: v{updateCheckResult.latestVersion}
                      </strong>
                      <span className="offline-version-badge updated">New Release</span>
                    </div>
                    <p className="offline-update-notes">
                      {updateCheckResult.latestManifest.description}
                    </p>
                    <div style={{ fontSize: 11, color: '#5f6368' }}>
                      Total download: ~{((updateCheckResult.latestManifest.assets.places.sizeBytes + updateCheckResult.latestManifest.assets.routingGraph.sizeBytes + updateCheckResult.latestManifest.assets.pmtiles.sizeBytes) / (1024 * 1024)).toFixed(1)} MB
                    </div>
                    <button
                      className="offline-action-btn primary"
                      style={{ marginTop: 6 }}
                      onClick={handleApplyDatasetUpdate}
                    >
                      <Download size={14} />
                      <span>Download & Install Update</span>
                    </button>
                  </div>
                )}

                {/* Up to date Banner */}
                {!isUpdatingDataset && updateCheckResult && !updateCheckResult.hasUpdate && !updateError && (
                  <div className="offline-update-uptodate-banner">
                    <CheckCircle2 size={16} />
                    <span>Your offline map dataset is up to date (v{installedRelease?.manifest.version || '2026.10.20'}).</span>
                  </div>
                )}

                {/* Actions Row */}
                {!isUpdatingDataset && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    <button
                      className="offline-action-btn"
                      style={{ flex: 1 }}
                      onClick={handleCheckForUpdates}
                      disabled={isCheckingUpdate}
                    >
                      <RotateCcw size={14} />
                      <span>{isCheckingUpdate ? 'Checking Server...' : 'Check for Updates'}</span>
                    </button>

                    {installedRelease?.source === 'updated' && (
                      <button
                        className="offline-subtle-btn"
                        onClick={handleRevertToBundled}
                        title="Revert to original bundled map data"
                      >
                        Revert to Bundled
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Scope and Disclaimer Notice */}
              <div className="offline-disclaimer-box">
                <strong>Offline Basemap Scope & Limits:</strong>
                <p>
                  Offline Delhi mode renders vector map tiles, roads, water, buildings, and bilingual English/Hindi labels completely without internet.
                </p>
                <p>
                  Delhi place search (13,594 places) and turn-by-turn road routing across Driving, Walking, and Cycling work 100% offline.
                </p>
              </div>
            </div>
          )}

          {activePanel === 'styles' && (
            <div className="style-list">
              {mapMode === 'offline-delhi' ? (
                <div className="offline-mode-card" style={{ marginBottom: 12 }}>
                  <div className="offline-card-header">
                    <strong>VersaTiles Colorful</strong>
                    <span className="mode-badge offline">Offline Delhi Active</span>
                  </div>
                  <p className="offline-card-desc">
                    Rendering vector tiles locally from Origin Private File System (OPFS).
                  </p>
                  <button
                    className="offline-action-btn primary"
                    onClick={() => handleSwitchMode('online')}
                    style={{ marginTop: 6 }}
                  >
                    Switch to Online Mode to Change Styles
                  </button>
                </div>
              ) : (
                styles.map(option => (
                  <button className="style-option" key={option.name} onClick={() => chooseStyle(option)}>
                    <span className={`style-preview preview-${option.name.toLowerCase()}`}><span /></span>
                    <span>{option.name}</span>
                    {styleName === option.name && <Check size={16} className="selected-check" />}
                  </button>
                ))
              )}
            </div>
          )}

          {activePanel === 'saved' && (
            <div className="saved-list">
              {/* Custom Lists Chips Bar */}
              <div className="list-chips-scroll">
                <button
                  className={`list-chip ${activeListId === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveListId('all')}
                >
                  <Bookmark size={12} />
                  <span>All Places</span>
                  <span className="list-chip-count">{saved.length}</span>
                </button>
                {lists.map(list => {
                  const count = saved.filter(p => (p.listIds || ['favorites']).includes(list.id)).length
                  return (
                    <button
                      key={list.id}
                      className={`list-chip ${activeListId === list.id ? 'active' : ''}`}
                      onClick={() => setActiveListId(list.id)}
                    >
                      <span>{list.name}</span>
                      <span className="list-chip-count">{count}</span>
                      {!list.isDefault && (
                        <span
                          className="list-chip-del"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteList(list.id)
                          }}
                          title={`Delete list ${list.name}`}
                        >
                          <X size={10} />
                        </span>
                      )}
                    </button>
                  )
                })}
                <button
                  className="list-chip"
                  style={{ borderStyle: 'dashed' }}
                  onClick={() => setIsCreatingList(true)}
                  title="Create a new custom list"
                >
                  <Plus size={12} />
                  <span>New List</span>
                </button>
              </div>

              {/* Create New List Box */}
              {isCreatingList && (
                <div className="new-list-box">
                  <input
                    className="new-list-input"
                    placeholder="List name (e.g. Cafes, Roadtrip)…"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateNewList()
                      if (e.key === 'Escape') setIsCreatingList(false)
                    }}
                  />
                  <button className="new-list-btn" onClick={handleCreateNewList}>
                    Create
                  </button>
                  <button className="new-list-cancel" onClick={() => setIsCreatingList(false)}>
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Places List */}
              {displayedSavedPlaces.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon"><Bookmark size={19} /></span>
                  <strong>{saved.length ? 'No places in this list' : 'Your saved places live here'}</strong>
                  <p>{saved.length ? 'Add places to this list or select another list.' : 'Drop a pin or search for a location to save it for your next trip.'}</p>
                </div>
              ) : (
                displayedSavedPlaces.map(place => {
                  const placeLists = lists.filter(l => (place.listIds || ['favorites']).includes(l.id))
                  return (
                    <div className="saved-place" key={place.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <button className="place-link" onClick={() => handleSelectPlace(place, 'saved')} style={{ flex: 1 }}>
                          <span className="place-pin"><Bookmark size={15} /></span>
                          <span>
                            <strong>{place.name}</strong>
                            <small>{formatCoordinates(place.longitude, place.latitude)}</small>
                          </span>
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button
                            className="icon-button subtle"
                            title="Share location link"
                            aria-label={`Share ${place.name}`}
                            onClick={() => handleSharePlace(place)}
                          >
                            <Share2 size={14} />
                          </button>
                          <button
                            className="icon-button subtle delete-place"
                            aria-label={`Remove ${place.name}`}
                            onClick={() => setSaved(current => deletePlace(current, place.id))}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>

                      {/* List Tags and Manage Lists Popover */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 28, marginTop: 2 }}>
                        <div className="place-list-badges">
                          {placeLists.map(l => (
                            <span key={l.id} className="place-list-tag">{l.name}</span>
                          ))}
                        </div>
                        <button
                          className="manage-lists-btn"
                          onClick={() => setEditingPlaceListId(editingPlaceListId === place.id ? null : place.id)}
                        >
                          {editingPlaceListId === place.id ? 'Done' : '+ Lists'}
                        </button>
                      </div>

                      {editingPlaceListId === place.id && (
                        <div className="list-selector-popover" style={{ marginLeft: 28 }}>
                          {lists.map(list => {
                            const isChecked = (place.listIds || ['favorites']).includes(list.id)
                            return (
                              <label key={list.id} className="list-checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleTogglePlaceList(place, list.id)}
                                />
                                <span>{list.name}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              )}

              {/* Export & Import Controls */}
              <div className="backup-actions-row" style={{ marginTop: 14 }}>
                <button className="backup-btn" onClick={handleExportData} title="Export all saved places and lists to JSON">
                  <Download size={13} />
                  <span>Export JSON</span>
                </button>
                <label className="backup-btn" style={{ cursor: 'pointer' }} title="Import saved places and lists from JSON">
                  <Upload size={13} />
                  <span>Import JSON</span>
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleImportFile(e.target.files[0])
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {activePanel === 'history' && (
            <div className="history-panel-content">
              {/* History Sub-tabs */}
              <div className="history-tabs-row" role="tablist">
                <button
                  role="tab"
                  aria-selected={historyTab === 'routes'}
                  className={`history-tab-btn ${historyTab === 'routes' ? 'active' : ''}`}
                  onClick={() => setHistoryTab('routes')}
                >
                  Route History ({routeHistory.length})
                </button>
                <button
                  role="tab"
                  aria-selected={historyTab === 'searches'}
                  className={`history-tab-btn ${historyTab === 'searches' ? 'active' : ''}`}
                  onClick={() => setHistoryTab('searches')}
                >
                  Recent Searches ({recentSearches.length})
                </button>
              </div>

              {historyTab === 'routes' && (
                <div>
                  {routeHistory.length === 0 ? (
                    <div className="empty-state">
                      <span className="empty-icon"><History size={19} /></span>
                      <strong>No route history yet</strong>
                      <p>Completed and planned trips will appear here for easy reopening.</p>
                    </div>
                  ) : (
                    <div className="history-cards-list">
                      {routeHistory.map(item => (
                        <div key={item.id} className="history-card">
                          <div className="history-card-header">
                            {editingHistoryId === item.id ? (
                              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                                <input
                                  className="new-list-input"
                                  value={editingHistoryTitle}
                                  onChange={(e) => setEditingHistoryTitle(e.target.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveHistoryTitle(item.id, editingHistoryTitle)
                                    if (e.key === 'Escape') setEditingHistoryId(null)
                                  }}
                                />
                                <button className="new-list-btn" onClick={() => handleSaveHistoryTitle(item.id, editingHistoryTitle)}>
                                  Save
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="history-card-title">{item.title}</span>
                                <button
                                  className="icon-button subtle"
                                  style={{ padding: 2 }}
                                  onClick={() => {
                                    setEditingHistoryId(item.id)
                                    setEditingHistoryTitle(item.title)
                                  }}
                                  title="Rename trip"
                                >
                                  <Edit2 size={12} />
                                </button>
                              </>
                            )}
                            <span className="history-card-date">
                              {new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          </div>

                          <div className="history-card-flow">
                            {item.origin.name} → {item.destination.name}
                            {item.waypoints && item.waypoints.length > 0 && (
                              <span style={{ color: '#8b5cf6', marginLeft: 4 }}>
                                (via {item.waypoints.length} stop{item.waypoints.length > 1 ? 's' : ''})
                              </span>
                            )}
                          </div>

                          <div className="history-card-meta">
                            <span style={{ textTransform: 'capitalize' }}>{item.mode}</span>
                            <span>·</span>
                            <span>{formatDistance(item.distanceMeters)}</span>
                            <span>·</span>
                            <span>{formatDuration(item.durationSeconds)}</span>
                          </div>

                          <div className="history-card-actions">
                            <button
                              className="history-card-btn primary"
                              onClick={() => {
                                setRouteOrigin(item.origin)
                                setRouteDestination(item.destination)
                                setRouteStops(item.waypoints || [])
                                setTravelMode(item.mode)
                                setActivePanel('directions')
                              }}
                            >
                              Load Route
                            </button>
                            <button
                              className="history-card-btn"
                              onClick={() => {
                                const url = generateRouteShareUrl(item.origin, item.destination, item.waypoints, item.mode)
                                navigator.clipboard.writeText(url).then(
                                  () => setShareToast('Route share link copied!'),
                                  () => setShareToast(`URL: ${url}`)
                                )
                              }}
                            >
                              <Share2 size={11} style={{ display: 'inline', marginRight: 4 }} />
                              Share
                            </button>
                            <button
                              className="history-card-btn"
                              style={{ marginLeft: 'auto' }}
                              onClick={() => setRouteHistory(current => deleteRouteHistoryItem(current, item.id))}
                              title="Delete entry"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {routeHistory.length > 0 && (
                    <div className="clear-history-box">
                      <button
                        className="clear-history-btn"
                        onClick={() => {
                          if (window.confirm('Clear all route history entries?')) {
                            setRouteHistory([])
                            clearRouteHistory()
                            setShareToast('Route history cleared.')
                          }
                        }}
                      >
                        Clear route history
                      </button>
                    </div>
                  )}
                </div>
              )}

              {historyTab === 'searches' && (
                <div>
                  {recentSearches.length === 0 ? (
                    <div className="empty-state">
                      <span className="empty-icon"><Search size={19} /></span>
                      <strong>No search history</strong>
                      <p>Places you search for will be saved here.</p>
                    </div>
                  ) : (
                    <div className="history-cards-list">
                      {recentSearches.map(item => (
                        <div key={item.id} className="history-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <button
                            className="place-link"
                            style={{ flex: 1, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}
                            onClick={() => {
                              if (item.longitude != null && item.latitude != null) {
                                handleSelectPlace({
                                  id: item.id,
                                  name: item.query,
                                  displayName: item.placeName,
                                  longitude: item.longitude,
                                  latitude: item.latitude,
                                  source: 'search',
                                }, 'search')
                              } else {
                                setQuery(item.query)
                              }
                            }}
                          >
                            <span className="suggestion-icon"><Clock size={14} /></span>
                            <div>
                              <strong style={{ fontSize: 12 }}>{item.query}</strong>
                              {item.placeName && <div style={{ fontSize: 10, color: '#64748b' }}>{item.placeName}</div>}
                            </div>
                          </button>
                          <button
                            className="icon-button subtle"
                            onClick={() => setRecentSearches(current => deleteRecentSearch(current, item.id))}
                            title="Remove from history"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {recentSearches.length > 0 && (
                    <div className="clear-history-box">
                      <button
                        className="clear-history-btn"
                        onClick={() => {
                          if (window.confirm('Clear all recent searches?')) {
                            setRecentSearches([])
                            clearRecentSearches()
                            setShareToast('Search history cleared.')
                          }
                        }}
                      >
                        Clear search history
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Privacy Guarantee Note */}
              <div className="privacy-notice-box">
                <strong>Privacy Guaranteed</strong>
                <span>OpenAtlas saves only endpoints and trip preferences locally on this device. Continuous GPS movement traces are strictly never recorded.</span>
              </div>
            </div>
          )}

          {activePanel === 'nearby' && (
            <div>
              <div className="nearby-categories-grid">
                {NEARBY_CATEGORIES.map(cat => (
                  <button
                    key={cat.key}
                    className={`category-card-btn ${nearbyCategory === cat.key ? 'active' : ''}`}
                    onClick={() => discoverNearby(cat.key)}
                  >
                    {renderCategoryIcon(cat.key, 16)}
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>

              {nearbyLoading && (
                <div className="dropdown-message">
                  <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />
                  Searching nearby places…
                </div>
              )}
              {nearbyError && <div className="dropdown-error">{nearbyError}</div>}
              {!nearbyLoading && !nearbyError && nearbyCategory && nearbyResults.length === 0 && (
                <div className="dropdown-message">No {nearbyCategory} places found in this view. Pan or zoom the map and try again.</div>
              )}

              {nearbyResults.length > 0 && (
                <div className="nearby-items-list">
                  {nearbyResults.map(place => {
                    const dist = formatDistance(calculateDistanceMeters(mapCenter[0], mapCenter[1], place.longitude, place.latitude))
                    return (
                      <button key={place.id} className="nearby-item-row" onClick={() => handleSelectPlace(place, 'nearby')}>
                        <span className="suggestion-icon">{renderCategoryIcon(place.type || place.category, 15)}</span>
                        <div className="nearby-item-info">
                          <strong>{place.name}</strong>
                          <small>{place.displayName}</small>
                        </div>
                        {dist && <span className="suggestion-distance">{dist}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {activePanel === 'settings' && (
            <div className="settings-list">
              <div className="setting-row">
                <span><strong>Show coordinates</strong><small>Display coordinates for selected places and pins</small></span>
                <button
                  className={`switch ${showCoordinates ? 'on' : ''}`}
                  role="switch"
                  aria-checked={showCoordinates}
                  onClick={() => setShowCoordinates(value => !value)}
                  aria-label="Show coordinates"
                >
                  <span />
                </button>
              </div>
              <div className="setting-row">
                <span><strong>Search provider</strong><small>{activeGeocodingProvider.name}</small></span>
              </div>
              <div className="setting-row">
                <span><strong>Routing engine</strong><small>{activeRoutingProvider.name}{mapMode === 'offline-delhi' ? ' (Offline road network active)' : ''}</small></span>
              </div>
              <div className="setting-row">
                <span><strong>Live navigation</strong><small>GPS position tracking, spoken maneuver directions, and off-route detection.</small></span>
              </div>
              <div className="setting-row">
                <span><strong>Offline capability</strong><small>{mapMode === 'offline-delhi' ? 'Offline Delhi mode active. Vector map tiles, Delhi place search, and offline turn-by-turn road routing work completely offline.' : 'App shell is cached offline. Map tiles, search & routing require an active connection.'}</small></span>
              </div>
              <div className="setting-row">
                <span><strong>Map style URL</strong><small>Set VITE_MAP_STYLE_URL in .env to use another source.</small></span>
              </div>

              {/* Phase 5: Personal Data & Privacy Section */}
              <div className="privacy-notice-box" style={{ marginTop: 14 }}>
                <strong>Personal Data & Privacy</strong>
                <span>All saved places, custom lists, recent searches and route history are stored locally in your browser. OpenAtlas never transmits your personal data to remote servers. Clearing browser data will delete these items.</span>
                <div className="backup-actions-row">
                  <button className="backup-btn" onClick={handleExportData} title="Export all personal data as JSON backup">
                    <Download size={13} />
                    <span>Export All</span>
                  </button>
                  <label className="backup-btn" style={{ cursor: 'pointer' }} title="Import data from JSON backup">
                    <Upload size={13} />
                    <span>Import</span>
                    <input
                      type="file"
                      accept=".json"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          handleImportFile(e.target.files[0])
                          e.target.value = ''
                        }
                      }}
                    />
                  </label>
                  <button className="backup-btn danger" onClick={handleClearAllData} title="Delete all saved places, lists and history">
                    <Trash2 size={13} />
                    <span>Clear All</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {selected && navStatus === 'idle' && (
        <div className="coordinate-card place-details-card">
          <button
            className="card-close"
            onClick={() => {
              setSelected(null)
              temporaryMarker.current?.remove()
              searchMarker.current?.remove()
            }}
            aria-label="Dismiss details"
          >
            <X size={15} />
          </button>

          <div className="place-header">
            <span className={`place-card-badge badge-${selected.source}`}>
              {selected.source === 'pin' ? 'Dropped pin' : selected.source === 'nearby' ? 'Nearby place' : selected.source === 'saved' ? 'Saved place' : 'Search result'}
            </span>
          </div>

          <strong className="place-title">{selected.name}</strong>
          {selected.displayName && selected.displayName !== selected.name && (
            <div className="place-address-line">{selected.displayName}</div>
          )}

          <div className="place-meta-row">
            {showCoordinates && <span className="coordinates">{formatCoordinates(selected.longitude, selected.latitude)}</span>}
            {selectedDistance && <span className="suggestion-distance" title="Distance from current location or map center">{selectedDistance}</span>}
          </div>

          {/* If place is saved, show list badges and '+ Lists' assignment */}
          {isSelectedSaved && (
            <div style={{ margin: '6px 0', borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="place-list-badges">
                  {lists
                    .filter(l => ((saved.find(p => p.id === selected.id)?.listIds) || ['favorites']).includes(l.id))
                    .map(l => (
                      <span key={l.id} className="place-list-tag">{l.name}</span>
                    ))}
                </div>
                <button
                  className="manage-lists-btn"
                  onClick={() => setEditingPlaceListId(editingPlaceListId === selected.id ? null : selected.id)}
                >
                  {editingPlaceListId === selected.id ? 'Done' : '+ Lists'}
                </button>
              </div>

              {editingPlaceListId === selected.id && (
                <div className="list-selector-popover">
                  {lists.map(list => {
                    const placeSaved = saved.find(p => p.id === selected.id)
                    const isChecked = (placeSaved?.listIds || ['favorites']).includes(list.id)
                    return (
                      <label key={list.id} className="list-checkbox-row">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleTogglePlaceList(selected, list.id)}
                        />
                        <span>{list.name}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="place-actions-row">
            <button className="directions-action-btn primary" onClick={() => handleDirectionsToPlace(selected)} title="Plan route to this place">
              <Navigation size={14} />
              <span>Directions</span>
            </button>
            <button className={`save-button ${isSelectedSaved ? 'saved-active' : ''}`} onClick={saveSelected}>
              {isSelectedSaved ? <Check size={14} /> : <Bookmark size={14} />}
              <span>{isSelectedSaved ? 'Saved' : 'Save'}</span>
            </button>
            <button className="directions-action-btn" onClick={() => handleSharePlace(selected)} title="Copy shareable link for this location">
              <Share2 size={13} />
              <span>Share</span>
            </button>
            <button className="directions-action-btn" onClick={() => handleDirectionsFromPlace(selected)} title="Plan route starting from here">
              <MapPin size={13} />
              <span>From here</span>
            </button>
          </div>
        </div>
      )}

      <div className="map-status">
        <span className={`status-pulse ${mapReady ? '' : 'status-pending'}`} />
        {mapReady ? (mapMode === 'offline-delhi' ? 'Offline Delhi Ready (OPFS)' : 'Map ready') : 'Connecting to map'}
        <span className="status-separator">·</span>
        {activeEffectiveStyleName}
      </div>

      <footer className="map-attribution">
        {mapMode === 'offline-delhi' ? (
          <>
            <span>© OpenStreetMap contributors · BBBike · VersaTiles Colorful (Delhi NCT Extract)</span>
            <span>Search: {activeGeocodingProvider.attribution}</span>
            <span>Route: {activeRoutingProvider.attribution}</span>
          </>
        ) : (
          <>
            {styleUrl.includes('openfreemap.org') && <span>© OpenFreeMap</span>}
            <span>Search: {activeGeocodingProvider.attribution}</span>
            <span>Route: {activeRoutingProvider.attribution}</span>
          </>
        )}
      </footer>
    </main>
  )
}

export default App
