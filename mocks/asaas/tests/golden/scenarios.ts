/**
 * THE PARITY SCENARIOS.
 *
 * Each scenario is a sequence of calls that runs in TWO places:
 *
 *   1. against the REAL Asaas sandbox  (bun run capture)  → writes the golden
 *   2. against this simulator          (bun test parity)   → compares with the golden
 *
 * It is what separates "we think the rule is this" from "we proved it". Every
 * business rule of this project was read in the documentation — and Asaas's own
 * documentation contradicts itself in at least two points we have already found. A
 * subtly wrong mock is worse than no mock, because it produces false confidence.
 *
 * To add coverage, add a scenario here and run the capture.
 */
import type { OperationId } from '../../src/generated/operations.ts'

export interface Step {
  /** Readable label — it shows up in the diff when the parity breaks. */
  label: string
  operationId: OperationId
  body?: unknown
  params?: Record<string, string>
  query?: Record<string, string | number>
  /**
   * Keeps a value of the response for the following steps.
   * E.g. { customerId: 'id' } stores `response.id` as `$customerId`.
   */
  capture?: Record<string, string>
  /**
   * Response fields to IGNORE in the comparison: the ones that are legitimately
   * different between environments (ids, URLs, absolute dates).
   */
  ignore?: string[]
}

export interface Scenario {
  name: string
  description: string
  steps: Step[]
}

/**
 * Fields that NEVER match between real Asaas and the simulator, and should not:
 * generated identifiers, URLs of their domain, absolute creation dates.
 *
 * Everything that is NOT on this list is compared — including `value`, `netValue`,
 * `status`, `billingType`, `discount`, `fine`, `interest` and the whole shape of
 * the object. That is where a rule divergence shows up.
 */
/**
 * `anticipable` is OUTSIDE the comparison, and the reason is honest:
 *
 * The rule is proven and implemented (`src/domain/anticipable.ts`, with the 11
 * real data points in `tests/unit/anticipable.test.ts`):
 *
 *   anticipable = half anticipable AND value ≤ available limit AND due date ≤ D+90
 *
 * But the LIMIT comes from Asaas's credit analysis and is account-specific — the
 * sandbox account used in the capture had a bank slip limit of **R$ 66.66**. No
 * simulator can guess that number, and comparing it would be comparing Asaas's
 * risk appetite, not our code.
 *
 * If you want parity here too, configure the limit of YOUR account
 * (`GET /v3/anticipations/limits`) and take this field off the list.
 */
const ACCOUNT_SPECIFIC = ['anticipable']

export const VOLATILE_FIELDS = [
  ...ACCOUNT_SPECIFIC,
  'id',
  'dateCreated',
  'customer',
  'subscription',
  'installment',
  'paymentLink',
  'checkoutSession',
  'invoiceUrl',
  'bankSlipUrl',
  'transactionReceiptUrl',
  'invoiceNumber',
  'nossoNumero',
  'walletId',
  'creditCardToken',
  'pixQrCodeId',
  'pixTransaction',
  'encodedImage',
  'payload',
  'identificationField',
  'barCode',
  'apiKey',
  'accountNumber',
  // Absolute dates: the real sandbox uses today's date; the simulator uses the
  // virtual clock. What we compare are the RELATIVE dates (see
  // `deriveRelativeDates` in parity.test.ts).
  'dueDate',
  'originalDueDate',
  'paymentDate',
  'clientPaymentDate',
  'confirmedDate',
  'creditDate',
  'estimatedCreditDate',
  'effectiveDate',
  'requestDate',
  'date',
]

/**
 * Relative dates: instead of comparing '2026-02-06' with '2025-08-14', we compare
 * the DISTANCE of each date to an anchor (the creation date). That is how we prove
 * the card credits at D+32 without depending on when the test ran.
 */
export const RELATIVE_DATE_FIELDS = [
  'dueDate',
  'confirmedDate',
  'creditDate',
  'estimatedCreditDate',
  'paymentDate',
]

const CUSTOMER = {
  name: 'Parity Customer',
  cpfCnpj: '24971563792',
  email: 'parity@example.com',
  // Real Asaas REJECTS a mobile number with all the same digits (47999999999 →
  // invalid_mobilePhone), by the same logic that rejects CPF 11111111111. Proven
  // against the sandbox; our simulator still accepts it — see progress.md.
  mobilePhone: '47996321478',
}

/**
 * `$today`, `$today+N` are resolved at run time — so the scenario runs both against
 * the real sandbox (today's date) and against the simulator (frozen virtual clock).
 */
export const SCENARIOS: Scenario[] = [
  {
    name: 'pix-received',
    description:
      'Pix: PENDING → RECEIVED directly (skips CONFIRMED), a FIXED R$ 1.99 fee, ' +
      'netValue = 98.01. This is the easiest rule to get wrong (assuming the Pix fee is a percentage).',
    steps: [
      {
        label: 'creates the customer',
        operationId: 'create-new-customer',
        body: CUSTOMER,
        capture: { customerId: 'id' },
      },
      {
        label: 'creates a R$ 100 Pix charge',
        operationId: 'create-new-payment',
        body: {
          customer: '$customerId',
          billingType: 'PIX',
          value: 100,
          dueDate: '$today+5',
          description: 'Parity Pix',
        },
        capture: { paymentId: 'id' },
      },
      {
        label: 'retrieves the charge',
        operationId: 'retrieve-a-single-payment',
        params: { id: '$paymentId' },
      },
    ],
  },

  {
    name: 'bank-slip-with-interest-and-fine',
    description:
      'Bank slip with a 2% fine and 1% monthly interest. Proves the netValue ' +
      'composition and the shape of the discount/fine/interest objects in the response.',
    steps: [
      {
        label: 'creates the customer',
        operationId: 'create-new-customer',
        body: CUSTOMER,
        capture: { customerId: 'id' },
      },
      {
        label: 'creates a R$ 350 bank slip with fine, interest and discount',
        operationId: 'create-new-payment',
        body: {
          customer: '$customerId',
          billingType: 'BOLETO',
          value: 350,
          dueDate: '$today+10',
          fine: { value: 2, type: 'PERCENTAGE' },
          interest: { value: 1 },
          discount: { value: 5, dueDateLimitDays: 0, type: 'PERCENTAGE' },
        },
        capture: { paymentId: 'id' },
      },
      {
        label: 'retrieves the charge',
        operationId: 'retrieve-a-single-payment',
        params: { id: '$paymentId' },
      },
    ],
  },

  {
    name: 'credit-card-single-payment',
    description:
      'Credit card in a single payment: R$ 0.49 + 2.99% fee, and estimatedCreditDate at D+32 ' +
      '(the technical doc says 32; the marketing says 30 — this scenario settles the argument).',
    steps: [
      {
        label: 'creates the customer',
        operationId: 'create-new-customer',
        body: CUSTOMER,
        capture: { customerId: 'id' },
      },
      {
        label: 'creates a R$ 100 credit card charge',
        operationId: 'create-new-payment',
        body: {
          customer: '$customerId',
          billingType: 'CREDIT_CARD',
          value: 100,
          dueDate: '$today+5',
        },
        capture: { paymentId: 'id' },
      },
      {
        label: 'retrieves the charge',
        operationId: 'retrieve-a-single-payment',
        params: { id: '$paymentId' },
      },
    ],
  },

  {
    name: 'installment-350-in-12x',
    description:
      'The remainder rule: R$ 350 in 12x → 11 × R$ 29.16 + R$ 29.24 in the LAST one. ' +
      'This is the scenario that proves (or breaks) line 1 of our golden test.',
    steps: [
      {
        label: 'creates the customer',
        operationId: 'create-new-customer',
        body: CUSTOMER,
        capture: { customerId: 'id' },
      },
      {
        label: 'creates a R$ 350 installment plan in 12x',
        operationId: 'create-installment',
        body: {
          customer: '$customerId',
          billingType: 'BOLETO',
          installmentCount: 12,
          totalValue: 350,
          dueDate: '$today+10',
        },
        capture: { installmentId: 'id' },
      },
      {
        label: 'lists the 12 installments — the amounts must match one by one',
        operationId: 'list-payments',
        query: { installment: '$installmentId', limit: 100 },
      },
    ],
  },

  {
    name: 'installment-on-card',
    description:
      'Installment plan on the card: the issuer authorizes the total in one go. Are the ' +
      'installments born CONFIRMED? And is the credit D+32 from the confirmation (all together) ' +
      'or D+32 from each one\'s due date (staggered)? The doc does not say; this scenario does.',
    steps: [
      {
        label: 'creates the customer',
        operationId: 'create-new-customer',
        body: CUSTOMER,
        capture: { customerId: 'id' },
      },
      {
        label: 'installs R$ 300 in 3x on the test card that approves',
        operationId: 'create-installment',
        body: {
          customer: '$customerId',
          billingType: 'CREDIT_CARD',
          installmentCount: 3,
          totalValue: 300,
          dueDate: '$today+10',
          creditCard: {
            holderName: 'Parity Customer',
            number: '4444444444444444',
            expiryMonth: '12',
            expiryYear: '2030',
            ccv: '123',
          },
          creditCardHolderInfo: {
            name: 'Parity Customer',
            email: 'parity@example.com',
            cpfCnpj: '24971563792',
            postalCode: '01310-100',
            addressNumber: '100',
            phone: '47999999999',
          },
          remoteIp: '127.0.0.1',
        },
        capture: { installmentId: 'id' },
      },
      {
        label: 'the 3 installments — status and creditDate of each one',
        operationId: 'list-payments',
        query: { installment: '$installmentId', limit: 100 },
      },
    ],
  },

  {
    name: 'monthly-subscription',
    description:
      'The most counterintuitive rule: creating the subscription creates the first charge immediately. ' +
      'The 40-day window governs the following charges. The listing must return that first ' +
      'charge even when the original due date is 60 days away.',
    steps: [
      {
        label: 'creates the customer',
        operationId: 'create-new-customer',
        body: CUSTOMER,
        capture: { customerId: 'id' },
      },
      {
        label: 'creates a monthly subscription due in 60 days',
        operationId: 'create-new-subscription',
        body: {
          customer: '$customerId',
          billingType: 'BOLETO',
          value: 100,
          nextDueDate: '$today+60',
          cycle: 'MONTHLY',
        },
        capture: { subscriptionId: 'id' },
      },
      {
        label: "the subscription's charges — we expect ZERO (60 days away > 40)",
        operationId: 'list-payments-of-a-subscription',
        params: { id: '$subscriptionId' },
      },
    ],
  },

  {
    name: 'validation-errors',
    description:
      'The error format is contract: {"errors":[{"code":"invalid_<field>",...}]}. ' +
      'And the creation status code: 200, never 201.',
    steps: [
      {
        label: 'customer with an invalid CPF → invalid_cpfCnpj',
        operationId: 'create-new-customer',
        body: { name: 'Invalid Customer', cpfCnpj: '11111111111' },
      },
      {
        label: 'charge without the required fields → 400',
        operationId: 'create-new-payment',
        body: {},
      },
    ],
  },
]
