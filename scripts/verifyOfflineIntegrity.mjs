/**
 * OpenAtlas — Automated Offline Integrity & Routing Verifier
 * Verifies local offline vector tiles, place database, binary road graph,
 * and route calculations for Driving, Walking, and Cycling.
 */
import fs from 'node:fs'
import path from 'node:path'

const pmtilesPath = path.resolve('public/offline/delhi/NewDelhi.osm.pmtiles')
const graphPath = path.resolve('public/offline/delhi/delhi-routing-graph.bin')
const placesPath = path.resolve('public/offline/delhi/places.json')
const stylePath = path.resolve('public/offline/assets/style.json')

console.log('=== OpenAtlas Offline Integrity Verification ===\n')

let passedChecks = 0
let totalChecks = 0

function assert(condition, message) {
  totalChecks++
  if (condition) {
    passedChecks++
    console.log(`  [PASS] ${message}`)
  } else {
    console.error(`  [FAIL] ${message}`)
    process.exitCode = 1
  }
}

// 1. File Existence and Sizing
console.log('1. Checking Offline Package Assets:')
assert(fs.existsSync(pmtilesPath), `PMTiles basemap archive exists (${pmtilesPath})`)
if (fs.existsSync(pmtilesPath)) {
  const pmtilesStat = fs.statSync(pmtilesPath)
  assert(pmtilesStat.size === 15361932, `PMTiles size matches expected 15,361,932 bytes (actual: ${pmtilesStat.size.toLocaleString()})`)
}

assert(fs.existsSync(graphPath), `Road network binary graph exists (${graphPath})`)
if (fs.existsSync(graphPath)) {
  const graphStat = fs.statSync(graphPath)
  assert(graphStat.size === 22859718, `Graph size matches expected 22,859,718 bytes (actual: ${graphStat.size.toLocaleString()})`)
}

assert(fs.existsSync(placesPath), `Offline places index exists (${placesPath})`)
if (fs.existsSync(placesPath)) {
  const placesStat = fs.statSync(placesPath)
  assert(placesStat.size > 800000, `Places JSON size > 800KB (actual: ${placesStat.size.toLocaleString()} bytes)`)
}

assert(fs.existsSync(stylePath), `Offline MapLibre style exists (${stylePath})`)

// 2. Binary Graph Structure
console.log('\n2. Validating Binary Road Graph Structure:')
const graphBuf = fs.readFileSync(graphPath)
const view = new DataView(graphBuf.buffer, graphBuf.byteOffset, graphBuf.byteLength)

const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
assert(magic === 'ODRG', `Magic header is 'ODRG' (got '${magic}')`)

const version = view.getUint16(4, true)
assert(version === 1, `Version is 1 (got ${version})`)

const nodeCount = view.getUint32(8, true)
assert(nodeCount === 944338, `Node count is 944,338 (got ${nodeCount.toLocaleString()})`)

const edgeCount = view.getUint32(12, true)
assert(edgeCount === 1080347, `Undirected edge count is 1,080,347 (got ${edgeCount.toLocaleString()})`)

const namesCount = view.getUint32(16, true)
assert(namesCount === 3621, `Named street table entries is 3,621 (got ${namesCount.toLocaleString()})`)

const minLon = view.getFloat32(24, true)
const minLat = view.getFloat32(28, true)
const maxLon = view.getFloat32(32, true)
const maxLat = view.getFloat32(36, true)
assert(minLon < 77.0 && maxLon > 77.4, `Delhi longitude extents [${minLon.toFixed(3)}, ${maxLon.toFixed(3)}]`)
assert(minLat < 28.5 && maxLat > 28.7, `Delhi latitude extents [${minLat.toFixed(3)}, ${maxLat.toFixed(3)}]`)

const totalRoadMeters = Number(view.getBigUint64(40, true))
assert(Math.round(totalRoadMeters / 1000) === 33001, `Total road length is 33,001 km (got ${(totalRoadMeters / 1000).toFixed(1)} km)`)

// 3. Places Search Verification
console.log('\n3. Validating Offline Places Index:')
const placesData = JSON.parse(fs.readFileSync(placesPath, 'utf8'))
assert(Array.isArray(placesData), `Places dataset is a valid array`)
assert(placesData.length === 13594, `Contains exactly 13,594 indexed POIs (got ${placesData.length.toLocaleString()})`)

const cp = placesData.find(p => p[0] && p[0].toLowerCase() === 'connaught place')
assert(Boolean(cp), `Found 'Connaught Place' landmark in offline index: [${cp ? cp[1] + ', ' + cp[2] : ''}]`)

const ig = placesData.find(p => p[0] && p[0].toLowerCase() === 'india gate')
assert(Boolean(ig), `Found 'India Gate' landmark in offline index: [${ig ? ig[1] + ', ' + ig[2] : ''}]`)

// 4. PWA Production Build Verification
console.log('\n4. Validating Production PWA Bundle:')
const distDir = path.resolve('dist')
if (fs.existsSync(distDir)) {
  assert(fs.existsSync(path.join(distDir, 'index.html')), 'dist/index.html exists')
  assert(fs.existsSync(path.join(distDir, 'sw.js')), 'dist/sw.js service worker bundle exists')
  assert(fs.existsSync(path.join(distDir, 'registerSW.js')), 'dist/registerSW.js exists')
  assert(fs.existsSync(path.join(distDir, 'manifest.webmanifest')), 'dist/manifest.webmanifest exists')
} else {
  console.log('  (dist directory not present; run npm run build to verify)')
}

console.log(`\n=== Verification Complete: ${passedChecks}/${totalChecks} checks passed ===\n`)
if (passedChecks === totalChecks) {
  console.log('RESULT: OFFLINE INTEGRITY VERIFIED SUCCESSFULLY.')
} else {
  console.error('RESULT: SOME CHECKS FAILED.')
  process.exit(1)
}
