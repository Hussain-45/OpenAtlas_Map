import { NominatimProvider } from './nominatim'
import { PhotonProvider } from './photon'
import type { GeocodingProvider } from './types'

export * from './categories'
export * from './nominatim'
export * from './offlineDelhi'
export * from './photon'
export * from './types'

export function getGeocodingProvider(providerId?: string, customBaseUrl?: string): GeocodingProvider {
  const envProvider = (import.meta.env.VITE_GEOCODING_PROVIDER || '').toLowerCase()
  const targetId = (providerId || envProvider || 'photon').toLowerCase()
  const envUrl = import.meta.env.VITE_GEOCODING_API_URL

  if (targetId === 'nominatim') {
    return new NominatimProvider(customBaseUrl || envUrl || 'https://nominatim.openstreetmap.org')
  }

  // Default to Photon
  return new PhotonProvider(customBaseUrl || envUrl || 'https://photon.komoot.io')
}
