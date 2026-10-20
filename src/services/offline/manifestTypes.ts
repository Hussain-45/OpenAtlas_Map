export type DatasetAssetType = 'pmtiles' | 'routing-graph' | 'places-index'

export interface DatasetAssetDescriptor {
  type: DatasetAssetType
  path: string
  filename: string
  sizeBytes: number
  sha256: string
  specVersion?: number
}

export interface DatasetReleaseManifest {
  id: string
  name: string
  version: string
  releaseDate: string
  description: string
  bounds: [number, number, number, number] // [minLon, minLat, maxLon, maxLat]
  center: [number, number]
  attribution: string
  assets: {
    pmtiles: DatasetAssetDescriptor
    routingGraph: DatasetAssetDescriptor
    places: DatasetAssetDescriptor
  }
  metadata?: {
    nodeCount?: number
    edgeCount?: number
    placeCount?: number
    totalRoadKm?: number
    sourceDataDate?: string
  }
}

export interface InstalledDatasetRelease {
  manifest: DatasetReleaseManifest
  installedAt: number
  source: 'bundled' | 'updated'
  verified: boolean
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  latestManifest?: DatasetReleaseManifest
  checkedAt: number
  error?: string
}

export interface DatasetUpdateProgress {
  currentAsset: 'pmtiles' | 'routing-graph' | 'places' | 'verifying' | 'activating'
  assetIndex: number
  totalAssets: number
  assetBytesDownloaded: number
  assetTotalBytes: number
  totalBytesDownloaded: number
  totalBytesToDownload: number
  percentage: number
}
