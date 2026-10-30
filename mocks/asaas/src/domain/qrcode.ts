/**
 * A QR Code from scratch — byte mode, error correction level M, versions 1..10. PURE.
 *
 * It exists because Pix's `encodedImage` is the PNG of the BR Code's QR and the
 * project adds no dependencies. It has to SCAN for real: a fake QR is the
 * textbook case of the "subtly wrong mock" — the developer photographs the screen,
 * the phone does not read it, and they spend the afternoon looking for the bug in
 * the wrong place.
 *
 * Limits, explicit:
 * - error correction level **fixed at M**;
 * - versions **1..10** → at most **213 bytes** in byte mode; above that, it THROWS.
 *   Pix's BR Code fits: 172 bytes in the handler's worst case (v9), 198 with a long
 *   Asaas URL (v10). But a 60-char URL together with a 25-char txid gives 220 and
 *   overflows — if one day we pass a real txid, we need the EC table of v11+ (and it
 *   has to come from the standard, not from deduction: a wrong block split
 *   generates a QR that passes our tests and fails in the bank's reader);
 * - byte mode **without ECI**: the bytes come out as UTF-8. The BR Code is pure
 *   ASCII, so in practice there is no charset ambiguity;
 * - the PNG uses deflate *stored* blocks (no real compression): it is a valid PNG
 *   and it avoids depending on zlib, at the cost of a bigger file.
 */

const MODE_BYTE = 0b0100
/** The level M indicator in the format info (ISO/IEC 18004 §8.9). */
const EC_LEVEL_M = 0b00

export const MIN_VERSION = 1
export const MAX_VERSION = 10

/**
 * ISO/IEC 18004, tables 13-22 — **level M**, versions 1..10:
 * `[ecPerBlock, group1Blocks, dataPerBlockGroup1, group2Blocks, dataPerBlockGroup2]`.
 * Group 2, when it exists, has exactly 1 data codeword more per block.
 */
export const EC_BLOCKS_M: Readonly<Record<number, readonly [number, number, number, number, number]>> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
}

function specOf(version: number): readonly [number, number, number, number, number] {
  const spec = EC_BLOCKS_M[version]
  if (!spec) throw new Error(`qrcode: version ${version} is out of support (${MIN_VERSION}..${MAX_VERSION})`)
  return spec
}

export const moduleCount = (version: number): number => version * 4 + 17

/** The character counter bits in byte mode: 8 up to v9, 16 from v10 on. */
export const charCountBits = (version: number): number => (version < 10 ? 8 : 16)

export function dataCodewords(version: number): number {
  const [, g1, d1, g2, d2] = specOf(version)
  return g1 * d1 + g2 * d2
}

export function totalCodewords(version: number): number {
  const [ec, g1, , g2] = specOf(version)
  return dataCodewords(version) + (g1 + g2) * ec
}

/** How many payload bytes fit in this version, with the header already discounted. */
export function capacityBytes(version: number): number {
  return Math.floor((dataCodewords(version) * 8 - 4 - charCountBits(version)) / 8)
}

export function chooseVersion(byteLength: number): number {
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    if (byteLength <= capacityBytes(v)) return v
  }
  throw new Error(
    `qrcode: ${byteLength} bytes do not fit — the maximum in byte mode/level M up to v${MAX_VERSION} is ${capacityBytes(MAX_VERSION)}`,
  )
}

// ---------------------------------------------------------------------------
// GF(256) — the Galois field of the QR's Reed-Solomon (primitive 0x11d, generator 2).
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!
}

/** The generator polynomial `(x - α⁰)(x - α¹)…(x - αⁿ⁻¹)`, coefficients from the highest degree to the lowest. */
function rsGenerator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ gfMul(poly[j]!, 1)
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, GF_EXP[i]!)
    }
    poly = next
  }
  return poly
}

/** The `degree` error-correction codewords: the remainder of dividing `data·x^degree` by the generator. */
export function rsEncode(data: readonly number[], degree: number): number[] {
  const gen = rsGenerator(degree)
  const rem = new Array<number>(degree).fill(0)

  for (const byte of data) {
    const factor = byte ^ rem[0]!
    rem.shift()
    rem.push(0)
    for (let i = 0; i < degree; i++) {
      rem[i] = rem[i]! ^ gfMul(gen[i + 1]!, factor)
    }
  }
  return rem
}

// ---------------------------------------------------------------------------
// Bitstream → codewords
// ---------------------------------------------------------------------------

class BitBuffer {
  readonly bits: number[] = []

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
  }
}

/** Encodes the payload into data codewords (with terminator and padding). */
export function encodeCodewords(data: string, version: number): number[] {
  const bytes = new TextEncoder().encode(data)
  const capacity = dataCodewords(version)

  const buf = new BitBuffer()
  buf.push(MODE_BYTE, 4)
  buf.push(bytes.length, charCountBits(version))
  for (const byte of bytes) buf.push(byte, 8)

  // Terminator: up to 4 zeros, if there is room left.
  const totalBits = capacity * 8
  const terminator = Math.min(4, totalBits - buf.bits.length)
  if (terminator < 0) throw new Error(`qrcode: the payload does not fit in version ${version}`)
  buf.push(0, terminator)
  // Closes the current byte.
  while (buf.bits.length % 8 !== 0) buf.bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0
    for (let b = 0; b < 8; b++) byte = (byte << 1) | buf.bits[i + b]!
    codewords.push(byte)
  }
  // Alternating 0xEC/0x11 padding until the capacity is filled (ISO/IEC 18004 §8.4.9).
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad)

  return codewords
}

/** Splits into blocks, generates each ECC and interleaves data and ECC. */
export function interleave(codewords: readonly number[], version: number): number[] {
  const [ecPerBlock, g1, d1, g2, d2] = specOf(version)

  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  let offset = 0
  for (const [count, size] of [
    [g1, d1],
    [g2, d2],
  ] as const) {
    for (let b = 0; b < count; b++) {
      const block = codewords.slice(offset, offset + size)
      offset += size
      dataBlocks.push(block)
      ecBlocks.push(rsEncode(block, ecPerBlock))
    }
  }

  const out: number[] = []
  const maxData = Math.max(d1, d2)
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]!)
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]!)
  }
  return out
}

// ---------------------------------------------------------------------------
// Matriz
// ---------------------------------------------------------------------------

/** Centers of the alignment patterns (ISO/IEC 18004 §6.3.5). */
export function alignmentCenters(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let pos = moduleCount(version) - 7; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

type Grid = boolean[][]

const emptyGrid = (size: number): Grid => Array.from({ length: size }, () => new Array<boolean>(size).fill(false))

/** Marks the function patterns and returns the base matrix + the map of what is reserved. */
function drawFunctionPatterns(version: number): { modules: Grid; reserved: Grid } {
  const size = moduleCount(version)
  const modules = emptyGrid(size)
  const reserved = emptyGrid(size)

  const set = (row: number, col: number, dark: boolean): void => {
    modules[row]![col] = dark
    reserved[row]![col] = true
  }

  // Timing: row 6 and column 6 are complete (the finders overwrite them next).
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  // Finder + separator: an 8×8 block at each of the three corners.
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || r >= size || c < 0 || c >= size) continue
        const inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
        set(r, c, inner && (ring || core))
      }
    }
  }

  // Alignment: at every crossing of centers, except those that collide with finders.
  const centers = alignmentCenters(version)
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const last = centers.length - 1
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      const cr = centers[i]!
      const cc = centers[j]!
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
        }
      }
    }
  }

  // Reserves the format info (the real value comes in after the mask is chosen).
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, false)
      set(i, 8, false)
    }
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false)
    set(size - 1 - i, 8, false)
  }
  // Dark module: always dark, always at (4v+9, 8).
  set(size - 8, 8, true)

  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(b, a, dark)
      set(a, b, dark)
    }
  }

  return { modules, reserved }
}

/** BCH(18,6) of the version info, generator 0x1f25 (ISO/IEC 18004 §8.10). */
export function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return ((version << 12) | rem) & 0x3ffff
}

/** BCH(15,5) of the format info, generator 0x537, masked with 0x5412 (ISO/IEC 18004 §8.9). */
export function formatBits(mask: number): number {
  const data = (EC_LEVEL_M << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff
}

function drawFormatInfo(modules: Grid, mask: number): void {
  const size = modules.length
  const bits = formatBits(mask)
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1

  for (let i = 0; i <= 5; i++) modules[i]![8] = bit(i)
  modules[7]![8] = bit(6)
  modules[8]![8] = bit(7)
  modules[8]![7] = bit(8)
  for (let i = 9; i < 15; i++) modules[8]![14 - i] = bit(i)

  for (let i = 0; i < 8; i++) modules[8]![size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) modules[size - 15 + i]![8] = bit(i)
}

/** Zigzag from bottom-right to top, skipping column 6 (vertical timing). */
function placeCodewords(modules: Grid, reserved: Grid, codewords: readonly number[]): void {
  const size = modules.length
  let bitIndex = 0

  const nextBit = (): boolean => {
    const i = bitIndex >>> 3
    // After the codewords come the "remainder bits", which are always 0.
    if (i >= codewords.length) return false
    const dark = ((codewords[i]! >>> (7 - (bitIndex & 7))) & 1) === 1
    bitIndex++
    return dark
  }

  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step
      for (const col of [right, right - 1]) {
        if (!reserved[row]![col]) modules[row]![col] = nextBit()
      }
    }
    upward = !upward
  }
}

const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

function applyMask(modules: Grid, reserved: Grid, mask: number): void {
  const fn = MASKS[mask]!
  for (let r = 0; r < modules.length; r++) {
    for (let c = 0; c < modules.length; c++) {
      if (!reserved[r]![c] && fn(r, c)) modules[r]![c] = !modules[r]![c]
    }
  }
}

/** The weights of the four penalty rules: 3, 3, 40, and 10 (ISO/IEC 18004 §8.8.2). */
const [N1, N2, N3, N4] = [3, 3, 40, 10]

export function penalty(modules: Grid): number {
  const size = modules.length
  let score = 0

  // Rule 1: runs of 5+ modules of the same color, in rows and columns.
  for (let i = 0; i < size; i++) {
    for (const line of [
      (j: number) => modules[i]![j]!,
      (j: number) => modules[j]![i]!,
    ]) {
      let run = 1
      for (let j = 1; j < size; j++) {
        if (line(j) === line(j - 1)) {
          run++
          if (run === 5) score += N1
          else if (run > 5) score += 1
        } else run = 1
      }
    }
  }

  // Rule 2: 2×2 blocks of uniform color.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c]!
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) score += N2
    }
  }

  // Rule 3: the 1:1:3:1:1 pattern followed (or preceded) by 4 light modules.
  const A = [true, false, true, true, true, false, true, false, false, false, false]
  const B = [false, false, false, false, true, false, true, true, true, false, true]
  const matches = (get: (j: number) => boolean, at: number, pat: boolean[]): boolean => {
    for (let k = 0; k < 11; k++) if (get(at + k) !== pat[k]) return false
    return true
  }
  for (let i = 0; i < size; i++) {
    for (const line of [
      (j: number) => modules[i]![j]!,
      (j: number) => modules[j]![i]!,
    ]) {
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(line, j, A)) score += N3
        if (matches(line, j, B)) score += N3
      }
    }
  }

  // Rule 4: deviation from the 50/50 proportion between light and dark.
  let dark = 0
  for (const row of modules) for (const v of row) if (v) dark++
  const ratio = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(ratio - 50) / 5) * N4

  return score
}

/**
 * The final module matrix (`true` = dark), already masked and with the format/version info.
 * Exposed so the test can decode it back without going through the PNG.
 */
export function qrMatrix(data: string): Grid {
  const version = chooseVersion(new TextEncoder().encode(data).length)
  const codewords = interleave(encodeCodewords(data, version), version)

  let best: Grid | undefined
  let bestScore = Infinity

  for (let mask = 0; mask < 8; mask++) {
    const { modules, reserved } = drawFunctionPatterns(version)
    placeCodewords(modules, reserved, codewords)
    applyMask(modules, reserved, mask)
    drawFormatInfo(modules, mask)

    const score = penalty(modules)
    if (score < bestScore) {
      bestScore = score
      best = modules
    }
  }

  return best!
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC32_TABLE[i] = c >>> 0
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function be32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, false)
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes, 0)
  body.set(data, typeBytes.length)

  const out = new Uint8Array(4 + body.length + 4)
  out.set(be32(data.length), 0)
  out.set(body, 4)
  out.set(be32(crc32(body)), 4 + body.length)
  return out
}

/**
 * A zlib stream with *stored* deflate blocks (BTYPE=00): no compression, but it is
 * exactly what the format allows — and it saves us from depending on zlib.
 */
/**
 * A PNG's IDAT is a **zlib** stream, and `Bun.deflateSync` returns **raw** deflate
 * — without the 2-byte header and without the trailing Adler-32. Wrapping it is
 * what is missing, and omitting that produces a PNG that some readers accept and
 * others refuse.
 *
 * (Using the runtime's deflate fits in the pure domain: it is deterministic and it
 * is not I/O. It is the difference between an `encodedImage` of ~3 KB and one of
 * 175 KB, which is what emitting *stored* blocks meant. A QR image is almost all white.)
 */
function zlibDeflate(raw: Uint8Array<ArrayBuffer>): Uint8Array {
  const deflated = Bun.deflateSync(raw)

  const out = new Uint8Array(2 + deflated.length + 4)
  out[0] = 0x78 // CM = deflate, CINFO = 32K window
  out[1] = 0x01 // FLEVEL + FCHECK: (0x78<<8 | 0x01) % 31 === 0
  out.set(deflated, 2)
  out.set(be32(adler32(raw)), 2 + deflated.length)
  return out
}

export interface QrPngOptions {
  /** Pixels per module. */
  scale?: number
  /** Quiet zone in modules — the QR standard is 4. */
  quietZone?: number
}

/** The QR as a base64 PNG, without the `data:` prefix — ready for `encodedImage`. */
export function qrPng(data: string, options: QrPngOptions = {}): string {
  const scale = options.scale ?? 6
  const quiet = options.quietZone ?? 4

  const modules = qrMatrix(data)
  const size = modules.length
  const side = (size + quiet * 2) * scale

  // 8-bit grayscale: each scanline starts with the filter byte 0 (None).
  const raw = new Uint8Array(side * (side + 1))
  raw.fill(0xff)
  for (let y = 0; y < side; y++) {
    const rowStart = y * (side + 1)
    raw[rowStart] = 0
    const moduleRow = Math.floor(y / scale) - quiet
    if (moduleRow < 0 || moduleRow >= size) continue
    for (let x = 0; x < side; x++) {
      const moduleCol = Math.floor(x / scale) - quiet
      if (moduleCol < 0 || moduleCol >= size) continue
      if (modules[moduleRow]![moduleCol]) raw[rowStart + 1 + x] = 0x00
    }
  }

  const ihdr = new Uint8Array(13)
  ihdr.set(be32(side), 0)
  ihdr.set(be32(side), 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter: adaptive
  ihdr[12] = 0 // interlace: none

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', zlibDeflate(raw))),
    Buffer.from(chunk('IEND', new Uint8Array(0))),
  ])

  return png.toString('base64')
}
