import { isValidCoordinate } from '../../coordinates'
import { getActiveReleasePointer, getOpfsArrayBuffer, isOpfsSupported } from '../offline/opfsStorage'
import { ACTIVE_ROUTING_FILENAME } from '../offline/datasetUpdateService'
import { validateRoutingGraphBuffer } from '../offline/manifestValidator'
import type { Route, RouteEndpoint, RouteRequest, RouteStep, RoutingProvider, TravelMode } from './types'

export const DELHI_ROUTING_BOUNDS: [number, number, number, number] = [
  76.978, // minLon
  28.440, // minLat
  77.497, // maxLon
  28.738, // maxLat
]

export function isCoordinateInsideDelhi(longitude: number, latitude: number): boolean {
  if (!isValidCoordinate(longitude, latitude)) return false
  const [minLon, minLat, maxLon, maxLat] = DELHI_ROUTING_BOUNDS
  return (
    longitude >= minLon &&
    longitude <= maxLon &&
    latitude >= minLat &&
    latitude <= maxLat
  )
}

export type RoadGraphResolver = (request: RouteRequest) => Promise<Route[]>

// Bitflags matching binary graph generator
const FLAG_ONEWAY = 1 << 0
const FLAG_DRIVE  = 1 << 1
const FLAG_WALK   = 1 << 2
const FLAG_CYCLE  = 1 << 3

// Highway speed models (km/h) for realistic travel time
const DRIVING_SPEEDS: Record<number, number> = {
  0: 60, // motorway
  1: 50, // trunk
  2: 40, // primary
  3: 32, // secondary
  4: 25, // tertiary
  5: 20, // residential
  6: 15, // service
  7: 15, // living_street
  13: 15, // track
  14: 20, // other
}

const CYCLING_SPEEDS: Record<number, number> = {
  10: 18, // cycleway
  1: 16,  // trunk
  2: 16,  // primary
  3: 16,  // secondary
  4: 15,  // tertiary
  5: 14,  // residential
  6: 12,  // service
  7: 12,  // living_street
  8: 10,  // pedestrian
  11: 12, // path
  14: 14, // other
}

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function calculateBearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function getTurnModifier(delta: number): { modifier: string; instruction: string } {
  if (Math.abs(delta) < 20) {
    return { modifier: 'straight', instruction: 'Continue straight' }
  }
  if (delta > 20 && delta <= 45) {
    return { modifier: 'slight right', instruction: 'Slight right' }
  }
  if (delta > 45 && delta <= 135) {
    return { modifier: 'right', instruction: 'Turn right' }
  }
  if (delta > 135) {
    return { modifier: 'sharp right', instruction: 'Sharp right' }
  }
  if (delta < -20 && delta >= -45) {
    return { modifier: 'slight left', instruction: 'Slight left' }
  }
  if (delta < -45 && delta >= -135) {
    return { modifier: 'left', instruction: 'Turn left' }
  }
  return { modifier: 'sharp left', instruction: 'Sharp left' }
}

interface HeapItem {
  id: number
  dist: number
  priority: number
}

class FastMinHeap {
  private data: HeapItem[] = []

  push(item: HeapItem): void {
    this.data.push(item)
    this.up(this.data.length - 1)
  }

  pop(): HeapItem | null {
    if (this.data.length === 0) return null
    const top = this.data[0]
    const bottom = this.data.pop()
    if (bottom && this.data.length > 0) {
      this.data[0] = bottom
      this.down(0)
    }
    return top
  }

  get size(): number {
    return this.data.length
  }

  private up(idx: number): void {
    while (idx > 0) {
      const p = (idx - 1) >> 1
      if (this.data[idx].priority < this.data[p].priority) {
        const tmp = this.data[idx]
        this.data[idx] = this.data[p]
        this.data[p] = tmp
        idx = p
      } else break
    }
  }

  private down(idx: number): void {
    const len = this.data.length
    while (true) {
      const left = (idx << 1) + 1
      const right = left + 1
      let smallest = idx
      if (left < len && this.data[left].priority < this.data[smallest].priority) smallest = left
      if (right < len && this.data[right].priority < this.data[smallest].priority) smallest = right
      if (smallest !== idx) {
        const tmp = this.data[idx]
        this.data[idx] = this.data[smallest]
        this.data[smallest] = tmp
        idx = smallest
      } else break
    }
  }
}

export class OfflineDelhiRoadGraph {
  readonly nodeCount: number
  readonly edgeCount: number
  readonly nodeCoords: Int32Array
  readonly mainMask: Uint8Array
  readonly names: string[]

  // CSR Adjacency arrays
  readonly offsets: Uint32Array
  readonly targets: Uint32Array
  readonly weights: Uint16Array
  readonly edgeFlags: Uint16Array
  readonly edgeNames: Uint16Array

  // Spatial Grid Index for <0.1ms node snapping
  private readonly gridCols = 200
  private readonly gridRows = 200
  private readonly grid: number[][]

  constructor(buffer: ArrayBuffer) {
    if (!buffer || buffer.byteLength < 64) {
      throw new Error(`Invalid road graph: buffer is too small (${buffer?.byteLength ?? 0} bytes, expected at least 64-byte header)`)
    }

    const view = new DataView(buffer)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (magic !== 'ODRG') {
      throw new Error(`Invalid road graph format: expected 'ODRG', received '${magic}'`)
    }

    this.nodeCount = view.getUint32(8, true)
    this.edgeCount = view.getUint32(12, true)
    const namesByteLen = view.getUint32(20, true)

    const minRequiredBytes = 64 + this.nodeCount * 8 + Math.ceil(this.nodeCount / 8) + this.edgeCount * 14 + namesByteLen
    if (buffer.byteLength < minRequiredBytes) {
      throw new Error(`Corrupted road graph: file truncated (${buffer.byteLength} bytes, expected at least ${minRequiredBytes} bytes)`)
    }

    // Node coordinates table (scaled by 1e5)
    this.nodeCoords = new Int32Array(buffer, 64, this.nodeCount * 2)

    // Main component mask
    const mainMaskOffset = 64 + this.nodeCount * 8
    const mainMaskLen = Math.ceil(this.nodeCount / 8)
    this.mainMask = new Uint8Array(buffer, mainMaskOffset, mainMaskLen)

    // Edge table
    const edgeTableOffset = mainMaskOffset + mainMaskLen
    const edgeDataView = new DataView(buffer, edgeTableOffset, this.edgeCount * 14)

    // String table
    const namesOffset = edgeTableOffset + this.edgeCount * 14
    const namesBytes = new Uint8Array(buffer, namesOffset, namesByteLen)
    const decoder = new TextDecoder('utf8')
    this.names = []
    let startIdx = 0
    for (let i = 0; i < namesByteLen; i++) {
      if (namesBytes[i] === 0) {
        this.names.push(decoder.decode(namesBytes.subarray(startIdx, i)))
        startIdx = i + 1
      }
    }

    // Build unified CSR adjacency representation
    const deg = new Uint16Array(this.nodeCount)
    for (let i = 0; i < this.edgeCount; i++) {
      const u = edgeDataView.getUint32(i * 14, true)
      const v = edgeDataView.getUint32(i * 14 + 4, true)
      deg[u]++
      deg[v]++
    }

    this.offsets = new Uint32Array(this.nodeCount + 1)
    for (let i = 0; i < this.nodeCount; i++) {
      this.offsets[i + 1] = this.offsets[i] + deg[i]
    }

    const totalDirected = this.offsets[this.nodeCount]
    this.targets = new Uint32Array(totalDirected)
    this.weights = new Uint16Array(totalDirected)
    this.edgeFlags = new Uint16Array(totalDirected)
    this.edgeNames = new Uint16Array(totalDirected)

    const cur = new Uint32Array(this.offsets)
    for (let i = 0; i < this.edgeCount; i++) {
      const pos = i * 14
      const u = edgeDataView.getUint32(pos, true)
      const v = edgeDataView.getUint32(pos + 4, true)
      const d = edgeDataView.getUint16(pos + 8, true)
      const f = edgeDataView.getUint16(pos + 10, true)
      const nIdx = edgeDataView.getUint16(pos + 12, true)

      // Forward edge u -> v
      let p = cur[u]++
      this.targets[p] = v
      this.weights[p] = d
      this.edgeFlags[p] = f
      this.edgeNames[p] = nIdx

      // Backward edge v -> u (reverse oneway driving/cycling flags)
      let backFlags = f
      if (f & FLAG_ONEWAY) {
        backFlags &= ~FLAG_DRIVE
        backFlags &= ~FLAG_CYCLE
      }
      p = cur[v]++
      this.targets[p] = u
      this.weights[p] = d
      this.edgeFlags[p] = backFlags
      this.edgeNames[p] = nIdx
    }

    // Spatial Grid Index
    const minLon = 76.978, maxLon = 77.497
    const minLat = 28.440, maxLat = 28.738
    this.grid = Array.from({ length: this.gridCols * this.gridRows }, () => [])

    for (let i = 0; i < this.nodeCount; i++) {
      // Only index nodes in the main connected component
      if (!(this.mainMask[i >> 3] & (1 << (i & 7)))) continue

      const lon = this.nodeCoords[i * 2] / 100000
      const lat = this.nodeCoords[i * 2 + 1] / 100000
      const c = Math.max(0, Math.min(this.gridCols - 1, Math.floor(((lon - minLon) / (maxLon - minLon)) * this.gridCols)))
      const r = Math.max(0, Math.min(this.gridRows - 1, Math.floor(((lat - minLat) / (maxLat - minLat)) * this.gridRows)))
      this.grid[r * this.gridCols + c].push(i)
    }
  }

  snap(targetLon: number, targetLat: number, mode: TravelMode): { nodeId: number; distMeters: number } {
    const minLon = 76.978, maxLon = 77.497
    const minLat = 28.440, maxLat = 28.738
    const c = Math.max(0, Math.min(this.gridCols - 1, Math.floor(((targetLon - minLon) / (maxLon - minLon)) * this.gridCols)))
    const r = Math.max(0, Math.min(this.gridRows - 1, Math.floor(((targetLat - minLat) / (maxLat - minLat)) * this.gridRows)))

    const modeFlag = mode === 'driving' ? FLAG_DRIVE : (mode === 'walking' ? FLAG_WALK : FLAG_CYCLE)

    let bestDist = Infinity
    let bestId = -1

    for (let rad = 0; rad <= 6; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue
          const nr = r + dr
          const nc = c + dc
          if (nr < 0 || nr >= this.gridRows || nc < 0 || nc >= this.gridCols) continue
          const cell = this.grid[nr * this.gridCols + nc]
          for (let k = 0; k < cell.length; k++) {
            const id = cell[k]

            // Verify node has at least one edge admitting the requested travel mode
            let hasAccessibleEdge = false
            const start = this.offsets[id]
            const end = this.offsets[id + 1]
            for (let eIdx = start; eIdx < end; eIdx++) {
              if (this.edgeFlags[eIdx] & modeFlag) {
                hasAccessibleEdge = true
                break
              }
            }
            if (!hasAccessibleEdge) continue

            const lon = this.nodeCoords[id * 2] / 100000
            const lat = this.nodeCoords[id * 2 + 1] / 100000
            const d = haversineMeters(targetLon, targetLat, lon, lat)
            if (d < bestDist) {
              bestDist = d
              bestId = id
            }
          }
        }
      }
      if (bestId !== -1 && bestDist < (rad + 1) * 350) break
    }

    if (bestId === -1) {
      throw new Error(`Could not snap point [${targetLon.toFixed(4)}, ${targetLat.toFixed(4)}] to accessible ${mode} road in Delhi.`)
    }

    return { nodeId: bestId, distMeters: bestDist }
  }

  findRouteLeg(startNode: number, targetNode: number, mode: TravelMode, signal?: AbortSignal): {
    pathNodes: number[]
    pathDistances: number[]
    edgeNames: number[]
    edgeFlags: number[]
    totalDistMeters: number
  } {
    if (startNode === targetNode) {
      return {
        pathNodes: [startNode],
        pathDistances: [0],
        edgeNames: [0],
        edgeFlags: [0],
        totalDistMeters: 0,
      }
    }

    const modeFlag = mode === 'driving' ? FLAG_DRIVE : (mode === 'walking' ? FLAG_WALK : FLAG_CYCLE)
    const targetLon = this.nodeCoords[targetNode * 2] / 100000
    const targetLat = this.nodeCoords[targetNode * 2 + 1] / 100000

    const distMap = new Float64Array(this.nodeCount).fill(Infinity)
    const parentNode = new Int32Array(this.nodeCount).fill(-1)
    const parentEdgeDist = new Uint16Array(this.nodeCount)
    const parentEdgeName = new Uint16Array(this.nodeCount)
    const parentEdgeFlag = new Uint16Array(this.nodeCount)
    const heap = new FastMinHeap()

    distMap[startNode] = 0
    const startH = haversineMeters(
      this.nodeCoords[startNode * 2] / 100000,
      this.nodeCoords[startNode * 2 + 1] / 100000,
      targetLon,
      targetLat
    )
    heap.push({ id: startNode, dist: 0, priority: startH })

    let found = false
    let stepCount = 0

    while (heap.size > 0) {
      if ((stepCount++ & 4095) === 0 && signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const curr = heap.pop()
      if (!curr) break
      if (curr.dist > distMap[curr.id]) continue

      if (curr.id === targetNode) {
        found = true
        break
      }

      const start = this.offsets[curr.id]
      const end = this.offsets[curr.id + 1]
      for (let j = start; j < end; j++) {
        const flag = this.edgeFlags[j]
        if (!(flag & modeFlag)) continue

        const nextId = this.targets[j]
        const edgeDist = this.weights[j]
        const newDist = curr.dist + edgeDist

        if (newDist < distMap[nextId]) {
          distMap[nextId] = newDist
          parentNode[nextId] = curr.id
          parentEdgeDist[nextId] = edgeDist
          parentEdgeName[nextId] = this.edgeNames[j]
          parentEdgeFlag[nextId] = flag

          const nLon = this.nodeCoords[nextId * 2] / 100000
          const nLat = this.nodeCoords[nextId * 2 + 1] / 100000
          const h = haversineMeters(nLon, nLat, targetLon, targetLat)
          heap.push({ id: nextId, dist: newDist, priority: newDist + h })
        }
      }
    }

    if (!found) {
      throw new Error(`No valid ${mode} route found between selected points on Delhi road network.`)
    }

    // Trace back path
    const pathNodes: number[] = []
    const pathDistances: number[] = []
    const edgeNamesList: number[] = []
    const edgeFlagsList: number[] = []

    let curr = targetNode
    while (curr !== -1) {
      pathNodes.push(curr)
      pathDistances.push(parentEdgeDist[curr])
      edgeNamesList.push(parentEdgeName[curr])
      edgeFlagsList.push(parentEdgeFlag[curr])
      curr = parentNode[curr]
    }

    pathNodes.reverse()
    pathDistances.reverse()
    edgeNamesList.reverse()
    edgeFlagsList.reverse()

    return {
      pathNodes,
      pathDistances,
      edgeNames: edgeNamesList,
      edgeFlags: edgeFlagsList,
      totalDistMeters: distMap[targetNode],
    }
  }
}

export class OfflineDelhiRoutingProvider implements RoutingProvider {
  readonly id = 'offline-delhi'
  readonly name = 'Offline Delhi Router'
  readonly attribution = 'Delhi Road Network © OpenStreetMap contributors'
  readonly supportedModes: TravelMode[] = ['driving', 'walking', 'cycling']

  private graphResolver?: RoadGraphResolver
  private graphInstance: OfflineDelhiRoadGraph | null = null
  private loadPromise: Promise<OfflineDelhiRoadGraph> | null = null

  constructor(customGraphResolver?: RoadGraphResolver) {
    this.graphResolver = customGraphResolver
  }

  /**
   * Sets a custom road graph calculation engine (used in unit tests).
   */
  setGraphResolver(resolver?: RoadGraphResolver): void {
    this.graphResolver = resolver
  }

  /**
   * Resets in-memory cached graph instance (used when deleting offline package).
   */
  resetGraph(): void {
    this.graphInstance = null
    this.loadPromise = null
  }

  /**
   * Checks whether the offline road graph is ready for immediate route calculation.
   */
  async isGraphAvailable(): Promise<boolean> {
    if (this.graphResolver || this.graphInstance) return true
    try {
      await this.ensureGraphLoaded()
      return Boolean(this.graphInstance)
    } catch {
      return false
    }
  }

  /**
   * Loads and caches the binary road network graph into memory.
   */
  async ensureGraphLoaded(signal?: AbortSignal): Promise<OfflineDelhiRoadGraph> {
    if (this.graphInstance) return this.graphInstance
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      let arrayBuffer: ArrayBuffer | null = null
      const graphUrl = '/offline/delhi/delhi-routing-graph.bin'

      // 0. Try active OPFS release first
      if (isOpfsSupported()) {
        try {
          const activePointer = await getActiveReleasePointer()
          if (activePointer && activePointer.verified) {
            const buf = await getOpfsArrayBuffer(ACTIVE_ROUTING_FILENAME)
            if (buf && buf.byteLength >= 64) {
              const check = validateRoutingGraphBuffer(buf)
              if (check.valid) {
                arrayBuffer = buf
              }
            }
          }
        } catch {
          // Fall back to CacheStorage / HTTP
        }
      }

      // 1. Try Browser CacheStorage first
      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open('openatlas-offline-routing-v1')
          const cachedResponse = await cache.match(graphUrl)
          if (cachedResponse) {
            arrayBuffer = await cachedResponse.arrayBuffer()
          }
        } catch {
          // Ignore cache errors, fall back to fetch
        }
      }

      // 2. Fetch from web server / static asset directory
      if (!arrayBuffer && typeof fetch !== 'undefined') {
        try {
          const response = await fetch(graphUrl, { signal })
          if (response.ok) {
            // Save to CacheStorage in background for offline durability
            if (typeof caches !== 'undefined') {
              try {
                const cache = await caches.open('openatlas-offline-routing-v1')
                void cache.put(graphUrl, response.clone())
              } catch {
                // Ignore cache put errors
              }
            }
            arrayBuffer = await response.arrayBuffer()
          }
        } catch (fetchErr) {
          if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
            throw fetchErr
          }
        }
      }

      // 3. Fallback for Node.js / Vitest test environments
      const g = globalThis as unknown as { process?: { versions?: { node?: string } } }
      if (!arrayBuffer && g.process?.versions?.node) {
        try {
          const fsMod = 'node:fs'
          const pathMod = 'node:path'
          const fs = (await import(/* @vite-ignore */ fsMod)) as {
            existsSync: (p: string) => boolean
            readFileSync: (p: string) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number }
          }
          const path = (await import(/* @vite-ignore */ pathMod)) as { resolve: (p: string) => string }
          const localPath = path.resolve('public/offline/delhi/delhi-routing-graph.bin')
          if (fs.existsSync(localPath)) {
            const buf = fs.readFileSync(localPath)
            arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
          }
        } catch {
          // Fall through
        }
      }

      if (!arrayBuffer) {
        throw new Error(
          'Offline road routing dataset (delhi-routing-graph.bin) could not be loaded. Please ensure the graph package is built in public/offline/delhi/.'
        )
      }

      const graph = new OfflineDelhiRoadGraph(arrayBuffer)
      this.graphInstance = graph
      return graph
    })()

    try {
      return await this.loadPromise
    } catch (err) {
      this.loadPromise = null
      throw err
    }
  }

  /**
   * Reloads the road network graph from an updated OPFS active release or an explicit ArrayBuffer.
   */
  async reloadGraph(customBuffer?: ArrayBuffer): Promise<OfflineDelhiRoadGraph> {
    this.graphInstance = null
    this.loadPromise = null
    if (customBuffer) {
      const graph = new OfflineDelhiRoadGraph(customBuffer)
      this.graphInstance = graph
      return graph
    }
    return this.ensureGraphLoaded()
  }

  /**
   * Validates endpoint coordinate bounds against Delhi NCT extract.
   */
  private validateEndpoint(endpoint: RouteEndpoint, label: string): void {
    if (!isValidCoordinate(endpoint.longitude, endpoint.latitude)) {
      throw new Error(`Invalid ${label} coordinates: [${endpoint.longitude}, ${endpoint.latitude}]`)
    }

    if (!isCoordinateInsideDelhi(endpoint.longitude, endpoint.latitude)) {
      const name = endpoint.name ? `"${endpoint.name}" ` : ''
      const coords = `(${endpoint.latitude.toFixed(4)}°, ${endpoint.longitude.toFixed(4)}°)`
      throw new Error(
        `${label} ${name}${coords} is outside the Offline Delhi coverage area (76.98°E–77.50°E, 28.44°N–28.74°N). Switch to Online mode to route globally.`
      )
    }
  }

  /**
   * Calculates genuine road-following route within Delhi NCT coverage.
   */
  async calculateRoute(request: RouteRequest): Promise<Route[]> {
    if (request.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    // 1. Boundary and coordinate validation
    this.validateEndpoint(request.origin, 'Origin')
    this.validateEndpoint(request.destination, 'Destination')

    if (request.waypoints && request.waypoints.length > 0) {
      request.waypoints.forEach((wp, idx) => {
        this.validateEndpoint(wp, `Stop #${idx + 1}`)
      })
    }

    if (!this.supportedModes.includes(request.mode)) {
      throw new Error(
        `Travel mode "${request.mode}" is not supported by the Offline Delhi router. Supported modes: ${this.supportedModes.join(', ')}.`
      )
    }

    // 2. Custom mock resolver hook
    if (this.graphResolver) {
      return this.graphResolver(request)
    }

    // 3. Ensure offline road network graph is loaded
    const graph = await this.ensureGraphLoaded(request.signal)

    // 4. Construct sequence of endpoints: Origin -> [Waypoints] -> Destination
    const stops: RouteEndpoint[] = [
      request.origin,
      ...(request.waypoints || []),
      request.destination,
    ]

    // 5. Snap each stop to the nearest road node
    const snappedNodes: number[] = []
    for (const stop of stops) {
      const snapResult = graph.snap(stop.longitude, stop.latitude, request.mode)
      snappedNodes.push(snapResult.nodeId)
    }

    // 6. Compute route legs between consecutive stops
    const allCoords: [number, number][] = []
    const allSteps: RouteStep[] = []
    let totalDistanceMeters = 0
    let totalDurationSeconds = 0
    const topStreetNames = new Set<string>()

    for (let legIdx = 0; legIdx < snappedNodes.length - 1; legIdx++) {
      const uNode = snappedNodes[legIdx]
      const vNode = snappedNodes[legIdx + 1]

      const leg = graph.findRouteLeg(uNode, vNode, request.mode, request.signal)
      totalDistanceMeters += leg.totalDistMeters

      // Convert path node indices to [lon, lat] coordinates
      const legCoords: [number, number][] = leg.pathNodes.map(idx => [
        graph.nodeCoords[idx * 2] / 100000,
        graph.nodeCoords[idx * 2 + 1] / 100000,
      ])

      // Calculate realistic leg duration based on road speeds
      let legDuration = 0
      for (let i = 1; i < leg.pathNodes.length; i++) {
        const segDist = leg.pathDistances[i]
        const segFlag = leg.edgeFlags[i]
        const kindIdx = (segFlag >> 4) & 0x0F

        let speedKmh = 25
        if (request.mode === 'driving') {
          speedKmh = DRIVING_SPEEDS[kindIdx] || 20
        } else if (request.mode === 'walking') {
          speedKmh = kindIdx === 12 ? 2.0 : 4.5
        } else if (request.mode === 'cycling') {
          speedKmh = CYCLING_SPEEDS[kindIdx] || 15
        }

        const speedMs = Math.max(0.5, (speedKmh * 1000) / 3600)
        legDuration += segDist / speedMs
      }
      totalDurationSeconds += Math.round(legDuration)

      // Generate turn-by-turn maneuvers from bearing differences and street names
      let currentStreet = graph.names[leg.edgeNames[1]] || 'Delhi Road'
      if (currentStreet && currentStreet !== 'Delhi Road') {
        topStreetNames.add(currentStreet)
      }

      let stepAccumDist = 0
      let stepAccumDuration = 0
      let stepStartCoord = legCoords[0]

      // Initial Depart step for first leg
      if (legIdx === 0) {
        allSteps.push({
          instruction: `Head out on ${currentStreet}`,
          distanceMeters: 0,
          durationSeconds: 0,
          type: 'depart',
          modifier: 'straight',
          name: currentStreet,
          location: legCoords[0],
        })
      }

      for (let i = 1; i < leg.pathNodes.length; i++) {
        const segDist = leg.pathDistances[i]
        const segFlag = leg.edgeFlags[i]
        const kindIdx = (segFlag >> 4) & 0x0F
        const street = graph.names[leg.edgeNames[i]] || currentStreet
        if (street && street !== 'Delhi Road') topStreetNames.add(street)

        let speedKmh = 20
        if (request.mode === 'driving') speedKmh = DRIVING_SPEEDS[kindIdx] || 20
        else if (request.mode === 'walking') speedKmh = kindIdx === 12 ? 2.0 : 4.5
        else if (request.mode === 'cycling') speedKmh = CYCLING_SPEEDS[kindIdx] || 15
        const segDuration = segDist / Math.max(0.5, (speedKmh * 1000) / 3600)

        stepAccumDist += segDist
        stepAccumDuration += segDuration

        // Check for road name change or significant bearing change (> 35°)
        const isNameChange = street !== currentStreet && stepAccumDist > 40
        let isTurn = false
        let turnInfo = { modifier: 'straight', instruction: 'Continue' }

        if (i >= 2 && i < leg.pathNodes.length - 1) {
          const pPrev = legCoords[i - 1]
          const pCurr = legCoords[i]
          const pNext = legCoords[i + 1]
          const b1 = calculateBearing(pPrev[0], pPrev[1], pCurr[0], pCurr[1])
          const b2 = calculateBearing(pCurr[0], pCurr[1], pNext[0], pNext[1])
          const delta = ((b2 - b1 + 540) % 360) - 180
          if (Math.abs(delta) >= 35 && stepAccumDist > 40) {
            isTurn = true
            turnInfo = getTurnModifier(delta)
          }
        }

        if (isNameChange || isTurn || i === leg.pathNodes.length - 1) {
          const instruction = isTurn
            ? `${turnInfo.instruction} onto ${street}`
            : (isNameChange ? `Continue onto ${street}` : `Follow ${currentStreet}`)

          allSteps.push({
            instruction,
            distanceMeters: Math.round(stepAccumDist),
            durationSeconds: Math.round(stepAccumDuration),
            type: isTurn ? 'turn' : 'continue',
            modifier: turnInfo.modifier,
            name: street,
            location: stepStartCoord,
          })

          currentStreet = street
          stepAccumDist = 0
          stepAccumDuration = 0
          stepStartCoord = legCoords[i]
        }
      }

      // Add coordinates (avoid duplicating boundary point between legs)
      if (allCoords.length > 0 && legCoords.length > 0) {
        allCoords.push(...legCoords.slice(1))
      } else {
        allCoords.push(...legCoords)
      }

      // Stop waypoint arrival instruction
      if (legIdx < snappedNodes.length - 2) {
        const wp = stops[legIdx + 1]
        allSteps.push({
          instruction: `Arrive at stop: ${wp.name || 'Waypoint'}`,
          distanceMeters: 0,
          durationSeconds: 0,
          type: 'arrive',
          modifier: 'straight',
          name: wp.name || 'Waypoint',
          location: legCoords[legCoords.length - 1],
        })
      }
    }

    // Final Arrival step
    allSteps.push({
      instruction: `Arrive at ${request.destination.name || 'Destination'}`,
      distanceMeters: 0,
      durationSeconds: 0,
      type: 'arrive',
      modifier: 'straight',
      name: request.destination.name || 'Destination',
      location: allCoords[allCoords.length - 1],
    })

    const topNamesArray = Array.from(topStreetNames).slice(0, 2)
    const summary = topNamesArray.length > 0
      ? `via ${topNamesArray.join(' and ')}`
      : 'via Delhi Road Network'

    const route: Route = {
      id: `offline-delhi-${Date.now()}`,
      summary,
      distanceMeters: Math.round(totalDistanceMeters),
      durationSeconds: Math.max(60, Math.round(totalDurationSeconds)),
      coordinates: allCoords,
      steps: allSteps,
      mode: request.mode,
      waypoints: request.waypoints,
    }

    return [route]
  }
}

let cachedOfflineRoutingProvider: OfflineDelhiRoutingProvider | null = null

export function getOfflineDelhiRoutingProvider(customResolver?: RoadGraphResolver): OfflineDelhiRoutingProvider {
  if (!cachedOfflineRoutingProvider) {
    cachedOfflineRoutingProvider = new OfflineDelhiRoutingProvider(customResolver)
  } else if (customResolver) {
    cachedOfflineRoutingProvider.setGraphResolver(customResolver)
  }
  return cachedOfflineRoutingProvider
}
