export type Place = {
  id: string
  name: string
  longitude: number
  latitude: number
  listIds?: string[]
  notes?: string
  updatedAt?: number
}

export function savePlace(saved: Place[], place: Place): Place[] {
  if (saved.some(item => item.id === place.id)) return saved
  return [
    ...saved,
    {
      ...place,
      name: place.name && place.name !== 'Dropped pin' ? place.name : `Saved place ${saved.length + 1}`,
    },
  ]
}

export function deletePlace(saved: Place[], id: string): Place[] {
  return saved.filter(place => place.id !== id)
}

export function filterSavedPlaces(saved: Place[], query: string): Place[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return saved
  return saved.filter(place => place.name.toLocaleLowerCase().includes(normalizedQuery))
}

export function isValidPlace(item: unknown): item is Place {
  if (!item || typeof item !== 'object') return false
  const p = item as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.longitude) &&
    typeof p.latitude === 'number' &&
    Number.isFinite(p.latitude)
  )
}

export function sanitizeSavedPlaces(items: unknown): Place[] {
  if (!Array.isArray(items)) return []
  return items.filter(isValidPlace).map(p => {
    if (Array.isArray(p.listIds)) {
      return {
        ...p,
        listIds: p.listIds.filter((id): id is string => typeof id === 'string'),
      }
    }
    return p
  })
}
