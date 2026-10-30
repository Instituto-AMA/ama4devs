/**
 * KYC / onboarding: the account's documents and the sandbox action that approves it.
 *
 * The whole client flow fits in one test: it creates the subaccount, discovers the
 * pending document, sends the file (a real multipart, with a Blob), sees the
 * document get approved, and sees `GET /v3/myAccount/status` close at APPROVED.
 *
 * ABOUT `responsible.type`: the spec declares an ARRAY; the real sandbox returns a STRING.
 * We return a string — the golden wins (AGENTS.md) —, and `spec/overlays/006` fixes
 * the spec, so that the harness's contract validation applies here again. Without
 * the overlay, the simulator would have to choose between being right and passing its own
 * contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

const subaccountBody = {
  name: 'Loja do Fulano',
  email: 'loja@localhost',
  cpfCnpj: '12345678909',
  mobilePhone: '11999998888',
  incomeValue: 25000,
  address: 'Rua Fernando Orlandi',
  addressNumber: '544',
  province: 'Jardim Pedra Branca',
  postalCode: '14079-452',
}

/** `GET /v3/myAccount/documents` — through the ApiClient, with contract validation. */
async function getDocuments(apiKey: string): Promise<any> {
  const res = await h.as(apiKey).call('check-pending-documents', {})
  expect(res.status).toBe(200)
  return res.body
}

/** The upload the client makes: multipart/form-data with the `documentFile` field. */
async function upload(
  apiKey: string,
  documentId: string,
  file: Blob | null = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
): Promise<{ status: number; body: any }> {
  const fd = new FormData()
  if (file) fd.append('documentFile', file, 'identidade.png')

  const res = await h.app.app.handle(
    new Request(`http://localhost/v3/myAccount/documents/${documentId}`, {
      method: 'POST',
      headers: { access_token: apiKey },
      body: fd,
    }),
  )

  return { status: res.status, body: await res.json() }
}

async function newSubaccount(): Promise<{ apiKey: string; id: string }> {
  const res = await h.api.call('create-subaccount', { body: subaccountBody })
  expect(res.status).toBe(200)
  return { apiKey: res.body.apiKey, id: res.body.id }
}

describe('document listing', () => {
  it('the main account is born approved — and the APPROVED group does not bring `documents`', async () => {
    const body = await getDocuments(TEST_API_KEY)

    expect(body.rejectReasons).toBeNull()
    expect(body.data).toHaveLength(1)

    const [group] = body.data
    expect(group.status).toBe('APPROVED')
    expect(group.type).toBe('IDENTIFICATION')
    expect(group.title).toBe('Documentos de identificação')
    expect(group.responsible).toEqual({
      name: 'Conta de Teste',
      type: 'INDIVIDUAL_COMPANY',
    })

    // It is what the real sandbox returns for an approved account: a null link, and NOT
    // `documents` NOR `onboardingUrlExpirationDate` in the response.
    expect(group.onboardingUrl).toBeNull()
    expect(group).not.toHaveProperty('documents')
    expect(group).not.toHaveProperty('onboardingUrlExpirationDate')
  })

  it('a subaccount is born with a pending document, with an id and an onboarding link', async () => {
    const sub = await newSubaccount()
    const body = await getDocuments(sub.apiKey)

    expect(body.data).toHaveLength(1)
    const [group] = body.data

    expect(group.status).toBe('NOT_SENT')
    expect(group.type).toBe('IDENTIFICATION')
    // FISICA: who answers for the document is the account's owner.
    expect(group.responsible).toEqual({ name: 'Loja do Fulano', type: 'ASAAS_ACCOUNT_OWNER' })

    expect(group.onboardingUrl).toBeString()
    expect(group.onboardingUrlExpirationDate).toBeString()

    // It is from here that the client takes the upload's `documentId`.
    expect(group.documents).toHaveLength(1)
    expect(group.documents[0].id).toBeString()
    expect(group.documents[0].status).toBe('NOT_SENT')
  })

  it('each account only sees its own documents', async () => {
    const sub = await newSubaccount()

    const mine = await getDocuments(TEST_API_KEY)
    const theirs = await getDocuments(sub.apiKey)

    expect(mine.data[0].id).not.toBe(theirs.data[0].id)
  })
})

describe('document upload (multipart)', () => {
  it('the whole flow: subaccount → pending document → upload → approved account', async () => {
    const sub = await newSubaccount()
    const as = h.as(sub.apiKey)

    // 1. The subaccount transacts, but the KYC is pending.
    const before = await as.call('check-account-registration-status')
    expect(before.body.commercialInfo).toBe('APPROVED')
    expect(before.body.documentation).toBe('PENDING')
    expect(before.body.general).toBe('PENDING')

    // 2. The client finds out which document to send.
    const pending = await getDocuments(sub.apiKey)
    const documentId = pending.data[0].documents[0].id

    // 3. Sends the image. In the sandbox any file is accepted and auto-approved.
    const sent = await upload(sub.apiKey, documentId)
    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ id: documentId, status: 'APPROVED' })

    // 4. It was the group's last document: the whole group is approved — and it starts
    //    answering as an approved group answers (no `documents`, no link).
    const after = await getDocuments(sub.apiKey)
    expect(after.data[0].status).toBe('APPROVED')
    expect(after.data[0].onboardingUrl).toBeNull()
    expect(after.data[0]).not.toHaveProperty('documents')

    // 5. And the account status closes by itself.
    const status = await as.call('check-account-registration-status')
    expect(status.body.documentation).toBe('APPROVED')
    expect(status.body.general).toBe('APPROVED')
  })

  it('without `documentFile` → 400, because the multipart does not go through TypeBox', async () => {
    const sub = await newSubaccount()
    const pending = await getDocuments(sub.apiKey)

    const res = await upload(sub.apiKey, pending.data[0].documents[0].id, null)

    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_documentFile')
  })

  it('nonexistent document → 404', async () => {
    const res = await upload(TEST_API_KEY, 'does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body.errors[0].code).toBe('not_found')
  })

  it('the document of ANOTHER account is a 404, not a 403', async () => {
    const sub = await newSubaccount()
    const pending = await getDocuments(sub.apiKey)
    const alheio = pending.data[0].documents[0].id

    // The parent account does NOT send a document through the subaccount, even having created it.
    const res = await upload(TEST_API_KEY, alheio)
    expect(res.status).toBe(404)

    // And the subaccount's document stays intact.
    const still = await getDocuments(sub.apiKey)
    expect(still.data[0].documents[0].status).toBe('NOT_SENT')
  })
})

describe('the account approval (sandbox)', () => {
  it('approves the account and all its documents at once', async () => {
    const sub = await newSubaccount()
    const as = h.as(sub.apiKey)

    const res = await as.call('approve-account', { body: {} })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: sub.id,
      commercialInfo: 'APPROVED',
      bankAccountInfo: 'APPROVED',
      documentation: 'APPROVED',
      general: 'APPROVED',
    })

    // It is not just the status: the documents that were NOT_SENT got approved.
    const docs = await getDocuments(sub.apiKey)
    expect(docs.data[0].status).toBe('APPROVED')
    expect(docs.data[0]).not.toHaveProperty('documents')

    // And `GET /v3/myAccount/status` agrees with the approval's response.
    const status = await as.call('check-account-registration-status')
    expect(status.body.general).toBe('APPROVED')
  })

  it('approving again breaks nothing', async () => {
    const sub = await newSubaccount()
    const as = h.as(sub.apiKey)

    await as.call('approve-account', { body: {} })
    const again = await as.call('approve-account', { body: {} })

    expect(again.status).toBe(200)
    expect(again.body.general).toBe('APPROVED')
  })

  it('approves ONLY the authenticated account', async () => {
    const a = await newSubaccount()
    const b = await newSubaccount2()

    await h.as(a.apiKey).call('approve-account', { body: {} })

    const other = await getDocuments(b.apiKey)
    expect(other.data[0].status).toBe('NOT_SENT')
  })
})

/** A second subaccount — the CPF/CNPJ is unique per account. */
async function newSubaccount2(): Promise<{ apiKey: string; id: string }> {
  const res = await h.api.call('create-subaccount', {
    body: { ...subaccountBody, cpfCnpj: '11144477735', email: 'other@localhost' },
  })
  expect(res.status).toBe(200)
  return { apiKey: res.body.apiKey, id: res.body.id }
}

