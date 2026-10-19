import type { NearbyCategory } from './types'

export const NEARBY_CATEGORIES: NearbyCategory[] = [
  { key: 'hospital', label: 'Hospitals', iconName: 'Activity', osmTag: 'amenity:hospital', query: 'hospital' },
  { key: 'restaurant', label: 'Restaurants', iconName: 'Utensils', osmTag: 'amenity:restaurant', query: 'restaurant' },
  { key: 'cafe', label: 'Cafes', iconName: 'Coffee', osmTag: 'amenity:cafe', query: 'cafe' },
  { key: 'pharmacy', label: 'Pharmacies', iconName: 'Pill', osmTag: 'amenity:pharmacy', query: 'pharmacy' },
  { key: 'atm', label: 'ATMs', iconName: 'Banknote', osmTag: 'amenity:atm', query: 'atm' },
  { key: 'fuel', label: 'Petrol Pumps', iconName: 'Fuel', osmTag: 'amenity:fuel', query: 'petrol station' },
  { key: 'bank', label: 'Banks', iconName: 'Landmark', osmTag: 'amenity:bank', query: 'bank' },
  { key: 'supermarket', label: 'Supermarkets', iconName: 'ShoppingBag', osmTag: 'shop:supermarket', query: 'supermarket' },
]

export function getCategoryByKey(key: string): NearbyCategory | undefined {
  return NEARBY_CATEGORIES.find(c => c.key === key)
}
