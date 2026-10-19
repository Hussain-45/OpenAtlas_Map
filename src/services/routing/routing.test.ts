import { describe, expect, it, vi } from 'vitest'
import {
  decodePolyline,
  DELHI_ROUTING_BOUNDS,
  formatOSRMStepInstruction,
  getOfflineDelhiRoutingProvider,
  getRoutingProvider,
  isCoordinateInsideDelhi,
  OfflineDelhiRoadGraph,
  OfflineDelhiRoutingProvider,
  OSRMProvider,
  parseOSRMResponse,
  parseValhallaResponse,
  ValhallaProvider,
} from './index'
import type { RouteEndpoint } from './types'

describe('formatOSRMStepInstruction', () => {
  it('formats depart maneuvers', () => {
    expect(formatOSRMStepInstruction({ maneuver: { type: 'depart' }, name: 'Main St' })).toBe('Depart on Main St')
    expect(formatOSRMStepInstruction({ maneuver: { type: 'depart' }, name: '' })).toBe('Depart on road')
  })

  it('formats arrive maneuvers', () => {
    expect(formatOSRMStepInstruction({ maneuver: { type: 'arrive' } })).toBe('Arrive at destination')
  })

  it('formats roundabout maneuvers with exit', () => {
    expect(
      formatOSRMStepInstruction({
        maneuver: { type: 'roundabout', modifier: 'slight_right', exit: 2 },
        name: 'Broadway',
      })
    ).toBe('At roundabout, take exit 2 onto Broadway')

    expect(
      formatOSRMStepInstruction({
        maneuver: { type: 'rotary', exit: 1 },
      })
    ).toBe('At roundabout, take exit 1')
  })

  it('formats turn maneuvers', () => {
    expect(
      formatOSRMStepInstruction({
        maneuver: { type: 'turn', modifier: 'slight_left' },
        name: 'Oak Ave',
      })
    ).toBe('Turn slight left onto Oak Ave')

    expect(
      formatOSRMStepInstruction({
        maneuver: { type: 'turn', modifier: 'right' },
      })
    ).toBe('Turn right')
  })

  it('formats fork, merge, end of road, ramp, and continue', () => {
    expect(
      formatOSRMStepInstruction({ maneuver: { type: 'fork', modifier: 'left' }, name: 'Route 9' })
    ).toBe('Take left fork onto Route 9')

    expect(
      formatOSRMStepInstruction({ maneuver: { type: 'merge', modifier: 'slight_left' }, name: 'I-95' })
    ).toBe('Merge slight left onto I-95')

    expect(
      formatOSRMStepInstruction({ maneuver: { type: 'end of road', modifier: 'right' }, name: 'Pine St' })
    ).toBe('At end of road, turn right onto Pine St')

    expect(
      formatOSRMStepInstruction({ maneuver: { type: 'on ramp' }, name: 'Freeway' })
    ).toBe('Take ramp onto Freeway')

    expect(
      formatOSRMStepInstruction({ maneuver: { type: 'continue', modifier: 'straight' }, name: 'Main St' })
    ).toBe('Continue straight onto Main St')

    expect(
      formatOSRMStepInstruction({ maneuver: {} })
    ).toBe('Continue straight')
  })
})

describe('parseOSRMResponse', () => {
  it('parses valid OSRM routes and steps', () => {
    const mockOSRM = {
      code: 'Ok',
      routes: [
        {
          distance: 1250.4,
          duration: 180.2,
          geometry: {
            coordinates: [
              [77.209, 28.6139],
              [77.215, 28.618],
            ],
          },
          legs: [
            {
              summary: 'Via Connaught Place',
              distance: 1250,
              duration: 180,
              steps: [
                {
                  name: 'Radial Road',
                  distance: 600,
                  duration: 80,
                  maneuver: { type: 'depart', location: [77.209, 28.6139] },
                },
                {
                  name: 'Inner Circle',
                  distance: 650,
                  duration: 100,
                  maneuver: { type: 'arrive', location: [77.215, 28.618] },
                },
              ],
            },
          ],
        },
      ],
    }

    const routes = parseOSRMResponse(mockOSRM, 'driving')
    expect(routes).toHaveLength(1)
    expect(routes[0].distanceMeters).toBe(1250)
    expect(routes[0].durationSeconds).toBe(180)
    expect(routes[0].summary).toBe('Via Connaught Place')
    expect(routes[0].isAlternative).toBe(false)
    expect(routes[0].coordinates).toHaveLength(2)
    expect(routes[0].steps).toHaveLength(2)
    expect(routes[0].steps[0].instruction).toBe('Depart on Radial Road')
    expect(routes[0].steps[1].instruction).toBe('Arrive at destination')
  })

  it('marks subsequent routes as alternatives', () => {
    const mockOSRM = {
      code: 'Ok',
      routes: [
        {
          distance: 1000,
          duration: 100,
          geometry: { coordinates: [[77.209, 28.6139], [77.215, 28.618]] },
          legs: [{ summary: 'Fastest route', steps: [] }],
        },
        {
          distance: 1200,
          duration: 130,
          geometry: { coordinates: [[77.209, 28.6139], [77.214, 28.617]] },
          legs: [{ summary: 'Alternative via Ring Rd', steps: [] }],
        },
      ],
    }

    const routes = parseOSRMResponse(mockOSRM, 'driving')
    expect(routes).toHaveLength(2)
    expect(routes[0].isAlternative).toBe(false)
    expect(routes[1].isAlternative).toBe(true)
  })

  it('throws specific message when code is NoRoute', () => {
    expect(() =>
      parseOSRMResponse({ code: 'NoRoute', message: 'Impossible route' }, 'driving')
    ).toThrow('No navigable route found between these locations.')
  })

  it('returns empty array when input is invalid or falsy', () => {
    expect(parseOSRMResponse(null, 'driving')).toEqual([])
    expect(parseOSRMResponse(undefined, 'driving')).toEqual([])
  })
})

describe('decodePolyline (Valhalla polyline6)', () => {
  it('decodes polyline6 coordinates correctly', () => {
    // Encoded polyline for (lat: 38.5, lon: -120.2), (lat: 40.7, lon: -120.95), (lat: 43.252, lon: -126.453)
    // with 6 decimal places:
    // (38.5, -120.2) -> 38500000, -120200000
    const coords = decodePolyline('_izlhA~oikC_gg_AhqicC_okzgnAhnbubC', 6)
    expect(coords.length).toBeGreaterThan(0)
    coords.forEach(([lon, lat]) => {
      expect(typeof lon).toBe('number')
      expect(typeof lat).toBe('number')
      expect(lon).toBeGreaterThanOrEqual(-180)
      expect(lon).toBeLessThanOrEqual(180)
      expect(lat).toBeGreaterThanOrEqual(-90)
      expect(lat).toBeLessThanOrEqual(90)
    })
  })
})

describe('parseValhallaResponse', () => {
  it('parses valid Valhalla trip response', () => {
    const mockValhalla = {
      trip: {
        status: 0,
        summary: { length: 5.4, time: 420 },
        legs: [
          {
            summary: { length: 5.4, time: 420 },
            shape: '_izlhA~oikC_gg_AhqicC',
            maneuvers: [
              {
                instruction: 'Drive northeast on 1st Ave.',
                length: 2.1,
                time: 150,
                street_names: ['1st Ave'],
                begin_shape_index: 0,
              },
            ],
          },
        ],
      },
    }

    const routes = parseValhallaResponse(mockValhalla, 'driving')
    expect(routes).toHaveLength(1)
    expect(routes[0].distanceMeters).toBe(5400)
    expect(routes[0].durationSeconds).toBe(420)
    expect(routes[0].steps).toHaveLength(1)
    expect(routes[0].steps[0].instruction).toBe('Drive northeast on 1st Ave.')
    expect(routes[0].steps[0].name).toBe('1st Ave')
  })

  it('throws when no trip or legs found', () => {
    expect(() => parseValhallaResponse({}, 'driving')).toThrow('No route found from Valhalla service.')
  })
})

describe('OSRMProvider and ValhallaProvider instances', () => {
  it('validates coordinates before making request', async () => {
    const provider = new OSRMProvider()
    await expect(
      provider.calculateRoute({
        origin: { name: 'Invalid', latitude: 999, longitude: 0, type: 'custom' },
        destination: { name: 'Valid', latitude: 10, longitude: 10, type: 'custom' },
        mode: 'driving',
      })
    ).rejects.toThrow('Invalid origin coordinates.')

    await expect(
      provider.calculateRoute({
        origin: { name: 'Valid', latitude: 10, longitude: 10, type: 'custom' },
        destination: { name: 'Invalid', latitude: 10, longitude: 999, type: 'custom' },
        mode: 'driving',
      })
    ).rejects.toThrow('Invalid destination coordinates.')
  })

  it('ValhallaProvider validates coordinates before making request', async () => {
    const provider = new ValhallaProvider()
    await expect(
      provider.calculateRoute({
        origin: { name: 'Invalid', latitude: 999, longitude: 0, type: 'custom' },
        destination: { name: 'Valid', latitude: 10, longitude: 10, type: 'custom' },
        mode: 'walking',
      })
    ).rejects.toThrow('Invalid origin coordinates.')
  })

  it('calculates OSRM route using fetch mock', async () => {
    const mockOSRM = {
      code: 'Ok',
      routes: [
        {
          distance: 500,
          duration: 60,
          geometry: { coordinates: [[10, 10], [10.01, 10.01]] },
          legs: [{ summary: 'Direct route', steps: [] }],
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOSRM),
    })
    globalThis.fetch = mockFetch

    const provider = new OSRMProvider('https://custom-osrm.example.com')
    const routes = await provider.calculateRoute({
      origin: { name: 'Origin', latitude: 10, longitude: 10, type: 'custom' },
      destination: { name: 'Destination', latitude: 10.01, longitude: 10.01, type: 'custom' },
      mode: 'driving',
    })

    expect(routes).toHaveLength(1)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://custom-osrm.example.com/route/v1/driving/10.000000,10.000000;10.010000,10.010000'),
      expect.any(Object)
    )
  })

  it('factory getRoutingProvider respects providerId', () => {
    const osrm = getRoutingProvider('osrm')
    expect(osrm.id).toBe('osrm')

    const valhalla = getRoutingProvider('valhalla')
    expect(valhalla.id).toBe('valhalla')

    const auto = getRoutingProvider('auto')
    expect(auto.id).toBe('multimodal')
  })

  it('MultiModalRoutingProvider routes walking to Valhalla and driving to OSRM', async () => {
    const { MultiModalRoutingProvider } = await import('./index')
    const provider = new MultiModalRoutingProvider()

    // Mock fetch for driving
    const mockOSRM = {
      code: 'Ok',
      routes: [
        {
          distance: 1000,
          duration: 120,
          geometry: { coordinates: [[10, 10], [10.01, 10.01]] },
          legs: [],
        },
      ],
    }
    const mockValhalla = {
      trip: {
        status: 0,
        summary: { length: 0.8, time: 600 },
        legs: [
          {
            summary: { length: 0.8, time: 600 },
            shape: '_izlhA~oikC_gg_AhqicC',
            maneuvers: [],
          },
        ],
      },
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('valhalla')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockValhalla) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockOSRM) })
    })
    globalThis.fetch = mockFetch

    const driveRoutes = await provider.calculateRoute({
      origin: { name: 'A', latitude: 10, longitude: 10, type: 'custom' },
      destination: { name: 'B', latitude: 10.01, longitude: 10.01, type: 'custom' },
      mode: 'driving',
    })
    expect(driveRoutes[0].distanceMeters).toBe(1000)

    const walkRoutes = await provider.calculateRoute({
      origin: { name: 'A', latitude: 10, longitude: 10, type: 'custom' },
      destination: { name: 'B', latitude: 10.01, longitude: 10.01, type: 'custom' },
      mode: 'walking',
    })
    expect(walkRoutes[0].distanceMeters).toBe(800)
    expect(walkRoutes[0].durationSeconds).toBe(600)
  })
})

describe('mapRoute layer management and bounds', () => {
  it('ensureRouteLayers adds source and three styling layers if missing', async () => {
    const { ensureRouteLayers, ROUTE_SOURCE_ID } = await import('./mapRoute')
    const addedSources: Record<string, unknown> = {}
    const addedLayers: unknown[] = []

    const mockMap = {
      getSource: vi.fn((id: string) => addedSources[id]),
      addSource: vi.fn((id: string, def: unknown) => { addedSources[id] = def }),
      getLayer: vi.fn(() => false),
      addLayer: vi.fn((layer: unknown) => { addedLayers.push(layer) }),
    } as unknown as import('maplibre-gl').Map

    ensureRouteLayers(mockMap)
    expect(mockMap.addSource).toHaveBeenCalledWith(ROUTE_SOURCE_ID, expect.any(Object))
    expect(mockMap.addLayer).toHaveBeenCalledTimes(3)
  })

  it('renderRoutesOnMap updates GeoJSON source with active and alt features', async () => {
    const { renderRoutesOnMap, ROUTE_SOURCE_ID } = await import('./mapRoute')
    let sourceData: unknown = null
    const mockSource = {
      setData: vi.fn((data: unknown) => { sourceData = data }),
    }

    const mockMap = {
      getSource: vi.fn((id: string) => (id === ROUTE_SOURCE_ID ? mockSource : null)),
      addSource: vi.fn(),
      getLayer: vi.fn(() => true),
      addLayer: vi.fn(),
    } as unknown as import('maplibre-gl').Map

    const sampleRoutes = [
      {
        id: 'r1',
        summary: 'Primary route',
        distanceMeters: 1000,
        durationSeconds: 120,
        coordinates: [[77.2, 28.6], [77.21, 28.61]] as [number, number][],
        steps: [],
        mode: 'driving' as const,
      },
      {
        id: 'r2',
        summary: 'Alt route',
        distanceMeters: 1200,
        durationSeconds: 150,
        coordinates: [[77.2, 28.6], [77.22, 28.62]] as [number, number][],
        steps: [],
        mode: 'driving' as const,
        isAlternative: true,
      },
    ]

    renderRoutesOnMap(mockMap, sampleRoutes, 0)
    expect(mockSource.setData).toHaveBeenCalled()
    const fc = sourceData as { type: string; features: Array<{ properties: { isAlternative: boolean } }> }
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].properties.isAlternative).toBe(false)
    expect(fc.features[1].properties.isAlternative).toBe(true)
  })

  it('clearRoutesFromMap empties features', async () => {
    const { clearRoutesFromMap, ROUTE_SOURCE_ID } = await import('./mapRoute')
    const mockSource = {
      setData: vi.fn(),
    }

    const mockMap = {
      getSource: vi.fn((id: string) => (id === ROUTE_SOURCE_ID ? mockSource : null)),
    } as unknown as import('maplibre-gl').Map

    clearRoutesFromMap(mockMap)
    expect(mockSource.setData).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [],
    })
  })

  it('fitRouteBounds calls map.fitBounds with correct coordinate box', async () => {
    const { fitRouteBounds } = await import('./mapRoute')
    const fitBounds = vi.fn()
    const mockMap = { fitBounds } as unknown as import('maplibre-gl').Map

    fitRouteBounds(mockMap, {
      id: 'r1',
      summary: 'Route',
      distanceMeters: 500,
      durationSeconds: 60,
      coordinates: [[10, 20], [12, 25], [9, 18]],
      steps: [],
      mode: 'driving',
    })

    expect(fitBounds).toHaveBeenCalledWith(
      [[9, 18], [12, 25]],
      expect.objectContaining({ maxZoom: 16 })
    )
  })

  it('createEndpointBadgeElement creates waypoint badge with 1-based index', async () => {
    const { createEndpointBadgeElement } = await import('./mapRoute')
    const fakeEl = {
      className: '',
      innerHTML: '',
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) {
        this.attrs[k] = v
      },
      getAttribute(k: string) {
        return this.attrs[k]
      },
    }
    const origDoc = globalThis.document
    globalThis.document = {
      createElement: () => fakeEl as unknown as HTMLElement,
    } as unknown as Document

    try {
      const el = createEndpointBadgeElement(
        'waypoint',
        { name: 'Midpoint Stop', latitude: 28.62, longitude: 77.21, type: 'custom' },
        1
      )
      expect(el).toBe(fakeEl)
      expect(fakeEl.className).toContain('pin-waypoint')
      expect(fakeEl.innerHTML).toContain('<span>2</span>')
      expect(fakeEl.attrs['aria-label']).toBe('Stop 2: Midpoint Stop')
    } finally {
      globalThis.document = origDoc
    }
  })
})

describe('multi-stop routing support', () => {
  it('parses OSRM multi-stop legs with waypoint summaries', () => {
    const multiLegOSRM = {
      code: 'Ok',
      routes: [
        {
          distance: 5000,
          duration: 600,
          geometry: {
            coordinates: [
              [77.2, 28.6],
              [77.21, 28.61],
              [77.22, 28.62],
            ],
          },
          legs: [
            {
              summary: 'Leg 1',
              distance: 2500,
              duration: 300,
              steps: [
                {
                  name: 'Road A',
                  distance: 2500,
                  duration: 300,
                  maneuver: { type: 'depart', location: [77.2, 28.6] },
                },
              ],
            },
            {
              summary: 'Leg 2',
              distance: 2500,
              duration: 300,
              steps: [
                {
                  name: 'Road B',
                  distance: 2500,
                  duration: 300,
                  maneuver: { type: 'turn', modifier: 'right', location: [77.21, 28.61] },
                },
              ],
            },
          ],
        },
      ],
    }

    const waypoints = [{ name: 'Stop 1', latitude: 28.61, longitude: 77.21, type: 'custom' as const }]
    const routes = parseOSRMResponse(multiLegOSRM, 'driving', waypoints)
    expect(routes).toHaveLength(1)
    expect(routes[0].summary).toContain('Via 1 stop')
    expect(routes[0].steps).toHaveLength(2)
    expect(routes[0].waypoints).toEqual(waypoints)
  })

  it('validates invalid waypoint coordinates in OSRMProvider', async () => {
    const provider = new OSRMProvider('https://router.project-osrm.org')
    await expect(
      provider.calculateRoute({
        origin: { name: 'A', latitude: 28.6, longitude: 77.2, type: 'custom' },
        destination: { name: 'B', latitude: 28.7, longitude: 77.3, type: 'custom' },
        waypoints: [{ name: 'Invalid Stop', latitude: 999, longitude: 77.25, type: 'custom' }],
        mode: 'driving',
      })
    ).rejects.toThrow('Invalid coordinates for intermediate stop 1')
  })

  it('validates invalid waypoint coordinates in ValhallaProvider', async () => {
    const provider = new ValhallaProvider('https://valhalla1.openstreetmap.de')
    await expect(
      provider.calculateRoute({
        origin: { name: 'A', latitude: 28.6, longitude: 77.2, type: 'custom' },
        destination: { name: 'B', latitude: 28.7, longitude: 77.3, type: 'custom' },
        waypoints: [{ name: 'Invalid Stop', latitude: 28.65, longitude: 999, type: 'custom' }],
        mode: 'walking',
      })
    ).rejects.toThrow('Invalid coordinates for intermediate stop 1')
  })
})

describe('isCoordinateInsideDelhi', () => {
  it('returns true for coordinates within Delhi NCT bounds', () => {
    // Connaught Place: [77.2195, 28.6315]
    expect(isCoordinateInsideDelhi(77.2195, 28.6315)).toBe(true)
    // India Gate: [77.2295, 28.6129]
    expect(isCoordinateInsideDelhi(77.2295, 28.6129)).toBe(true)
    // Boundary bounds
    expect(isCoordinateInsideDelhi(DELHI_ROUTING_BOUNDS[0], DELHI_ROUTING_BOUNDS[1])).toBe(true)
    expect(isCoordinateInsideDelhi(DELHI_ROUTING_BOUNDS[2], DELHI_ROUTING_BOUNDS[3])).toBe(true)
  })

  it('returns false for coordinates outside Delhi', () => {
    // Mumbai: [72.8777, 19.0760]
    expect(isCoordinateInsideDelhi(72.8777, 19.0760)).toBe(false)
    // London: [-0.1278, 51.5074]
    expect(isCoordinateInsideDelhi(-0.1278, 51.5074)).toBe(false)
    // Invalid / NaN
    expect(isCoordinateInsideDelhi(NaN, 28.6)).toBe(false)
    expect(isCoordinateInsideDelhi(77.2, 999)).toBe(false)
  })
})

describe('OfflineDelhiRoutingProvider', () => {
  const cpOrigin = { name: 'Connaught Place', latitude: 28.6315, longitude: 77.2195, type: 'search' as const }
  const igDest = { name: 'India Gate', latitude: 28.6129, longitude: 77.2295, type: 'search' as const }
  const mumbaiOutside = { name: 'Mumbai Airport', latitude: 19.0896, longitude: 72.8656, type: 'search' as const }

  it('initializes with correct provider metadata and supported modes', () => {
    const provider = new OfflineDelhiRoutingProvider()
    expect(provider.id).toBe('offline-delhi')
    expect(provider.name).toBe('Offline Delhi Router')
    expect(provider.attribution).toContain('Delhi Road Network')
    expect(provider.supportedModes).toEqual(['driving', 'walking', 'cycling'])
  })

  it('honors AbortSignal', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    const controller = new AbortController()
    controller.abort()

    await expect(
      provider.calculateRoute({
        origin: cpOrigin,
        destination: igDest,
        mode: 'driving',
        signal: controller.signal,
      })
    ).rejects.toThrow('Aborted')
  })

  it('rejects with descriptive error when origin is outside Delhi coverage', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    await expect(
      provider.calculateRoute({
        origin: mumbaiOutside,
        destination: igDest,
        mode: 'driving',
      })
    ).rejects.toThrow('Origin "Mumbai Airport" (19.0896°, 72.8656°) is outside the Offline Delhi coverage area')
  })

  it('rejects with descriptive error when destination is outside Delhi coverage', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    await expect(
      provider.calculateRoute({
        origin: cpOrigin,
        destination: mumbaiOutside,
        mode: 'driving',
      })
    ).rejects.toThrow('Destination "Mumbai Airport" (19.0896°, 72.8656°) is outside the Offline Delhi coverage area')
  })

  it('rejects with descriptive error when an intermediate stop is outside Delhi coverage', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    await expect(
      provider.calculateRoute({
        origin: cpOrigin,
        destination: igDest,
        waypoints: [mumbaiOutside],
        mode: 'driving',
      })
    ).rejects.toThrow('Stop #1 "Mumbai Airport" (19.0896°, 72.8656°) is outside the Offline Delhi coverage area')
  })

  it('reports isGraphAvailable true when road graph data is installed', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    expect(await provider.isGraphAvailable()).toBe(true)
  })

  it('calculates genuine road-following driving route with real road steps and coordinates', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    const routes = await provider.calculateRoute({
      origin: cpOrigin,
      destination: igDest,
      mode: 'driving',
    })

    expect(routes).toHaveLength(1)
    const route = routes[0]
    expect(route.distanceMeters).toBeGreaterThan(2500)
    expect(route.distanceMeters).toBeLessThan(4500)
    expect(route.durationSeconds).toBeGreaterThan(300)
    expect(route.durationSeconds).toBeLessThan(1200)

    // Genuine road linestring coordinates following Delhi streets, not a straight line!
    expect(route.coordinates.length).toBeGreaterThan(50)
    expect(route.steps.length).toBeGreaterThan(5)

    // First step is depart and last is arrive
    expect(route.steps[0].type).toBe('depart')
    expect(route.steps[route.steps.length - 1].type).toBe('arrive')
    expect(route.steps[route.steps.length - 1].instruction).toContain('India Gate')
  })

  it('calculates genuine walking route utilizing pedestrian pathways and shortcuts', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    const routes = await provider.calculateRoute({
      origin: cpOrigin,
      destination: igDest,
      mode: 'walking',
    })

    expect(routes).toHaveLength(1)
    const route = routes[0]
    // Walking route should be shorter than driving because pedestrian shortcuts are accessible
    expect(route.distanceMeters).toBeLessThan(3500)
    expect(route.durationSeconds).toBeGreaterThan(1500) // ~30+ mins walking
    expect(route.mode).toBe('walking')
    expect(route.coordinates.length).toBeGreaterThan(30)
  })

  it('calculates genuine cycling route', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    const routes = await provider.calculateRoute({
      origin: cpOrigin,
      destination: igDest,
      mode: 'cycling',
    })

    expect(routes).toHaveLength(1)
    const route = routes[0]
    expect(route.distanceMeters).toBeGreaterThan(2000)
    expect(route.durationSeconds).toBeGreaterThan(500)
    expect(route.durationSeconds).toBeLessThan(1500)
    expect(route.mode).toBe('cycling')
  })

  it('calculates multi-stop route with intermediate waypoints', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    const mandiHouse: RouteEndpoint = {
      name: 'Mandi House',
      longitude: 77.2346,
      latitude: 28.6258,
      type: 'search',
    }

    const routes = await provider.calculateRoute({
      origin: cpOrigin,
      waypoints: [mandiHouse],
      destination: igDest,
      mode: 'driving',
    })

    expect(routes).toHaveLength(1)
    const route = routes[0]
    expect(route.waypoints).toHaveLength(1)
    expect(route.coordinates.length).toBeGreaterThan(60)

    // Should contain a waypoint arrival step
    const wpStep = route.steps.find(s => s.instruction.includes('Arrive at stop: Mandi House'))
    expect(wpStep).toBeDefined()
  })

  it('executes genuine route calculation when custom road graph resolver is provided', async () => {
    const mockRoute = {
      id: 'mock-delhi-route',
      summary: 'Barakhamba Road → Rajpath',
      distanceMeters: 3200,
      durationSeconds: 480,
      coordinates: [[77.2195, 28.6315], [77.2295, 28.6129]] as [number, number][],
      steps: [
        {
          instruction: 'Head southeast toward Rajpath',
          distanceMeters: 3200,
          durationSeconds: 480,
          location: [77.2195, 28.6315] as [number, number],
        },
      ],
      mode: 'driving' as const,
    }

    const mockResolver = vi.fn().mockResolvedValue([mockRoute])
    const provider = new OfflineDelhiRoutingProvider(mockResolver)
    expect(await provider.isGraphAvailable()).toBe(true)

    const routes = await provider.calculateRoute({
      origin: cpOrigin,
      destination: igDest,
      mode: 'driving',
    })

    expect(routes).toHaveLength(1)
    expect(routes[0].distanceMeters).toBe(3200)
    expect(mockResolver).toHaveBeenCalledOnce()
  })

  it('getOfflineDelhiRoutingProvider returns singleton instance', () => {
    const p1 = getOfflineDelhiRoutingProvider()
    const p2 = getOfflineDelhiRoutingProvider()
    expect(p1).toBe(p2)
    expect(p1.id).toBe('offline-delhi')
  })

  it('OfflineDelhiRoadGraph rejects buffer smaller than header', () => {
    const tinyBuffer = new ArrayBuffer(32)
    expect(() => new OfflineDelhiRoadGraph(tinyBuffer)).toThrow(
      'Invalid road graph: buffer is too small (32 bytes, expected at least 64-byte header)'
    )
  })

  it('OfflineDelhiRoadGraph rejects corrupt magic identifier', () => {
    const fakeHeader = new ArrayBuffer(64)
    const view = new DataView(fakeHeader)
    view.setUint8(0, 88) // 'X'
    view.setUint8(1, 89) // 'Y'
    view.setUint8(2, 90) // 'Z'
    view.setUint8(3, 49) // '1'
    expect(() => new OfflineDelhiRoadGraph(fakeHeader)).toThrow(
      "Invalid road graph format: expected 'ODRG', received 'XYZ1'"
    )
  })

  it('OfflineDelhiRoadGraph rejects truncated graph buffers', () => {
    const truncatedBuf = new ArrayBuffer(80)
    const view = new DataView(truncatedBuf)
    view.setUint8(0, 79) // 'O'
    view.setUint8(1, 68) // 'D'
    view.setUint8(2, 82) // 'R'
    view.setUint8(3, 71) // 'G'
    view.setUint32(8, 100, true) // 100 nodes -> needs 800 bytes
    view.setUint32(12, 10, true)  // 10 edges -> needs 140 bytes
    view.setUint32(20, 10, true)  // namesByteLen -> 10 bytes
    expect(() => new OfflineDelhiRoadGraph(truncatedBuf)).toThrow(
      'Corrupted road graph: file truncated'
    )
  })

  it('resetGraph clears cached in-memory road graph instance', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    expect(await provider.isGraphAvailable()).toBe(true)
    provider.resetGraph()
    // Can still reload when needed
    expect(await provider.isGraphAvailable()).toBe(true)
  })
})



