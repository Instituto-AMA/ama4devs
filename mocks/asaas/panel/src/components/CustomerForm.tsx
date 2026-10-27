/**
 * Create or edit a customer through the real `/v3/customers`, with the account's key.
 *
 * The fields are the ones the Asaas "Novo cliente" form has and the API takes; only
 * name and CPF/CNPJ are required, as in Asaas. "Gerar CPF" fills a valid test CPF.
 */
import { useState } from 'preact/hooks'
import { v3, type Customer } from '../api.ts'
import { randomCpf } from './forms.ts'
import { Banner, Button, errorText, Field, Modal } from './ui.tsx'

type Draft = Record<
  | 'name'
  | 'cpfCnpj'
  | 'email'
  | 'mobilePhone'
  | 'phone'
  | 'postalCode'
  | 'address'
  | 'addressNumber'
  | 'province'
  | 'externalReference'
  | 'observations',
  string
>

const fromCustomer = (c?: Customer): Draft => ({
  name: c?.name ?? '',
  cpfCnpj: c?.cpfCnpj ?? '',
  email: c?.email ?? '',
  mobilePhone: c?.mobilePhone ?? '',
  phone: c?.phone ?? '',
  postalCode: c?.postalCode ?? '',
  address: c?.address ?? '',
  addressNumber: c?.addressNumber ?? '',
  province: c?.province ?? '',
  externalReference: c?.externalReference ?? '',
  observations: c?.observations ?? '',
})

export function CustomerForm(props: {
  apiKey: string
  customer?: Customer
  onClose: () => void
  onSaved: (customer: Customer) => void
}) {
  const [draft, setDraft] = useState<Draft>(fromCustomer(props.customer))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = Boolean(props.customer)

  const set = (k: keyof Draft) => (e: Event) =>
    setDraft({ ...draft, [k]: (e.target as HTMLInputElement).value })

  const submit = async (e: Event) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Empty optional fields are left out: Asaas validates what it receives.
    const body = Object.fromEntries(
      Object.entries(draft)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v !== ''),
    )
    try {
      const saved = editing
        ? await v3(`/customers/${props.customer!.id}`, props.apiKey, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
        : await v3('/customers', props.apiKey, { method: 'POST', body: JSON.stringify(body) })
      props.onSaved(saved)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Editar cliente' : 'Novo cliente'} onClose={props.onClose} wide>
      <form class="stack" onSubmit={submit}>
        {error && <Banner tone="danger">{error}</Banner>}
        <div class="form-grid">
          <Field label="Nome *">
            <input class="input" value={draft.name} onInput={set('name')} required autoFocus />
          </Field>
          <Field label="CPF ou CNPJ *">
            <div class="row">
              <input
                class="input mono"
                value={draft.cpfCnpj}
                onInput={set('cpfCnpj')}
                inputMode="numeric"
                required
              />
              <Button
                type="button"
                size="sm"
                onClick={() => setDraft({ ...draft, cpfCnpj: randomCpf() })}
              >
                Gerar CPF
              </Button>
            </div>
          </Field>
          <Field label="E-mail">
            <input class="input" type="email" value={draft.email} onInput={set('email')} />
          </Field>
          <Field label="Celular">
            <input class="input" value={draft.mobilePhone} onInput={set('mobilePhone')} inputMode="tel" />
          </Field>
          <Field label="Telefone">
            <input class="input" value={draft.phone} onInput={set('phone')} inputMode="tel" />
          </Field>
          <Field label="CEP">
            <input class="input" value={draft.postalCode} onInput={set('postalCode')} inputMode="numeric" />
          </Field>
          <Field label="Endereço">
            <input class="input" value={draft.address} onInput={set('address')} />
          </Field>
          <Field label="Número">
            <input class="input" value={draft.addressNumber} onInput={set('addressNumber')} />
          </Field>
          <Field label="Bairro">
            <input class="input" value={draft.province} onInput={set('province')} />
          </Field>
          <Field label="Referência externa" hint="O id do cliente no seu sistema.">
            <input class="input mono" value={draft.externalReference} onInput={set('externalReference')} />
          </Field>
        </div>
        <Field label="Observações">
          <textarea class="input textarea" rows={3} value={draft.observations} onInput={set('observations')} />
        </Field>
        <div class="modal-actions">
          <Button type="button" variant="ghost" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Salvando…' : editing ? 'Salvar' : 'Criar cliente'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
