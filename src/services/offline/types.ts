export type OfflinePackageStatus =
  | 'unsupported'     // Environment lacks OPFS or storage capabilities
  | 'not_downloaded'  // Storage supported, package not present
  | 'downloading'     // Download or write in progress
  | 'ready'           // Downloaded, validated, and available for use
  | 'error'           // An error occurred during check, download, or validation

export interface OfflinePackageMetadata {
  id: string
  name: string
  description: string
  sourceUrl: string
  expectedSize: number
  bounds: [number, number, number, number] // [minLon, minLat, maxLon, maxLat]
  center: [number, number]
  zoomRange: [number, number]
  tileType: string
  specVersion: number
  vectorLayers: string[]
}

export interface DownloadProgress {
  bytesDownloaded: number
  totalBytes: number
  percentage: number
}

export interface StorageQuotaInfo {
  supported: boolean
  usageBytes?: number
  quotaBytes?: number
  availableBytes?: number
}

export interface OfflinePackageState {
  status: OfflinePackageStatus
  progress?: DownloadProgress
  error?: string
  lastChecked?: number
  verifiedSize?: number
  metadata?: OfflinePackageMetadata
}

export const DELHI_PACKAGE_METADATA: OfflinePackageMetadata = {
  id: 'delhi-ncr-core',
  name: 'Delhi NCT Core',
  description: 'Offline vector map extract for Central Delhi NCT & immediate urban ring',
  sourceUrl: '/offline/delhi/NewDelhi.osm.pmtiles',
  expectedSize: 15361932,
  bounds: [76.978, 28.44, 77.497, 28.738],
  center: [77.2375, 28.589],
  zoomRange: [0, 14],
  tileType: 'MVT',
  specVersion: 3,
  vectorLayers: [
    'addresses', 'aerialways', 'boundaries', 'boundary_labels', 'bridges',
    'buildings', 'dam_lines', 'dam_polygons', 'ferries', 'land', 'ocean',
    'pier_lines', 'pier_polygons', 'place_labels', 'pois', 'public_transport',
    'sites', 'street_labels', 'street_labels_points', 'street_polygons',
    'streets', 'streets_polygons_labels', 'water_lines', 'water_lines_labels',
    'water_polygons', 'water_polygons_labels',
  ],
}
