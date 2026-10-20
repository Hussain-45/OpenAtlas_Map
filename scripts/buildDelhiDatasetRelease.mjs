/**
 * OpenAtlas — Reproducible Delhi Dataset Release Generator
 *
 * Verifies or packages:
 * 1. public/offline/delhi/NewDelhi.osm.pmtiles (Basemap)
 * 2. public/offline/delhi/delhi-routing-graph.bin (ODRG Routing Graph)
 * 3. public/offline/delhi/places.json (Indexed POIs)
 *
 * Computes exact SHA-256 checksums, validates data integrity, and outputs:
 * public/offline/delhi/manifest.json
 *
 * Usage:
 *   node scripts/buildDelhiDatasetRelease.mjs [--version 2026.10.20] [--description "Release notes..."]
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function computeSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath)
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  return { hash, size: fileBuffer.length, buffer: fileBuffer }
}

function parseCliArgs() {
  const args = process.argv.slice(2)
  const options = {
    dir: 'public/offline/delhi',
    version: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    description: 'Delhi NCT offline map package, road routing graph, and POI index.',
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      options.version = args[++i]
    } else if (args[i] === '--description' && args[i + 1]) {
      options.description = args[++i]
    } else if (args[i] === '--dir' && args[i + 1]) {
      options.dir = args[++i]
    }
  }

  return options
}

async function main() {
  const { dir, version, description } = parseCliArgs()
  const baseDir = path.resolve(dir)

  const pmtilesPath = path.join(baseDir, 'NewDelhi.osm.pmtiles')
  const graphPath = path.join(baseDir, 'delhi-routing-graph.bin')
  const placesPath = path.join(baseDir, 'places.json')
  const manifestPath = path.join(baseDir, 'manifest.json')

  console.log(`[OpenAtlas Release Builder] Packaging dataset from: ${baseDir}`)
  console.log(`[OpenAtlas Release Builder] Target version: ${version}`)

  if (!fs.existsSync(pmtilesPath)) {
    throw new Error(`PMTiles file missing: ${pmtilesPath}`)
  }
  if (!fs.existsSync(graphPath)) {
    throw new Error(`Routing graph missing: ${graphPath}`)
  }
  if (!fs.existsSync(placesPath)) {
    throw new Error(`Places JSON missing: ${placesPath}`)
  }

  // 1. Basemap PMTiles Checksum & Header Verification
  console.log('[OpenAtlas Release Builder] Verifying PMTiles archive...')
  const pmtilesData = computeSha256(pmtilesPath)
  if (pmtilesData.size < 127) {
    throw new Error('PMTiles file too small.')
  }
  const pmtilesHeader = pmtilesData.buffer.subarray(0, 127)
  const pmtilesMagic = pmtilesHeader.subarray(0, 7).toString('ascii')
  const pmtilesSpec = pmtilesHeader[7]
  if (pmtilesMagic !== 'PMTiles' || pmtilesSpec !== 3) {
    throw new Error(`Invalid PMTiles header: magic=${pmtilesMagic}, specVersion=${pmtilesSpec}`)
  }

  // 2. Routing Graph Checksum & Header Verification
  console.log('[OpenAtlas Release Builder] Verifying ODRG routing graph...')
  const graphData = computeSha256(graphPath)
  if (graphData.size < 64) {
    throw new Error('Routing graph file too small.')
  }
  const graphMagic = graphData.buffer.subarray(0, 4).toString('ascii')
  const graphVersion = graphData.buffer.readUInt16LE(4)
  const nodeCount = graphData.buffer.readUInt32LE(8)
  const edgeCount = graphData.buffer.readUInt32LE(12)
  const nameCount = graphData.buffer.readUInt32LE(16)
  const totalRoadMeters = Number(graphData.buffer.readBigUInt64LE(40))

  if (graphMagic !== 'ODRG' || graphVersion !== 1) {
    throw new Error(`Invalid routing graph header: magic=${graphMagic}, version=${graphVersion}`)
  }

  // 3. Places Index Verification
  console.log('[OpenAtlas Release Builder] Verifying places.json...')
  const placesData = computeSha256(placesPath)
  const placesJson = JSON.parse(placesData.buffer.toString('utf-8'))
  if (!Array.isArray(placesJson)) {
    throw new Error('places.json is not an array.')
  }

  // Construct Manifest
  const manifest = {
    id: 'delhi-nct',
    name: 'Delhi NCT Core & Regional Network',
    version,
    releaseDate: new Date().toISOString(),
    description,
    bounds: [76.978, 28.440, 77.497, 28.738],
    center: [77.2375, 28.589],
    attribution: '© OpenStreetMap contributors, BBBike.org, VersaTiles Colorful',
    assets: {
      pmtiles: {
        type: 'pmtiles',
        path: '/offline/delhi/NewDelhi.osm.pmtiles',
        filename: 'NewDelhi.osm.pmtiles',
        sizeBytes: pmtilesData.size,
        sha256: pmtilesData.hash,
        specVersion: 3,
      },
      routingGraph: {
        type: 'routing-graph',
        path: '/offline/delhi/delhi-routing-graph.bin',
        filename: 'delhi-routing-graph.bin',
        sizeBytes: graphData.size,
        sha256: graphData.hash,
        specVersion: 1,
      },
      places: {
        type: 'places-index',
        path: '/offline/delhi/places.json',
        filename: 'places.json',
        sizeBytes: placesData.size,
        sha256: placesData.hash,
      },
    },
    metadata: {
      nodeCount,
      edgeCount,
      nameCount,
      placeCount: placesJson.length,
      totalRoadKm: Math.round((totalRoadMeters / 1000) * 10) / 10,
      sourceDataDate: new Date().toISOString().slice(0, 10),
    },
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

  console.log('\n[OpenAtlas Release Builder] SUCCESS!')
  console.log(`Manifest written to: ${manifestPath}`)
  console.log('--- Summary ---')
  console.log(`  Version:       ${manifest.version}`)
  console.log(`  PMTiles:       ${(pmtilesData.size / (1024 * 1024)).toFixed(2)} MB (SHA256: ${pmtilesData.hash})`)
  console.log(`  Routing Graph: ${(graphData.size / (1024 * 1024)).toFixed(2)} MB (SHA256: ${graphData.hash})`)
  console.log(`                 ${nodeCount.toLocaleString()} nodes, ${edgeCount.toLocaleString()} edges, ${manifest.metadata.totalRoadKm} km`)
  console.log(`  Places Index:  ${(placesData.size / 1024).toFixed(1)} KB (SHA256: ${placesData.hash})`)
  console.log(`                 ${placesJson.length.toLocaleString()} POIs`)
  console.log(`  Total Package: ${((pmtilesData.size + graphData.size + placesData.size) / (1024 * 1024)).toFixed(2)} MB\n`)
}

main().catch(err => {
  console.error('[OpenAtlas Release Builder] Fatal error:', err)
  process.exit(1)
})
