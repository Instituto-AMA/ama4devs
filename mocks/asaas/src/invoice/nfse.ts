/**
 * The issued note behind `pdfUrl` and `xmlUrl`: a printable page and its XML.
 *
 * Exists so the links an AUTHORIZED note returns open something, built from the
 * note itself — never a URL that answers 404. A note not yet authorized has no
 * document, as at the city hall.
 */
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import type { AppContext } from '../core/context.ts'
import { notFound } from '../core/errors.ts'
import { accounts, customers, invoices } from '../db/schema/index.ts'
import { cents, centsToBrl } from '../domain/money.ts'

const HAS_DOCUMENT = new Set(['AUTHORIZED', 'PROCESSING_CANCELLATION', 'CANCELLATION_DENIED', 'CANCELED'])

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const brl = (c: number | null) =>
  centsToBrl(cents(c ?? 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function nfseRoutes(ctx: AppContext) {
  const load = async (id: string) => {
    const [inv] = await ctx.db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
    if (!inv || !HAS_DOCUMENT.has(inv.status)) throw notFound('Nota fiscal')
    const [issuer] = await ctx.db.select().from(accounts).where(eq(accounts.id, inv.accountId)).limit(1)
    const [taker] = inv.customerId
      ? await ctx.db.select().from(customers).where(eq(customers.id, inv.customerId)).limit(1)
      : []
    return { inv, issuer, taker }
  }

  return new Elysia({ name: 'nfse-document' })
    .get('/nfse/:id', async ({ params }) => {
      const { inv, issuer, taker } = await load(params.id)
      const cancelled = inv.status === 'CANCELED'
      const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NFS-e ${esc(inv.number)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#111}
h1{font-size:20px;margin:0}.muted{color:#555}.box{border:1px solid #bbb;border-radius:6px;padding:12px 16px;margin:12px 0}
table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}td:last-child{text-align:right}
.stamp{color:#b00;font-weight:700;border:2px solid #b00;display:inline-block;padding:2px 8px;transform:rotate(-4deg)}
</style></head><body>
<h1>Nota Fiscal de Serviço Eletrônica — NFS-e nº ${esc(inv.number)}</h1>
<p class="muted">Documento de simulação (Asaas mock): não tem validade fiscal.</p>
${cancelled ? '<p class="stamp">CANCELADA</p>' : ''}
<div class="box"><table>
<tr><td>Data de emissão</td><td>${esc(inv.effectiveDate)}</td></tr>
<tr><td>Código de verificação</td><td>${esc(inv.validationCode)}</td></tr>
<tr><td>RPS</td><td>série ${esc(inv.rpsSerie)}, nº ${esc(inv.rpsNumber)}</td></tr>
</table></div>
<div class="box"><b>Prestador</b><br>${esc(issuer?.name)} — CPF/CNPJ ${esc(issuer?.cpfCnpj)}</div>
<div class="box"><b>Tomador</b><br>${taker ? `${esc(taker.name)} — CPF/CNPJ ${esc(taker.cpfCnpj)}` : '—'}</div>
<div class="box"><b>Serviço</b><br>${esc(inv.municipalServiceName)}<br>${esc(inv.serviceDescription)}
${inv.observations ? `<p class="muted">${esc(inv.observations)}</p>` : ''}</div>
<div class="box"><table>
<tr><td>Valor do serviço</td><td>${brl(inv.valueCents)}</td></tr>
<tr><td>Deduções</td><td>${brl(inv.deductionsCents)}</td></tr>
</table></div>
</body></html>`
      return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    })
    .get('/nfse/:id/xml', async ({ params }) => {
      const { inv, issuer, taker } = await load(params.id)
      const taxes = (inv.taxes ?? {}) as Record<string, unknown>
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse simulacao="true">
  <Nfse>
    <Numero>${esc(inv.number)}</Numero>
    <CodigoVerificacao>${esc(inv.validationCode)}</CodigoVerificacao>
    <DataEmissao>${esc(inv.effectiveDate)}</DataEmissao>
    <IdentificacaoRps><Numero>${esc(inv.rpsNumber)}</Numero><Serie>${esc(inv.rpsSerie)}</Serie></IdentificacaoRps>
    <Situacao>${esc(inv.status)}</Situacao>
    <Servico>
      <Valores>
        <ValorServicos>${centsToBrl(cents(inv.valueCents)).toFixed(2)}</ValorServicos>
        <ValorDeducoes>${centsToBrl(cents(inv.deductionsCents ?? 0)).toFixed(2)}</ValorDeducoes>
        <IssRetido>${taxes.retainIss ? 1 : 2}</IssRetido>
        <Aliquota>${esc(taxes.iss ?? 0)}</Aliquota>
      </Valores>
      <ItemListaServico>${esc(inv.municipalServiceCode ?? inv.municipalServiceId)}</ItemListaServico>
      <Discriminacao>${esc(inv.serviceDescription)}</Discriminacao>
    </Servico>
    <Prestador><CpfCnpj>${esc(issuer?.cpfCnpj)}</CpfCnpj><RazaoSocial>${esc(issuer?.name)}</RazaoSocial></Prestador>
    <Tomador><CpfCnpj>${esc(taker?.cpfCnpj)}</CpfCnpj><RazaoSocial>${esc(taker?.name)}</RazaoSocial></Tomador>
  </Nfse>
</CompNfse>
`
      return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
    })
}
