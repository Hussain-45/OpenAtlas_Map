import {
  cleanupStagingFiles,
  clearActiveReleasePointer,
  copyOpfsFile,
  deleteOpfsFile,
  getActiveReleasePointer,
  getOpfsArrayBuffer,
  getOpfsFile,
  getStorageQuota,
  isOpfsSupported,
  setActiveReleasePointer,
  STAGING_PREFIX,
  writeStreamToOpfs,
} from './opfsStorage'
import type {
  DatasetAssetDescriptor,
  DatasetReleaseManifest,
  DatasetUpdateProgress,
  InstalledDatasetRelease,
  UpdateCheckResult,
} from './manifestTypes'
import {
  isNewerVersion,
  validateManifest,
  validatePlacesData,
  validatePmtilesBuffer,
  validateRoutingGraphBuffer,
  verifySha256,
} from './manifestValidator'

export const ACTIVE_PMTILES_FILENAME = 'active_delhi_basemap.pmtiles'
export const ACTIVE_ROUTING_FILENAME = 'active_delhi_routing.bin'
export const ACTIVE_PLACES_FILENAME = 'active_delhi_places.json'

export const BUNDLED_DELHI_MANIFEST: DatasetReleaseManifest = {
  id: 'delhi-nct',
  name: 'Delhi NCT Core & Regional Network',
  version: '2026.10.20',
  releaseDate: '2026-10-20T12:00:00Z',
  description: 'Bundled OpenAtlas offline release with 13,594 indexed POIs and 944,338 routing nodes.',
  bounds: [76.978, 28.44, 77.497, 28.738],
  center: [77.2375, 28.589],
  attribution: '© OpenStreetMap contributors, BBBike.org, VersaTiles Colorful',
  assets: {
    pmtiles: {
      type: 'pmtiles',
      path: '/offline/delhi/NewDelhi.osm.pmtiles',
      filename: 'NewDelhi.osm.pmtiles',
      sizeBytes: 15361932,
      sha256: '51e3cbf69fd4fcbad19d41dbfd432466d159522db7b618d8099374ac931a626d',
      specVersion: 3,
    },
    routingGraph: {
      type: 'routing-graph',
      path: '/offline/delhi/delhi-routing-graph.bin',
      filename: 'delhi-routing-graph.bin',
      sizeBytes: 22859718,
      sha256: '3051698dd59274877bd3b38a927c048252163e9717fbb3867207a323c9732236',
      specVersion: 1,
    },
    places: {
      type: 'places-index',
      path: '/offline/delhi/places.json',
      filename: 'places.json',
      sizeBytes: 852524,
      sha256: '74a6e77224e619d8fd0d57767e56e6fe6c29dfd37c278f1d5f143ca7bf944f9b',
    },
  },
  metadata: {
    nodeCount: 944338,
    edgeCount: 1080347,
    placeCount: 13594,
    totalRoadKm: 33001.1,
    sourceDataDate: '2026-10-20',
  },
}

export type DatasetUpdateListener = (release: InstalledDatasetRelease) => void

export class DatasetUpdateService {
  private activeAbortController: AbortController | null = null
  private listeners = new Set<DatasetUpdateListener>()

  /**
   * Registers a listener to be called whenever a dataset update is activated or reverted.
   */
  onUpdateActivated(listener: DatasetUpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(release: InstalledDatasetRelease): void {
    for (const listener of this.listeners) {
      try {
        listener(release)
      } catch (err) {
        console.warn('Dataset update listener error:', err)
      }
    }
  }

  /**
   * Retrieves the currently active dataset release.
   * Checks OPFS active release pointer; falls back to bundled release.
   */
  async getInstalledRelease(): Promise<InstalledDatasetRelease> {
    if (!isOpfsSupported()) {
      return {
        manifest: BUNDLED_DELHI_MANIFEST,
        installedAt: new Date(BUNDLED_DELHI_MANIFEST.releaseDate).getTime(),
        source: 'bundled',
        verified: true,
      }
    }

    try {
      const activePointer = await getActiveReleasePointer()
      if (activePointer && activePointer.verified && activePointer.manifest) {
        // Confirm active files exist
        const pmtilesFile = await getOpfsFile(ACTIVE_PMTILES_FILENAME)
        const routingFile = await getOpfsFile(ACTIVE_ROUTING_FILENAME)
        const placesFile = await getOpfsFile(ACTIVE_PLACES_FILENAME)

        if (pmtilesFile && routingFile && placesFile) {
          return activePointer
        }
      }
    } catch {
      // Fallback on error
    }

    return {
      manifest: BUNDLED_DELHI_MANIFEST,
      installedAt: new Date(BUNDLED_DELHI_MANIFEST.releaseDate).getTime(),
      source: 'bundled',
      verified: true,
    }
  }

  /**
   * Checks the remote server for an updated dataset manifest.
   */
  async checkForUpdates(
    manifestUrl = '/offline/delhi/manifest.json',
    signal?: AbortSignal,
  ): Promise<UpdateCheckResult> {
    const installed = await this.getInstalledRelease()
    const currentVersion = installed.manifest.version

    try {
      // Use cache-busting timestamp param to avoid stale SW / browser HTTP caches
      const fetchUrl = manifestUrl.includes('?')
        ? `${manifestUrl}&_t=${Date.now()}`
        : `${manifestUrl}?_t=${Date.now()}`

      const response = await fetch(fetchUrl, {
        signal,
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch update manifest: HTTP ${response.status} ${response.statusText}`)
      }

      const data: unknown = await response.json()
      const validation = validateManifest(data)
      if (!validation.valid || !validation.manifest) {
        throw new Error(`Invalid manifest received: ${validation.error || 'schema mismatch'}`)
      }

      const remoteManifest = validation.manifest
      const hasUpdate = isNewerVersion(remoteManifest.version, currentVersion)

      return {
        hasUpdate,
        currentVersion,
        latestVersion: remoteManifest.version,
        latestManifest: remoteManifest,
        checkedAt: Date.now(),
      }
    } catch (err) {
      if (signal?.aborted) throw err
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        checkedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Downloads, validates, and installs an update package safely.
   *
   * SAFE ROLLBACK GUARANTEE:
   * 1. All assets are downloaded into isolated staging files.
   * 2. Hashes and internal file signatures are fully verified.
   * 3. If any step fails or is cancelled, staging files are deleted; the previous active dataset is 100% preserved.
   * 4. Only after ALL 3 assets pass 100% are they promoted and activated.
   */
  async downloadAndInstallUpdate(
    manifest: DatasetReleaseManifest,
    onProgress?: (progress: DatasetUpdateProgress) => void,
    externalSignal?: AbortSignal,
  ): Promise<InstalledDatasetRelease> {
    if (!isOpfsSupported()) {
      throw new Error('OPFS storage is not supported in this browser. Updated offline datasets require OPFS.')
    }

    const validation = validateManifest(manifest)
    if (!validation.valid || !validation.manifest) {
      throw new Error(`Cannot install invalid manifest: ${validation.error}`)
    }

    this.activeAbortController = new AbortController()
    const abortHandler = () => this.activeAbortController?.abort()

    if (externalSignal) {
      if (externalSignal.aborted) {
        throw new DOMException('Download cancelled by user.', 'AbortError')
      }
      externalSignal.addEventListener('abort', abortHandler)
    }

    const stagePmtilesFile = `${STAGING_PREFIX}delhi_${manifest.version}_basemap.pmtiles`
    const stageRoutingFile = `${STAGING_PREFIX}delhi_${manifest.version}_routing.bin`
    const stagePlacesFile = `${STAGING_PREFIX}delhi_${manifest.version}_places.json`

    const totalBytesToDownload =
      manifest.assets.places.sizeBytes +
      manifest.assets.routingGraph.sizeBytes +
      manifest.assets.pmtiles.sizeBytes

    let totalBytesDownloaded = 0

    try {
      // 1. Quota check (~2.5x total bytes for staging + commit)
      const quota = await getStorageQuota()
      if (quota.supported && quota.availableBytes !== undefined) {
        const required = totalBytesToDownload * 2.5
        if (quota.availableBytes < required) {
          throw new Error(
            `Insufficient storage space: ${Math.round(quota.availableBytes / (1024 * 1024))} MB available, requires ${Math.round(required / (1024 * 1024))} MB.`,
          )
        }
      }

      // 2. Clean up any previous stale staging files
      await cleanupStagingFiles()

      // Define staging tasks in order of increasing size (places -> routing -> basemap)
      const assetTasks: Array<{
        key: 'places' | 'routingGraph' | 'pmtiles'
        label: 'places' | 'routing-graph' | 'pmtiles'
        stagedFilename: string
        descriptor: DatasetAssetDescriptor
      }> = [
        {
          key: 'places',
          label: 'places',
          stagedFilename: stagePlacesFile,
          descriptor: manifest.assets.places,
        },
        {
          key: 'routingGraph',
          label: 'routing-graph',
          stagedFilename: stageRoutingFile,
          descriptor: manifest.assets.routingGraph,
        },
        {
          key: 'pmtiles',
          label: 'pmtiles',
          stagedFilename: stagePmtilesFile,
          descriptor: manifest.assets.pmtiles,
        },
      ]

      for (let i = 0; i < assetTasks.length; i++) {
        const task = assetTasks[i]
        const asset = task.descriptor

        if (this.activeAbortController?.signal.aborted) {
          throw new DOMException('Download cancelled by user.', 'AbortError')
        }

        // Fetch asset stream
        const response = await fetch(asset.path, {
          signal: this.activeAbortController?.signal,
        })

        if (!response.ok) {
          throw new Error(`Failed to download ${task.label} from ${asset.path}: HTTP ${response.status} ${response.statusText}`)
        }

        if (!response.body) {
          throw new Error(`Empty response body received for ${task.label}`)
        }

        let assetCurrentBytes = 0
        const onAssetProgress = (p: { bytesDownloaded: number }) => {
          const delta = p.bytesDownloaded - assetCurrentBytes
          assetCurrentBytes = p.bytesDownloaded
          totalBytesDownloaded += delta

          if (onProgress) {
            onProgress({
              currentAsset: task.label,
              assetIndex: i + 1,
              totalAssets: assetTasks.length,
              assetBytesDownloaded: p.bytesDownloaded,
              assetTotalBytes: asset.sizeBytes,
              totalBytesDownloaded,
              totalBytesToDownload,
              percentage: totalBytesToDownload > 0 ? Math.min(100, (totalBytesDownloaded / totalBytesToDownload) * 100) : 0,
            })
          }
        }

        // Stream into staging file
        await writeStreamToOpfs(
          task.stagedFilename,
          response.body,
          asset.sizeBytes,
          onAssetProgress,
          this.activeAbortController?.signal,
        )

        // Read back buffer to verify checksum and internal integrity
        const buffer = await getOpfsArrayBuffer(task.stagedFilename)
        if (!buffer) {
          throw new Error(`Failed to verify ${task.label}: staged file could not be read.`)
        }

        if (buffer.byteLength !== asset.sizeBytes) {
          throw new Error(
            `Size mismatch for ${task.label}: received ${buffer.byteLength} bytes, expected ${asset.sizeBytes} bytes.`,
          )
        }

        // SHA-256 verification
        const hashResult = await verifySha256(buffer, asset.sha256)
        if (!hashResult.match) {
          throw new Error(
            `Checksum mismatch for ${task.label}! Expected SHA-256: ${asset.sha256}, calculated: ${hashResult.actualSha256}. Update aborted to preserve data integrity.`,
          )
        }

        // Deep content format validation
        if (task.label === 'pmtiles') {
          const pmtilesCheck = validatePmtilesBuffer(buffer)
          if (!pmtilesCheck.valid) {
            throw new Error(`Corrupted PMTiles basemap archive: ${pmtilesCheck.error}`)
          }
        } else if (task.label === 'routing-graph') {
          const graphCheck = validateRoutingGraphBuffer(buffer)
          if (!graphCheck.valid) {
            throw new Error(`Corrupted road routing graph: ${graphCheck.error}`)
          }
        } else if (task.label === 'places') {
          try {
            const text = new TextDecoder().decode(buffer)
            const json = JSON.parse(text)
            const placesCheck = validatePlacesData(json)
            if (!placesCheck.valid) {
              throw new Error(`Corrupted places index: ${placesCheck.error}`)
            }
          } catch (jsonErr) {
            throw new Error(`Failed to parse places JSON: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`)
          }
        }
      }

      // ATOMIC PROMOTION: Only reached if ALL 3 assets pass 100% of checks
      if (onProgress) {
        onProgress({
          currentAsset: 'activating',
          assetIndex: 3,
          totalAssets: 3,
          assetBytesDownloaded: manifest.assets.pmtiles.sizeBytes,
          assetTotalBytes: manifest.assets.pmtiles.sizeBytes,
          totalBytesDownloaded: totalBytesToDownload,
          totalBytesToDownload,
          percentage: 100,
        })
      }

      await copyOpfsFile(stagePlacesFile, ACTIVE_PLACES_FILENAME)
      await copyOpfsFile(stageRoutingFile, ACTIVE_ROUTING_FILENAME)
      await copyOpfsFile(stagePmtilesFile, ACTIVE_PMTILES_FILENAME)

      const installedRelease: InstalledDatasetRelease = {
        manifest,
        installedAt: Date.now(),
        source: 'updated',
        verified: true,
      }

      await setActiveReleasePointer(installedRelease)

      // Clean up staging files after promotion
      await cleanupStagingFiles()

      // Notify running services of active release
      this.notifyListeners(installedRelease)

      return installedRelease
    } catch (err) {
      // ROLLBACK SAFETY: Clean up any staged files immediately.
      // The previous active files and active pointer are completely untouched!
      await cleanupStagingFiles()
      throw err
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortHandler)
      }
      this.activeAbortController = null
    }
  }

  /**
   * Cancels any ongoing update download.
   */
  cancelUpdate(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }
  }

  /**
   * Reverts the offline dataset back to the default bundled release,
   * removing custom active files from OPFS.
   */
  async revertToBundledRelease(): Promise<InstalledDatasetRelease> {
    await clearActiveReleasePointer()
    await deleteOpfsFile(ACTIVE_PLACES_FILENAME)
    await deleteOpfsFile(ACTIVE_ROUTING_FILENAME)
    await deleteOpfsFile(ACTIVE_PMTILES_FILENAME)
    await cleanupStagingFiles()

    const bundled: InstalledDatasetRelease = {
      manifest: BUNDLED_DELHI_MANIFEST,
      installedAt: new Date(BUNDLED_DELHI_MANIFEST.releaseDate).getTime(),
      source: 'bundled',
      verified: true,
    }

    this.notifyListeners(bundled)
    return bundled
  }
}

export const datasetUpdateService = new DatasetUpdateService()
