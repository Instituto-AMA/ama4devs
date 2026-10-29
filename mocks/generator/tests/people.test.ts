import { describe, expect, test } from 'bun:test'
import { address } from '../src/core/address.js'
import { company } from '../src/core/companies.js'
import {
  ACTIVITIES,
  BANKS,
  CITIES,
  COMPANY_WORDS,
  DISTRICTS,
  EMAIL_DOMAINS,
  FEMALE_FIRST_NAMES,
  LAST_NAMES,
  MALE_FIRST_NAMES,
  STATES,
  STREET_NAMES,
} from '../src/core/data.js'
import { person } from '../src/core/people.js'
import { createRng } from '../src/core/rng.js'

const NOW = new Date('2026-10-29T12:00:00Z')

describe('data', () => {
  test('every city has a known state, an IBGE code and a CEP range', () => {
    for (const city of CITIES) {
      expect(Object.keys(STATES)).toContain(city.state)
      expect(city.ibge).toMatch(/^\d{7}$/)
      expect(city.cep[0]).toBeLessThanOrEqual(city.cep[1])
      expect(city.ddd.length).toBeGreaterThan(0)
    }
  })

  test('every state has at least one city', () => {
    const covered = new Set(CITIES.map((city) => city.state))
    expect(Object.keys(STATES).length).toBe(27)
    for (const state of Object.keys(STATES)) expect(covered.has(state)).toBe(true)
  })

  test('the lists hold enough entries', () => {
    expect(MALE_FIRST_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(FEMALE_FIRST_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(LAST_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(STREET_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(DISTRICTS.length).toBeGreaterThanOrEqual(40)
    expect(COMPANY_WORDS.length).toBeGreaterThanOrEqual(40)
    expect(CITIES.length).toBeGreaterThanOrEqual(40)
    expect(ACTIVITIES.length).toBeGreaterThanOrEqual(25)
    expect(BANKS.length).toBeGreaterThanOrEqual(12)
    expect(EMAIL_DOMAINS).toEqual(['example.com', 'example.org', 'example.net'])
  })

  test('every activity has a CNAE code and three products', () => {
    for (const activity of ACTIVITIES) {
      expect(activity.cnae).toMatch(/^\d{4}-\d\/\d{2}$/)
      expect(activity.products.length).toBeGreaterThanOrEqual(3)
    }
  })

  test('every bank has a code and an ISPB', () => {
    for (const bank of BANKS) {
      expect(bank.code).toMatch(/^\d{3}$/)
      expect(bank.ispb).toMatch(/^\d{8}$/)
    }
  })
})

describe('address', () => {
  test('keeps the requested state', () => {
    for (let index = 0; index < 50; index++) {
      const place = address(createRng(`a${index}`), { state: 'RJ' })
      expect(place.state).toBe('RJ')
      expect(place.stateName).toBe('Rio de Janeiro')
      expect(place.postalCode).toMatch(/^\d{8}$/)
      expect(place.ibgeCode).toMatch(/^\d{7}$/)
    }
  })

  test('an unknown state falls back to every city', () => {
    const place = address(createRng('unknown'), { state: 'ZZ' })
    expect(Object.keys(STATES)).toContain(place.state)
  })
})

describe('person', () => {
  test('the same seed yields the same person', () => {
    expect(person(createRng('p1'), { now: NOW })).toEqual(person(createRng('p1'), { now: NOW }))
  })

  test('keeps every field inside its range', () => {
    for (let index = 0; index < 200; index++) {
      const generated = person(createRng(`p${index}`), { now: NOW })
      expect(generated.age).toBeGreaterThanOrEqual(18)
      expect(generated.age).toBeLessThanOrEqual(80)
      expect(generated.mobilePhone).toMatch(/^\d{2}9\d{8}$/)
      expect(generated.mobilePhone.slice(2)).not.toMatch(/^(\d)\1{8}$/)
      expect(generated.email).toMatch(/@(example\.com|example\.org|example\.net)$/)
      expect(generated.cpf).toMatch(/^\d{11}$/)
      expect(generated.address.postalCode).toMatch(/^\d{8}$/)
    }
  })

  test('keeps the state and its area code', () => {
    const areaCodes = CITIES.filter((city) => city.state === 'RJ').flatMap((city) => city.ddd)
    for (let index = 0; index < 50; index++) {
      const generated = person(createRng(`rj${index}`), { state: 'RJ', now: NOW })
      expect(generated.address.state).toBe('RJ')
      expect(areaCodes).toContain(generated.mobilePhone.slice(0, 2))
    }
  })

  test('masks the documents when formatted', () => {
    const generated = person(createRng('masked'), { formatted: true, now: NOW })
    expect(generated.cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/)
    expect(generated.address.postalCode).toMatch(/^\d{5}-\d{3}$/)
    expect(generated.mobilePhone).toMatch(/^\(\d{2}\) 9\d{4}-\d{4}$/)
  })
})

describe('company', () => {
  test('keeps every field inside its range', () => {
    for (let index = 0; index < 100; index++) {
      const generated = company(createRng(`c${index}`), { now: NOW })
      expect(generated.cnpj).toMatch(/^\d{14}$/)
      expect(generated.website.startsWith('https://www.')).toBe(true)
      expect(generated.activity.cnae).toMatch(/^\d{4}-\d\/\d{2}$/)
      expect(generated.partners.length).toBeGreaterThanOrEqual(1)
      expect(generated.partners.length).toBeLessThanOrEqual(3)
      for (const partner of generated.partners) {
        expect(partner.age).toBeGreaterThanOrEqual(21)
        expect(partner.address.state).toBe(generated.address.state)
      }
    }
  })

  test('keeps the requested state', () => {
    const generated = company(createRng('sp'), { state: 'SP', now: NOW })
    expect(generated.address.state).toBe('SP')
    for (const partner of generated.partners) expect(partner.address.state).toBe('SP')
  })

  test('the same seed yields the same company', () => {
    expect(company(createRng('c1'), { now: NOW })).toEqual(company(createRng('c1'), { now: NOW }))
  })
})
