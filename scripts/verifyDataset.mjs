import fs from 'node:fs'
import path from 'node:path'

const graphPath = path.resolve('public/offline/delhi/delhi-routing-graph.bin')
const pmtilesPath = path.resolve('public/offline/delhi/NewDelhi.osm.pmtiles')
const placesPath = path.resolve('public/offline/delhi/places.json')

console.log('=== OpenAtlas Dataset Verification Script ===\n')

// 1. Graph File Sizing
const stat = fs.statSync(graphPath)
const fileSize = stat.size
const fileSizeMib = fileSize / (1024 * 1024)
console.log(`Graph file path: ${graphPath}`)
console.log(`Graph file size: ${fileSize} bytes (${fileSizeMib.toFixed(4)} MiB)`)

const buf = fs.readFileSync(graphPath)
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
const version = view.getUint16(4, true)
const nodeCount = view.getUint32(8, true)
const edgeCount = view.getUint32(12, true)
const namesCount = view.getUint32(16, true)
const namesByteLen = view.getUint32(20, true)
const headerMinLon = view.getFloat32(24, true)
const headerMinLat = view.getFloat32(28, true)
const headerMaxLon = view.getFloat32(32, true)
const headerMaxLat = view.getFloat32(36, true)
const headerTotalRoadMeters = Number(view.getBigUint64(40, true))

console.log(`Header Magic: '${magic}'`)
console.log(`Header Version: ${version}`)
console.log(`Header Node Count: ${nodeCount}`)
console.log(`Header Undirected Edge Count: ${edgeCount}`)
console.log(`Header Names Count: ${namesCount}`)
console.log(`Header Names Byte Length: ${namesByteLen}`)
console.log(`Header Bounds: [${headerMinLon.toFixed(4)}, ${headerMinLat.toFixed(4)}, ${headerMaxLon.toFixed(4)}, ${headerMaxLat.toFixed(4)}]`)
console.log(`Header Road Length: ${headerTotalRoadMeters} meters (${(headerTotalRoadMeters / 1000).toFixed(2)} km)`)

const mainMaskLen = Math.ceil(nodeCount / 8)
const expectedSize = 64 + nodeCount * 8 + mainMaskLen + edgeCount * 14 + namesByteLen
console.log(`Calculated layout expected size: ${expectedSize} bytes`)
console.log(`Header size matches file size: ${expectedSize === fileSize}`)

// 2. Node Table Verification
console.log('\n--- Verifying Node Coordinates ---')
const nodeOffset = 64
let minLon = Infinity, maxLon = -Infinity
let minLat = Infinity, maxLat = -Infinity
let invalidNodes = 0

for (let i = 0; i < nodeCount; i++) {
  const lonScaled = view.getInt32(nodeOffset + i * 8, true)
  const latScaled = view.getInt32(nodeOffset + i * 8 + 4, true)
  const lon = lonScaled / 100000
  const lat = latScaled / 100000
  if (isNaN(lon) || isNaN(lat)) {
    invalidNodes++
  }
  if (lon < minLon) minLon = lon
  if (lon > maxLon) maxLon = lon
  if (lat < minLat) minLat = lat
  if (lat > maxLat) maxLat = lat
}

console.log(`Actual Node Lon Extents: [${minLon.toFixed(5)}, ${maxLon.toFixed(5)}]`)
console.log(`Actual Node Lat Extents: [${minLat.toFixed(5)}, ${maxLat.toFixed(5)}]`)
console.log(`Invalid node coordinates: ${invalidNodes}`)

// 3. Edge Table Verification
console.log('\n--- Verifying Edge Table ---')
const edgeOffset = 64 + nodeCount * 8 + mainMaskLen

let minWeight = Infinity
let maxWeight = -Infinity
let totalWeight = 0
let invalidNodeRefs = 0
let selfLoops = 0
let malformedEdges = 0
let onewayCount = 0
let driveCount = 0
let walkCount = 0
let cycleCount = 0

// Highway kind distribution
const kindDistribution = {}

for (let i = 0; i < edgeCount; i++) {
  const pos = edgeOffset + i * 14
  const u = view.getUint32(pos, true)
  const v = view.getUint32(pos + 4, true)
  const dist = view.getUint16(pos + 8, true)
  const flags = view.getUint16(pos + 10, true)
  const nameIdx = view.getUint16(pos + 12, true)

  if (u >= nodeCount || v >= nodeCount) invalidNodeRefs++
  if (u === v) selfLoops++
  if (dist < minWeight) minWeight = dist
  if (dist > maxWeight) maxWeight = dist
  totalWeight += dist

  if (nameIdx >= namesCount) malformedEdges++

  const isOneway = (flags & (1 << 0)) !== 0
  const isDrive = (flags & (1 << 1)) !== 0
  const isWalk = (flags & (1 << 2)) !== 0
  const isCycle = (flags & (1 << 3)) !== 0
  const kind = (flags >> 4) & 0x0f

  if (isOneway) onewayCount++
  if (isDrive) driveCount++
  if (isWalk) walkCount++
  if (isCycle) cycleCount++

  kindDistribution[kind] = (kindDistribution[kind] || 0) + 1
}

const avgWeight = totalWeight / edgeCount
console.log(`Edge Weight Unit: meters`)
console.log(`Min Edge Weight: ${minWeight} m`)
console.log(`Max Edge Weight: ${maxWeight} m`)
console.log(`Sum of Edge Weights: ${totalWeight} m (${(totalWeight / 1000).toFixed(2)} km)`)
console.log(`Average Edge Weight: ${avgWeight.toFixed(2)} m`)
console.log(`Invalid Node References: ${invalidNodeRefs}`)
console.log(`Self Loops: ${selfLoops}`)
console.log(`Malformed Edges: ${malformedEdges}`)
console.log(`Oneway Edges (undirected table): ${onewayCount} (${((onewayCount / edgeCount) * 100).toFixed(2)}%)`)
console.log(`Drive-permitted Edges: ${driveCount} (${((driveCount / edgeCount) * 100).toFixed(2)}%)`)
console.log(`Walk-permitted Edges: ${walkCount} (${((walkCount / edgeCount) * 100).toFixed(2)}%)`)
console.log(`Cycle-permitted Edges: ${cycleCount} (${((cycleCount / edgeCount) * 100).toFixed(2)}%)`)

// 4. Directed Edge Counting (CSR in memory)
// In the CSR adjacency structure constructed at runtime:
// Every undirected record produces 2 directed edges (u->v and v->u).
// Thus total directed edges in CSR = edgeCount * 2.
// For driving: u->v has DRIVE flag if record has DRIVE.
// v->u has DRIVE flag only if record has DRIVE AND NOT ONEWAY.
let directedDriveEdges = 0
let directedWalkEdges = 0
let directedCycleEdges = 0
for (let i = 0; i < edgeCount; i++) {
  const pos = edgeOffset + i * 14
  const flags = view.getUint16(pos + 10, true)
  const isOneway = (flags & (1 << 0)) !== 0
  const isDrive = (flags & (1 << 1)) !== 0
  const isWalk = (flags & (1 << 2)) !== 0
  const isCycle = (flags & (1 << 3)) !== 0

  // Forward u->v
  if (isDrive) directedDriveEdges++
  if (isWalk) directedWalkEdges++
  if (isCycle) directedCycleEdges++

  // Backward v->u
  if (isDrive && !isOneway) directedDriveEdges++
  if (isWalk) directedWalkEdges++
  if (isCycle && !isOneway) directedCycleEdges++
}
console.log(`\nCSR Adjacency Total Directed Edges: ${edgeCount * 2}`)
console.log(`Directed Traversable Driving Edges: ${directedDriveEdges}`)
console.log(`Directed Traversable Walking Edges: ${directedWalkEdges}`)
console.log(`Directed Traversable Cycling Edges: ${directedCycleEdges}`)

// 5. Connected Component Analysis (Disjoint Set / Union Find)
console.log('\n--- Computing Connected Components ---')
const parent = new Int32Array(nodeCount)
for (let i = 0; i < nodeCount; i++) parent[i] = i

function findRoot(i) {
  let root = i
  while (root !== parent[root]) root = parent[root]
  let curr = i
  while (curr !== root) {
    const nxt = parent[curr]
    parent[curr] = root
    curr = nxt
  }
  return root
}

function unionNodes(i, j) {
  const rootI = findRoot(i)
  const rootJ = findRoot(j)
  if (rootI !== rootJ) parent[rootI] = rootJ
}

for (let i = 0; i < edgeCount; i++) {
  const pos = edgeOffset + i * 14
  const u = view.getUint32(pos, true)
  const v = view.getUint32(pos + 4, true)
  unionNodes(u, v)
}

const componentSizes = new Map()
for (let i = 0; i < nodeCount; i++) {
  const root = findRoot(i)
  componentSizes.set(root, (componentSizes.get(root) || 0) + 1)
}

const totalComponents = componentSizes.size
let largestComponentSize = 0
let componentsSize1 = 0
let componentsSizeGe100 = 0

for (const size of componentSizes.values()) {
  if (size > largestComponentSize) largestComponentSize = size
  if (size === 1) componentsSize1++
  if (size >= 100) componentsSizeGe100++
}

console.log(`Total Connected Components: ${totalComponents}`)
console.log(`Largest Component Size: ${largestComponentSize} nodes (${((largestComponentSize / nodeCount) * 100).toFixed(2)}%)`)
console.log(`Isolated Nodes (component size 1): ${componentsSize1}`)
console.log(`Components with size >= 100: ${componentsSizeGe100}`)

// 6. Map Archive & Places Index Verification
console.log('\n--- Verifying Map Archive and Place Index ---')
const pmtilesStat = fs.statSync(pmtilesPath)
console.log(`PMTiles file path: ${pmtilesPath}`)
console.log(`PMTiles file size: ${pmtilesStat.size} bytes (${(pmtilesStat.size / (1024 * 1024)).toFixed(4)} MiB)`)

const placesStat = fs.statSync(placesPath)
const placesData = JSON.parse(fs.readFileSync(placesPath, 'utf8'))
console.log(`Places file path: ${placesPath}`)
console.log(`Places file size: ${placesStat.size} bytes (${(placesStat.size / 1024).toFixed(2)} KiB)`)
console.log(`Indexed Places Count: ${placesData.length}`)
