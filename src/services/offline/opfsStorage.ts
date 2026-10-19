import { bytesToHeader, type Header } from 'pmtiles'
import type { DownloadProgress, StorageQuotaInfo } from './types'

export const DEFAULT_PMTILES_FILENAME = 'NewDelhi.osm.pmtiles'
export const DEFAULT_EXPECTED_SIZE = 15361932

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

    if (file.size !== expectedSize) {
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

    // Verify PMTiles header
    const headerBuffer = await file.slice(0, 127).arrayBuffer()
    const validation = validatePmtilesHeader(headerBuffer)
    if (!validation.valid) {
      throw new Error(`PMTiles header validation failed: ${validation.error}`)
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
