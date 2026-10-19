/**
 * OpenAtlas — Delhi Offline Road Routing Graph Builder
 * Extracts OSM road network & geometries from public/offline/delhi/NewDelhi.osm.pmtiles
 * Outputs high-performance binary graph: public/offline/delhi/delhi-routing-graph.bin
 */
import fs from 'node:fs'
import path from 'node:path'
import { PMTiles } from 'pmtiles'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'

class LocalFileSource {
  constructor(filePath) {
    this.fd = fs.openSync(filePath, 'r')
    this.key = filePath
  }
  getKey() { return this.key }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length)
    fs.readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  }
}

function haversineMeters(lon1, lat1, lon2, lat2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const HIGHWAY_KIND_MAP = {
  motorway: 0,
  trunk: 1,
  primary: 2,
  secondary: 3,
  tertiary: 4,
  residential: 5,
  service: 6,
  living_street: 7,
  pedestrian: 8,
  footway: 9,
  cycleway: 10,
  path: 11,
  steps: 12,
  track: 13,
}

const NON_ROUTABLE_KINDS = new Set([
  'rail', 'subway', 'narrow_gauge', 'funicular', 'light_rail',
  'monorail', 'tram', 'runway', 'taxiway', 'platform', 'corridor',
])

async function buildGraph() {
  const tStart = performance.now()
  const pmtilesPath = path.resolve('public/offline/delhi/NewDelhi.osm.pmtiles')
  const outPath = path.resolve('public/offline/delhi/delhi-routing-graph.bin')

  if (!fs.existsSync(pmtilesPath)) {
    throw new Error(`PMTiles file not found at: ${pmtilesPath}`)
  }

  console.log(`[OpenAtlas Graph Builder] Reading PMTiles archive: ${pmtilesPath}`)
  const pmtiles = new PMTiles(new LocalFileSource(pmtilesPath))
  const header = await pmtiles.getHeader()
  console.log(`[OpenAtlas Graph Builder] PMTiles bounds: [${header.minLon}, ${header.minLat}, ${header.maxLon}, ${header.maxLat}]`)

  const vertexMap = new Map() // 'kx,ky' -> id
  const vertices = [] // [lon, lat]
  const edgeMap = new Map() // 'u-v' -> edge object
  const nameToId = new Map([['', 0]])
  const names = ['']
  const nameCoords = new Map() // 'kx,ky' -> name

  function getVertexId(lon, lat) {
    const kx = Math.round(lon * 100000)
    const ky = Math.round(lat * 100000)
    const key = `${kx},${ky}`
    let id = vertexMap.get(key)
    if (id === undefined) {
      id = vertices.length
      vertexMap.set(key, id)
      vertices.push([kx / 100000, ky / 100000])
    }
    return id
  }

  function getNameId(name) {
    if (!name) return 0
    let id = nameToId.get(name)
    if (id === undefined) {
      if (names.length >= 65535) return 0
      id = names.length
      nameToId.set(name, id)
      names.push(name)
    }
    return id
  }

  const zoom = 14
  const n = Math.pow(2, zoom)

  // Delhi NCT bbox tile range at z14
  const minTileX = 11695
  const maxTileX = 11718
  const minTileY = 6825
  const maxTileY = 6840

  let tilesScanned = 0
  let tilesWithStreets = 0

  console.log(`[OpenAtlas Graph Builder] Scanning ${((maxTileX - minTileX + 1) * (maxTileY - minTileY + 1))} tile coordinates...`)

  // Pass 1: Extract street labels for road naming
  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) {
      const tile = await pmtiles.getZxy(zoom, x, y)
      if (!tile) continue
      tilesScanned++
      const vt = new VectorTile(new PbfReader(Buffer.from(tile.data)))
      const labels = vt.layers.street_labels
      if (labels) {
        const extent = labels.extent || 4096
        for (let i = 0; i < labels.length; i++) {
          const feat = labels.feature(i)
          const name = feat.properties.name || feat.properties.name_en || ''
          if (!name) continue
          const geom = feat.loadGeometry()
          for (const line of geom) {
            for (const pt of line) {
              const gx = x + pt.x / extent
              const gy = y + pt.y / extent
              const lon = (gx / n) * 360 - 180
              const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / n)))
              const lat = latRad * 180 / Math.PI
              const kx = Math.round(lon * 100000)
              const ky = Math.round(lat * 100000)
              nameCoords.set(`${kx},${ky}`, name)
            }
          }
        }
      }
    }
  }

  console.log(`[OpenAtlas Graph Builder] Indexed ${nameCoords.size} street label anchor points.`)

  // Pass 2: Extract road geometry & build topology
  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) {
      const tile = await pmtiles.getZxy(zoom, x, y)
      if (!tile) continue
      const vt = new VectorTile(new PbfReader(Buffer.from(tile.data)))
      const layer = vt.layers.streets
      if (!layer) continue
      tilesWithStreets++
      const extent = layer.extent || 4096

      for (let i = 0; i < layer.length; i++) {
        const feat = layer.feature(i)
        const props = feat.properties
        const kind = props.kind || 'residential'
        if (NON_ROUTABLE_KINDS.has(kind) || props.rail) continue

        const kindIndex = HIGHWAY_KIND_MAP[kind] !== undefined ? HIGHWAY_KIND_MAP[kind] : 14
        const oneway = Boolean(props.oneway)

        // Mode permissions
        let drive = false
        let walk = false
        let cycle = false

        if (kind === 'motorway') {
          drive = true
          walk = false
          cycle = false
        } else if (kind === 'trunk') {
          drive = true
          walk = false
          cycle = true
        } else if (kind === 'steps') {
          drive = false
          walk = true
          cycle = false
        } else if (kind === 'footway') {
          drive = false
          walk = true
          cycle = false
        } else if (kind === 'pedestrian' || kind === 'path') {
          drive = false
          walk = true
          cycle = true
        } else if (kind === 'cycleway') {
          drive = false
          walk = true
          cycle = true
        } else {
          // motorway_link, primary, secondary, tertiary, residential, living_street, service, track
          drive = true
          walk = true
          cycle = true
        }

        const lines = feat.loadGeometry()
        for (const line of lines) {
          if (line.length < 2) continue
          let prevId = null
          let prevLon = 0, prevLat = 0

          for (let pIdx = 0; pIdx < line.length; pIdx++) {
            const pt = line[pIdx]
            const gx = x + pt.x / extent
            const gy = y + pt.y / extent
            const lon = (gx / n) * 360 - 180
            const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / n)))
            const lat = latRad * 180 / Math.PI

            const vId = getVertexId(lon, lat)
            if (prevId !== null && prevId !== vId) {
              const u = prevId
              const v = vId
              const edgeKey = u < v ? `${u}-${v}` : `${v}-${u}`
              const dist = haversineMeters(prevLon, prevLat, lon, lat)

              if (dist > 0.1 && dist < 5000) {
                const kx = Math.round(lon * 100000)
                const ky = Math.round(lat * 100000)
                const roadName = nameCoords.get(`${kx},${ky}`) || ''
                const nameIdx = getNameId(roadName)

                const existing = edgeMap.get(edgeKey)
                if (!existing) {
                  edgeMap.set(edgeKey, {
                    u,
                    v,
                    dist: Math.round(dist),
                    kindIndex,
                    oneway,
                    drive,
                    walk,
                    cycle,
                    nameIdx,
                  })
                } else {
                  // Merge access permissions and prefer named / higher-order road
                  if (drive) existing.drive = true
                  if (walk) existing.walk = true
                  if (cycle) existing.cycle = true
                  if (nameIdx !== 0 && existing.nameIdx === 0) {
                    existing.nameIdx = nameIdx
                  }
                  if (kindIndex < existing.kindIndex) {
                    existing.kindIndex = kindIndex
                  }
                }
              }
            }
            prevId = vId
            prevLon = lon
            prevLat = lat
          }
        }
      }
    }
  }

  const nodeCount = vertices.length
  const edgeCount = edgeMap.size
  console.log(`[OpenAtlas Graph Builder] Built topology: ${nodeCount} vertices, ${edgeCount} unique road edges.`)

  // Pass 3: Connected Component Analysis (Union-Find)
  console.log(`[OpenAtlas Graph Builder] Computing connected components...`)
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

  for (const e of edgeMap.values()) {
    unionNodes(e.u, e.v)
  }

  // Count component sizes
  const componentSizes = new Map()
  for (let i = 0; i < nodeCount; i++) {
    const root = findRoot(i)
    componentSizes.set(root, (componentSizes.get(root) || 0) + 1)
  }

  let largestRoot = -1
  let largestSize = 0
  for (const [root, size] of componentSizes.entries()) {
    if (size > largestSize) {
      largestSize = size
      largestRoot = root
    }
  }

  console.log(`[OpenAtlas Graph Builder] Largest connected component: ${largestSize} nodes (${((largestSize / nodeCount) * 100).toFixed(1)}% of all Delhi nodes)`)

  // Node main component bitmask (1 = main component or size >= 100)
  const isMainNode = new Uint8Array(Math.ceil(nodeCount / 8))
  for (let i = 0; i < nodeCount; i++) {
    const root = findRoot(i)
    const size = componentSizes.get(root) || 0
    if (size >= 100 || root === largestRoot) {
      const byteIdx = i >> 3
      const bitIdx = i & 7
      isMainNode[byteIdx] |= (1 << bitIdx)
    }
  }

  // Pass 4: Serialize to optimized binary layout
  console.log(`[OpenAtlas Graph Builder] Serializing binary road network graph...`)

  // Name table serialization
  const nameBuffers = []
  let totalNamesLen = 0
  for (const name of names) {
    const buf = Buffer.from(name, 'utf8')
    nameBuffers.push(buf)
    totalNamesLen += buf.length + 1 // null terminated
  }
  const namesBuffer = Buffer.alloc(totalNamesLen)
  let nOffset = 0
  for (const buf of nameBuffers) {
    buf.copy(namesBuffer, nOffset)
    nOffset += buf.length
    namesBuffer[nOffset++] = 0 // null byte
  }

  const HEADER_SIZE = 64
  const nodeTableSize = nodeCount * 8
  const mainMaskSize = isMainNode.length
  const edgeTableSize = edgeCount * 14
  const totalFileSize = HEADER_SIZE + nodeTableSize + mainMaskSize + edgeTableSize + totalNamesLen

  const fileBuffer = Buffer.alloc(totalFileSize)

  // Write Header (64 bytes)
  fileBuffer.write('ODRG', 0, 4, 'ascii') // Magic: OpenAtlas Delhi Routing Graph
  fileBuffer.writeUInt16LE(1, 4)           // Version: 1
  fileBuffer.writeUInt16LE(0, 6)           // Reserved
  fileBuffer.writeUInt32LE(nodeCount, 8)
  fileBuffer.writeUInt32LE(edgeCount, 12)
  fileBuffer.writeUInt32LE(names.length, 16)
  fileBuffer.writeUInt32LE(totalNamesLen, 20)
  fileBuffer.writeFloatLE(76.978, 24)      // minLon
  fileBuffer.writeFloatLE(28.440, 28)      // minLat
  fileBuffer.writeFloatLE(77.497, 32)      // maxLon
  fileBuffer.writeFloatLE(28.738, 36)      // maxLat

  let totalRoadMeters = 0
  for (const e of edgeMap.values()) {
    totalRoadMeters += e.dist
  }
  fileBuffer.writeBigUInt64LE(BigInt(totalRoadMeters), 40)
  // Remaining 16 bytes of header reserved (zeros)

  let writePos = HEADER_SIZE

  // Write Node Table (nodeCount * 8 bytes)
  for (let i = 0; i < nodeCount; i++) {
    const [lon, lat] = vertices[i]
    fileBuffer.writeInt32LE(Math.round(lon * 100000), writePos)
    fileBuffer.writeInt32LE(Math.round(lat * 100000), writePos + 4)
    writePos += 8
  }

  // Write Main Component Mask
  Buffer.from(isMainNode.buffer, isMainNode.byteOffset, isMainNode.byteLength).copy(fileBuffer, writePos)
  writePos += mainMaskSize

  // Write Edge Table (edgeCount * 14 bytes)
  for (const e of edgeMap.values()) {
    fileBuffer.writeUInt32LE(e.u, writePos)
    fileBuffer.writeUInt32LE(e.v, writePos + 4)
    fileBuffer.writeUInt16LE(Math.min(65535, e.dist), writePos + 8)

    // Flags (2 bytes):
    // bit 0: oneway (1 = u to v only)
    // bit 1: drive
    // bit 2: walk
    // bit 3: cycle
    // bits 4..7: highway type (0..15)
    let flags = 0
    if (e.oneway) flags |= (1 << 0)
    if (e.drive) flags |= (1 << 1)
    if (e.walk) flags |= (1 << 2)
    if (e.cycle) flags |= (1 << 3)
    flags |= ((e.kindIndex & 0x0F) << 4)

    fileBuffer.writeUInt16LE(flags, writePos + 10)
    fileBuffer.writeUInt16LE(Math.min(65535, e.nameIdx), writePos + 12)
    writePos += 14
  }

  // Write Names Table
  namesBuffer.copy(fileBuffer, writePos)
  writePos += totalNamesLen

  if (writePos !== totalFileSize) {
    throw new Error(`Buffer size mismatch: expected ${totalFileSize}, wrote ${writePos}`)
  }

  fs.writeFileSync(outPath, fileBuffer)
  const elapsed = ((performance.now() - tStart) / 1000).toFixed(2)
  const mbSize = (totalFileSize / (1024 * 1024)).toFixed(2)

  console.log(`[OpenAtlas Graph Builder] SUCCESS! Saved ${outPath} (${mbSize} MB) in ${elapsed}s.`)
  console.log(`[OpenAtlas Graph Builder] Road network summary:`)
  console.log(`  - Total Nodes: ${nodeCount}`)
  console.log(`  - Total Undirected Edges: ${edgeCount}`)
  console.log(`  - Total Road Network Length: ${(totalRoadMeters / 1000).toFixed(1)} km`)
  console.log(`  - Named Streets: ${names.length - 1}`)
  console.log(`  - Main Component Coverage: ${((largestSize / nodeCount) * 100).toFixed(1)}%`)
}

buildGraph().catch(err => {
  console.error('[OpenAtlas Graph Builder] Error:', err)
  process.exit(1)
})
