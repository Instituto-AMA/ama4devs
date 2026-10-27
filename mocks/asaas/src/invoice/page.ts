/**
 * The payer's invoice page (`invoiceUrl`), rendered on the server.
 *
 * One HTML string per request, no build step: the page is what a patient opens from
 * the link the application shows, so it must work from any browser with no panel and
 * no key. Every value from the database goes through `esc()`.
 */
export interface InvoiceView {
  token: string
  merchant: { name: string; cpfCnpj: string }
  customer: { name: string; cpfCnpj: string; email: string | null } | null
  payment: {
    id: string
    status: string
    billingType: string
    valueCents: number
    dueDate: string
    description: string | null
    invoiceNumber: string | null
    paymentDate: string | null
    deleted: boolean
  }
  /** The other charges of the same installment plan, this one included. */
  installments: Array<{
    token: string
    number: string | null
    dueDate: string
    valueCents: number
    status: string
    current: boolean
  }>
  /** The methods the payer may choose: the charge's own, all three for UNDEFINED, boleto also by Pix. */
  methods: Array<'PIX' | 'BOLETO' | 'CREDIT_CARD'>
  payable: boolean
  /** The test cards the card form offers: built-in and added in the panel. */
  testCards: Array<{ number: string; label: string }>
  /** An installment plan paid by card takes every pending installment at once. */
  cardPlan: { count: number; valueCents: number } | null
  pix: { payload: string; image: string } | null
  boletoLine: string | null
  today: string
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  PENDING: { label: 'Aguardando pagamento', tone: 'neutral' },
  OVERDUE: { label: 'Vencida', tone: 'bad' },
  AWAITING_RISK_ANALYSIS: { label: 'Em análise', tone: 'warn' },
  CONFIRMED: { label: 'Pagamento confirmado', tone: 'ok' },
  RECEIVED: { label: 'Paga', tone: 'ok' },
  RECEIVED_IN_CASH: { label: 'Paga (em dinheiro)', tone: 'ok' },
  REFUNDED: { label: 'Estornada', tone: 'neutral' },
  REFUND_REQUESTED: { label: 'Estorno solicitado', tone: 'warn' },
  REFUND_IN_PROGRESS: { label: 'Estorno em andamento', tone: 'warn' },
  CHARGEBACK_REQUESTED: { label: 'Chargeback', tone: 'bad' },
  AUTHORIZED: { label: 'Autorizada', tone: 'warn' },
}

const METHOD_LABEL = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão de crédito' } as const

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const br = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

function formatDocument(cpfCnpj: string): string {
  const d = cpfCnpj.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return cpfCnpj
}

function statusBadge(status: string, deleted: boolean): string {
  if (deleted) return '<span class="badge bad">Cobrança removida</span>'
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const }
  return `<span class="badge ${s.tone}">${esc(s.label)}</span>`
}

function pixPanel(v: InvoiceView): string {
  if (!v.pix) return ''
  return `
    <section class="method" data-method="PIX">
      <div class="pix">
        <img alt="QR Code Pix" src="data:image/png;base64,${esc(v.pix.image)}" width="200" height="200">
        <div class="pix-copy">
          <label for="pix-payload">Pix copia e cola</label>
          <textarea id="pix-payload" readonly rows="4">${esc(v.pix.payload)}</textarea>
          <button type="button" class="btn outline" data-copy="pix-payload">Copiar código</button>
        </div>
      </div>
      <button type="button" class="btn primary" data-pay="PIX">Simular pagamento via Pix</button>
    </section>`
}

function boletoPanel(v: InvoiceView): string {
  if (!v.boletoLine) return ''
  return `
    <section class="method" data-method="BOLETO" hidden>
      <label for="boleto-line">Linha digitável</label>
      <div class="line">
        <input id="boleto-line" readonly value="${esc(v.boletoLine)}">
        <button type="button" class="btn outline" data-copy="boleto-line">Copiar</button>
      </div>
      <p class="hint">O boleto é compensado em até 1 dia útil depois do pagamento.</p>
      <button type="button" class="btn primary" data-pay="BOLETO">Simular pagamento do boleto</button>
    </section>`
}

function cardPanel(v: InvoiceView): string {
  const options = v.testCards.map(
    (c) =>
      `<option value="${esc(c.number)}">${esc(c.number.replace(/(\d{4})(?=\d)/g, '$1 '))} — ${esc(c.label)}</option>`,
  ).join('')
  return `
    <section class="method" data-method="CREDIT_CARD" hidden>
      <form id="card-form" class="card-form">
        <label>Cartão de teste
          <select name="number">${options}</select>
        </label>
        <label>Nome impresso no cartão
          <input name="holderName" value="TITULAR TESTE" required>
        </label>
        <div class="grid">
          <label>Mês<input name="expiryMonth" value="12" inputmode="numeric" required></label>
          <label>Ano<input name="expiryYear" value="2030" inputmode="numeric" required></label>
          <label>CVV<input name="ccv" value="123" inputmode="numeric" required></label>
        </div>
        ${
          v.cardPlan
            ? `<p class="hint">Parcelado no cartão: as ${v.cardPlan.count} parcelas pendentes (total ${brl(v.cardPlan.valueCents)}) são confirmadas agora, e cada uma é creditada no seu mês.</p>`
            : ''
        }
        <button type="submit" class="btn primary">${v.cardPlan ? `Pagar ${v.cardPlan.count} parcelas no cartão` : 'Pagar com cartão'}</button>
      </form>
    </section>`
}

function installmentsTable(v: InvoiceView): string {
  if (v.installments.length < 2) return ''
  const rows = v.installments
    .map(
      (i) => `
        <tr class="${i.current ? 'current' : ''}">
          <td>${esc(i.number ?? '—')}</td>
          <td>${br(i.dueDate)}</td>
          <td class="num">${brl(i.valueCents)}</td>
          <td>${i.current ? statusBadge(i.status, false) : `<a href="/i/${esc(i.token)}">${esc(STATUS[i.status]?.label ?? i.status)}</a>`}</td>
        </tr>`,
    )
    .join('')
  return `
    <section class="box">
      <h2>Parcelas</h2>
      <table>
        <thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`
}

function payArea(v: InvoiceView): string {
  if (!v.payable) {
    const paid = v.payment.paymentDate
      ? `<p>Pagamento registrado em <b>${br(v.payment.paymentDate)}</b>.</p>`
      : ''
    return `<section class="box done">${statusBadge(v.payment.status, v.payment.deleted)}${paid}</section>`
  }
  const tabs =
    v.methods.length > 1
      ? `<div class="tabs" role="tablist">${v.methods
          .map(
            (m, i) =>
              `<button type="button" role="tab" class="tab${i === 0 ? ' active' : ''}" data-tab="${m}">${METHOD_LABEL[m]}</button>`,
          )
          .join('')}</div>`
      : ''
  const panels = v.methods
    .map((m) => (m === 'PIX' ? pixPanel(v) : m === 'BOLETO' ? boletoPanel(v) : cardPanel(v)))
    .join('')
  return `
    <section class="box">
      <h2>Como você quer pagar?</h2>
      ${tabs}
      ${panels}
      <p id="pay-error" class="error" role="alert" hidden></p>
    </section>`
}

export function renderInvoice(v: InvoiceView): string {
  const p = v.payment
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fatura ${esc(p.invoiceNumber ?? '')} · ${esc(v.merchant.name)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <p class="sim">Simulador Asaas · o pagamento acontece na hora, como se o banco tivesse confirmado.</p>
  <header class="box head">
    <div>
      <p class="muted">Cobrança de</p>
      <h1>${esc(v.merchant.name)}</h1>
      <p class="muted">CPF/CNPJ ${esc(formatDocument(v.merchant.cpfCnpj))}</p>
    </div>
    ${statusBadge(p.status, p.deleted)}
  </header>
  <section class="box summary">
    <div><p class="muted">Valor</p><p class="value">${brl(p.valueCents)}</p></div>
    <div><p class="muted">Vencimento</p><p class="strong">${br(p.dueDate)}</p></div>
    <div><p class="muted">Fatura</p><p class="strong">${esc(p.invoiceNumber ?? '—')}</p></div>
    ${p.description ? `<div class="wide"><p class="muted">Descrição</p><p>${esc(p.description)}</p></div>` : ''}
    ${
      v.customer
        ? `<div class="wide"><p class="muted">Pagador</p><p>${esc(v.customer.name)} · ${esc(formatDocument(v.customer.cpfCnpj))}</p></div>`
        : ''
    }
  </section>
  ${payArea(v)}
  ${installmentsTable(v)}
</main>
<script>${SCRIPT.replace('__TOKEN__', JSON.stringify(v.token))}</script>
</body>
</html>`
}

const CSS = `
:root { --bg:#f4f6fb; --surface:#fff; --text:#0b1736; --muted:#5b6785; --border:#dfe4ef;
  --primary:#0038e5; --primary-soft:#e6edff; --ok:#0a7a4b; --ok-soft:#e3f6ec; --warn:#9a5b00;
  --warn-soft:#fff3db; --bad:#b42318; --bad-soft:#fde8e6; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1020; --surface:#141a2e; --text:#e8ecf7;
  --muted:#a1abc4; --border:#28304a; --primary:#6f93ff; --primary-soft:#1d2a55; --ok:#5fd39c;
  --ok-soft:#123326; --warn:#f2b75a; --warn-soft:#3a2b10; --bad:#ff8a80; --bad-soft:#3d1714; } }
* { box-sizing: border-box; }
/* An author display (.method is flex) beats the browser's [hidden]; this restores it. */
[hidden] { display:none !important; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:640px; margin:0 auto; padding:24px 16px 48px; display:flex; flex-direction:column; gap:16px; }
h1 { font-size:22px; margin:2px 0; } h2 { font-size:17px; margin:0 0 12px; }
p { margin:0; }
.sim { font-size:12px; color:var(--muted); text-align:center; }
.box { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:20px; }
.head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
.summary { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:16px; }
.summary .wide { grid-column:1 / -1; }
@media (max-width:480px) { .summary { grid-template-columns:1fr 1fr; } }
.muted { color:var(--muted); font-size:13px; }
.value { font-size:26px; font-weight:700; } .strong { font-weight:600; }
.badge { display:inline-block; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
.badge.ok { background:var(--ok-soft); color:var(--ok); } .badge.warn { background:var(--warn-soft); color:var(--warn); }
.badge.bad { background:var(--bad-soft); color:var(--bad); } .badge.neutral { background:var(--primary-soft); color:var(--primary); }
.done { display:flex; flex-direction:column; gap:8px; align-items:flex-start; }
.tabs { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
.tab { border:1px solid var(--border); background:var(--surface); color:var(--muted); border-radius:999px; padding:8px 16px; font-family:inherit; font-weight:600; font-size:14px; cursor:pointer; }
.tab.active { background:var(--primary-soft); border-color:var(--primary); color:var(--primary); }
.method { display:flex; flex-direction:column; gap:12px; }
.pix { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
.pix img { border-radius:8px; background:#fff; padding:6px; }
.pix-copy { flex:1; min-width:200px; display:flex; flex-direction:column; gap:8px; }
label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; color:var(--muted); }
textarea, input, select { font:14px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--text); background:var(--surface);
  border:1px solid var(--border); border-radius:12px; padding:10px 12px; width:100%; }
select, .card-form input { font-family:inherit; }
textarea { resize:none; overflow-wrap:anywhere; }
.line { display:flex; gap:8px; } .line input { flex:1; min-width:0; }
.card-form { display:flex; flex-direction:column; gap:12px; }
.grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; }
.btn { border-radius:999px; padding:0 20px; height:44px; font-family:inherit; font-weight:600; font-size:15px; cursor:pointer; border:1px solid transparent; white-space:nowrap; }
.btn.primary { background:var(--primary); color:#fff; } .btn.outline { background:transparent; color:var(--primary); border-color:var(--primary); height:36px; font-size:13px; }
.btn:disabled { opacity:.6; cursor:progress; }
.hint { font-size:13px; color:var(--muted); }
.error { color:var(--bad); background:var(--bad-soft); border-radius:12px; padding:10px 12px; margin-top:12px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--border); }
th { color:var(--muted); font-size:12px; font-weight:600; } .num { text-align:right; }
tr.current td { font-weight:600; }
a { color:var(--primary); }
`

const SCRIPT = `
(() => {
  const token = __TOKEN__;
  const error = document.getElementById('pay-error');
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('[data-tab]')) t.classList.toggle('active', t === tab);
      for (const m of document.querySelectorAll('[data-method]')) m.hidden = m.dataset.method !== tab.dataset.tab;
    });
  }
  for (const b of document.querySelectorAll('[data-copy]')) {
    b.addEventListener('click', async () => {
      const el = document.getElementById(b.dataset.copy);
      try { await navigator.clipboard.writeText(el.value); b.textContent = 'Copiado'; } catch { el.select(); }
    });
  }
  const pay = async (body, button) => {
    error.hidden = true;
    button.disabled = true;
    try {
      const r = await fetch('/i/' + token + '/pay', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.errors?.[0]?.description ?? ('HTTP ' + r.status));
      }
      location.reload();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      button.disabled = false;
    }
  };
  for (const b of document.querySelectorAll('[data-pay]')) {
    b.addEventListener('click', () => pay({ method: b.dataset.pay }, b));
  }
  const form = document.getElementById('card-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    pay({ method: 'CREDIT_CARD', card: Object.fromEntries(f.entries()) }, form.querySelector('button'));
  });
})();
`
