import { describe, expect, it } from 'vitest'
import {
  deletePlace,
  filterSavedPlaces,
  isValidPlace,
  sanitizeSavedPlaces,
  savePlace,
  type Place,
} from './places'

const home: Place = { id: 'home', name: 'Dropped pin', longitude: 77.2, latitude: 28.6 }

describe('saved places', () => {
  it('saves a dropped pin with a generated name', () => {
    expect(savePlace([], home)).toEqual([{ ...home, name: 'Saved place 1' }])
  })

  it('preserves existing custom name when saving a non-default pin', () => {
    const custom: Place = { id: 'custom-1', name: 'Connaught Place', longitude: 77.21, latitude: 28.63 }
    expect(savePlace([], custom)).toEqual([custom])
  })

  it('does not add the same pin twice', () => {
    const saved = savePlace([], home)
    expect(savePlace(saved, home)).toBe(saved)
  })

  it('deletes a place by id', () => {
    const list: Place[] = [
      { id: '1', name: 'Place 1', longitude: 10, latitude: 20 },
      { id: '2', name: 'Place 2', longitude: 30, latitude: 40 },
    ]
    expect(deletePlace(list, '1')).toEqual([list[1]])
    expect(deletePlace(list, 'nonexistent')).toEqual(list)
  })

  it('filters saved places case-insensitively and trims whitespace', () => {
    const saved = [{ ...home, name: 'Central Library' }, { ...home, id: 'park', name: 'Riverside Park' }]
    expect(filterSavedPlaces(saved, ' LIBRARY ')).toEqual([saved[0]])
    expect(filterSavedPlaces(saved, '')).toEqual(saved)
    expect(filterSavedPlaces(saved, '   ')).toEqual(saved)
    expect(filterSavedPlaces(saved, 'museum')).toEqual([])
  })
})

describe('place validation and sanitization', () => {
  it('identifies valid places correctly', () => {
    expect(isValidPlace(home)).toBe(true)
    expect(isValidPlace({ id: 'a', name: 'b', longitude: 0, latitude: 0 })).toBe(true)
  })

  it('rejects invalid place objects', () => {
    expect(isValidPlace(null)).toBe(false)
    expect(isValidPlace(undefined)).toBe(false)
    expect(isValidPlace('not an object')).toBe(false)
    expect(isValidPlace({})).toBe(false)
    expect(isValidPlace({ id: '1', name: 'test' })).toBe(false) // missing coordinates
    expect(isValidPlace({ id: '1', name: 'test', longitude: '77', latitude: 28 })).toBe(false) // string lon
    expect(isValidPlace({ id: '1', name: 'test', longitude: NaN, latitude: 28 })).toBe(false)
  })

  it('sanitizes an array containing malformed storage values', () => {
    const dirty = [
      home,
      null,
      undefined,
      123,
      { corrupted: true },
      { id: 'bad-lon', name: 'Bad', longitude: Infinity, latitude: 10 },
      { id: 'valid', name: 'Valid Place', longitude: 12.5, latitude: 45.2 },
    ]
    expect(sanitizeSavedPlaces(dirty)).toEqual([home, dirty[6]])
  })

  it('returns empty array when input is not an array', () => {
    expect(sanitizeSavedPlaces(null)).toEqual([])
    expect(sanitizeSavedPlaces('corrupted')).toEqual([])
    expect(sanitizeSavedPlaces({ foo: 'bar' })).toEqual([])
  })
})
