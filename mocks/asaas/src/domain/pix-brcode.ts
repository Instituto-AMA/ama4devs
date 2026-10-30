/**
 * BR Code EMV — the Pix "copy and paste" payload. Pure.
 *
 * EMV®QRCPS format / BACEN Standards Manual: TLV with a 2-digit ID, a 2-digit
 * zero-padded size and a CRC16-CCITT in the last 4 hex digits.
 *
 * This is a **dynamic** QR: the amount does NOT go in the payload (there is no `54`
 * field) — it lives behind the URL of the 26/25 field. It was checked against a
 * real payload from the sandbox, whose CRC (`C50D`) is the golden of
 * `tests/unit/pix-brcode.test.ts`.
 */

/** Field 26, subfield 00: the GUI of the Pix arrangement. */
const PIX_GUI = 'br.gov.bcb.pix'

const MERCHANT_NAME_MAX = 25
const MERCHANT_CITY_MAX = 15

export interface BrCodeInput {
  /** The dynamic payload URL (field 26/25). The `https://` scheme is removed. */
  url: string
  merchantName: string
  merchantCity: string
  /** Field 62/05. The standard for a dynamic QR is `***`. */
  txid?: string
  /** Field 61 (postal code, digits only). Omitted when absent. */
  postalCode?: string
}

/**
 * CRC16-CCITT (poly 0x1021, init 0xFFFF, no final xor), 4 uppercase hex digits.
 * Computed over the ASCII bytes of the payload with the `6304` already at the end.
 */
export function crc16(s: string): string {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    crc ^= (s.charCodeAt(i) & 0xff) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** A TLV: `<id 2><len 2 zero-padded><value>`. */
function tlv(id: string, value: string): string {
  if (value.length > 99) {
    throw new Error(`brCode: field ${id} has ${value.length} chars — the TLV size only goes up to 99`)
  }
  return id + String(value.length).padStart(2, '0') + value
}

/** The BR Code is ASCII: an accented letter becomes its unaccented version, the rest disappears. */
function ascii(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
    .slice(0, max)
}

export function brCodePayload(i: BrCodeInput): string {
  const url = i.url.replace(/^https?:\/\//i, '')
  const txid = i.txid && i.txid.length > 0 ? i.txid : '***'

  const merchantAccount = tlv('00', PIX_GUI) + tlv('25', url)

  let payload =
    tlv('00', '01') + // payload format indicator
    tlv('01', '12') + // point of initiation: 12 = dynamic (one-time use)
    tlv('26', merchantAccount) +
    tlv('52', '0000') + // merchant category code: not informed
    tlv('53', '986') + // currency: BRL
    tlv('58', 'BR') +
    tlv('59', ascii(i.merchantName, MERCHANT_NAME_MAX)) +
    tlv('60', ascii(i.merchantCity, MERCHANT_CITY_MAX))

  if (i.postalCode) {
    const digits = i.postalCode.replace(/\D/g, '')
    if (digits.length > 0) payload += tlv('61', digits)
  }

  payload += tlv('62', tlv('05', txid))
  payload += '6304' // the CRC goes in afterwards — but the "6304" already goes into its calculation.

  return payload + crc16(payload)
}

/** Checks the CRC of a BR Code received ready-made. Useful in tests and debugging. */
export function isValidBrCode(payload: string): boolean {
  if (payload.length < 8) return false
  const body = payload.slice(0, -4)
  if (!body.endsWith('6304')) return false
  return crc16(body) === payload.slice(-4).toUpperCase()
}
