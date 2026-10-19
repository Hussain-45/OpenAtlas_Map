import type { Map as MapLibreMap, Marker } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import type { Route, RouteEndpoint } from './types'

export const ROUTE_SOURCE_ID = 'openatlas-route-source'
export const ROUTE_ALT_LAYER_ID = 'openatlas-route-alt-layer'
export const ROUTE_CASING_LAYER_ID = 'openatlas-route-casing-layer'
export const ROUTE_LINE_LAYER_ID = 'openatlas-route-line-layer'

export function ensureRouteLayers(map: MapLibreMap): void {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
  }

  if (!map.getLayer(ROUTE_ALT_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_ALT_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'isAlternative'], true],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#64748b',
        'line-width': 4,
        'line-opacity': 0.7,
        'line-dasharray': [2, 2],
      },
    })
  }

  if (!map.getLayer(ROUTE_CASING_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_CASING_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'isAlternative'], false],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#1e3a8a',
        'line-width': 7,
        'line-opacity': 0.9,
      },
    })
  }

  if (!map.getLayer(ROUTE_LINE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LINE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'isAlternative'], false],
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#2563eb',
        'line-width': 5,
        'line-opacity': 1,
      },
    })
  }
}

export function renderRoutesOnMap(
  map: MapLibreMap,
  routes: Route[],
  activeRouteIndex = 0
): void {
  ensureRouteLayers(map)
  const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (!source) return

  const features = routes.map((route, idx) => ({
    type: 'Feature' as const,
    properties: {
      isAlternative: idx !== activeRouteIndex,
      index: idx,
      summary: route.summary,
    },
    geometry: {
      type: 'LineString' as const,
      coordinates: route.coordinates,
    },
  }))

  source.setData({
    type: 'FeatureCollection',
    features,
  })
}

export function clearRoutesFromMap(map: MapLibreMap): void {
  const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (!source) return
  source.setData({
    type: 'FeatureCollection',
    features: [],
  })
}

export function fitRouteBounds(
  map: MapLibreMap,
  route: Route,
  padding = { top: 90, bottom: 90, left: 320, right: 60 }
): void {
  if (!route.coordinates || route.coordinates.length === 0) return
  const bounds = route.coordinates.reduce(
    (acc, coord) => [
      [Math.min(acc[0][0], coord[0]), Math.min(acc[0][1], coord[1])],
      [Math.max(acc[1][0], coord[0]), Math.max(acc[1][1], coord[1])],
    ],
    [
      [route.coordinates[0][0], route.coordinates[0][1]],
      [route.coordinates[0][0], route.coordinates[0][1]],
    ]
  )
  map.fitBounds(
    [
      [bounds[0][0], bounds[0][1]],
      [bounds[1][0], bounds[1][1]],
    ],
    {
      padding,
      maxZoom: 16,
      duration: 600,
    }
  )
}

export function createEndpointBadgeElement(
  type: 'origin' | 'destination' | 'waypoint',
  endpoint: RouteEndpoint,
  index?: number
): HTMLElement {
  const el = document.createElement('div')
  el.className = `route-pin-badge pin-${type}`
  const label = type === 'origin' ? 'A' : type === 'destination' ? 'B' : `${(index ?? 0) + 1}`
  el.setAttribute(
    'aria-label',
    `${type === 'origin' ? 'Origin' : type === 'destination' ? 'Destination' : `Stop ${label}`}: ${endpoint.name}`
  )
  el.innerHTML = `<span>${label}</span>`
  return el
}

export function createEndpointMarker(
  type: 'origin' | 'destination' | 'waypoint',
  endpoint: RouteEndpoint,
  map: MapLibreMap,
  index?: number
): Marker {
  const el = createEndpointBadgeElement(type, endpoint, index)
  return new maplibregl.Marker({ element: el })
    .setLngLat([endpoint.longitude, endpoint.latitude])
    .addTo(map)
}

