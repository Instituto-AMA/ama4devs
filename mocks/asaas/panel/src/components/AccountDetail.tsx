/**
 * The record of the selected account: balance, walletId, API key, accountId,
 * CPF/CNPJ.
 *
 * The API KEY shows up on the screen — and that is indefensible in any real
 * system. Here it is the point: in Asaas, the key of a subaccount is shown ONE
 * time, at the creation, and never again. Whoever did not save it, lost it. This
 * panel lives in a localhost container behind `ADMIN_ENABLED`, and showing the
 * key is what allows you to enter a subaccount and see the simulator through its
 * eyes.
 *
 * The `walletId` stays next to it because they are a pair: the key is how you
 * ACT as the account, the walletId is how you SEND money to it in a split.
 */
import type { Account } from '../api.ts'
import { Card, Copy, money, Row } from './ui.tsx'

export function AccountDetail({ account: a }: { account: Account }) {
  return (
    <Card title={a.name} subtitle={a.parentAccountId ? 'Subconta' : 'Conta principal'}>
      <Row label="Saldo">
        <b class={a.balance < 0 ? 'neg' : ''}>{money(a.balance)}</b>
      </Row>
      <Row label="walletId">
        <Copy value={a.walletId} />
      </Row>
      <Row label="Chave de API">
        {a.apiKey ? (
          <Copy value={a.apiKey}>{`${a.apiKey.slice(0, 22)}…`}</Copy>
        ) : (
          <span class="hint">nenhuma</span>
        )}
      </Row>
      <Row label="accountId">
        <Copy value={a.id} />
      </Row>
      <Row label="CPF/CNPJ">
        <span class="mono">{a.cpfCnpj}</span>
      </Row>
      <Row label="E-mail">{a.email}</Row>
    </Card>
  )
}
