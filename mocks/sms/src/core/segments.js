// @ts-check
/**
 * SMS segment counting: what a message costs on the wire.
 * A GSM-7 message fits 160 septets in one segment and 153 in each extra one; the
 * characters of the extension table cost two septets each. Any character outside
 * GSM-7 turns the message into UCS-2, which fits 70 UTF-16 units in one segment
 * and 67 in each extra one.
 */

/** The GSM 03.38 basic table: the 128 characters that cost one septet. */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

/** The GSM 03.38 extension table: the nine characters that cost two septets each. */
const GSM_EXTENSION = '^ { } \\ [ ] ~ | €'

const BASIC_CHARS = new Set(GSM_BASIC)
const EXTENSION_CHARS = new Set(GSM_EXTENSION)

/** Septets of one GSM-7 segment, and of each segment after the first. */
const GSM_SINGLE = 160
const GSM_MULTI = 153
/** UTF-16 units of one UCS-2 segment, and of each segment after the first. */
const UCS2_SINGLE = 70
const UCS2_MULTI = 67

/**
 * @typedef {object} SegmentInfo
 * @property {'GSM-7' | 'UCS-2'} encoding The encoding the message is billed in.
 * @property {number} length The length in septets (GSM-7) or UTF-16 units (UCS-2).
 * @property {number} segments How many SMS parts the message costs.
 * @property {number} perSegment The capacity of one segment, in the encoding's units.
 * @property {number} remaining How many units are left in the last segment.
 */

/**
 * Counts the parts of a message: its encoding, its length in that encoding's units,
 * the number of segments it takes and the room left in the last one.
 * @param {string} text The message body.
 * @returns {SegmentInfo}
 */
export function analyze(text) {
  if (text.length === 0) {
    return {
      encoding: 'GSM-7',
      length: 0,
      segments: 0,
      perSegment: GSM_SINGLE,
      remaining: GSM_SINGLE,
    }
  }

  let septets = 0
  let gsm = true
  for (const char of text) {
    if (EXTENSION_CHARS.has(char)) septets += 2
    else if (BASIC_CHARS.has(char)) septets += 1
    else {
      gsm = false
      break
    }
  }

  if (!gsm) {
    const length = text.length
    const single = length <= UCS2_SINGLE
    const perSegment = single ? UCS2_SINGLE : UCS2_MULTI
    const segments = single ? 1 : Math.ceil(length / UCS2_MULTI)
    return { encoding: 'UCS-2', length, segments, perSegment, remaining: segments * perSegment - length }
  }

  const single = septets <= GSM_SINGLE
  const perSegment = single ? GSM_SINGLE : GSM_MULTI
  const segments = single ? 1 : Math.ceil(septets / GSM_MULTI)
  return {
    encoding: 'GSM-7',
    length: septets,
    segments,
    perSegment,
    remaining: segments * perSegment - septets,
  }
}
