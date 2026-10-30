/**
 * The booklet (`paymentBook`). (Track E)
 *
 * `GET /v3/installments/{id}/paymentBook` and `GET /v3/subscriptions/{id}/paymentBook`
 * do NOT return JSON: they return **a PDF** (`application/pdf`), and that is why
 * the spec declares the 200 response without a schema. A client that expects PDF
 * bytes and receives `{"url": "..."}` breaks — so we generate a real PDF, minimal
 * but valid: header, xref with correct offsets and trailer.
 *
 * The content is fictional (there is no issuing bank here), but the TYPE of the
 * answer is the real one. It is the difference between a simulator and a mock
 * with a static answer.
 */

/**
 * PDF in ASCII only: the offsets of the xref are counted in BYTES, and an accent
 * (2 bytes in UTF-8) would misalign the table in silence — the file would open
 * in some readers and not in others. We fold it to ASCII before writing.
 */
function toAscii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira os diacriticos
    .replace(/[^\x20-\x7e]/g, '?')
}

/** Escapes the characters that have meaning inside a PDF string literal. */
function escapePdf(s: string): string {
  return toAscii(s)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

export function buildPaymentBookPdf(title: string, lines: readonly string[]): string {
  const content = [
    'BT',
    '/F1 14 Tf',
    '40 800 Td',
    `(${escapePdf(title)}) Tj`,
    '/F1 10 Tf',
    ...lines.flatMap((line) => ['0 -18 Td', `(${escapePdf(line)}) Tj`]),
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefStart}\n%%EOF\n`

  // Pure ASCII by construction: 1 character = 1 byte, and the xref offsets close.
  return pdf
}

/** The HTTP answer of the booklet. Real Content-Type: the client receives a PDF. */
export function paymentBookResponse(title: string, lines: readonly string[]): Response {
  return new Response(buildPaymentBookPdf(title, lines), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="carne.pdf"',
    },
  })
}

/**
 * The ordering of the booklet. `sort`/`order` exist in the spec of the two
 * operations; the docs do not say which fields are accepted, so we support the
 * ones that make sense in a booklet (due date and value) and fall back to
 * `dueDate` for anything else.
 * TODO(rule): confirm the set of fields accepted by the real Asaas.
 */
export function bookletOrder(query: Record<string, unknown>): {
  field: 'dueDate' | 'value'
  desc: boolean
} {
  const raw = String(query.sort ?? 'dueDate')
  return {
    field: raw === 'value' ? 'value' : 'dueDate',
    desc: String(query.order ?? 'asc').toLowerCase() === 'desc',
  }
}
