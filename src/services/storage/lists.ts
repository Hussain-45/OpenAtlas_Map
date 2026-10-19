import type { Place, PlaceList } from './types'

export const DEFAULT_LISTS: PlaceList[] = [
  { id: 'favorites', name: 'Favorites', icon: 'heart', isDefault: true, createdAt: 1 },
  { id: 'work', name: 'Work', icon: 'briefcase', isDefault: true, createdAt: 2 },
  { id: 'home', name: 'Home', icon: 'home', isDefault: true, createdAt: 3 },
  { id: 'trips', name: 'Weekend Trips', icon: 'compass', isDefault: true, createdAt: 4 },
]

export function isValidList(item: unknown): item is PlaceList {
  if (!item || typeof item !== 'object') return false
  const l = item as Record<string, unknown>
  return typeof l.id === 'string' && l.id.trim().length > 0 && typeof l.name === 'string' && l.name.trim().length > 0
}

export function sanitizeLists(items: unknown): PlaceList[] {
  if (!Array.isArray(items)) return [...DEFAULT_LISTS]
  const valid = items.filter(isValidList)
  if (valid.length === 0) return [...DEFAULT_LISTS]

  // Ensure default lists exist
  const existingIds = new Set(valid.map(l => l.id))
  const merged = [...valid]
  for (const def of DEFAULT_LISTS) {
    if (!existingIds.has(def.id)) {
      merged.push(def)
    }
  }
  return merged
}

export function createList(lists: PlaceList[], name: string, icon = 'folder'): { lists: PlaceList[]; newList: PlaceList } {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('List name cannot be empty.')
  }
  const id = `list-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const newList: PlaceList = {
    id,
    name: trimmed,
    icon,
    isDefault: false,
    createdAt: Date.now(),
  }
  return {
    lists: [...lists, newList],
    newList,
  }
}

export function renameList(lists: PlaceList[], id: string, newName: string): PlaceList[] {
  const trimmed = newName.trim()
  if (!trimmed) return lists
  return lists.map(list => (list.id === id ? { ...list, name: trimmed } : list))
}

export function deleteList(lists: PlaceList[], id: string): PlaceList[] {
  // Prevent deleting default lists or non-existent
  const target = lists.find(l => l.id === id)
  if (!target || target.isDefault) return lists
  return lists.filter(l => l.id !== id)
}

export function addPlaceToList(places: Place[], placeId: string, listId: string): Place[] {
  return places.map(p => {
    if (p.id !== placeId) return p
    const currentListIds = p.listIds || ['favorites']
    if (currentListIds.includes(listId)) return p
    return { ...p, listIds: [...currentListIds, listId], updatedAt: Date.now() }
  })
}

export function removePlaceFromList(places: Place[], placeId: string, listId: string): Place[] {
  return places.map(p => {
    if (p.id !== placeId) return p
    const currentListIds = p.listIds || ['favorites']
    return { ...p, listIds: currentListIds.filter(id => id !== listId), updatedAt: Date.now() }
  })
}

export function setPlaceLists(places: Place[], placeId: string, listIds: string[]): Place[] {
  return places.map(p => {
    if (p.id !== placeId) return p
    return { ...p, listIds, updatedAt: Date.now() }
  })
}

export function filterPlacesByList(places: Place[], listId: string | 'all'): Place[] {
  if (listId === 'all') return places
  return places.filter(p => {
    const listIds = p.listIds && p.listIds.length > 0 ? p.listIds : ['favorites']
    return listIds.includes(listId)
  })
}
