// @ts-check
/**
 * OTP code extraction: the numbers a message asks the reader to type back.
 * A code is a run of four to eight digits that does not stick to other digits, or
 * the same digits split in two groups (`123-456`, `123 456`) that the reader joins.
 */

/** A run of digits that stands on its own: four to eight of them. */
const CODE_RUN = /(?<!\d)\d{4,8}(?!\d)/g

/** Two groups of digits a reader joins back: `123-456` or `123 456`. */
const CODE_GROUP = /(?<!\d)\d{3,4}[-–—\s]+\d{3,4}(?!\d)/g

/**
 * @typedef {object} FoundCode
 * @property {string} code The digits to type back.
 * @property {number} at Where the code starts in the text.
 */

/**
 * Finds the codes a text carries: digit runs of four to eight digits and split
 * groups of two groups of three or four digits, de-duplicated, in the order they
 * appear.
 * @param {string} text The message body.
 * @returns {string[]}
 */
export function extractCodes(text) {
  /** @type {FoundCode[]} */
  const found = []
  /** @type {{ start: number, end: number }[]} */
  const taken = []

  CODE_GROUP.lastIndex = 0
  for (const match of text.matchAll(CODE_GROUP)) {
    const start = match.index
    found.push({ code: match[0].replace(/\D/g, ''), at: start })
    taken.push({ start, end: start + match[0].length })
  }

  CODE_RUN.lastIndex = 0
  for (const match of text.matchAll(CODE_RUN)) {
    const start = match.index
    const end = start + match[0].length
    const inside = taken.some((span) => start < span.end && end > span.start)
    if (!inside) found.push({ code: match[0], at: start })
  }

  found.sort((a, b) => a.at - b.at)

  /** @type {string[]} */
  const codes = []
  for (const item of found) {
    if (codes.includes(item.code)) continue
    codes.push(item.code)
  }
  return codes
}
