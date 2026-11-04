/**
 * The hosted checkout page (the checkout's `link`), rendered on the server.
 *
 * Same contract as the invoice page: one HTML string per request, no build step,
 * every value from the database through `esc()` (`scriptValue()` inside the
 * script). It shares that page's stylesheet.
 */
import { br, brl, CSS, esc, formatDocument } from '../invoice/page.ts'

export interface CheckoutView {
  id: string
  /** ACTIVE | PAID | EXPIRED | CANCELED; EXPIRED as soon as the time ran out. */
  status: string
  merchant: { name: string; cpfCnpj: string }
  /** The checkout's customer or `customerData`; null when the payer types it here. */
  payer: { name: string; cpfCnpj: string } | null
  items: Array<{ name: string; description: string | null; quantity: number; valueCents: number }>
  totalCents: number
  chargeTypes: string[]
  billingTypes: string[]
  subscription: { cycle: string; nextDueDate: string } | null
  expirationDate: string | null
  callback: { successUrl: string | null; cancelUrl: string | null; expiredUrl: string | null }
  testCards: Array<{ number: string; label: string }>
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'neutral' }> = {
  ACTIVE: { label: 'Aguardando pagamento', tone: 'neutral' },
  PAID: { label: 'Pago', tone: 'ok' },
  EXPIRED: { label: 'Expirado', tone: 'bad' },
  CANCELED: { label: 'Cancelado', tone: 'bad' },
}

const CYCLE_LABEL: Record<string, string> = {
  WEEKLY: 'semanal',
  BIWEEKLY: 'quinzenal',
  MONTHLY: 'mensal',
  BIMONTHLY: 'bimestral',
  QUARTERLY: 'trimestral',
  SEMIANNUALLY: 'semestral',
  YEARLY: 'anual',
}

const CHARGE_LABEL: Record<string, string> = {
  DETACHED: 'À vista',
  RECURRENT: 'Assinatura',
  INSTALLMENT: 'Parcelado',
}

/**
 * The callback URLs come from whoever created the checkout: only http(s) is
 * followed, so a `javascript:` URL never becomes a link or a redirect.
 */
function webUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** A value for the inline script: JSON, with `<` escaped so it cannot close the tag. */
function scriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function badge(status: string): string {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const }
  return `<span class="badge ${s.tone}">${esc(s.label)}</span>`
}

function itemsTable(v: CheckoutView): string {
  const rows = v.items
    .map(
      (i) => `
        <tr>
          <td>${esc(i.name)}${i.description ? `<br><span class="muted">${esc(i.description)}</span>` : ''}</td>
          <td class="num">${esc(i.quantity)}</td>
          <td class="num">${brl(i.valueCents)}</td>
        </tr>`,
    )
    .join('')
  return `
    <table>
      <thead><tr><th>Item</th><th class="num">Qtd.</th><th class="num">Valor</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

function payerFields(v: CheckoutView): string {
  if (v.payer) {
    return `<p class="muted">Pagador</p><p>${esc(v.payer.name)} · ${esc(formatDocument(v.payer.cpfCnpj))}</p>`
  }
  return `
    <fieldset id="payer" class="card-form">
      <label>Nome do pagador<input name="name" value="Pagador Teste" required></label>
      <label>CPF ou CNPJ<input name="cpfCnpj" value="24971563792" inputmode="numeric" required></label>
      <label>E-mail<input name="email" value="pagador@example.com" type="email"></label>
    </fieldset>`
}

const shown = (visible: boolean) => (visible ? '' : ' hidden')

function cardForm(v: CheckoutView, visible: boolean): string {
  const options = v.testCards
    .map(
      (c) =>
        `<option value="${esc(c.number)}">${esc(c.number.replace(/(\d{4})(?=\d)/g, '$1 '))} — ${esc(c.label)}</option>`,
    )
    .join('')
  return `
    <section class="method" data-method="CREDIT_CARD"${shown(visible)}>
      <form id="card-form" class="card-form">
        <label>Cartão de teste<select name="number">${options}</select></label>
        <label>Nome impresso no cartão<input name="holderName" value="TITULAR TESTE" required></label>
        <div class="grid">
          <label>Mês<input name="expiryMonth" value="12" inputmode="numeric" required></label>
          <label>Ano<input name="expiryYear" value="2030" inputmode="numeric" required></label>
          <label>CVV<input name="ccv" value="123" inputmode="numeric" required></label>
        </div>
        <button type="submit" class="btn primary">Pagar com cartão</button>
      </form>
    </section>`
}

function pixPanel(visible: boolean): string {
  return `
    <section class="method" data-method="PIX"${shown(visible)}>
      <p class="hint">A cobrança Pix é criada e paga na hora.</p>
      <button type="button" class="btn primary" data-pay="PIX">Simular pagamento via Pix</button>
    </section>`
}

function payArea(v: CheckoutView): string {
  if (v.status !== 'ACTIVE') {
    const next = webUrl(
      v.status === 'PAID' ? v.callback.successUrl : v.status === 'EXPIRED' ? v.callback.expiredUrl ?? v.callback.cancelUrl : v.callback.cancelUrl,
    )
    return `
      <section class="box done">
        ${badge(v.status)}
        ${next ? `<a href="${esc(next)}">Voltar para a loja</a>` : ''}
      </section>`
  }

  const chargeChoice =
    v.chargeTypes.length > 1
      ? `<label>Como pagar<select id="charge-type">${v.chargeTypes
          .map((c) => `<option value="${esc(c)}">${esc(CHARGE_LABEL[c] ?? c)}</option>`)
          .join('')}</select></label>`
      : ''
  const methods = v.billingTypes.filter((b) => b === 'CREDIT_CARD' || b === 'PIX')
  const tabs =
    methods.length > 1
      ? `<div class="tabs" role="tablist">${methods
          .map(
            (m, i) =>
              `<button type="button" role="tab" class="tab${i === 0 ? ' active' : ''}" aria-selected="${i === 0}" data-tab="${m}">${m === 'PIX' ? 'Pix' : 'Cartão de crédito'}</button>`,
          )
          .join('')}</div>`
      : ''
  // The first method is the selected tab: its panel is the one that shows.
  const panels = methods
    .map((m, i) => (m === 'PIX' ? pixPanel(i === 0) : cardForm(v, i === 0)))
    .join('')

  return `
    <section class="box">
      <h2>Pagamento</h2>
      ${payerFields(v)}
      ${chargeChoice}
      ${tabs}
      ${panels}
      <p id="pay-error" class="error" role="alert" hidden></p>
    </section>`
}

export function renderCheckout(v: CheckoutView): string {
  const recurrence = v.subscription
    ? `<div class="wide"><p class="muted">Assinatura</p><p>Cobrança ${esc(CYCLE_LABEL[v.subscription.cycle] ?? v.subscription.cycle)}, a primeira com vencimento em ${br(v.subscription.nextDueDate)}.</p></div>`
    : ''
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout · ${esc(v.merchant.name)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <p class="sim">Simulador Asaas · o pagamento acontece na hora, como se o banco tivesse confirmado.</p>
  <header class="box head">
    <div>
      <p class="muted">Checkout de</p>
      <h1>${esc(v.merchant.name)}</h1>
      <p class="muted">CPF/CNPJ ${esc(formatDocument(v.merchant.cpfCnpj))}</p>
    </div>
    ${badge(v.status)}
  </header>
  <section class="box summary">
    <div><p class="muted">Total</p><p class="value">${brl(v.totalCents)}</p></div>
    <div><p class="muted">Válido até</p><p class="strong">${v.expirationDate ? `${br(v.expirationDate)} ${esc(v.expirationDate.slice(11, 16))}` : '—'}</p></div>
    ${recurrence}
    <div class="wide">${itemsTable(v)}</div>
  </section>
  ${payArea(v)}
</main>
<script>${SCRIPT.replace('__ID__', () => scriptValue(v.id)).replace('__SUCCESS__', () => scriptValue(webUrl(v.callback.successUrl)))}</script>
</body>
</html>`
}

const SCRIPT = `
(() => {
  const id = __ID__;
  const successUrl = __SUCCESS__;
  const error = document.getElementById('pay-error');
  if (!error) return;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('[data-tab]')) {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      }
      for (const m of document.querySelectorAll('[data-method]')) m.hidden = m.dataset.method !== tab.dataset.tab;
    });
  }
  const payer = () => {
    const f = document.getElementById('payer');
    if (!f) return undefined;
    return Object.fromEntries([...f.querySelectorAll('input')].map((i) => [i.name, i.value]));
  };
  const pay = async (body, button) => {
    error.hidden = true;
    button.disabled = true;
    const chargeType = document.getElementById('charge-type')?.value;
    const customerData = payer();
    try {
      const r = await fetch('/checkoutSession/show/' + id + '/pay', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, ...(chargeType ? { chargeType } : {}), ...(customerData ? { customerData } : {}) }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.errors?.[0]?.description ?? ('HTTP ' + r.status));
      }
      if (successUrl) location.href = successUrl; else location.reload();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      button.disabled = false;
    }
  };
  for (const b of document.querySelectorAll('[data-pay]')) {
    b.addEventListener('click', () => pay({ billingType: b.dataset.pay }, b));
  }
  const form = document.getElementById('card-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    pay({ billingType: 'CREDIT_CARD', creditCard: Object.fromEntries(f.entries()) }, form.querySelector('button'));
  });
})();
`
