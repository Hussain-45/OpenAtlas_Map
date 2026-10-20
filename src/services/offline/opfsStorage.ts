import { bytesToHeader, type Header } from 'pmtiles'
import type { DownloadProgress, StorageQuotaInfo } from './types'
import type { InstalledDatasetRelease } from './manifestTypes'

export const DEFAULT_PMTILES_FILENAME = 'NewDelhi.osm.pmtiles'
export const DEFAULT_EXPECTED_SIZE = 15361932
export const ACTIVE_RELEASE_FILENAME = 'active-release.json'
export const STAGING_PREFIX = 'staging_'

/**
 * Checks whether the current runtime environment supports the Origin Private File System (OPFS).
 */
export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.storage) &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

/**
 * Retrieves the current browser storage quota and usage estimates safely.
 */
export async function getStorageQuota(): Promise<StorageQuotaInfo> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
    return { supported: false }
  }

  try {
    const estimate = await navigator.storage.estimate()
    const usageBytes = estimate.usage ?? 0
    const quotaBytes = estimate.quota ?? 0
    const availableBytes = Math.max(0, quotaBytes - usageBytes)

    return {
      supported: true,
      usageBytes,
      quotaBytes,
      availableBytes,
    }
  } catch {
    return { supported: false }
  }
}

/**
 * Validates that an ArrayBuffer (or slice) contains a valid PMTiles v3 header.
 */
export function validatePmtilesHeader(buffer: ArrayBuffer): { valid: boolean; header?: Header; error?: string } {
  if (!buffer || buffer.byteLength < 127) {
    return { valid: false, error: 'Buffer is smaller than the required 127-byte PMTiles header.' }
  }

  try {
    const header = bytesToHeader(buffer)
    if (header.specVersion !== 3) {
      return { valid: false, error: `Unsupported PMTiles spec version: ${header.specVersion} (expected 3)` }
    }
    if (header.tileType !== 1) {
      return { valid: false, error: `Unexpected tile type: ${header.tileType} (expected 1 for MVT/vector)` }
    }
    return { valid: true, header }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Checks whether an offline package exists in OPFS and passes byte-length and header verification.
 */
export async function hasOfflinePackage(
  filename = DEFAULT_PMTILES_FILENAME,
  expectedSize = DEFAULT_EXPECTED_SIZE,
): Promise<boolean> {
  if (!isOpfsSupported()) return false

  try {
    const root = await navigator.storage.getDirectory()
    const fileHandle = await root.getFileHandle(filename)
    const file = await fileHandle.getFile()

    if (file.size !== expectedSize) {
      return false
    }

    // Verify header from first 127 bytes without loading the whole file into RAM
    const slice = await file.slice(0, 127).arrayBuffer()
    const validation = validatePmtilesHeader(slice)
    return validation.valid
  } catch {
    return false
  }
}

/**
 * Retrieves the File object for an offline package stored in OPFS.
 */
export async function getOfflineFile(
  filename = DEFAULT_PMTILES_FILENAME,
  expectedSize = DEFAULT_EXPECTED_SIZE,
): Promise<File | null> {
  if (!isOpfsSupported()) return null

  try {
    const root = await navigator.storage.getDirectory()
    const fileHandle = await root.getFileHandle(filename)
    const file = await fileHandle.getFile()

    if (expectedSize > 0 && file.size !== expectedSize) {
      return null
    }

    const slice = await file.slice(0, 127).arrayBuffer()
    const validation = validatePmtilesHeader(slice)
    if (!validation.valid) {
      return null
    }

    return file
  } catch {
    return null
  }
}

/**
 * Retrieves generic File from OPFS by filename.
 */
export async function getOpfsFile(filename: string): Promise<File | null> {
  if (!isOpfsSupported()) return null
  try {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(filename)
    return await handle.getFile()
  } catch {
    return null
  }
}

/**
 * Reads an entire OPFS file into an ArrayBuffer.
 */
export async function getOpfsArrayBuffer(filename: string): Promise<ArrayBuffer | null> {
  const file = await getOpfsFile(filename)
  if (!file) return null
  return await file.arrayBuffer()
}

/**
 * Reads and parses JSON from an OPFS file.
 */
export async function getOpfsJson<T>(filename: string): Promise<T | null> {
  const file = await getOpfsFile(filename)
  if (!file) return null
  try {
    const text = await file.text()
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * Writes text or JSON directly to an OPFS file.
 */
export async function writeOpfsText(filename: string, text: string): Promise<void> {
  if (!isOpfsSupported()) throw new Error('OPFS is not supported.')
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  try {
    const encoded = new TextEncoder().encode(text)
    await writable.write(encoded)
    await writable.close()
  } catch (err) {
    try {
      await writable.abort()
    } catch {
      // Ignore abort failure
    }
    throw err
  }
}

/**
 * Retrieves the currently active dataset release manifest pointer from OPFS.
 */
export async function getActiveReleasePointer(): Promise<InstalledDatasetRelease | null> {
  return await getOpfsJson<InstalledDatasetRelease>(ACTIVE_RELEASE_FILENAME)
}

/**
 * Atomically updates the active release manifest pointer in OPFS.
 */
export async function setActiveReleasePointer(release: InstalledDatasetRelease): Promise<void> {
  await writeOpfsText(ACTIVE_RELEASE_FILENAME, JSON.stringify(release, null, 2))
}

/**
 * Clears the active release manifest pointer from OPFS.
 */
export async function clearActiveReleasePointer(): Promise<void> {
  await deleteOpfsFile(ACTIVE_RELEASE_FILENAME)
}

/**
 * Deletes an offline package (and any leftover temporary download files) from OPFS.
 */
export async function deleteOfflinePackage(filename = DEFAULT_PMTILES_FILENAME): Promise<boolean> {
  if (!isOpfsSupported()) return false

  try {
    const root = await navigator.storage.getDirectory()
    let deletedAny = false

    try {
      await root.removeEntry(filename)
      deletedAny = true
    } catch {
      // Main file may not exist
    }

    try {
      await root.removeEntry(`${filename}.tmp`)
      deletedAny = true
    } catch {
      // Temp file may not exist
    }

    return deletedAny
  } catch {
    return false
  }
}

/**
 * Deletes any file by name from OPFS root.
 */
export async function deleteOpfsFile(filename: string): Promise<boolean> {
  if (!isOpfsSupported()) return false
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(filename)
    return true
  } catch {
    return false
  }
}

/**
 * Cleans up any staging files or leftover temporary files in OPFS.
 */
export async function cleanupStagingFiles(prefix = STAGING_PREFIX): Promise<void> {
  if (!isOpfsSupported()) return
  try {
    const root = await navigator.storage.getDirectory()
    // Scan entries if supported
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootAny = root as any
    if (typeof rootAny.values === 'function') {
      for await (const entry of rootAny.values()) {
        if (entry.kind === 'file') {
          const name: string = entry.name
          if (name.startsWith(prefix) || name.endsWith('.tmp')) {
            try {
              await root.removeEntry(name)
            } catch {
              // Ignore deletion error
            }
          }
        }
      }
    }
  } catch {
    // Non-blocking cleanup
  }
}

/**
 * Copies a file from source handle to destination handle within OPFS.
 */
export async function copyOpfsFile(sourceFilename: string, destFilename: string): Promise<void> {
  if (!isOpfsSupported()) throw new Error('OPFS is not supported.')
  const root = await navigator.storage.getDirectory()
  const sourceHandle = await root.getFileHandle(sourceFilename)
  const sourceFile = await sourceHandle.getFile()

  const destHandle = await root.getFileHandle(destFilename, { create: true })
  const writable = await destHandle.createWritable()
  try {
    const stream = sourceFile.stream()
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        await writable.write(value)
      }
    }
    await writable.close()
  } catch (err) {
    try {
      await writable.abort()
    } catch {
      // Ignore
    }
    throw err
  }
}

/**
 * Streams data from a ReadableStream directly into an OPFS file with progress reporting and cancellation.
 */
export async function writeStreamToOpfs(
  filename: string,
  stream: ReadableStream<Uint8Array>,
  totalBytes: number,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<{ size: number }> {
  if (!isOpfsSupported()) {
    throw new Error('OPFS is not supported in this browser environment.')
  }

  const root = await navigator.storage.getDirectory()
  const tmpFilename = `${filename}.tmp`

  // Remove any stale temporary file first
  try {
    await root.removeEntry(tmpFilename)
  } catch {
    // Ignore if it did not exist
  }

  const tmpHandle = await root.getFileHandle(tmpFilename, { create: true })
  let writable: FileSystemWritableFileStream | null = null

  try {
    writable = await tmpHandle.createWritable()
    const reader = stream.getReader()
    let bytesDownloaded = 0

    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Download aborted by user', 'AbortError')
      }

      const { done, value } = await reader.read()
      if (done) break

      if (value) {
        await writable.write(value as unknown as BufferSource)
        bytesDownloaded += value.byteLength

        if (onProgress) {
          const percentage = totalBytes > 0 ? Math.min(100, (bytesDownloaded / totalBytes) * 100) : 0
          onProgress({ bytesDownloaded, totalBytes, percentage })
        }
      }
    }

    await writable.close()
    writable = null

    // Inspect the written temporary file
    const file = await tmpHandle.getFile()
    if (totalBytes > 0 && file.size !== totalBytes) {
      throw new Error(`Downloaded file size mismatch: got ${file.size} bytes, expected ${totalBytes} bytes.`)
    }

    // Verify PMTiles header if filename indicates PMTiles
    if (filename.endsWith('.pmtiles')) {
      const headerBuffer = await file.slice(0, 127).arrayBuffer()
      const validation = validatePmtilesHeader(headerBuffer)
      if (!validation.valid) {
        throw new Error(`PMTiles header validation failed: ${validation.error}`)
      }
    }

    // Commit file: write to target filename and remove .tmp
    const targetHandle = await root.getFileHandle(filename, { create: true })
    const targetWritable = await targetHandle.createWritable()
    const fileStream = file.stream()
    const targetReader = fileStream.getReader()

    while (true) {
      const { done, value } = await targetReader.read()
      if (done) break
      if (value) {
        await targetWritable.write(value)
      }
    }
    await targetWritable.close()

    // Clean up temporary file
    try {
      await root.removeEntry(tmpFilename)
    } catch {
      // Ignore
    }

    return { size: file.size }
  } catch (err) {
    if (writable) {
      try {
        await writable.abort()
      } catch {
        // Ignore abort failure
      }
    }
    // Clean up temporary file upon error or cancellation
    try {
      await root.removeEntry(tmpFilename)
    } catch {
      // Ignore
    }
    throw err
  }
}
