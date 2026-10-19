import fs from 'node:fs'
import path from 'node:path'
import { OfflineDelhiRoadGraph } from '../src/services/routing/offlineDelhiRouting.js'
import { dijkstraShortestPath, aStarShortestPath } from '../src/services/routing/dijkstra.js'

console.log('=== OpenAtlas Offline Network Isolation Verification ===\n')

let networkRequestsIntercepted = 0

// Monkey-patch global fetch to detect ANY network attempts
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  networkRequestsIntercepted++
  throw new Error(`[Network Isolation Violation] Blocked unexpected outbound request to: ${url}`)
}

console.log('Network access disabled: global fetch intercepted and blocked.')

// 1. Verify Offline Graph Loading & Routing Under Zero Network Access
console.log('\n1. Testing Offline Route Calculation under Network Isolation:')
const graphBuf = fs.readFileSync(path.resolve('public/offline/delhi/delhi-routing-graph.bin'))
const graph = new OfflineDelhiRoadGraph(graphBuf.buffer.slice(graphBuf.byteOffset, graphBuf.byteOffset + graphBuf.byteLength))

const cpLon = 77.2195, cpLat = 28.6315
const igLon = 77.2295, igLat = 28.6129

const snapO = graph.snap(cpLon, cpLat, 'driving')
const snapD = graph.snap(igLon, igLat, 'driving')

console.log(`  - Snapped Origin to Node ${snapO.nodeId} (${snapO.distMeters.toFixed(1)}m away)`)
console.log(`  - Snapped Destination to Node ${snapD.nodeId} (${snapD.distMeters.toFixed(1)}m away)`)

const tDijk0 = performance.now()
const resDijk = dijkstraShortestPath(graph, snapO.nodeId, snapD.nodeId, 'driving')
const tDijk = (performance.now() - tDijk0).toFixed(2)

const tAStar0 = performance.now()
const resAStar = aStarShortestPath(graph, snapO.nodeId, snapD.nodeId, 'driving')
const tAStar = (performance.now() - tAStar0).toFixed(2)

console.log(`  - Dijkstra route found: ${resDijk.found}, cost: ${resDijk.totalCostMeters}m in ${tDijk}ms`)
console.log(`  - A* route found: ${resAStar.found}, cost: ${resAStar.totalCostMeters}m in ${tAStar}ms`)
console.log(`  - Network requests during route calculation: ${networkRequestsIntercepted}`)

// 2. Testing Offline Place Search
console.log('\n2. Testing Offline Place Search under Network Isolation:')
const placesRaw = JSON.parse(fs.readFileSync(path.resolve('public/offline/delhi/places.json'), 'utf8'))
const query = 'connaught'
const hits = placesRaw.filter(p => p[0] && p[0].toLowerCase().includes(query))
console.log(`  - Found ${hits.length} matching places for '${query}' in offline database`)
console.log(`  - Top result: ${hits[0][0]} at [${hits[0][1]}, ${hits[0][2]}]`)
console.log(`  - Network requests during place search: ${networkRequestsIntercepted}`)

// 3. Testing Map Assets Existence for Offline Rendering
console.log('\n3. Testing Map Assets for Offline WebGL Rendering:')
const pmtilesExists = fs.existsSync(path.resolve('public/offline/delhi/NewDelhi.osm.pmtiles'))
const styleExists = fs.existsSync(path.resolve('public/offline/assets/style.json'))
const fontsExist = fs.existsSync(path.resolve('public/offline/assets/glyphs/noto_sans_regular/0-255.pbf'))
const spritesExist = fs.existsSync(path.resolve('public/offline/assets/sprites/base.json'))

console.log(`  - PMTiles vector basemap present: ${pmtilesExists}`)
console.log(`  - MapLibre offline style present: ${styleExists}`)
console.log(`  - Local font PBFs present: ${fontsExist}`)
console.log(`  - Local sprites present: ${spritesExist}`)

console.log(`\n=== Verification Summary ===`)
console.log(`Total Outbound Network Requests: ${networkRequestsIntercepted}`)
console.log(`Offline Routing Status: ${resDijk.found && resAStar.found && networkRequestsIntercepted === 0 ? 'PASSED (100% Offline)' : 'FAILED'}`)
