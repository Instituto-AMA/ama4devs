/**
 * Configuration coming from the environment.
 *
 * Every numeric business rule of Asaas (fees, deadlines, lookahead) is
 * CONFIGURABLE on purpose. The rules were researched in the documentation, not
 * proven against the real API — so, when we find a divergence, the correction
 * has to be a configuration change, not a code change.
 */
import { readFileSync } from 'node:fs'
import { parseCaptureSchedule, type CaptureSlot } from '../domain/card-capture.ts'
import { bp, cents, type BasisPoints, type Cents } from '../domain/money.ts'
import type { ClockMode } from './clock.ts'

const num = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Env ${key} is not a number: "${raw}"`)
  return n
}

const str = (key: string, fallback: string): string => process.env[key] || fallback
const optionalStr = (key: string): string | undefined => process.env[key] || undefined
const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

/** One extra ROOT account, seeded on every boot. Format of a single item. */
export interface SeedExtraAccount {
  apiKey: string
  name: string
  cpfCnpj: string
}

/**
 * Parses `SEED_EXTRA_ACCOUNTS`: items of `apiKey|name|cpfCnpj` separated by
 * `;`. The key starts with `$`, so there is no ambiguity with other separators.
 * Example:
 *
 *   $aact_hmlg_dev_tenant_a|Clinica A|12345678000195;$aact_hmlg_dev_tenant_b|Clinica B|98765432000198
 *
 * An empty (or whitespace-only) value means none. A malformed item is a BOOT
 * error — the local stack would run half-seeded otherwise, and the e2e would
 * chase a ghost. The error names the ITEM INDEX, never the key itself (the key
 * is a secret).
 */
function parseSeedExtraAccounts(
  raw: string | undefined,
  masterKey: string | undefined,
): SeedExtraAccount[] {
  if (raw === undefined || raw.trim() === '') return []

  const seen = new Set<string>()
  const out: SeedExtraAccount[] = []

  const items = raw.split(';')
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!.trim()
    if (item === '') continue // stray `;` at the end of the line

    const fail = (why: string): never => {
      throw new Error(`Env SEED_EXTRA_ACCOUNTS: item ${i} is invalid — ${why}.`)
    }

    const parts = item.split('|').map((s) => s.trim())
    if (parts.length !== 3 || parts.some((s) => s === '')) {
      fail('expected "apiKey|name|cpfCnpj"')
    }
    const [apiKey, name, cpfCnpj] = parts as [string, string, string]

    if (!apiKey.startsWith('$aact_')) fail('the key must start with "$aact_"')
    if (apiKey === masterKey) fail('the key is the master account key (ASAAS_API_KEY)')
    if (seen.has(apiKey)) fail('duplicate key')

    seen.add(apiKey)
    out.push({ apiKey, name, cpfCnpj })
  }

  return out
}

const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']

/** The hostnames allowed to reach the key-free local routes, plus the configured ones. */
const hostList = (key: string, fallback: string[]): string[] => {
  const extra = (process.env[key] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set([...fallback, ...extra])]
}

/**
 * The Asaas fee table (the public price list).
 * Charged only when the charge is PAID — issuing costs nothing.
 */
export interface FeeTable {
  /** Bank slip settled. */
  boleto: Cents
  /** Pix received: a FIXED amount, not a percentage. */
  pix: Cents
  creditCard: {
    fixed: Cents
    /** The bracket depends on the number of installments. */
    oneInstallment: BasisPoints
    upToSix: BasisPoints
    upToTwelve: BasisPoints
    upToTwentyOne: BasisPoints
  }
  debitCard: { fixed: Cents; pct: BasisPoints }
  transfer: {
    ted: Cents
    pix: Cents
    /** Free transfers per month. */
    monthlyWithoutFee: number
  }

  /**
   * The fees below are NOT charged when a charge is settled — they are service
   * fees, charged when the service is used. They live here because
   * GET /v3/myAccount/fees returns the whole table, and because the Serasa
   * query (creditBureauReport) needs a price.
   */
  /** Serasa query. The price differs by person type. */
  creditBureauReport: { naturalPerson: Cents; legalPerson: Cents }
  /** Notifications to the end customer. */
  notification: { phoneCall: Cents; whatsApp: Cents; messaging: Cents }
  /** Issued service invoice (NFS-e). */
  invoice: Cents
  /** Negative listing at Serasa. */
  paymentDunning: Cents
  /** Anticipation: fee PER MONTH, in basis points. */
  anticipation: {
    creditCardDetached: BasisPoints
    creditCardInstallment: BasisPoints
    bankSlip: BasisPoints
  }
}

export interface Config {
  port: number
  databasePath: string
  seed: number | undefined
  adminEnabled: boolean
  /** Hostnames allowed to reach the key-free local routes. */
  allowedHosts: string[]
  logLevel: string

  /**
   * Base of the public URLs the API RETURNS (payment link, checkout,
   * image/report download). It is not the URL this server listens on: it is the
   * host Asaas would put in the response, and integrations usually display it.
   */
  publicBaseUrl: string

  /**
   * Where the payer's invoice page (`invoiceUrl`, `/i/<id>`) and bank slip (`bankSlipUrl`)
   * open: this server, as the browser reaches it. Unlike `publicBaseUrl` the page exists
   * here, so the link has to work. Default `http://localhost:<PORT>`; behind a different
   * host port, set INVOICE_BASE_URL to it.
   */
  invoiceBaseUrl: string

  clock: { mode: ClockMode; start: string | undefined; tickIntervalMs: number }

  seedAccount: {
    apiKey: string | undefined
    name: string
    cpfCnpj: string
    email: string
    balanceCents: Cents
  }

  /** Extra ROOT accounts seeded from `SEED_EXTRA_ACCOUNTS` on every boot. */
  seedExtraAccounts: SeedExtraAccount[]

  /**
   * The payer notifications (e-mail, WhatsApp template and SMS per charge event). Each
   * channel is on while its address is known, set or found (`discover`): e-mail
   * goes to Mailpit's send API, the template to the WhatsApp mock's Cloud API, the
   * SMS to the SMS mock's native API. Off,
   * nothing is queued.
   */
  notify: {
    mailpitUrl: string | undefined
    whatsappUrl: string | undefined
    smsUrl?: string | undefined
    /** The sender number the WhatsApp mock shows the templates from. */
    whatsappPhoneNumberId: string
    /** The WABA whose library holds the payer templates (the WhatsApp mock's default account). */
    whatsappWabaId: string
    fromEmail: string
    maxAttempts: number
    /**
     * This server as the WhatsApp mock reaches it: on boot the sender number is
     * registered there with `<callbackBaseUrl>/_mock/whatsapp/webhook` as its webhook,
     * so delivery statuses and the payer's replies come back here.
     */
    callbackBaseUrl: string
    /** Where the browser opens Mailpit's mailbox and the WhatsApp console (the Integrations tab). */
    mailpitUiUrl: string
    whatsappUiUrl: string
    smsUiUrl?: string
    /**
     * What this server looks for by itself (src/notify/discovery.ts): the places
     * Mailpit, the WhatsApp mock, the SMS mock and the generator may answer on, and whether the
     * address the WhatsApp mock calls back on is found too. Left out, nothing is
     * looked for: the process entry fills it from the environment
     * (`notifyDiscoveryFromEnv`), the tests leave it unset.
     */
    discover?: NotifyDiscovery
  }

  /**
   * The generator of fake data (mocks/generator). It is found by itself like the
   * payer channels (src/notify/discovery.ts): `GENERATOR_URL` says where it
   * answers, empty turns it off, and unset it is looked for.
   */
  generator: {
    /** Where the generator answers; undefined while it is off or not found yet. */
    url: string | undefined
    /** Where the browser opens the generator's UI. */
    uiUrl: string
  }

  webhook: {
    /**
     * Inside the container, "localhost" is the container ITSELF — the webhook would
     * never reach the developer's machine. We rewrite the host. It is the #1 trap
     * of this project and the reason it exists.
     */
    localhostRewrite: string | undefined
    timeoutMs: number
    maxAttempts: number
    retentionDays: number
    maxPerAccount: number
  }

  rules: {
    /** Asaas creates each following subscription charge 40 days before its due date. */
    subscriptionLookaheadDays: number
    /** Credit card credits at D+32. */
    creditCardSettlementDays: number
    /** Debit card credits at D+3. */
    debitCardSettlementDays: number
    /** Bank slip credits at D+1 business day. */
    bankSlipSettlementDays: number
    /** Deadline to fix a split blocked by a value divergence. */
    splitDivergenceGraceBusinessDays: number
    /** TODO(rule): the doc does not define the default of the checkout's `minutesToExpire`. */
    checkoutMinutesToExpire: number
    /**
     * When a recurring card charge is tried on and after its due date
     * (src/domain/card-capture.ts). The panel can override it at runtime.
     */
    cardCaptureSchedule: CaptureSlot[]
  }

  fees: FeeTable
}

export function loadConfig(): Config {
  const seedRaw = process.env.SEED
  const masterApiKey = optionalStr('ASAAS_API_KEY')
  const port = num('PORT', 45445)
  return {
    port,
    invoiceBaseUrl: str('INVOICE_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
    databasePath: str('DATABASE_PATH', './data/asaas.db'),
    seed: seedRaw === undefined || seedRaw === '' ? undefined : Number(seedRaw),
    adminEnabled: bool('ADMIN_ENABLED', true),
    allowedHosts: hostList('MOCK_ALLOWED_HOSTS', DEFAULT_ALLOWED_HOSTS),
    logLevel: str('LOG_LEVEL', 'info'),
    publicBaseUrl: str('PUBLIC_BASE_URL', 'https://sandbox.asaas.com'),

    clock: {
      mode: str('CLOCK_MODE', 'REAL') as ClockMode,
      start: optionalStr('CLOCK_START'),
      tickIntervalMs: num('TICK_INTERVAL_MS', 60_000),
    },

    seedAccount: {
      apiKey: masterApiKey,
      name: str('SEED_ACCOUNT_NAME', 'Conta Principal'),
      cpfCnpj: str('SEED_ACCOUNT_CPF_CNPJ', '47960950000121'),
      email: str('SEED_ACCOUNT_EMAIL', 'conta@localhost'),
      balanceCents: cents(num('SEED_ACCOUNT_BALANCE_CENTS', 0)),
    },

    seedExtraAccounts: parseSeedExtraAccounts(process.env.SEED_EXTRA_ACCOUNTS, masterApiKey),

    notify: {
      mailpitUrl: optionalStr('MAILPIT_URL')?.replace(/\/+$/, ''),
      whatsappUrl: optionalStr('WHATSAPP_MOCK_URL')?.replace(/\/+$/, ''),
      smsUrl: optionalStr('SMS_MOCK_URL')?.replace(/\/+$/, ''),
      whatsappPhoneNumberId: str('WHATSAPP_PHONE_NUMBER_ID', '5511400000000'),
      whatsappWabaId: str('WHATSAPP_WABA_ID', '100000000000001'),
      fromEmail: str('NOTIFY_FROM_EMAIL', 'notificacoes@asaas.localhost'),
      maxAttempts: num('NOTIFY_MAX_ATTEMPTS', 5),
      callbackBaseUrl: str('NOTIFY_CALLBACK_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
      mailpitUiUrl: str('MAILPIT_UI_URL', 'http://localhost:8025').replace(/\/+$/, ''),
      whatsappUiUrl: str('WHATSAPP_UI_URL', 'http://localhost:3010').replace(/\/+$/, ''),
      smsUiUrl: str('SMS_UI_URL', 'http://localhost:8899').replace(/\/+$/, ''),
    },

    generator: {
      url: optionalStr('GENERATOR_URL')?.replace(/\/+$/, ''),
      uiUrl: str('GENERATOR_UI_URL', 'http://localhost:45450'),
    },

    webhook: {
      localhostRewrite: optionalStr('WEBHOOK_LOCALHOST_REWRITE'),
      timeoutMs: num('WEBHOOK_TIMEOUT_MS', 10_000),
      maxAttempts: num('WEBHOOK_MAX_ATTEMPTS', 15),
      retentionDays: num('WEBHOOK_RETENTION_DAYS', 14),
      maxPerAccount: num('WEBHOOK_MAX_PER_ACCOUNT', 10),
    },

    rules: {
      subscriptionLookaheadDays: num('SUBSCRIPTION_LOOKAHEAD_DAYS', 40),
      creditCardSettlementDays: num('CREDIT_CARD_SETTLEMENT_DAYS', 32),
      debitCardSettlementDays: num('DEBIT_CARD_SETTLEMENT_DAYS', 3),
      bankSlipSettlementDays: num('BANK_SLIP_SETTLEMENT_DAYS', 1),
      splitDivergenceGraceBusinessDays: num('SPLIT_DIVERGENCE_GRACE_BUSINESS_DAYS', 2),
      checkoutMinutesToExpire: num('CHECKOUT_MINUTES_TO_EXPIRE', 60),
      cardCaptureSchedule: parseCaptureSchedule(process.env.CARD_CAPTURE_SCHEDULE),
    },

    fees: {
      boleto: cents(num('FEE_BOLETO_CENTS', 199)),
      pix: cents(num('FEE_PIX_CENTS', 199)),
      creditCard: {
        fixed: cents(num('FEE_CC_FIXED_CENTS', 49)),
        oneInstallment: bp(num('FEE_CC_PCT_BP_1X', 299)),
        upToSix: bp(num('FEE_CC_PCT_BP_2_6', 349)),
        upToTwelve: bp(num('FEE_CC_PCT_BP_7_12', 399)),
        upToTwentyOne: bp(num('FEE_CC_PCT_BP_13_21', 429)),
      },
      debitCard: {
        fixed: cents(num('FEE_DEBIT_FIXED_CENTS', 35)),
        pct: bp(num('FEE_DEBIT_PCT_BP', 189)),
      },
      transfer: {
        ted: cents(num('FEE_TED_CENTS', 500)),
        pix: cents(num('FEE_PIX_TRANSFER_CENTS', 0)),
        monthlyWithoutFee: num('FEE_TRANSFER_MONTHLY_WITHOUT_FEE', 30),
      },

      creditBureauReport: {
        naturalPerson: cents(num('FEE_CREDIT_BUREAU_NATURAL_CENTS', 1699)),
        legalPerson: cents(num('FEE_CREDIT_BUREAU_LEGAL_CENTS', 1699)),
      },
      notification: {
        phoneCall: cents(num('FEE_NOTIFICATION_PHONE_CALL_CENTS', 55)),
        whatsApp: cents(num('FEE_NOTIFICATION_WHATSAPP_CENTS', 55)),
        messaging: cents(num('FEE_NOTIFICATION_MESSAGING_CENTS', 99)),
      },
      invoice: cents(num('FEE_INVOICE_CENTS', 99)),
      paymentDunning: cents(num('FEE_PAYMENT_DUNNING_CENTS', 990)),
      anticipation: {
        creditCardDetached: bp(num('FEE_ANTICIPATION_CC_DETACHED_BP', 249)),
        creditCardInstallment: bp(num('FEE_ANTICIPATION_CC_INSTALLMENT_BP', 200)),
        bankSlip: bp(num('FEE_ANTICIPATION_BANK_SLIP_BP', 499)),
      },
    },
  }
}

/** The payer channels and the generator this server finds by itself, and where it looks. */
export interface NotifyDiscovery {
  /** The base URLs Mailpit may answer on, in order; empty when MAILPIT_URL says where. */
  mailpit: string[]
  /** The base URLs the WhatsApp mock may answer on, in order; empty when WHATSAPP_MOCK_URL says where. */
  whatsapp: string[]
  /** The base URLs the SMS mock may answer on, in order; empty when SMS_MOCK_URL says where. */
  sms?: string[]
  /** The base URLs the generator may answer on, in order; empty when GENERATOR_URL says where. */
  generator: string[]
  /** Whether the address the WhatsApp mock calls back on is found (NOTIFY_CALLBACK_BASE_URL unset). */
  callback: boolean
}

/** The Docker host as a container sees it: its name, and the default gateway on Linux. */
function dockerHosts(): string[] {
  const hosts = ['host.docker.internal']
  try {
    for (const line of readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const [, destination, gateway] = line.trim().split(/\s+/)
      if (destination !== '00000000' || !gateway || gateway === '00000000') continue
      // Little-endian hex: 0100A8C0 is 192.168.0.1.
      hosts.push((gateway.match(/../g) ?? []).map((b) => parseInt(b, 16)).reverse().join('.'))
      break
    }
  } catch {
    // Not Linux: there is no routing table to read, and no gateway to add.
  }
  return hosts
}

/**
 * What to look for, from the environment. A service whose variable is set is used
 * as given, and set empty it is off; unset, it is looked for where it usually
 * answers: the compose service name, this machine, the Docker host.
 */
export function notifyDiscoveryFromEnv(env: Record<string, string | undefined> = process.env): NotifyDiscovery {
  const places = (names: string[], port: number) =>
    [...names, 'localhost', ...dockerHosts()].map((host) => `http://${host}:${port}`)
  return {
    mailpit: env.MAILPIT_URL === undefined ? places(['mailpit'], 8025) : [],
    whatsapp: env.WHATSAPP_MOCK_URL === undefined ? places(['whatsapp', 'whatsapp-mock'], 3010) : [],
    sms: env.SMS_MOCK_URL === undefined ? places(['sms', 'sms-mock'], 8899) : [],
    generator: env.GENERATOR_URL === undefined ? places(['generator', 'generator-mock'], 45450) : [],
    callback: env.NOTIFY_CALLBACK_BASE_URL === undefined,
  }
}
