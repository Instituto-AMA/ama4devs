/**
 * The fee table of the mock, as the screen shows it.
 *
 * The API answers with the whole table (`GET /_admin/fees`): a tree of integers, in
 * cents and in basis points. This file is the map from that tree to the screen — the
 * words of every fee, its unit, and the group it belongs to.
 *
 * The words are not invented here. They come from the vendored Asaas specification
 * (`spec/openapi.json`, the descriptions of `GET /v3/myAccount/fees`) and from
 * `src/core/config.ts`, which says when each fee is charged. A screen that names a
 * fee differently from the mock teaches the developer the wrong thing.
 */

/** The tree of the fee table: numbers, and the groups that hold them. */
export type FeeTree = { [key: string]: number | FeeTree }

/** How a fee is measured. */
export type FeeUnit = 'brl' | 'pct' | 'count' | 'raw'

/**
 * The table stores cents and basis points: the number the developer reads is a
 * hundredth of it. A count is stored as it is, and so is a fee the screen does not
 * know yet (`raw`) — the screen shows the table's own number and sends it back.
 */
const SCALE: Record<FeeUnit, number> = { brl: 100, pct: 100, count: 1, raw: 1 }

/** The sign the slot shows in front of the number. */
export const UNIT_SIGN: Record<FeeUnit, string> = { brl: 'R$', pct: '%', count: '', raw: '' }

/** One fee of the table. */
export type FeeSpec = {
  /** The path in the tree: `['creditCard', 'oneInstallment']`. */
  path: string[]
  /** The words of the fee, as the developer reads them. */
  label: string
  unit: FeeUnit
}

/** A group of fees: one head on the sheet, the lines under it. */
export type FeeGroupSpec = {
  title: string
  /** One line that says what the group charges, and when. */
  note: string
  fields: FeeSpec[]
}

/**
 * The groups of the sheet.
 *
 * The order is the order of the life of a charge: the money comes in, it goes out,
 * a service is used, the sale is anticipated. The notes say when each fee is
 * charged — the mock takes the receiving fees when the charge is PAID and the
 * service fees when the service is used.
 */
export const FEE_GROUPS: FeeGroupSpec[] = [
  {
    title: 'Recebimento',
    note: 'A taxa fixa de cada cobrança recebida.',
    fields: [
      { path: ['boleto'], label: 'Boleto', unit: 'brl' },
      { path: ['pix'], label: 'Pix', unit: 'brl' },
    ],
  },
  {
    title: 'Cartão de crédito',
    note: 'A taxa fixa por operação e a taxa percentual de cada parcelamento.',
    fields: [
      { path: ['creditCard', 'fixed'], label: 'Por operação', unit: 'brl' },
      { path: ['creditCard', 'oneInstallment'], label: 'À vista', unit: 'pct' },
      { path: ['creditCard', 'upToSix'], label: '2 a 6 parcelas', unit: 'pct' },
      { path: ['creditCard', 'upToTwelve'], label: '7 a 12 parcelas', unit: 'pct' },
      { path: ['creditCard', 'upToTwentyOne'], label: '13 a 21 parcelas', unit: 'pct' },
    ],
  },
  {
    title: 'Cartão de débito',
    note: 'A taxa fixa por operação e a taxa percentual da venda.',
    fields: [
      { path: ['debitCard', 'fixed'], label: 'Por operação', unit: 'brl' },
      { path: ['debitCard', 'pct'], label: 'Percentual', unit: 'pct' },
    ],
  },
  {
    title: 'Transferências',
    note: 'A taxa de cada transferência para a conta do recebedor.',
    fields: [
      { path: ['transfer', 'ted'], label: 'TED', unit: 'brl' },
      { path: ['transfer', 'pix'], label: 'Pix', unit: 'brl' },
      { path: ['transfer', 'monthlyWithoutFee'], label: 'Gratuitas por mês', unit: 'count' },
    ],
  },
  {
    title: 'Consulta de crédito',
    note: 'O preço de cada consulta à Serasa.',
    fields: [
      { path: ['creditBureauReport', 'naturalPerson'], label: 'Pessoa física', unit: 'brl' },
      { path: ['creditBureauReport', 'legalPerson'], label: 'Pessoa jurídica', unit: 'brl' },
    ],
  },
  {
    title: 'Notificações',
    note: 'O preço de cada aviso enviado ao pagador.',
    fields: [
      { path: ['notification', 'phoneCall'], label: 'Ligação', unit: 'brl' },
      { path: ['notification', 'whatsApp'], label: 'WhatsApp', unit: 'brl' },
      { path: ['notification', 'messaging'], label: 'Mensagem', unit: 'brl' },
    ],
  },
  {
    title: 'Serviços',
    note: 'Cobrados quando o serviço é usado, não no recebimento.',
    fields: [
      { path: ['invoice'], label: 'Nota fiscal (NFS-e)', unit: 'brl' },
      { path: ['paymentDunning'], label: 'Negativação (Serasa)', unit: 'brl' },
    ],
  },
  {
    title: 'Antecipação',
    note: 'A taxa mensal de cada antecipação.',
    fields: [
      { path: ['anticipation', 'creditCardDetached'], label: 'Cartão à vista', unit: 'pct' },
      { path: ['anticipation', 'creditCardInstallment'], label: 'Cartão parcelado', unit: 'pct' },
      { path: ['anticipation', 'bankSlip'], label: 'Boleto', unit: 'pct' },
    ],
  },
]

/** The key of a fee in the tree, flattened. */
export const feeKey = (path: string[]) => path.join('.')

/** The id of a fee in the DOM. */
export const feeDomId = (path: string[]) => `fee-${path.join('-')}`

/** Reads a fee from the tree; `undefined` when the path does not exist. */
export function readFee(tree: FeeTree, path: string[]): number | undefined {
  let node: number | FeeTree | undefined = tree
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = node[key]
  }
  return typeof node === 'number' ? node : undefined
}

/** Every leaf of the tree, as a path. */
function treePaths(tree: FeeTree, path: string[] = []): string[][] {
  const found: string[][] = []
  for (const [key, value] of Object.entries(tree)) {
    const next = [...path, key]
    if (typeof value === 'object' && value !== null) found.push(...treePaths(value, next))
    else found.push(next)
  }
  return found
}

/**
 * The groups of the sheet, for the table the mock answered.
 *
 * A fee that no group claims is not hidden: it goes to a last group, with its own
 * key as the word, because a fee the mock charges has to be a fee the developer can
 * see and change.
 */
export function feeGroups(tree: FeeTree): FeeGroupSpec[] {
  const groups = [...FEE_GROUPS]
  const claimed = new Set(groups.flatMap((group) => group.fields.map((field) => feeKey(field.path))))
  const extra = treePaths(tree).filter((path) => !claimed.has(feeKey(path)))
  if (extra.length) {
    groups.push({
      title: 'Outras taxas',
      note: 'A tabela do mock trouxe estas taxas e a tela ainda não as conhece.',
      fields: extra.map((path) => ({ path, label: path[path.length - 1], unit: 'raw' as const })),
    })
  }
  return groups
}

/** The number the slot shows: cents and basis points become reais and percent. */
export function formatFee(value: number, unit: FeeUnit): string {
  const shown = value / SCALE[unit]
  const digits = unit === 'count' || unit === 'raw' ? 0 : 2
  return shown.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/**
 * Reads what the developer typed, in the scale of the table.
 *
 * The screen is Brazilian: the comma separates the decimals and the dot groups the
 * thousands. A dot alone is a decimal point — a developer typing `1.99` means one
 * ninety-nine, not a thousand. `null` means the text is not a number, and the
 * caller refuses to send it.
 */
export function parseFee(raw: string, unit: FeeUnit): number | null {
  const cleaned = raw.trim().replace(/\s/g, '')
  if (!cleaned) return null
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  if (!/^\d*\.?\d*$/.test(normalized)) return null
  const shown = Number(normalized)
  if (!Number.isFinite(shown) || shown < 0) return null
  return Math.round(shown * SCALE[unit])
}

/** The text of every slot, for the table the mock answered. */
export function feeTexts(tree: FeeTree, groups: FeeGroupSpec[]): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const group of groups) {
    for (const field of group.fields) {
      const value = readFee(tree, field.path)
      if (value === undefined) continue
      texts[feeKey(field.path)] = formatFee(value, field.unit)
    }
  }
  return texts
}

/** The table the mock accepts: the loaded one with the edited values in it. */
export function applyFees(
  tree: FeeTree,
  groups: FeeGroupSpec[],
  values: Record<string, number>,
): FeeTree {
  const result = structuredClone(tree)
  for (const group of groups) {
    for (const field of group.fields) {
      const value = values[feeKey(field.path)]
      if (value === undefined) continue
      let node = result
      for (const key of field.path.slice(0, -1)) node = node[key] as FeeTree
      node[field.path[field.path.length - 1]] = value
    }
  }
  return result
}
