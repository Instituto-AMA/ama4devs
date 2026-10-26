/**
 * Parsing of `SEED_EXTRA_ACCOUNTS`.
 *
 * Format: items of `apiKey|name|cpfCnpj` separated by `;`. A malformed item
 * must be a BOOT error naming the ITEM INDEX — never the key itself (the key
 * is a secret and must not leak into a log).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { loadConfig } from '../../src/core/config.ts'

const setExtra = (v: string | undefined) => {
  if (v === undefined) delete process.env.SEED_EXTRA_ACCOUNTS
  else process.env.SEED_EXTRA_ACCOUNTS = v
}
const setMaster = (v: string | undefined) => {
  if (v === undefined) delete process.env.ASAAS_API_KEY
  else process.env.ASAAS_API_KEY = v
}

afterEach(() => {
  setExtra(undefined)
  setMaster(undefined)
})

describe('SEED_EXTRA_ACCOUNTS parsing', () => {
  it('empty or unset means none', () => {
    setExtra(undefined)
    expect(loadConfig().seedExtraAccounts).toEqual([])

    setExtra('')
    expect(loadConfig().seedExtraAccounts).toEqual([])

    setExtra('   ')
    expect(loadConfig().seedExtraAccounts).toEqual([])
  })

  it('parses items, trimming whitespace around items and fields', () => {
    setExtra(
      ' $aact_hmlg_dev_tenant_a | Clinica A | 12345678000195 ;  $aact_hmlg_dev_tenant_b|Clinica B|98765432000198 ',
    )
    expect(loadConfig().seedExtraAccounts).toEqual([
      { apiKey: '$aact_hmlg_dev_tenant_a', name: 'Clinica A', cpfCnpj: '12345678000195' },
      { apiKey: '$aact_hmlg_dev_tenant_b', name: 'Clinica B', cpfCnpj: '98765432000198' },
    ])
  })

  it('a stray `;` does not create an empty item', () => {
    setExtra('$aact_hmlg_dev_tenant_a|Clinica A|12345678000195;')
    expect(loadConfig().seedExtraAccounts).toHaveLength(1)
  })

  it('missing field fails with the item index', () => {
    setExtra('$aact_hmlg_dev_tenant_a|Clinica A|12345678000195;$aact_hmlg_dev_tenant_b|Clinica B')
    expect(() => loadConfig()).toThrow(/item 1/)
  })

  it('a key not starting with $aact_ fails with the item index', () => {
    setExtra('aact_hmlg_dev_tenant_a|Clinica A|12345678000195')
    expect(() => loadConfig()).toThrow(/item 0/)
  })

  it('a duplicate key fails with the item index', () => {
    setExtra(
      '$aact_hmlg_dev_tenant_a|Clinica A|12345678000195;$aact_hmlg_dev_tenant_a|Clinica B|98765432000198',
    )
    expect(() => loadConfig()).toThrow(/item 1/)
  })

  it('the master key is refused', () => {
    setMaster('$aact_hmlg_master')
    setExtra('$aact_hmlg_master|Clinica A|12345678000195')
    expect(() => loadConfig()).toThrow(/item 0/)
  })
})
