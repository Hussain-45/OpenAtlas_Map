import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  getStorageQuota,
  isOpfsSupported,
  validatePmtilesHeader,
} from './opfsStorage'
import { OfflineManager, offlineManager } from './offlineManager'
import { DELHI_PACKAGE_METADATA } from './types'

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

function createMockPmtilesHeader(specVersion = 3, tileType = 1): ArrayBuffer {
  const copy = new Uint8Array(REAL_VALID_HEADER)
  copy[7] = specVersion
  copy[99] = tileType
  return copy.buffer
}

describe('opfsStorage', () => {
  const origNavigator = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      configurable: true,
      writable: true,
    })
    vi.restoreAllMocks()
  })

  function setNavigator(nav: unknown) {
    Object.defineProperty(globalThis, 'navigator', {
      value: nav,
      configurable: true,
      writable: true,
    })
  }

  describe('validatePmtilesHeader', () => {
    it('rejects buffers smaller than 127 bytes', () => {
      const small = new ArrayBuffer(50)
      const res = validatePmtilesHeader(small)
      expect(res.valid).toBe(false)
      expect(res.error).toContain('smaller than the required 127-byte')
    })

    it('rejects unsupported spec versions', () => {
      const invalidSpec = createMockPmtilesHeader(4)
      const res = validatePmtilesHeader(invalidSpec)
      expect(res.valid).toBe(false)
      expect(res.error).toContain('spec version')
    })

    it('validates a correct PMTiles v3 header', () => {
      const valid = createMockPmtilesHeader(3, 1)
      const res = validatePmtilesHeader(valid)
      expect(res.valid).toBe(true)
      expect(res.header?.specVersion).toBe(3)
      expect(res.header?.tileType).toBe(1)
      expect(res.header?.minZoom).toBe(0)
      expect(res.header?.maxZoom).toBe(14)
    })
  })

  describe('isOpfsSupported', () => {
    it('returns false when navigator.storage is undefined', () => {
      setNavigator({})
      expect(isOpfsSupported()).toBe(false)
    })

    it('returns true when getDirectory is defined', () => {
      setNavigator({
        storage: {
          getDirectory: vi.fn(),
        },
      })
      expect(isOpfsSupported()).toBe(true)
    })
  })

  describe('getStorageQuota', () => {
    it('returns supported: false when estimate() is unavailable', async () => {
      setNavigator({})
      const res = await getStorageQuota()
      expect(res.supported).toBe(false)
    })

    it('calculates available bytes when estimate() succeeds', async () => {
      setNavigator({
        storage: {
          estimate: vi.fn().mockResolvedValue({
            usage: 50 * 1024 * 1024,
            quota: 200 * 1024 * 1024,
          }),
        },
      })
      const res = await getStorageQuota()
      expect(res.supported).toBe(true)
      expect(res.usageBytes).toBe(50 * 1024 * 1024)
      expect(res.quotaBytes).toBe(200 * 1024 * 1024)
      expect(res.availableBytes).toBe(150 * 1024 * 1024)
    })
  })
})

describe('OfflineManager', () => {
  let manager: OfflineManager
  const origNavigator = globalThis.navigator
  const origFetch = globalThis.fetch

  beforeEach(() => {
    manager = new OfflineManager()
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

  function setNavigator(nav: unknown) {
    Object.defineProperty(globalThis, 'navigator', {
      value: nav,
      configurable: true,
      writable: true,
    })
  }

  describe('isCoordinateInsideBounds', () => {
    it('returns true for locations inside Delhi NCT core', () => {
      // Connaught Place
      expect(manager.isCoordinateInsideBounds(77.219, 28.631)).toBe(true)
      // Hauz Khas
      expect(manager.isCoordinateInsideBounds(77.206, 28.549)).toBe(true)
      // Rohini
      expect(manager.isCoordinateInsideBounds(77.115, 28.715)).toBe(true)
      // Noida Sector 18 (inside eastern border)
      expect(manager.isCoordinateInsideBounds(77.325, 28.57)).toBe(true)
    })

    it('returns false for locations outside Delhi extract bounds', () => {
      // Mumbai
      expect(manager.isCoordinateInsideBounds(72.877, 19.076)).toBe(false)
      // Bengaluru
      expect(manager.isCoordinateInsideBounds(77.594, 12.971)).toBe(false)
      // Greater Noida (east of 77.497 E)
      expect(manager.isCoordinateInsideBounds(77.55, 28.47)).toBe(false)
      // Southern Gurugram / Manesar (south of 28.44 N)
      expect(manager.isCoordinateInsideBounds(76.93, 28.35)).toBe(false)
      // Sonipat / Narela North (north of 28.738 N)
      expect(manager.isCoordinateInsideBounds(77.10, 28.85)).toBe(false)
    })

    it('returns true for exact boundary edges', () => {
      expect(manager.isCoordinateInsideBounds(76.978, 28.44)).toBe(true)
      expect(manager.isCoordinateInsideBounds(77.497, 28.738)).toBe(true)
    })
  })

  describe('getPackageState', () => {
    it('reports unsupported when OPFS is missing', async () => {
      setNavigator({})
      const state = await manager.getPackageState()
      expect(state.status).toBe('unsupported')
      expect(state.error).toContain('OPFS is not supported')
    })
  })

  describe('downloadPackage and cancelDownload', () => {
    it('aborts download when AbortController is triggered', async () => {
      setNavigator({
        storage: {
          getDirectory: vi.fn().mockResolvedValue({
            getFileHandle: vi.fn(),
            removeEntry: vi.fn(),
          }),
          estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1e9 }),
        },
      })

      const controller = new AbortController()
      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          if (options?.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

      const downloadPromise = manager.downloadPackage(DELHI_PACKAGE_METADATA, undefined, controller.signal)
      controller.abort()

      const res = await downloadPromise
      expect(res.status).toBe('not_downloaded')
      expect(res.error).toContain('cancelled')
    })

    it('aborts download when cancelDownload is called directly on manager', async () => {
      setNavigator({
        storage: {
          getDirectory: vi.fn().mockResolvedValue({
            getFileHandle: vi.fn(),
            removeEntry: vi.fn(),
          }),
          estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1e9 }),
        },
      })

      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          if (options?.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

      const downloadPromise = manager.downloadPackage(DELHI_PACKAGE_METADATA)
      manager.cancelDownload()

      const res = await downloadPromise
      expect(res.status).toBe('not_downloaded')
      expect(res.error).toContain('cancelled')
    })

    it('rejects download when available storage quota is insufficient', async () => {
      setNavigator({
        storage: {
          getDirectory: vi.fn(),
          // Only 5 MB available, package requires ~32 MB
          estimate: vi.fn().mockResolvedValue({
            usage: 95 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
          }),
        },
      })

      const res = await manager.downloadPackage(DELHI_PACKAGE_METADATA)
      expect(res.status).toBe('error')
      expect(res.error).toContain('Insufficient storage quota')
    })

    it('handles HTTP error responses gracefully', async () => {
      setNavigator({
        storage: {
          getDirectory: vi.fn(),
          estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1e9 }),
        },
      })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const res = await manager.downloadPackage(DELHI_PACKAGE_METADATA)
      expect(res.status).toBe('error')
      expect(res.error).toContain('HTTP 404 Not Found')
    })
  })

  describe('createPmtilesInstance', () => {
    it('creates a PMTiles instance with a FileSource', () => {
      const mockFile = new File([new ArrayBuffer(127)], 'NewDelhi.osm.pmtiles')
      const instance = manager.createPmtilesInstance(mockFile)
      expect(instance).toBeDefined()
      expect(typeof instance.getHeader).toBe('function')
    })
  })

  describe('protocol registration and file attachment', () => {
    it('returns a Protocol instance and registers once with MapLibre', () => {
      const mockAddProtocol = vi.fn()
      const mockMapLibre = { addProtocol: mockAddProtocol }

      manager.registerProtocol(mockMapLibre)
      expect(mockAddProtocol).toHaveBeenCalledTimes(1)
      expect(mockAddProtocol).toHaveBeenCalledWith('pmtiles', expect.any(Function))

      // Second registration should be a no-op
      manager.registerProtocol(mockMapLibre)
      expect(mockAddProtocol).toHaveBeenCalledTimes(1)
    })

    it('attaches and detaches PMTiles file across path aliases in protocol', () => {
      const mockFile = new File([new ArrayBuffer(127)], 'NewDelhi.osm.pmtiles')
      const pmtiles = manager.attachPmtilesFile(mockFile)
      const protocol = manager.getProtocol()

      expect(protocol.tiles.get('NewDelhi.osm.pmtiles')).toBe(pmtiles)
      expect(protocol.tiles.get('/offline/delhi/NewDelhi.osm.pmtiles')).toBe(pmtiles)
      expect(protocol.tiles.get('offline/delhi/NewDelhi.osm.pmtiles')).toBe(pmtiles)

      manager.detachPmtilesFile()
      expect(protocol.tiles.get('NewDelhi.osm.pmtiles')).toBeUndefined()
      expect(protocol.tiles.get('/offline/delhi/NewDelhi.osm.pmtiles')).toBeUndefined()
    })
  })

  describe('isCoordinateInsideBounds', () => {
    it('returns true for coordinates inside the Delhi package bounding box', () => {
      // Connaught Place: [77.2090, 28.6139]
      expect(manager.isCoordinateInsideBounds(77.2090, 28.6139)).toBe(true)
      // India Gate: [77.2295, 28.6129]
      expect(manager.isCoordinateInsideBounds(77.2295, 28.6129)).toBe(true)
    })

    it('returns false for coordinates outside the Delhi package bounding box', () => {
      // Jaipur: [75.7873, 26.9124]
      expect(manager.isCoordinateInsideBounds(75.7873, 26.9124)).toBe(false)
      // Mumbai: [72.8777, 19.0760]
      expect(manager.isCoordinateInsideBounds(72.8777, 19.0760)).toBe(false)
    })
  })

  describe('singleton export', () => {
    it('exports singleton instance', () => {
      expect(offlineManager).toBeInstanceOf(OfflineManager)
    })
  })
})
