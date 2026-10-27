/**
 * The webhook events grouped as the Asaas form groups them ("Cobranças",
 * "Assinaturas", …). The events come from the server (`/_admin/webhooks/events`,
 * the spec's enum); only the grouping lives here, by prefix. An event no prefix
 * claims lands in "Outros" instead of disappearing.
 */
export interface EventGroup {
  id: string
  label: string
  description: string
  events: string[]
}

const GROUPS: Array<Omit<EventGroup, 'events'> & { prefix: string }> = [
  {
    id: 'payment',
    prefix: 'PAYMENT_',
    label: 'Cobranças',
    description: 'Criação, pagamento, vencimento, estorno e chargeback de cobranças.',
  },
  {
    id: 'subscription',
    prefix: 'SUBSCRIPTION_',
    label: 'Assinaturas',
    description: 'Criação, alteração e encerramento de assinaturas.',
  },
  {
    id: 'checkout',
    prefix: 'CHECKOUT_',
    label: 'Checkout',
    description: 'Ciclo de vida do checkout: criado, pago, cancelado, expirado.',
  },
  {
    id: 'invoice',
    prefix: 'INVOICE_',
    label: 'Notas fiscais',
    description: 'Emissão, sincronização e cancelamento de notas fiscais.',
  },
  {
    id: 'transfer',
    prefix: 'TRANSFER_',
    label: 'Transferências',
    description: 'Transferências para contas bancárias e chaves Pix.',
  },
  {
    id: 'internal-transfer',
    prefix: 'INTERNAL_TRANSFER_',
    label: 'Movimentações internas',
    description: 'Créditos e débitos entre contas Asaas.',
  },
  {
    id: 'anticipation',
    prefix: 'RECEIVABLE_ANTICIPATION_',
    label: 'Antecipações',
    description: 'Solicitação, crédito e débito de antecipações.',
  },
  {
    id: 'bill',
    prefix: 'BILL_',
    label: 'Pague Contas',
    description: 'Pagamento de contas e boletos de terceiros.',
  },
  {
    id: 'balance',
    prefix: 'BALANCE_VALUE_',
    label: 'Bloqueios de saldo',
    description: 'Valores do saldo bloqueados e desbloqueados.',
  },
  {
    id: 'account-status',
    prefix: 'ACCOUNT_STATUS_',
    label: 'Situação da conta',
    description: 'Análise de documentos, dados comerciais e bancários da conta.',
  },
  {
    id: 'access-token',
    prefix: 'ACCESS_TOKEN_',
    label: 'Chaves de API',
    description: 'Criação, desativação e expiração de chaves de API.',
  },
  {
    id: 'pix-automatic',
    prefix: 'PIX_AUTOMATIC_',
    label: 'Pix Automático',
    description: 'Autorizações e instruções de pagamento do Pix Automático.',
  },
  {
    id: 'mobile-recharge',
    prefix: 'MOBILE_PHONE_RECHARGE_',
    label: 'Recargas de celular',
    description: 'Recargas de celular pagas com o saldo da conta.',
  },
]

export function groupEvents(events: string[]): EventGroup[] {
  const groups: EventGroup[] = GROUPS.map(({ prefix: _, ...g }) => ({ ...g, events: [] }))
  const other: EventGroup = {
    id: 'other',
    label: 'Outros',
    description: 'Eventos da spec sem grupo neste painel.',
    events: [],
  }

  for (const event of events) {
    const i = GROUPS.findIndex((g) => event.startsWith(g.prefix))
    ;(i >= 0 ? groups[i]! : other).events.push(event)
  }

  return [...groups, other].filter((g) => g.events.length > 0)
}
