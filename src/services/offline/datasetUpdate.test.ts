import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateSha256,
  compareVersions,
  isNewerVersion,
  validateManifest,
  validatePlacesData,
  validatePmtilesBuffer,
  validateRoutingGraphBuffer,
  verifySha256,
} from './manifestValidator'
import {
  ACTIVE_PLACES_FILENAME,
  ACTIVE_PMTILES_FILENAME,
  ACTIVE_ROUTING_FILENAME,
  BUNDLED_DELHI_MANIFEST,
  DatasetUpdateService,
} from './datasetUpdateService'
import { OfflineDelhiProvider } from '../geocoding/offlineDelhi'
import { OfflineDelhiRoutingProvider } from '../routing/offlineDelhiRouting'
import type { DatasetReleaseManifest, InstalledDatasetRelease } from './manifestTypes'

// Helper to create a dummy ArrayBuffer
function createBuffer(content: string): ArrayBuffer {
  const enc = new TextEncoder()
  const u8 = enc.encode(content)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
}

// Helper to create mock ODRG binary buffer with valid table structures
function createMockOdrgBuffer(version = 1, nodeCount = 2, edgeCount = 1, magic = 'ODRG'): ArrayBuffer {
  const nodeTableSize = nodeCount * 8
  const maskSize = Math.ceil(nodeCount / 8)
  const edgeTableSize = edgeCount * 14
  const namesLen = 4
  const total = 64 + nodeTableSize + maskSize + edgeTableSize + namesLen

  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  for (let i = 0; i < 4 && i < magic.length; i++) {
    view.setUint8(i, magic.charCodeAt(i))
  }
  view.setUint16(4, version, true)
  view.setUint16(6, 0, true)
  view.setUint32(8, nodeCount, true)
  view.setUint32(12, edgeCount, true)
  view.setUint32(16, 1, true)
  view.setUint32(20, namesLen, true)

  view.setFloat32(24, 76.978, true)
  view.setFloat32(28, 28.440, true)
  view.setFloat32(32, 77.497, true)
  view.setFloat32(36, 28.738, true)

  let pos = 64
  for (let i = 0; i < nodeCount; i++) {
    view.setInt32(pos, 7720900 + i * 100, true)
    view.setInt32(pos + 4, 2861300 + i * 100, true)
    pos += 8
  }
  pos += maskSize
  for (let i = 0; i < edgeCount; i++) {
    view.setUint32(pos, 0, true)
    view.setUint32(pos + 4, Math.min(1, nodeCount - 1), true)
    view.setUint16(pos + 8, 100, true)
    view.setUint16(pos + 10, 0x0E, true) // drive | walk | cycle
    view.setUint16(pos + 12, 0, true)
    pos += 14
  }
  return buf
}

// Valid 127-byte PMTiles v3 byte sequence matching specification
const REAL_VALID_HEADER = new Uint8Array([
  80, 77, 84, 105, 108, 101, 115, 3, 127, 0, 0, 0, 0, 0, 0, 0,
  64, 13, 0, 0, 0, 0, 0, 0, 197, 100, 234, 0, 0, 0, 0, 0,
  199, 2, 0, 0, 0, 0, 0, 0, 197, 100, 234, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 0,
  197, 36, 234, 0, 0, 0, 0, 0, 54, 2, 0, 0, 0, 0, 0, 0,
  54, 2, 0, 0, 0, 0, 0, 0, 53, 2, 0, 0, 0, 0, 0, 0,
  0, 2, 2, 1, 0, 14, 32, 233, 225, 45, 128, 153, 243, 16,
  144, 26, 49, 46, 32, 18, 33, 17, 7, 216, 129, 9, 46, 208, 85, 10, 17,
])

// Helper to create mock PMTiles v3 header (127 bytes)
function createMockPmtilesBuffer(specVersion = 3, magic = 'PMTiles'): ArrayBuffer {
  const copy = new Uint8Array(REAL_VALID_HEADER)
  for (let i = 0; i < 7 && i < magic.length; i++) {
    copy[i] = magic.charCodeAt(i)
  }
  copy[7] = specVersion
  copy[99] = 1 // tileType: 1 for MVT
  return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)
}

describe('manifestValidator', () => {
  const validManifest: DatasetReleaseManifest = {
    id: 'delhi-nct',
    name: 'Delhi NCT Core',
    version: '2026.11.01',
    releaseDate: '2026-11-01T12:00:00Z',
    description: 'Updated road geometry and new commercial landmarks.',
    bounds: [76.978, 28.44, 77.497, 28.738],
    center: [77.2375, 28.589],
    attribution: '© OpenStreetMap contributors',
    assets: {
      pmtiles: {
        type: 'pmtiles',
        path: '/offline/delhi/NewDelhi.osm.pmtiles',
        filename: 'NewDelhi.osm.pmtiles',
        sizeBytes: 15000000,
        sha256: '51e3cbf69fd4fcbad19d41dbfd432466d159522db7b618d8099374ac931a626d',
        specVersion: 3,
      },
      routingGraph: {
        type: 'routing-graph',
        path: '/offline/delhi/delhi-routing-graph.bin',
        filename: 'delhi-routing-graph.bin',
        sizeBytes: 22000000,
        sha256: '3051698dd59274877bd3b38a927c048252163e9717fbb3867207a323c9732236',
        specVersion: 1,
      },
      places: {
        type: 'places-index',
        path: '/offline/delhi/places.json',
        filename: 'places.json',
        sizeBytes: 850000,
        sha256: '74a6e77224e619d8fd0d57767e56e6fe6c29dfd37c278f1d5f143ca7bf944f9b',
      },
    },
  }

  describe('validateManifest', () => {
    it('accepts a valid dataset manifest', () => {
      const res = validateManifest(validManifest)
      expect(res.valid).toBe(true)
      expect(res.manifest?.version).toBe('2026.11.01')
    })

    it('rejects null or non-objects', () => {
      expect(validateManifest(null).valid).toBe(false)
      expect(validateManifest('string').valid).toBe(false)
    })

    it('rejects missing or invalid id, name, version, or releaseDate', () => {
      expect(validateManifest({ ...validManifest, id: '' }).valid).toBe(false)
      expect(validateManifest({ ...validManifest, name: '' }).valid).toBe(false)
      expect(validateManifest({ ...validManifest, version: '' }).valid).toBe(false)
      expect(validateManifest({ ...validManifest, releaseDate: '' }).valid).toBe(false)
    })

    it('rejects invalid bounding box coordinates', () => {
      // minLon >= maxLon
      expect(validateManifest({ ...validManifest, bounds: [78.0, 28.0, 77.0, 29.0] }).valid).toBe(false)
      // invalid latitude range
      expect(validateManifest({ ...validManifest, bounds: [76.0, -95.0, 77.0, 28.0] }).valid).toBe(false)
      // wrong array length
      expect(validateManifest({ ...validManifest, bounds: [76.0, 28.0] as unknown as [number, number, number, number] }).valid).toBe(false)
    })

    it('rejects invalid center coordinates', () => {
      expect(validateManifest({ ...validManifest, center: [200.0, 28.0] }).valid).toBe(false)
    })

    it('rejects manifest missing required assets', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { places, ...restAssets } = validManifest.assets
      const invalid = { ...validManifest, assets: restAssets }
      expect(validateManifest(invalid).valid).toBe(false)
    })

    it('rejects asset with invalid sizeBytes or sha256', () => {
      const invalidSize = {
        ...validManifest,
        assets: {
          ...validManifest.assets,
          places: { ...validManifest.assets.places, sizeBytes: -10 },
        },
      }
      expect(validateManifest(invalidSize).valid).toBe(false)

      const invalidHash = {
        ...validManifest,
        assets: {
          ...validManifest.assets,
          places: { ...validManifest.assets.places, sha256: 'not-a-valid-sha256' },
        },
      }
      expect(validateManifest(invalidHash).valid).toBe(false)
    })
  })

  describe('compareVersions and isNewerVersion', () => {
    it('compares semantic date versions properly', () => {
      expect(compareVersions('2026.11.01', '2026.10.20')).toBe(1)
      expect(compareVersions('2026.10.20', '2026.11.01')).toBe(-1)
      expect(compareVersions('2026.10.20', '2026.10.20')).toBe(0)
      expect(compareVersions('1.2.3', '1.2.2')).toBe(1)
      expect(compareVersions('1.2.0', '1.3.0')).toBe(-1)
    })

    it('correctly determines whether a release is newer', () => {
      expect(isNewerVersion('2026.11.01', '2026.10.20')).toBe(true)
      expect(isNewerVersion('2026.10.20', '2026.10.20')).toBe(false)
      expect(isNewerVersion('2026.10.15', '2026.10.20')).toBe(false)
    })
  })

  describe('calculateSha256 and verifySha256', () => {
    it('computes and verifies SHA-256 for a buffer', async () => {
      const buf = createBuffer('OpenAtlas Offline Navigation')
      const hash = await calculateSha256(buf)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)

      const verifySuccess = await verifySha256(buf, hash)
      expect(verifySuccess.match).toBe(true)

      const verifyFail = await verifySha256(buf, '0000000000000000000000000000000000000000000000000000000000000000')
      expect(verifyFail.match).toBe(false)
    })
  })

  describe('validatePmtilesBuffer', () => {
    it('accepts valid PMTiles v3 buffer', () => {
      const buf = createMockPmtilesBuffer(3)
      expect(validatePmtilesBuffer(buf).valid).toBe(true)
    })

    it('rejects short buffer', () => {
      const buf = new ArrayBuffer(50)
      expect(validatePmtilesBuffer(buf).valid).toBe(false)
    })

    it('rejects invalid magic or specVersion', () => {
      const badMagic = createMockPmtilesBuffer(3, 'NOTPMTL')
      expect(validatePmtilesBuffer(badMagic).valid).toBe(false)

      const badVersion = createMockPmtilesBuffer(4)
      expect(validatePmtilesBuffer(badVersion).valid).toBe(false)
    })
  })

  describe('validateRoutingGraphBuffer', () => {
    it('accepts valid ODRG v1 buffer', () => {
      const buf = createMockOdrgBuffer(1, 500, 1000)
      const res = validateRoutingGraphBuffer(buf)
      expect(res.valid).toBe(true)
      expect(res.nodeCount).toBe(500)
      expect(res.edgeCount).toBe(1000)
    })

    it('rejects short buffer or wrong magic/version', () => {
      expect(validateRoutingGraphBuffer(new ArrayBuffer(32)).valid).toBe(false)
      expect(validateRoutingGraphBuffer(createMockOdrgBuffer(1, 100, 100, 'ABCD')).valid).toBe(false)
      expect(validateRoutingGraphBuffer(createMockOdrgBuffer(2, 100, 100)).valid).toBe(false)
    })

    it('rejects zero nodes or edges', () => {
      expect(validateRoutingGraphBuffer(createMockOdrgBuffer(1, 0, 100)).valid).toBe(false)
      expect(validateRoutingGraphBuffer(createMockOdrgBuffer(1, 100, 0)).valid).toBe(false)
    })
  })

  describe('validatePlacesData', () => {
    it('accepts valid array of POI tuples', () => {
      const validTuples = [
        ['Connaught Place', 77.2167, 28.6315, 'commercial', 'landmark'],
        ['India Gate', 77.2295, 28.6129, 'historic', 'monument'],
      ]
      const res = validatePlacesData(validTuples)
      expect(res.valid).toBe(true)
      expect(res.count).toBe(2)
    })

    it('rejects non-array or empty array', () => {
      expect(validatePlacesData({}).valid).toBe(false)
      expect(validatePlacesData([]).valid).toBe(false)
    })

    it('rejects entries with invalid coordinates or empty names', () => {
      const invalid = [
        ['', 77.21, 28.63, 'cat', 'type'],
      ]
      expect(validatePlacesData(invalid).valid).toBe(false)

      const invalidCoords = [
        ['Test Place', 200.0, 28.63, 'cat', 'type'],
      ]
      expect(validatePlacesData(invalidCoords).valid).toBe(false)
    })
  })
})

describe('DatasetUpdateService', () => {
  let service: DatasetUpdateService
  const origNavigator = globalThis.navigator
  const origFetch = globalThis.fetch

  beforeEach(() => {
    service = new DatasetUpdateService()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      configurable: true,
      writable: true,
    })
    globalThis.fetch = origFetch
    vi.restoreAllMocks()
  })

  it('returns bundled release by default when OPFS is unsupported or empty', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    })

    const release = await service.getInstalledRelease()
    expect(release.source).toBe('bundled')
    expect(release.manifest.version).toBe(BUNDLED_DELHI_MANIFEST.version)
  })

  it('checks for updates and detects newer remote manifest', async () => {
    const remoteManifest: DatasetReleaseManifest = {
      ...BUNDLED_DELHI_MANIFEST,
      version: '2026.11.15',
      description: 'New highway ring road and 500+ updated business listings.',
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => remoteManifest,
    })

    const check = await service.checkForUpdates('/offline/delhi/manifest.json')
    expect(check.hasUpdate).toBe(true)
    expect(check.latestVersion).toBe('2026.11.15')
    expect(check.latestManifest?.description).toContain('New highway ring road')
  })

  it('reports hasUpdate: false when remote version is equal or older', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => BUNDLED_DELHI_MANIFEST,
    })

    const check = await service.checkForUpdates('/offline/delhi/manifest.json')
    expect(check.hasUpdate).toBe(false)
  })

  it('handles network failure during update check gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'))

    const check = await service.checkForUpdates('/offline/delhi/manifest.json')
    expect(check.hasUpdate).toBe(false)
    expect(check.error).toContain('Network offline')
  })

  describe('Download, Rollback Safety, and Atomic Promotion in OPFS', () => {
    // In-memory mock OPFS storage
    const storageFiles = new Map<string, Uint8Array>()

    function createMockOpfsStorage() {
      storageFiles.clear()

      function createMockHandle(filename: string) {
        return {
          name: filename,
          kind: 'file',
          getFile: async () => {
            const data = storageFiles.get(filename)
            if (!data) throw new Error(`File not found: ${filename}`)
            return {
              name: filename,
              size: data.byteLength,
              arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
              text: async () => new TextDecoder().decode(data),
              slice: (start = 0, end = data.byteLength) => ({
                arrayBuffer: async () => data.slice(start, end).buffer,
              }),
              stream: () => {
                let sent = false
                return new ReadableStream({
                  pull(controller) {
                    if (!sent) {
                      controller.enqueue(data)
                      sent = true
                    } else {
                      controller.close()
                    }
                  },
                })
              },
            }
          },
          createWritable: async () => {
            let writtenChunks: Uint8Array[] = []
            return {
              write: async (chunk: Uint8Array | string) => {
                if (typeof chunk === 'string') {
                  writtenChunks.push(new TextEncoder().encode(chunk))
                } else {
                  writtenChunks.push(new Uint8Array(chunk))
                }
              },
              close: async () => {
                const total = writtenChunks.reduce((acc, c) => acc + c.byteLength, 0)
                const merged = new Uint8Array(total)
                let offset = 0
                for (const c of writtenChunks) {
                  merged.set(c, offset)
                  offset += c.byteLength
                }
                storageFiles.set(filename, merged)
              },
              abort: async () => {
                writtenChunks = []
              },
            }
          },
        }
      }

      const mockDirectoryHandle = {
        getFileHandle: vi.fn().mockImplementation(async (name: string, opts?: { create?: boolean }) => {
          if (!storageFiles.has(name) && !opts?.create) {
            throw new Error(`File ${name} does not exist`)
          }
          if (opts?.create && !storageFiles.has(name)) {
            storageFiles.set(name, new Uint8Array(0))
          }
          return createMockHandle(name)
        }),
        removeEntry: vi.fn().mockImplementation(async (name: string) => {
          storageFiles.delete(name)
        }),
        values: async function* () {
          for (const [name] of storageFiles.entries()) {
            yield { name, kind: 'file' }
          }
        },
      }

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          storage: {
            getDirectory: vi.fn().mockResolvedValue(mockDirectoryHandle),
            estimate: vi.fn().mockResolvedValue({ usage: 1000000, quota: 1000000000 }),
          },
        },
        configurable: true,
        writable: true,
      })
    }

    beforeEach(() => {
      createMockOpfsStorage()
    })

    it('aborts update on checksum mismatch and leaves existing offline data untouched', async () => {
      // 1. Establish an existing active dataset
      const existingPlaces = new TextEncoder().encode(JSON.stringify([['Old Place', 77.2, 28.6, 'c', 't']]))
      storageFiles.set(ACTIVE_PLACES_FILENAME, existingPlaces)
      storageFiles.set(ACTIVE_ROUTING_FILENAME, new Uint8Array(createMockOdrgBuffer(1, 10, 20)))
      storageFiles.set(ACTIVE_PMTILES_FILENAME, new Uint8Array(createMockPmtilesBuffer(3)))

      const existingRelease: InstalledDatasetRelease = {
        manifest: BUNDLED_DELHI_MANIFEST,
        installedAt: 1000000,
        source: 'updated',
        verified: true,
      }
      storageFiles.set('active-release.json', new TextEncoder().encode(JSON.stringify(existingRelease)))

      // 2. Prepare an update manifest where the routing graph hash will intentionally mismatch
      const mockPlacesData = new TextEncoder().encode(JSON.stringify([['New Place', 77.22, 28.62, 'cat', 'type']]))
      const mockPlacesHash = await calculateSha256(mockPlacesData.buffer)

      const mockRoutingData = new Uint8Array(createMockOdrgBuffer(1, 50, 100))
      // Intentional wrong expected hash
      const wrongRoutingHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

      const mockPmtilesData = new Uint8Array(createMockPmtilesBuffer(3))
      const mockPmtilesHash = await calculateSha256(mockPmtilesData.buffer)

      const updateManifest: DatasetReleaseManifest = {
        ...BUNDLED_DELHI_MANIFEST,
        version: '2026.11.20',
        assets: {
          places: {
            type: 'places-index',
            path: '/test/places.json',
            filename: 'places.json',
            sizeBytes: mockPlacesData.byteLength,
            sha256: mockPlacesHash,
          },
          routingGraph: {
            type: 'routing-graph',
            path: '/test/routing.bin',
            filename: 'routing.bin',
            sizeBytes: mockRoutingData.byteLength,
            sha256: wrongRoutingHash, // Mismatch!
          },
          pmtiles: {
            type: 'pmtiles',
            path: '/test/basemap.pmtiles',
            filename: 'basemap.pmtiles',
            sizeBytes: mockPmtilesData.byteLength,
            sha256: mockPmtilesHash,
            specVersion: 3,
          },
        },
      }

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        let data: Uint8Array = mockPlacesData
        if (url === '/test/routing.bin') data = mockRoutingData
        if (url === '/test/basemap.pmtiles') data = mockPmtilesData

        return {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(data)
              controller.close()
            },
          }),
        }
      })

      // 3. Run downloadAndInstallUpdate and expect rejection
      await expect(service.downloadAndInstallUpdate(updateManifest)).rejects.toThrow(/Checksum mismatch/)

      // 4. Verify existing active files and pointer are 100% UNTOUCHED
      const currentRelease = await service.getInstalledRelease()
      expect(currentRelease.manifest.version).toBe(BUNDLED_DELHI_MANIFEST.version)
      expect(storageFiles.get(ACTIVE_PLACES_FILENAME)).toEqual(existingPlaces)

      // 5. Verify all staging files were cleaned up
      for (const key of storageFiles.keys()) {
        expect(key.startsWith('staging_')).toBe(false)
        expect(key.endsWith('.tmp')).toBe(false)
      }
    })

    it('aborts update on user cancellation without corrupting existing offline data', async () => {
      const abortCtrl = new AbortController()

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        // Abort on first fetch
        abortCtrl.abort()
        throw new DOMException('Download cancelled by user', 'AbortError')
      })

      const updateManifest: DatasetReleaseManifest = {
        ...BUNDLED_DELHI_MANIFEST,
        version: '2026.11.20',
      }

      await expect(service.downloadAndInstallUpdate(updateManifest, undefined, abortCtrl.signal)).rejects.toThrow()

      // Staging files cleaned up
      for (const key of storageFiles.keys()) {
        expect(key.startsWith('staging_')).toBe(false)
      }
    })

    it('successfully downloads, validates, atomically promotes, and activates an update', async () => {
      const mockPlacesData = new TextEncoder().encode(JSON.stringify([
        ['Connaught Place North', 77.218, 28.633, 'commercial', 'landmark'],
        ['IGI Airport Terminal 3', 77.085, 28.556, 'transport', 'aerodrome'],
      ]))
      const mockPlacesHash = await calculateSha256(mockPlacesData.buffer)

      const mockRoutingData = new Uint8Array(createMockOdrgBuffer(1, 1200, 2400))
      const mockRoutingHash = await calculateSha256(mockRoutingData.buffer)

      const mockPmtilesData = new Uint8Array(createMockPmtilesBuffer(3))
      const mockPmtilesHash = await calculateSha256(mockPmtilesData.buffer)

      const updateManifest: DatasetReleaseManifest = {
        ...BUNDLED_DELHI_MANIFEST,
        version: '2026.11.25',
        description: 'November 2026 Road Network and POI Update',
        assets: {
          places: {
            type: 'places-index',
            path: '/test/places.json',
            filename: 'places.json',
            sizeBytes: mockPlacesData.byteLength,
            sha256: mockPlacesHash,
          },
          routingGraph: {
            type: 'routing-graph',
            path: '/test/routing.bin',
            filename: 'routing.bin',
            sizeBytes: mockRoutingData.byteLength,
            sha256: mockRoutingHash,
            specVersion: 1,
          },
          pmtiles: {
            type: 'pmtiles',
            path: '/test/basemap.pmtiles',
            filename: 'basemap.pmtiles',
            sizeBytes: mockPmtilesData.byteLength,
            sha256: mockPmtilesHash,
            specVersion: 3,
          },
        },
      }

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        let data: Uint8Array = mockPlacesData
        if (url === '/test/routing.bin') data = mockRoutingData
        if (url === '/test/basemap.pmtiles') data = mockPmtilesData

        return {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(data)
              controller.close()
            },
          }),
        }
      })

      const listenerFn = vi.fn()
      service.onUpdateActivated(listenerFn)

      const installed = await service.downloadAndInstallUpdate(updateManifest)
      expect(installed.manifest.version).toBe('2026.11.25')
      expect(installed.source).toBe('updated')
      expect(installed.verified).toBe(true)

      // Verify listener was notified
      expect(listenerFn).toHaveBeenCalledWith(installed)

      // Verify active files in storage
      expect(storageFiles.has(ACTIVE_PLACES_FILENAME)).toBe(true)
      expect(storageFiles.has(ACTIVE_ROUTING_FILENAME)).toBe(true)
      expect(storageFiles.has(ACTIVE_PMTILES_FILENAME)).toBe(true)
      expect(storageFiles.has('active-release.json')).toBe(true)

      // Verify getInstalledRelease reflects the updated version
      const current = await service.getInstalledRelease()
      expect(current.manifest.version).toBe('2026.11.25')
      expect(current.source).toBe('updated')

      // Verify revert back to bundled release
      const reverted = await service.revertToBundledRelease()
      expect(reverted.manifest.version).toBe(BUNDLED_DELHI_MANIFEST.version)
      expect(reverted.source).toBe('bundled')
      expect(storageFiles.has('active-release.json')).toBe(false)
    })

    it('allows OfflineDelhiProvider to search newly updated places from active OPFS release', async () => {
      // Setup active release pointer and places in mock OPFS
      const updatedPlaces = [
        ['Bharat Mandapam Exhibition Center', 77.241, 28.618, 'amenity', 'events_venue'],
        ['Yashobhoomi Convention Center Dwarka', 77.034, 28.552, 'amenity', 'convention_center'],
      ]
      storageFiles.set(ACTIVE_PLACES_FILENAME, new TextEncoder().encode(JSON.stringify(updatedPlaces)))
      storageFiles.set(ACTIVE_ROUTING_FILENAME, new Uint8Array(createMockOdrgBuffer(1, 10, 20)))
      storageFiles.set(ACTIVE_PMTILES_FILENAME, new Uint8Array(createMockPmtilesBuffer(3)))

      const release: InstalledDatasetRelease = {
        manifest: {
          ...BUNDLED_DELHI_MANIFEST,
          version: '2026.11.25',
        },
        installedAt: Date.now(),
        source: 'updated',
        verified: true,
      }
      storageFiles.set('active-release.json', new TextEncoder().encode(JSON.stringify(release)))

      const provider = new OfflineDelhiProvider('/test/bundled-places.json')
      const places = await provider.loadPlaces()
      expect(places.length).toBe(2)
      expect(places[0].name).toBe('Bharat Mandapam Exhibition Center')

      // Search finds the new place
      const results = await provider.search('Bharat Mandapam')
      expect(results.length).toBe(1)
      expect(results[0].name).toBe('Bharat Mandapam Exhibition Center')
      expect(results[0].longitude).toBe(77.241)
    })

    it('allows OfflineDelhiRoutingProvider to reload and initialize graph from buffer', async () => {
      const routingProvider = new OfflineDelhiRoutingProvider()
      const mockGraphBuffer = createMockOdrgBuffer(1, 10, 20)

      const graph = await routingProvider.reloadGraph(mockGraphBuffer)
      expect(graph).toBeDefined()
      expect(graph.nodeCount).toBe(10)
      expect(graph.edgeCount).toBe(20)
    })
  })
})
