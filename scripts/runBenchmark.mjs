import fs from 'node:fs'
import path from 'node:path'
import {
  dijkstraShortestPath,
  aStarShortestPath,
  bidirectionalAStarShortestPath,
} from '../src/services/routing/dijkstra.js'
import { OfflineDelhiRoadGraph } from '../src/services/routing/offlineDelhiRouting.js'

// Load graph
const graphPath = path.resolve('public/offline/delhi/delhi-routing-graph.bin')
console.log(`[Benchmark] Loading graph from ${graphPath}...`)
const tLoad0 = performance.now()
const graphBuffer = fs.readFileSync(graphPath)
const graphInstance = new OfflineDelhiRoadGraph(graphBuffer.buffer.slice(graphBuffer.byteOffset, graphBuffer.byteOffset + graphBuffer.byteLength))
const tLoad = (performance.now() - tLoad0).toFixed(1)
console.log(`[Benchmark] Graph loaded in ${tLoad}ms. Nodes: ${graphInstance.nodeCount}, Edges: ${graphInstance.edgeCount}`)

const graphCSR = {
  nodeCount: graphInstance.nodeCount,
  offsets: graphInstance.offsets,
  targets: graphInstance.targets,
  weights: graphInstance.weights,
  edgeFlags: graphInstance.edgeFlags,
  nodeCoords: graphInstance.nodeCoords,
}

// Landmark coordinates for test OD pairs
const LANDMARKS = [
  // Short routes (< 3 km)
  { id: 'OD01_SHORT', name: 'Connaught Place -> New Delhi Railway Stn', o: [77.2195, 28.6315], d: [77.2215, 28.6425], mode: 'driving', category: 'short' },
  { id: 'OD02_SHORT', name: 'India Gate -> National Museum', o: [77.2295, 28.6129], d: [77.2193, 28.6118], mode: 'driving', category: 'short' },
  { id: 'OD03_SHORT', name: 'Red Fort -> Jama Masjid', o: [77.2410, 28.6562], d: [77.2334, 28.6507], mode: 'walking', category: 'short' },
  { id: 'OD04_SHORT', name: 'Karol Bagh Market -> Rajendra Place', o: [77.1906, 28.6517], d: [77.1783, 28.6433], mode: 'driving', category: 'short' },

  // Medium routes (3 - 10 km)
  { id: 'OD05_MED', name: 'Connaught Place -> India Gate', o: [77.2195, 28.6315], d: [77.2295, 28.6129], mode: 'driving', category: 'medium' },
  { id: 'OD06_MED', name: 'Red Fort -> Connaught Place', o: [77.2410, 28.6562], d: [77.2195, 28.6315], mode: 'driving', category: 'medium' },
  { id: 'OD07_MED', name: 'India Gate -> Humayun\'s Tomb', o: [77.2295, 28.6129], d: [77.2435, 28.5878], mode: 'driving', category: 'medium' },
  { id: 'OD08_MED', name: 'Hauz Khas Village -> AIIMS New Delhi', o: [77.1947, 28.5535], d: [77.2090, 28.5672], mode: 'driving', category: 'medium' },
  { id: 'OD09_MED', name: 'Lotus Temple -> Lajpat Nagar', o: [77.2588, 28.5535], d: [77.2410, 28.5700], mode: 'cycling', category: 'medium' },

  // Long routes (> 10 km)
  { id: 'OD10_LONG', name: 'Connaught Place -> Rohini Sector 10', o: [77.2195, 28.6315], d: [77.1130, 28.7112], mode: 'driving', category: 'long' },
  { id: 'OD11_LONG', name: 'Red Fort -> Qutub Minar', o: [77.2410, 28.6562], d: [77.1855, 28.5244], mode: 'driving', category: 'long' },
  { id: 'OD12_LONG', name: 'Delhi Cantt -> Mayur Vihar Phase 1', o: [77.1233, 28.5984], d: [77.2940, 28.6080], mode: 'driving', category: 'long' },
  { id: 'OD13_LONG', name: 'Najafgarh -> Connaught Place', o: [76.9819, 28.6129], d: [77.2195, 28.6315], mode: 'driving', category: 'long' },
  { id: 'OD14_LONG', name: 'Dwarka Sector 21 -> Akshardham', o: [77.0580, 28.5520], d: [77.2773, 28.6127], mode: 'driving', category: 'long' },
]

// Identify a disconnected node for unreachable test case
let disconnectedNode = -1
for (let i = 0; i < graphCSR.nodeCount; i++) {
  if (!(graphInstance.mainMask[i >> 3] & (1 << (i & 7)))) {
    disconnectedNode = i
    break
  }
}
console.log(`[Benchmark] Disconnected component node ID identified: ${disconnectedNode}`)

const SPECIAL_CASES = [
  { id: 'SC01_UNREACHABLE', name: 'Disconnected Node -> Connaught Place', startNode: disconnectedNode, targetNode: -1, mode: 'driving', category: 'unreachable' },
  { id: 'SC02_INVALID_START', name: 'Negative Start Node (-1)', startNode: -1, targetNode: 100, mode: 'driving', category: 'invalid' },
  { id: 'SC03_INVALID_TARGET', name: 'Out-of-Bounds Target Node (9999999)', startNode: 100, targetNode: 9999999, mode: 'driving', category: 'invalid' },
  { id: 'SC04_IDENTICAL_NODES', name: 'Start equals Destination', startNode: 1000, targetNode: 1000, mode: 'driving', category: 'trivial' },
]

// Prepare OD test cases with snapped node IDs
const TEST_CASES = []
for (const lm of LANDMARKS) {
  const snapO = graphInstance.snap(lm.o[0], lm.o[1], lm.mode)
  const snapD = graphInstance.snap(lm.d[0], lm.d[1], lm.mode)
  TEST_CASES.push({
    id: lm.id,
    name: lm.name,
    category: lm.category,
    mode: lm.mode,
    startNode: snapO.nodeId,
    targetNode: snapD.nodeId,
    originCoords: lm.o,
    destCoords: lm.d,
    snapDistOrigin: snapO.distMeters,
    snapDistDest: snapD.distMeters,
  })
}

// Special case 1 target snapped to CP
const cpSnap = graphInstance.snap(77.2195, 28.6315, 'driving')
SPECIAL_CASES[0].targetNode = cpSnap.nodeId
SPECIAL_CASES[0].originCoords = [0, 0]
SPECIAL_CASES[0].destCoords = [77.2195, 28.6315]

const ALL_CASES = [...TEST_CASES, ...SPECIAL_CASES]

// Verification helper: check that every edge in path is physically present and matching in CSR
function verifyPathConnectivity(graph, pathNodes, modeFlag) {
  if (!pathNodes || pathNodes.length <= 1) return { valid: true, computedDist: 0 }
  let sumDist = 0
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const u = pathNodes[i]
    const v = pathNodes[i + 1]
    let edgeFound = false
    let edgeDist = 0

    const start = graph.offsets[u]
    const end = graph.offsets[u + 1]
    for (let j = start; j < end; j++) {
      if (graph.targets[j] === v && (graph.edgeFlags[j] & modeFlag)) {
        edgeFound = true
        edgeDist = graph.weights[j]
        break
      }
    }
    if (!edgeFound) {
      return { valid: false, error: `Invalid transition from node ${u} to ${v} (no traversable edge)` }
    }
    sumDist += edgeDist
  }
  return { valid: true, computedDist: sumDist }
}

const REPETITIONS = 10
const rawRuns = []

console.log(`\n=== Running Controlled Benchmark (${REPETITIONS} repetitions per test case) ===\n`)

const ALGORITHMS = [
  { name: 'Dijkstra', fn: dijkstraShortestPath },
  { name: 'A_Star_Uni', fn: aStarShortestPath },
  { name: 'A_Star_Bi', fn: bidirectionalAStarShortestPath },
]

for (const tc of ALL_CASES) {
  console.log(`Evaluating ${tc.id}: ${tc.name} (mode: ${tc.mode}, start: ${tc.startNode}, target: ${tc.targetNode})...`)
  const modeFlag = tc.mode === 'driving' ? (1 << 1) : (tc.mode === 'walking' ? (1 << 2) : (1 << 3))

  for (const algo of ALGORITHMS) {
    // Warm-up run (not recorded)
    try {
      algo.fn(graphCSR, tc.startNode, tc.targetNode, tc.mode)
    } catch {
      // Ignored for invalid/unreachable test cases
    }

    // Measured repetitions
    for (let rep = 1; rep <= REPETITIONS; rep++) {
      const memBefore = process.memoryUsage().heapUsed
      const t0 = performance.now()
      let res
      let errStr = ''
      try {
        res = algo.fn(graphCSR, tc.startNode, tc.targetNode, tc.mode)
      } catch (e) {
        res = {
          found: false,
          pathNodes: [],
          totalCostMeters: Infinity,
          expandedVertices: 0,
          relaxedEdges: 0,
          edgesEvaluated: 0,
          executionTimeMs: performance.now() - t0,
          error: e.message,
        }
        errStr = e.message
      }
      const t1 = performance.now()
      const memAfter = process.memoryUsage().heapUsed
      const measuredTimeMs = t1 - t0
      const heapDeltaBytes = Math.max(0, memAfter - memBefore)

      if (res.error) errStr = res.error

      // Verify path connectivity if found
      let pathValid = true
      let pathVerificationError = ''
      if (res.found && res.pathNodes.length > 1) {
        const v = verifyPathConnectivity(graphCSR, res.pathNodes, modeFlag)
        pathValid = v.valid
        if (!v.valid) {
          pathVerificationError = v.error
        }
      }

      rawRuns.push({
        testCaseId: tc.id,
        testCaseName: tc.name,
        category: tc.category,
        mode: tc.mode,
        algorithm: algo.name,
        repetition: rep,
        sourceNode: tc.startNode,
        destNode: tc.targetNode,
        routeFound: res.found,
        totalCostMeters: res.found ? res.totalCostMeters : -1,
        pathLengthNodes: res.pathNodes ? res.pathNodes.length : 0,
        executionTimeMs: Number(measuredTimeMs.toFixed(3)),
        expandedVertices: res.expandedVertices,
        relaxedEdges: res.relaxedEdges,
        edgesEvaluated: res.edgesEvaluated,
        heapDeltaBytes,
        pathValid,
        error: errStr || pathVerificationError,
      })
    }
  }
}

// Write raw runs CSV
const rawCsvHeader = [
  'testCaseId',
  'testCaseName',
  'category',
  'mode',
  'algorithm',
  'repetition',
  'sourceNode',
  'destNode',
  'routeFound',
  'totalCostMeters',
  'pathLengthNodes',
  'executionTimeMs',
  'expandedVertices',
  'relaxedEdges',
  'edgesEvaluated',
  'heapDeltaBytes',
  'pathValid',
  'error',
].join(',')

const rawCsvLines = rawRuns.map(r => [
  r.testCaseId,
  `"${r.testCaseName}"`,
  r.category,
  r.mode,
  r.algorithm,
  r.repetition,
  r.sourceNode,
  r.destNode,
  r.routeFound,
  r.totalCostMeters,
  r.pathLengthNodes,
  r.executionTimeMs,
  r.expandedVertices,
  r.relaxedEdges,
  r.edgesEvaluated,
  r.heapDeltaBytes,
  r.pathValid,
  `"${r.error.replace(/"/g, '""')}"`,
].join(','))

fs.writeFileSync('benchmark_runs_raw.csv', [rawCsvHeader, ...rawCsvLines].join('\n'))
console.log(`\n[Benchmark] Wrote ${rawRuns.length} raw benchmark executions to benchmark_runs_raw.csv`)

// Helper functions for statistics
function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function quantile(values, q) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

function iqr(values) {
  return quantile(values, 0.75) - quantile(values, 0.25)
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / (values.length || 1)
}

function stddev(values) {
  const m = mean(values)
  const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length || 1)
  return Math.sqrt(variance)
}

// Compute Aggregated Summary
const summaryRows = []

for (const tc of ALL_CASES) {
  for (const algo of ALGORITHMS) {
    const runs = rawRuns.filter(r => r.testCaseId === tc.id && r.algorithm === algo.name)
    const times = runs.map(r => r.executionTimeMs)
    const expansions = runs.map(r => r.expandedVertices)
    const relaxations = runs.map(r => r.relaxedEdges)
    const heaps = runs.map(r => r.heapDeltaBytes)
    const costs = runs.map(r => r.totalCostMeters)

    summaryRows.push({
      testCaseId: tc.id,
      testCaseName: tc.name,
      category: tc.category,
      mode: tc.mode,
      algorithm: algo.name,
      runsCount: runs.length,
      routeFound: runs[0].routeFound,
      totalCostMeters: runs[0].totalCostMeters,
      pathLengthNodes: runs[0].pathLengthNodes,
      timeMedianMs: Number(median(times).toFixed(2)),
      timeIQRMs: Number(iqr(times).toFixed(2)),
      timeMeanMs: Number(mean(times).toFixed(2)),
      timeStdDevMs: Number(stddev(times).toFixed(2)),
      timeMinMs: Number(Math.min(...times).toFixed(2)),
      timeMaxMs: Number(Math.max(...times).toFixed(2)),
      expandedVerticesMedian: median(expansions),
      relaxedEdgesMedian: median(relaxations),
      heapDeltaMedianBytes: median(heaps),
      pathValid: runs.every(r => r.pathValid),
      error: runs[0].error,
    })
  }
}

const summaryCsvHeader = [
  'testCaseId',
  'testCaseName',
  'category',
  'mode',
  'algorithm',
  'runsCount',
  'routeFound',
  'totalCostMeters',
  'pathLengthNodes',
  'timeMedianMs',
  'timeIQRMs',
  'timeMeanMs',
  'timeStdDevMs',
  'timeMinMs',
  'timeMaxMs',
  'expandedVerticesMedian',
  'relaxedEdgesMedian',
  'heapDeltaMedianBytes',
  'pathValid',
  'error',
].join(',')

const summaryCsvLines = summaryRows.map(r => [
  r.testCaseId,
  `"${r.testCaseName}"`,
  r.category,
  r.mode,
  r.algorithm,
  r.runsCount,
  r.routeFound,
  r.totalCostMeters,
  r.pathLengthNodes,
  r.timeMedianMs,
  r.timeIQRMs,
  r.timeMeanMs,
  r.timeStdDevMs,
  r.timeMinMs,
  r.timeMaxMs,
  r.expandedVerticesMedian,
  r.relaxedEdgesMedian,
  r.heapDeltaMedianBytes,
  r.pathValid,
  `"${r.error.replace(/"/g, '""')}"`,
].join(','))

fs.writeFileSync('benchmark_summary.csv', [summaryCsvHeader, ...summaryCsvLines].join('\n'))
console.log(`[Benchmark] Wrote ${summaryRows.length} summary metrics to benchmark_summary.csv`)

console.log('\n=== Benchmark Execution Complete ===\n')
