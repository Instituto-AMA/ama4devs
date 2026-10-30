/**
 * The sales simulator, and the TRUNCATION RULE of the installment fee.
 *
 * All the numbers here were captured from `POST /v3/payments/simulate` and from
 * `POST /v3/payments` against the REAL Asaas sandbox on 2026-07-14. They are not
 * deduced from the documentation — they are what the API returned.
 *
 * The 350 in 12x case exists to lock the rule down: the total fee comes to
 * 1446 cents, 1446/12 = 120.5 — rounding gives 121, truncating gives 120. Asaas
 * returns 120. While we used Math.round, we were off by ONE CENT PER
 * INSTALLMENT, and no other case of the suite separated the two rules.
 */
import { describe, expect, it } from 'bun:test'
import { loadConfig } from '../../src/core/config.ts'
import { calcInstallmentFee } from '../../src/domain/fees.ts'
import { brlToCents, cents } from '../../src/domain/money.ts'
import { simulate } from '../../src/domain/simulator.ts'

const fees = loadConfig().fees
const brl = (c: number) => c / 100

describe('the installment fee on the card — it TRUNCATES, it does not round', () => {
  it('R$ 350 in 12x → R$ 1.20 per installment (not 1.21)', () => {
    // sandbox: value 29.16, netValue 27.96 → fee 1.20
    expect(calcInstallmentFee(fees, 'CREDIT_CARD', brlToCents(350), 12)).toBe(cents(120))
  })

  it('R$ 300 in 3x → R$ 3.65 per installment', () => {
    // sandbox: value 100.00, netValue 96.35 → fee 3.65
    expect(calcInstallmentFee(fees, 'CREDIT_CARD', brlToCents(300), 3)).toBe(cents(365))
  })

  it('on the bank slip the fee is per issued slip, and it is not divided', () => {
    expect(calcInstallmentFee(fees, 'BOLETO', brlToCents(350), 12)).toBe(cents(199))
  })
})

describe('POST /v3/payments/simulate', () => {
  it('single payment: Pix R$ 100 → net R$ 98.01', () => {
    const s = simulate(fees, { valueCents: brlToCents(100), billingTypes: ['PIX'] })

    expect(brl(s.pix!.netValueCents)).toBe(98.01)
    expect(brl(s.pix!.feeFixedCents)).toBe(1.99)
    expect(s.pix!.installment).toBeNull()

    // The keys that were not asked for DO come out, and they come out null — a client can read `.creditCard`.
    expect(s.creditCard).toBeNull()
    expect(s.bankSlip).toBeNull()
  })

  it('single payment: card R$ 100 → net R$ 96.52, at 2.99%', () => {
    const s = simulate(fees, {
      valueCents: brlToCents(100),
      billingTypes: ['CREDIT_CARD'],
      installmentCount: 1,
    })

    expect(brl(s.creditCard!.netValueCents)).toBe(96.52)
    expect(s.creditCard!.feeBp! / 100).toBe(2.99)
    expect(brl(s.creditCard!.feeFixedCents)).toBe(0.49)
    expect(s.creditCard!.installment).toBeNull()
  })

  it('R$ 100 in 3x: splitting on the BANK SLIP costs more than on the CARD', () => {
    const s = simulate(fees, {
      valueCents: brlToCents(100),
      billingTypes: ['CREDIT_CARD', 'BOLETO', 'PIX'],
      installmentCount: 3,
    })

    // Card: fee 0.49 + 3.49% = 3.98, divided by 3 → 1.32 (truncated) per installment.
    expect(brl(s.creditCard!.netValueCents)).toBe(96.04)
    expect(s.creditCard!.feeBp! / 100).toBe(3.49)
    expect(brl(s.creditCard!.installment!.paymentValueCents)).toBe(33.33)
    expect(brl(s.creditCard!.installment!.paymentNetValueCents)).toBe(32.01)

    // Bank slip: R$ 1.99 PER INSTALLMENT — 3 bank slips, 3 fees. It is not divided.
    expect(brl(s.bankSlip!.netValueCents)).toBe(94.03)
    expect(brl(s.bankSlip!.installment!.paymentNetValueCents)).toBe(31.34)

    expect(brl(s.pix!.netValueCents)).toBe(94.03)

    // It is counterintuitive and it is real: the installment bank slip comes out R$ 2.01 more expensive.
    expect(s.bankSlip!.netValueCents).toBeLessThan(s.creditCard!.netValueCents)
  })

  it('R$ 350 in 12x on the card → net R$ 335.60, installment 29.16 / 27.96', () => {
    const s = simulate(fees, {
      valueCents: brlToCents(350),
      billingTypes: ['CREDIT_CARD'],
      installmentCount: 12,
    })

    expect(brl(s.creditCard!.netValueCents)).toBe(335.6)
    expect(s.creditCard!.feeBp! / 100).toBe(3.99)
    expect(brl(s.creditCard!.installment!.paymentValueCents)).toBe(29.16)
    expect(brl(s.creditCard!.installment!.paymentNetValueCents)).toBe(27.96)
  })
})
