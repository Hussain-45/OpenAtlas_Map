import { FileSource, PMTiles, Protocol } from 'pmtiles'
import {
  clearActiveReleasePointer,
  deleteOfflinePackage,
  getActiveReleasePointer,
  getOfflineFile,
  getStorageQuota,
  hasOfflinePackage,
  isOpfsSupported,
  writeStreamToOpfs,
} from './opfsStorage'
import { ACTIVE_PMTILES_FILENAME } from './datasetUpdateService'
import {
  DELHI_PACKAGE_METADATA,
  type DownloadProgress,
  type OfflinePackageMetadata,
  type OfflinePackageState,
} from './types'

export class OfflineManager {
  private activeAbortController: AbortController | null = null
  private protocolInstance: Protocol | null = null
  private isProtocolRegistered = false

  /**
   * Evaluates the current state of the specified offline package without making network requests.
   */
  async getPackageState(metadata: OfflinePackageMetadata = DELHI_PACKAGE_METADATA): Promise<OfflinePackageState> {
    if (!isOpfsSupported()) {
      return {
        status: 'unsupported',
        error: 'OPFS is not supported in this browser.',
        lastChecked: Date.now(),
        metadata,
      }
    }

    try {
      // Check active release pointer first
      const activePointer = await getActiveReleasePointer()
      if (activePointer && activePointer.verified) {
        const activeFile = await getOfflineFile(ACTIVE_PMTILES_FILENAME, activePointer.manifest.assets.pmtiles.sizeBytes)
        if (activeFile) {
          return {
            status: 'ready',
            verifiedSize: activeFile.size,
            lastChecked: Date.now(),
            metadata: {
              ...metadata,
              expectedSize: activeFile.size,
            },
          }
        }
      }

      const isReady = await hasOfflinePackage(this.getFilename(metadata), metadata.expectedSize)
      if (isReady) {
        return {
          status: 'ready',
          verifiedSize: metadata.expectedSize,
          lastChecked: Date.now(),
          metadata,
        }
      }

      return {
        status: 'not_downloaded',
        lastChecked: Date.now(),
        metadata,
      }
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        lastChecked: Date.now(),
        metadata,
      }
    }
  }

  /**
   * Explicitly downloads the offline package into OPFS.
   * MUST ONLY be called upon explicit user request. Never triggered automatically.
   */
  async downloadPackage(
    metadata: OfflinePackageMetadata = DELHI_PACKAGE_METADATA,
    onProgress?: (progress: DownloadProgress) => void,
    externalSignal?: AbortSignal,
  ): Promise<OfflinePackageState> {
    if (!isOpfsSupported()) {
      return {
        status: 'unsupported',
        error: 'OPFS storage is not supported in this browser.',
        metadata,
      }
    }

    // Set up internal AbortController linked to external signal if provided
    this.activeAbortController = new AbortController()
    const abortHandler = () => this.activeAbortController?.abort()

    if (externalSignal) {
      if (externalSignal.aborted) {
        return { status: 'not_downloaded', error: 'Download was cancelled.', metadata }
      }
      externalSignal.addEventListener('abort', abortHandler)
    }

    try {
      // 1. Check storage quota before starting download
      const quota = await getStorageQuota()
      if (this.activeAbortController?.signal.aborted) {
        return {
          status: 'not_downloaded',
          error: 'Download cancelled by user.',
          metadata,
        }
      }

      if (quota.supported && quota.availableBytes !== undefined) {
        // Need space for both the incoming stream and temporary commit copy (~2x expected size)
        const requiredBytes = metadata.expectedSize * 2.1
        if (quota.availableBytes < requiredBytes) {
          throw new Error(
            `Insufficient storage quota: available ${Math.round(quota.availableBytes / (1024 * 1024))} MB, requires at least ${Math.round(requiredBytes / (1024 * 1024))} MB.`,
          )
        }
      }

      // 2. Fetch the archive stream
      const response = await fetch(metadata.sourceUrl, {
        signal: this.activeAbortController.signal,
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch package from ${metadata.sourceUrl}: HTTP ${response.status} ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('Response body stream is empty.')
      }

      const contentLengthHeader = response.headers.get('content-length')
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : metadata.expectedSize

      // 3. Stream directly to OPFS
      const filename = this.getFilename(metadata)
      const { size } = await writeStreamToOpfs(
        filename,
        response.body,
        totalBytes,
        onProgress,
        this.activeAbortController.signal,
      )

      // Automatically attach newly downloaded package to protocol instance
      try {
        const file = await getOfflineFile(filename, metadata.expectedSize)
        if (file) {
          this.attachPmtilesFile(file, metadata)
        }
      } catch {
        // Non-blocking attachment attempt
      }

      return {
        status: 'ready',
        verifiedSize: size,
        lastChecked: Date.now(),
        metadata,
      }
    } catch (err: unknown) {
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
        (this.activeAbortController?.signal.aborted ?? false)

      if (isAbort) {
        return {
          status: 'not_downloaded',
          error: 'Download cancelled by user.',
          metadata,
        }
      }

      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        metadata,
      }
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortHandler)
      }
      this.activeAbortController = null
    }
  }

  /**
   * Cancels any active download in progress.
   */
  cancelDownload(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }
  }

  /**
   * Deletes the specified offline package from OPFS.
   */
  async deletePackage(metadata: OfflinePackageMetadata = DELHI_PACKAGE_METADATA): Promise<OfflinePackageState> {
    this.detachPmtilesFile(metadata)
    const filename = this.getFilename(metadata)
    await deleteOfflinePackage(filename)
    await deleteOfflinePackage(ACTIVE_PMTILES_FILENAME)
    await clearActiveReleasePointer()
    return {
      status: 'not_downloaded',
      lastChecked: Date.now(),
      metadata,
    }
  }

  /**
   * Returns or initializes the shared PMTiles Protocol instance.
   */
  getProtocol(): Protocol {
    if (!this.protocolInstance) {
      this.protocolInstance = new Protocol()
    }
    return this.protocolInstance
  }

  /**
   * Registers the PMTiles protocol handler with MapLibre GL JS once globally.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerProtocol(maplibre: { addProtocol: (scheme: string, handler: any) => void }): void {
    if (this.isProtocolRegistered) return
    const protocol = this.getProtocol()
    maplibre.addProtocol('pmtiles', protocol.tile)
    this.isProtocolRegistered = true
  }

  /**
   * Attaches a local OPFS File to the Protocol instance under the expected keys.
   */
  attachPmtilesFile(file: File, metadata: OfflinePackageMetadata = DELHI_PACKAGE_METADATA): PMTiles {
    const pmtiles = this.createPmtilesInstance(file)
    const protocol = this.getProtocol()
    protocol.add(pmtiles)

    const filename = this.getFilename(metadata)
    // Alias keys for exact MapLibre PMTiles URL resolution
    protocol.tiles.set(filename, pmtiles)
    protocol.tiles.set(`/offline/delhi/${filename}`, pmtiles)
    protocol.tiles.set(`offline/delhi/${filename}`, pmtiles)
    return pmtiles
  }

  /**
   * Detaches the local OPFS File from the Protocol instance.
   */
  detachPmtilesFile(metadata: OfflinePackageMetadata = DELHI_PACKAGE_METADATA): void {
    if (!this.protocolInstance) return
    const filename = this.getFilename(metadata)
    this.protocolInstance.tiles.delete(filename)
    this.protocolInstance.tiles.delete(`/offline/delhi/${filename}`)
    this.protocolInstance.tiles.delete(`offline/delhi/${filename}`)
  }

  /**
   * Creates a PMTiles instance backed by the local OPFS File.
   */
  createPmtilesInstance(file: File): PMTiles {
    const fileSource = new FileSource(file)
    return new PMTiles(fileSource)
  }

  /**
   * Gets the File object for an installed offline package.
   */
  async getPackageFile(metadata: OfflinePackageMetadata = DELHI_PACKAGE_METADATA): Promise<File | null> {
    const activePointer = await getActiveReleasePointer()
    if (activePointer && activePointer.verified) {
      const activeFile = await getOfflineFile(ACTIVE_PMTILES_FILENAME, activePointer.manifest.assets.pmtiles.sizeBytes)
      if (activeFile) return activeFile
    }
    const filename = this.getFilename(metadata)
    return getOfflineFile(filename, metadata.expectedSize)
  }

  /**
   * Attaches the active release PMTiles file to the protocol if available.
   */
  async attachActiveReleaseIfPresent(metadata: OfflinePackageMetadata = DELHI_PACKAGE_METADATA): Promise<boolean> {
    if (!isOpfsSupported()) return false
    try {
      const file = await this.getPackageFile(metadata)
      if (file) {
        this.attachPmtilesFile(file, metadata)
        return true
      }
    } catch {
      // Non-blocking
    }
    return false
  }

  /**
   * Determines if a given geographic coordinate falls within the covered package bounding box.
   */
  isCoordinateInsideBounds(
    longitude: number,
    latitude: number,
    bounds = DELHI_PACKAGE_METADATA.bounds,
  ): boolean {
    const [minLon, minLat, maxLon, maxLat] = bounds
    return (
      longitude >= minLon &&
      longitude <= maxLon &&
      latitude >= minLat &&
      latitude <= maxLat
    )
  }

  private getFilename(metadata: OfflinePackageMetadata): string {
    const parts = metadata.sourceUrl.split('/')
    return parts[parts.length - 1] || 'offline.pmtiles'
  }
}

export const offlineManager = new OfflineManager()
