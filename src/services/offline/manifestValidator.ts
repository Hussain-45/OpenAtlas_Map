import { isValidCoordinate } from '../../coordinates'
import type { DatasetAssetDescriptor, DatasetReleaseManifest } from './manifestTypes'

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i

/**
 * Validates a dataset release manifest structure, bounds, and asset descriptors.
 */
export function validateManifest(data: unknown): {
  valid: boolean
  manifest?: DatasetReleaseManifest
  error?: string
} {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Manifest must be a non-empty JSON object.' }
  }

  const m = data as Partial<DatasetReleaseManifest>

  if (!m.id || typeof m.id !== 'string') {
    return { valid: false, error: 'Manifest is missing a valid "id" string.' }
  }

  if (!m.name || typeof m.name !== 'string') {
    return { valid: false, error: 'Manifest is missing a valid "name" string.' }
  }

  if (!m.version || typeof m.version !== 'string') {
    return { valid: false, error: 'Manifest is missing a valid "version" string.' }
  }

  if (!m.releaseDate || typeof m.releaseDate !== 'string') {
    return { valid: false, error: 'Manifest is missing a valid "releaseDate" string.' }
  }

  if (!Array.isArray(m.bounds) || m.bounds.length !== 4) {
    return { valid: false, error: 'Manifest "bounds" must be an array of [minLon, minLat, maxLon, maxLat].' }
  }

  const [minLon, minLat, maxLon, maxLat] = m.bounds
  if (
    typeof minLon !== 'number' ||
    typeof minLat !== 'number' ||
    typeof maxLon !== 'number' ||
    typeof maxLat !== 'number' ||
    !isValidCoordinate(minLon, minLat) ||
    !isValidCoordinate(maxLon, maxLat) ||
    minLon >= maxLon ||
    minLat >= maxLat
  ) {
    return { valid: false, error: 'Manifest "bounds" coordinates are invalid.' }
  }

  if (!Array.isArray(m.center) || m.center.length !== 2) {
    return { valid: false, error: 'Manifest "center" must be an array of [lon, lat].' }
  }

  const [centerLon, centerLat] = m.center
  if (!isValidCoordinate(centerLon, centerLat)) {
    return { valid: false, error: 'Manifest "center" coordinates are invalid.' }
  }

  if (!m.assets || typeof m.assets !== 'object') {
    return { valid: false, error: 'Manifest is missing the "assets" dictionary.' }
  }

  const requiredAssets: Array<{ key: keyof DatasetReleaseManifest['assets']; expectedType: string }> = [
    { key: 'pmtiles', expectedType: 'pmtiles' },
    { key: 'routingGraph', expectedType: 'routing-graph' },
    { key: 'places', expectedType: 'places-index' },
  ]

  for (const { key, expectedType } of requiredAssets) {
    const asset = m.assets[key] as DatasetAssetDescriptor | undefined
    if (!asset || typeof asset !== 'object') {
      return { valid: false, error: `Manifest is missing required asset: "${key}".` }
    }
    if (asset.type !== expectedType) {
      return { valid: false, error: `Asset "${key}" has invalid type "${asset.type}" (expected "${expectedType}").` }
    }
    if (!asset.path || typeof asset.path !== 'string') {
      return { valid: false, error: `Asset "${key}" is missing a valid "path".` }
    }
    if (!asset.filename || typeof asset.filename !== 'string') {
      return { valid: false, error: `Asset "${key}" is missing a valid "filename".` }
    }
    if (typeof asset.sizeBytes !== 'number' || asset.sizeBytes <= 0 || !Number.isInteger(asset.sizeBytes)) {
      return { valid: false, error: `Asset "${key}" has invalid sizeBytes: ${asset.sizeBytes}.` }
    }
    if (!asset.sha256 || !SHA256_HEX_REGEX.test(asset.sha256)) {
      return { valid: false, error: `Asset "${key}" has invalid sha256 checksum format.` }
    }
  }

  return { valid: true, manifest: m as DatasetReleaseManifest }
}

/**
 * Compares two version strings (e.g. "2026.10.20" vs "2026.10.15" or "1.2.3").
 * Returns:
 *   > 0 if v1 > v2
 *   < 0 if v1 < v2
 *   0 if v1 === v2
 */
export function compareVersions(v1: string, v2: string): number {
  if (v1 === v2) return 0
  const segs1 = v1.split(/[.-]/)
  const segs2 = v2.split(/[.-]/)
  const len = Math.max(segs1.length, segs2.length)

  for (let i = 0; i < len; i++) {
    const p1 = segs1[i] ?? '0'
    const p2 = segs2[i] ?? '0'
    const n1 = parseInt(p1, 10)
    const n2 = parseInt(p2, 10)

    if (!isNaN(n1) && !isNaN(n2)) {
      if (n1 !== n2) return n1 > n2 ? 1 : -1
    } else {
      const cmp = p1.localeCompare(p2)
      if (cmp !== 0) return cmp
    }
  }

  return 0
}

/**
 * Returns true if availableVersion is strictly newer than installedVersion.
 */
export function isNewerVersion(availableVersion: string, installedVersion: string): boolean {
  return compareVersions(availableVersion, installedVersion) > 0
}

/**
 * Computes the SHA-256 hex string of an ArrayBuffer in browser or Node environments.
 */
export async function calculateSha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // Node fallback if Web Crypto is unavailable
  try {
    const cryptoMod = 'node:crypto'
    const nodeCrypto = (await import(/* @vite-ignore */ cryptoMod)) as {
      createHash: (alg: string) => { update: (buf: Uint8Array) => { digest: (enc: string) => string } }
    }
    return nodeCrypto.createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
  } catch {
    throw new Error('Web Crypto API (crypto.subtle) is not available to compute SHA-256.')
  }
}

/**
 * Verifies that the SHA-256 digest of an ArrayBuffer matches the expected lowercase hex digest.
 */
export async function verifySha256(
  buffer: ArrayBuffer,
  expectedSha256: string,
): Promise<{ match: boolean; actualSha256: string }> {
  const actualSha256 = (await calculateSha256(buffer)).toLowerCase()
  const expected = expectedSha256.toLowerCase().trim()
  return {
    match: actualSha256 === expected,
    actualSha256,
  }
}

/**
 * Validates PMTiles v3 header from ArrayBuffer.
 */
export function validatePmtilesBuffer(buffer: ArrayBuffer): { valid: boolean; error?: string } {
  if (buffer.byteLength < 127) {
    return { valid: false, error: 'Buffer smaller than 127 bytes.' }
  }

  const bytes = new Uint8Array(buffer, 0, 127)
  // Magic bytes: 0x50 0x4D 0x54 0x69 0x6C 0x65 0x73 ("PMTiles")
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6])
  if (magic !== 'PMTiles') {
    return { valid: false, error: `Invalid PMTiles magic string: "${magic}".` }
  }

  const specVersion = bytes[7]
  if (specVersion !== 3) {
    return { valid: false, error: `Unsupported PMTiles spec version: ${specVersion} (expected 3).` }
  }

  return { valid: true }
}

/**
 * Validates ODRG (OpenAtlas Delhi Routing Graph) v1 header from ArrayBuffer.
 */
export function validateRoutingGraphBuffer(buffer: ArrayBuffer): {
  valid: boolean
  nodeCount?: number
  edgeCount?: number
  error?: string
} {
  if (buffer.byteLength < 64) {
    return { valid: false, error: 'Routing graph buffer smaller than 64-byte header.' }
  }

  const view = new DataView(buffer)
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  )

  if (magic !== 'ODRG') {
    return { valid: false, error: `Invalid routing graph magic: "${magic}" (expected "ODRG").` }
  }

  const version = view.getUint16(4, true)
  if (version !== 1) {
    return { valid: false, error: `Unsupported routing graph version: ${version} (expected 1).` }
  }

  const nodeCount = view.getUint32(8, true)
  const edgeCount = view.getUint32(12, true)

  if (nodeCount === 0 || edgeCount === 0) {
    return { valid: false, error: `Routing graph has zero nodes (${nodeCount}) or edges (${edgeCount}).` }
  }

  return { valid: true, nodeCount, edgeCount }
}

/**
 * Validates places JSON data array.
 */
export function validatePlacesData(data: unknown): {
  valid: boolean
  count?: number
  error?: string
} {
  if (!Array.isArray(data)) {
    return { valid: false, error: 'Places data must be a JSON array of POI tuples.' }
  }

  if (data.length === 0) {
    return { valid: false, error: 'Places array is empty.' }
  }

  // Validate sample of items
  const sampleIndices = [0, Math.floor(data.length / 2), data.length - 1]
  for (const idx of sampleIndices) {
    const item = data[idx]
    if (!Array.isArray(item) || item.length < 3) {
      return { valid: false, error: `Places entry at index ${idx} is not a valid tuple.` }
    }
    const [name, lon, lat] = item
    if (typeof name !== 'string' || !name.trim()) {
      return { valid: false, error: `Places entry at index ${idx} has invalid name.` }
    }
    if (typeof lon !== 'number' || typeof lat !== 'number' || !isValidCoordinate(lon, lat)) {
      return { valid: false, error: `Places entry at index ${idx} has invalid coordinates: [${lon}, ${lat}].` }
    }
  }

  return { valid: true, count: data.length }
}
