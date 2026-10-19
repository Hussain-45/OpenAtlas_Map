/**
 * OpenAtlas — Experimental Research Routing Algorithms Module
 * 
 * Implements isolated Dijkstra's Algorithm, Instrumented A* (Unidirectional),
 * and Bidirectional A* for experimental evaluation against the OpenAtlas
 * offline road network dataset.
 * 
 * Safety & Isolation:
 * - Does not modify or replace the production OfflineDelhiRoadGraph engine.
 * - Operates directly on the same CSR data structures, node coordinates,
 *   and mode access bitmasks.
 */

import type { TravelMode } from './types'

export const FLAG_ONEWAY = 1 << 0
export const FLAG_DRIVE  = 1 << 1
export const FLAG_WALK   = 1 << 2
export const FLAG_CYCLE  = 1 << 3

export interface HeapItem {
  id: number
  dist: number
  priority: number
}

export class FastMinHeap {
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

  clear(): void {
    this.data = []
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

export function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export interface RoutingSearchResult {
  found: boolean
  pathNodes: number[]
  totalCostMeters: number
  expandedVertices: number
  relaxedEdges: number
  edgesEvaluated: number
  executionTimeMs: number
  error?: string
}

export interface GraphCSRView {
  nodeCount: number
  offsets: Uint32Array
  targets: Uint32Array
  weights: Uint16Array
  edgeFlags: Uint16Array
  nodeCoords: Int32Array
}

export function getModeFlag(mode: TravelMode): number {
  if (mode === 'driving') return FLAG_DRIVE
  if (mode === 'walking') return FLAG_WALK
  if (mode === 'cycling') return FLAG_CYCLE
  throw new Error(`Unsupported travel mode: ${mode}`)
}

/**
 * Dijkstra's Shortest Path Algorithm
 * 
 * Properties:
 * - Uses priority = dist (heuristic = 0).
 * - Exact non-negative distance model matching OpenAtlas CSR representation.
 * - Respects directed one-way restrictions and travel modes.
 * - Handles stale heap entries: if curr.dist > distMap[curr.id] continue.
 * - Tracks expanded vertices (popped & evaluated) and relaxed edges (dist updated).
 */
export function dijkstraShortestPath(
  graph: GraphCSRView,
  startNode: number,
  targetNode: number,
  mode: TravelMode
): RoutingSearchResult {
  const t0 = performance.now()

  // 1. Validate inputs
  if (startNode < 0 || startNode >= graph.nodeCount) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
      error: `Invalid start node ID: ${startNode} (out of bounds [0, ${graph.nodeCount - 1}])`,
    }
  }

  if (targetNode < 0 || targetNode >= graph.nodeCount) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
      error: `Invalid target node ID: ${targetNode} (out of bounds [0, ${graph.nodeCount - 1}])`,
    }
  }

  if (startNode === targetNode) {
    return {
      found: true,
      pathNodes: [startNode],
      totalCostMeters: 0,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
    }
  }

  const modeFlag = getModeFlag(mode)
  const distMap = new Float64Array(graph.nodeCount).fill(Infinity)
  const parentNode = new Int32Array(graph.nodeCount).fill(-1)
  const heap = new FastMinHeap()

  let expandedVertices = 0
  let relaxedEdges = 0
  let edgesEvaluated = 0

  distMap[startNode] = 0
  heap.push({ id: startNode, dist: 0, priority: 0 })

  let found = false

  while (heap.size > 0) {
    const curr = heap.pop()
    if (!curr) break

    // Stale heap entry filter
    if (curr.dist > distMap[curr.id]) continue

    if (curr.id === targetNode) {
      found = true
      break
    }

    expandedVertices++

    const start = graph.offsets[curr.id]
    const end = graph.offsets[curr.id + 1]

    for (let j = start; j < end; j++) {
      const flag = graph.edgeFlags[j]
      if (!(flag & modeFlag)) continue

      edgesEvaluated++
      const nextId = graph.targets[j]
      const edgeDist = graph.weights[j]

      if (edgeDist < 0) {
        throw new Error(`Negative edge weight encountered: ${edgeDist}`)
      }

      const newDist = curr.dist + edgeDist

      if (newDist < distMap[nextId]) {
        distMap[nextId] = newDist
        parentNode[nextId] = curr.id
        relaxedEdges++
        heap.push({ id: nextId, dist: newDist, priority: newDist })
      }
    }
  }

  const execTime = performance.now() - t0

  if (!found) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices,
      relaxedEdges,
      edgesEvaluated,
      executionTimeMs: execTime,
      error: `No path exists from node ${startNode} to node ${targetNode} for mode ${mode}`,
    }
  }

  // Reconstruct path
  const path: number[] = []
  let curr = targetNode
  while (curr !== -1) {
    path.push(curr)
    curr = parentNode[curr]
  }
  path.reverse()

  return {
    found: true,
    pathNodes: path,
    totalCostMeters: distMap[targetNode],
    expandedVertices,
    relaxedEdges,
    edgesEvaluated,
    executionTimeMs: execTime,
  }
}

/**
 * Instrumented Unidirectional A* Shortest Path Algorithm
 * 
 * Exact mirror of production OfflineDelhiRoadGraph.findRouteLeg,
 * but returns detailed search metrics (expanded vertices, relaxed edges,
 * execution time) under identical counting rules.
 */
export function aStarShortestPath(
  graph: GraphCSRView,
  startNode: number,
  targetNode: number,
  mode: TravelMode
): RoutingSearchResult {
  const t0 = performance.now()

  // 1. Validate inputs
  if (startNode < 0 || startNode >= graph.nodeCount) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
      error: `Invalid start node ID: ${startNode} (out of bounds [0, ${graph.nodeCount - 1}])`,
    }
  }

  if (targetNode < 0 || targetNode >= graph.nodeCount) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
      error: `Invalid target node ID: ${targetNode} (out of bounds [0, ${graph.nodeCount - 1}])`,
    }
  }

  if (startNode === targetNode) {
    return {
      found: true,
      pathNodes: [startNode],
      totalCostMeters: 0,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
    }
  }

  const modeFlag = getModeFlag(mode)
  const targetLon = graph.nodeCoords[targetNode * 2] / 100000
  const targetLat = graph.nodeCoords[targetNode * 2 + 1] / 100000

  const distMap = new Float64Array(graph.nodeCount).fill(Infinity)
  const parentNode = new Int32Array(graph.nodeCount).fill(-1)
  const heap = new FastMinHeap()

  let expandedVertices = 0
  let relaxedEdges = 0
  let edgesEvaluated = 0

  distMap[startNode] = 0
  const startH = haversineMeters(
    graph.nodeCoords[startNode * 2] / 100000,
    graph.nodeCoords[startNode * 2 + 1] / 100000,
    targetLon,
    targetLat
  )
  heap.push({ id: startNode, dist: 0, priority: startH })

  let found = false

  while (heap.size > 0) {
    const curr = heap.pop()
    if (!curr) break

    // Stale heap entry filter
    if (curr.dist > distMap[curr.id]) continue

    if (curr.id === targetNode) {
      found = true
      break
    }

    expandedVertices++

    const start = graph.offsets[curr.id]
    const end = graph.offsets[curr.id + 1]

    for (let j = start; j < end; j++) {
      const flag = graph.edgeFlags[j]
      if (!(flag & modeFlag)) continue

      edgesEvaluated++
      const nextId = graph.targets[j]
      const edgeDist = graph.weights[j]

      if (edgeDist < 0) {
        throw new Error(`Negative edge weight encountered: ${edgeDist}`)
      }

      const newDist = curr.dist + edgeDist

      if (newDist < distMap[nextId]) {
        distMap[nextId] = newDist
        parentNode[nextId] = curr.id
        relaxedEdges++

        const nLon = graph.nodeCoords[nextId * 2] / 100000
        const nLat = graph.nodeCoords[nextId * 2 + 1] / 100000
        const h = haversineMeters(nLon, nLat, targetLon, targetLat)
        heap.push({ id: nextId, dist: newDist, priority: newDist + h })
      }
    }
  }

  const execTime = performance.now() - t0

  if (!found) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices,
      relaxedEdges,
      edgesEvaluated,
      executionTimeMs: execTime,
      error: `No path exists from node ${startNode} to node ${targetNode} for mode ${mode}`,
    }
  }

  // Reconstruct path
  const path: number[] = []
  let curr = targetNode
  while (curr !== -1) {
    path.push(curr)
    curr = parentNode[curr]
  }
  path.reverse()

  return {
    found: true,
    pathNodes: path,
    totalCostMeters: distMap[targetNode],
    expandedVertices,
    relaxedEdges,
    edgesEvaluated,
    executionTimeMs: execTime,
  }
}

export interface ReverseGraphCSRView {
  revOffsets: Uint32Array
  revTargets: Uint32Array
  revWeights: Uint16Array
  revEdgeFlags: Uint16Array
}

let cachedReverseGraph: ReverseGraphCSRView | null = null
let cachedForGraph: GraphCSRView | null = null

export function getOrBuildReverseCSR(graph: GraphCSRView): ReverseGraphCSRView {
  if (cachedReverseGraph && cachedForGraph === graph) {
    return cachedReverseGraph
  }

  const nodeCount = graph.nodeCount
  const totalEdges = graph.offsets[nodeCount]
  const inDeg = new Uint32Array(nodeCount)

  for (let e = 0; e < totalEdges; e++) {
    const v = graph.targets[e]
    inDeg[v]++
  }

  const revOffsets = new Uint32Array(nodeCount + 1)
  for (let i = 0; i < nodeCount; i++) {
    revOffsets[i + 1] = revOffsets[i] + inDeg[i]
  }

  const revTargets = new Uint32Array(totalEdges)
  const revWeights = new Uint16Array(totalEdges)
  const revEdgeFlags = new Uint16Array(totalEdges)
  const cur = new Uint32Array(revOffsets)

  for (let u = 0; u < nodeCount; u++) {
    const start = graph.offsets[u]
    const end = graph.offsets[u + 1]
    for (let e = start; e < end; e++) {
      const v = graph.targets[e]
      const p = cur[v]++
      revTargets[p] = u
      revWeights[p] = graph.weights[e]
      revEdgeFlags[p] = graph.edgeFlags[e]
    }
  }

  cachedReverseGraph = { revOffsets, revTargets, revWeights, revEdgeFlags }
  cachedForGraph = graph
  return cachedReverseGraph
}

/**
 * Bidirectional A* Shortest Path Algorithm
 * 
 * Uses symmetric forward and backward searches with consistent potential function:
 * p_F(u) = 0.5 * (h(u, target) - h(start, u))
 * p_B(u) = 0.5 * (h(start, u) - h(u, target)) = -p_F(u)
 * Reduced cost for edge (u -> v):
 * c_F'(u, v) = c(u, v) - p_F(u) + p_F(v) >= 0 (consistent)
 * c_B'(v, u) = c(u, v) - p_B(v) + p_B(u) = c_F'(u, v) >= 0 (symmetric)
 */
export function bidirectionalAStarShortestPath(
  graph: GraphCSRView,
  startNode: number,
  targetNode: number,
  mode: TravelMode
): RoutingSearchResult {
  const t0 = performance.now()

  // 1. Validate inputs
  if (startNode < 0 || startNode >= graph.nodeCount) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
      error: `Invalid start node ID: ${startNode} (out of bounds [0, ${graph.nodeCount - 1}])`,
    }
  }

  if (targetNode < 0 || targetNode >= graph.nodeCount) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
      error: `Invalid target node ID: ${targetNode} (out of bounds [0, ${graph.nodeCount - 1}])`,
    }
  }

  if (startNode === targetNode) {
    return {
      found: true,
      pathNodes: [startNode],
      totalCostMeters: 0,
      expandedVertices: 0,
      relaxedEdges: 0,
      edgesEvaluated: 0,
      executionTimeMs: performance.now() - t0,
    }
  }

  const modeFlag = getModeFlag(mode)
  const revGraph = getOrBuildReverseCSR(graph)

  const startLon = graph.nodeCoords[startNode * 2] / 100000
  const startLat = graph.nodeCoords[startNode * 2 + 1] / 100000
  const targetLon = graph.nodeCoords[targetNode * 2] / 100000
  const targetLat = graph.nodeCoords[targetNode * 2 + 1] / 100000

  // Potential function: p(u) = 0.5 * (dist(u, target) - dist(start, u))
  function potential(u: number): number {
    const uLon = graph.nodeCoords[u * 2] / 100000
    const uLat = graph.nodeCoords[u * 2 + 1] / 100000
    const hT = haversineMeters(uLon, uLat, targetLon, targetLat)
    const hS = haversineMeters(startLon, startLat, uLon, uLat)
    return 0.5 * (hT - hS)
  }

  const pStart = potential(startNode)

  const distF = new Float64Array(graph.nodeCount).fill(Infinity)
  const parentF = new Int32Array(graph.nodeCount).fill(-1)
  const heapF = new FastMinHeap()

  const distB = new Float64Array(graph.nodeCount).fill(Infinity)
  const parentB = new Int32Array(graph.nodeCount).fill(-1)
  const heapB = new FastMinHeap()

  let expandedVertices = 0
  let relaxedEdges = 0
  let edgesEvaluated = 0

  distF[startNode] = 0
  heapF.push({ id: startNode, dist: 0, priority: potential(startNode) - pStart })

  distB[targetNode] = 0
  heapB.push({ id: targetNode, dist: 0, priority: -potential(targetNode) + pStart })

  let mu = Infinity
  let bestU = -1
  let bestV = -1

  while (heapF.size > 0 && heapB.size > 0) {
    // Check if termination condition reached
    const topF = heapF.pop()
    if (!topF) break
    if (topF.dist > distF[topF.id]) continue

    if (topF.priority >= mu) {
      break
    }

    const u = topF.id
    expandedVertices++

    // Expand forward edges from u
    const fStart = graph.offsets[u]
    const fEnd = graph.offsets[u + 1]
    for (let j = fStart; j < fEnd; j++) {
      const flag = graph.edgeFlags[j]
      if (!(flag & modeFlag)) continue

      edgesEvaluated++
      const v = graph.targets[j]
      const w = graph.weights[j]
      const newDistF = topF.dist + w

      if (newDistF < distF[v]) {
        distF[v] = newDistF
        parentF[v] = u
        relaxedEdges++

        const prioF = newDistF + potential(v) - pStart
        heapF.push({ id: v, dist: newDistF, priority: prioF })
      }

      // Check if connecting edge
      if (distB[v] < Infinity) {
        const total = topF.dist + w + distB[v]
        if (total < mu) {
          mu = total
          bestU = u
          bestV = v
        }
      }
    }

    // Expand backward search
    const topB = heapB.pop()
    if (!topB) break
    if (topB.dist > distB[topB.id]) continue

    if (topB.priority >= mu) {
      break
    }

    const vB = topB.id
    expandedVertices++

    // Incoming edges into vB: in revGraph, edges from vB go to predecessor uB
    const bStart = revGraph.revOffsets[vB]
    const bEnd = revGraph.revOffsets[vB + 1]
    for (let j = bStart; j < bEnd; j++) {
      const flag = revGraph.revEdgeFlags[j]
      if (!(flag & modeFlag)) continue

      edgesEvaluated++
      const uB = revGraph.revTargets[j]
      const w = revGraph.revWeights[j]
      const newDistB = topB.dist + w

      if (newDistB < distB[uB]) {
        distB[uB] = newDistB
        parentB[uB] = vB
        relaxedEdges++

        const prioB = newDistB - potential(uB) + pStart
        heapB.push({ id: uB, dist: newDistB, priority: prioB })
      }

      // Check if connecting edge
      if (distF[uB] < Infinity) {
        const total = distF[uB] + w + topB.dist
        if (total < mu) {
          mu = total
          bestU = uB
          bestV = vB
        }
      }
    }
  }

  const execTime = performance.now() - t0

  if (!isFinite(mu) || bestU === -1) {
    return {
      found: false,
      pathNodes: [],
      totalCostMeters: Infinity,
      expandedVertices,
      relaxedEdges,
      edgesEvaluated,
      executionTimeMs: execTime,
      error: `No path exists from node ${startNode} to node ${targetNode} for mode ${mode}`,
    }
  }

  // Path reconstruction: start -> ... -> bestU -> bestV -> ... -> target
  const forwardPath: number[] = []
  let cF = bestU
  while (cF !== -1) {
    forwardPath.push(cF)
    cF = parentF[cF]
  }
  forwardPath.reverse()

  const backwardPath: number[] = []
  let cB = bestV
  while (cB !== -1) {
    backwardPath.push(cB)
    cB = parentB[cB]
  }

  const fullPath = [...forwardPath, ...backwardPath]

  return {
    found: true,
    pathNodes: fullPath,
    totalCostMeters: mu,
    expandedVertices,
    relaxedEdges,
    edgesEvaluated,
    executionTimeMs: execTime,
  }
}
