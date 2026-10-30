# progress.md

The agents' progress log. Read `AGENTS.md` before picking up a track.

> **The coverage number is not kept by hand.** Run `bun run coverage:ops` — it
> reads the manifest ∩ handler map. Paste the result here when you close a track.

```
implemented: 119/208 (57%)
stubbed:     89  (they answer 501)
variants:    5  (they share a route with the canonical operation)
total spec:  213
```

**411 tests · 0 failures · `tsc --noEmit` clean · parity 7/7 against the real sandbox ·
26/26 calls of the real client (PartiuRole) answered in Asaas's format.**

*(208 = the 213 operations of the spec − 5 variants that share a route with the canonical one.)*

The remaining 94 operations are the long tail (static Pix, invoices, bills,
recharges, dunning, documents) — they all answer **501 in Asaas's error format**,
never 404.

---

## Phase 0 — Trunk ✅

Blocking, not parallelizable. **Done.**

| | |
|---|---|
| Vendored spec | 159 paths · 213 operations · 486 schemas · sha256 in the lock |
| Codegen | 173 enums → 74 canonical · TypeBox per tag · manifest |
| Drizzle schema | 35 tables · money in cents · dates as TEXT |
| Core | clock (3 modes) · seeded rng · errors · money · ids · ledger |
| HTTP | 213 routes assembled · `access_token` auth · error in Asaas's format |
| Scheduler | `tick()` · mutex · idempotency per simulated day · 8 jobs (skeleton) |
| Admin | `/_admin/clock` · `/tick` · `/coverage` · `/webhooks/deliveries` · `/fees` |
| Tests | 26 passing · determinism guard · the surface test of the 213 |
| Docker | multi-stage · `WEBHOOK_LOCALHOST_REWRITE` · healthcheck |

Two defects of Asaas's spec, discovered and handled in the codegen:

1. **The `AUTHORIZED` status exists in no enum** of the spec, but it is real
   (card pre-authorization). → `spec/overlays/001-*.json`.
2. **13 paths with a spurious trailing slash**; in 5 of them that creates a "twin"
   operation (`POST /v3/payments` vs `POST /v3/payments/`). In the real Asaas it is the
   **same endpoint** — the body decides whether there is a card. Worse: the empty segment
   corrupted the route tree and took down the neighbouring `GET`.
   → normalized in the codegen, variants flagged with `variantOf`.

---

## Tracks

Each track has its own folder in `src/modules/` and its own file in
`src/db/schema/` — two agents in parallel do not conflict.

| Track | Scope | Status |
|-------|--------|--------|
| **C — Money** | fees, interest, fine, discount, installment division, split math, BR business days | ✅ `src/domain/*` 100% pure · 38 golden tests |
| **B — Webhooks** | queue, dispatcher, 15-attempt backoff, SEQ/NON_SEQ, retention | ✅ 6 ops · `src/webhooks/{rewrite,backoff,dispatcher}.ts` · 18 tests |
| **A — Payments core** | customers, payments, state machine, sandbox actions | ✅ 21 ops · `applyTransition` · 12 lifecycle tests |
| **G1 — Account and long tail** | account info, payment links, notifications, checkout, Serasa | ✅ 27 ops |
| **D — Finance** | ledger, statement, balance, transfers, anticipation | ✅ 16 ops (4 Finance/Statement + 4 Transfer + 8 Anticipation) · `src/modules/{finance,transfers,anticipations}` · jobs in `src/scheduler/jobs/{transfer,anticipation}-jobs.ts` · 35 tests |
| **E — Recurrence** | installments, subscriptions, D-40 generation | ✅ 22 ops (9 Installment + 13 Subscription) · job 1 `subscription-generation` in `src/scheduler/jobs/subscription-jobs.ts` · `src/modules/{installments,subscriptions}` · 39 tests |
| **F — Multi-account split** | split engine, subaccounts, movement between accounts | ✅ 13 ops (4 Payment Split + 9 Subaccount) · jobs 4 and 5 in `src/scheduler/jobs/split-jobs.ts` · 28 tests |
| **H — Card** | tokenization, test cards, pre-authorization/capture, chargeback | ✅ 9 ops (6 Credit Card/Payment + 3 Chargeback) · `src/domain/credit-card.ts` (Luhn + brand, pure) · `src/modules/{credit-cards,chargebacks}` · 68 tests (43 unit + 25 integration) |

**The 8 tracks are stitched together** in `src/modules/index.ts` and
`src/scheduler/jobs/index.ts`, and the scaffolding each agent used to test before
the stitching (`extraHandlers`/`extraJobs` in the harness) **was removed on purpose**:
a test that registers its own handlers passes even if the stitching never happened —
it serves itself, and the suite stops proving that the real server answers that route.
Today the 328 tests hit the real `HANDLERS`/`JOBS`.

### Verified end to end

`bun run e2e` boots the server, creates a Pix charge over HTTP, confirms it, and waits
for the `PAYMENT_RECEIVED` to arrive at a local listener. **It also runs against the container**
(`bun run e2e -- http://localhost:8080 '$aact_...'`) — and it passes: the webhook
crosses the Docker boundary through `WEBHOOK_LOCALHOST_REWRITE`. It is the whole
promise of the project, in one command.

---

## Parity with the real Asaas — **DONE** ✅

```
7 scripts · 7 passing · 0 divergences
```

The capture ran against the **real Asaas sandbox** (`bun run capture`) and the parity
suite replicates the same scripts against the simulator, comparing field by field.
**This project stopped being "our best reading of the documentation" and became
a proven behaviour.**

```bash
ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun run capture   # → tests/golden/*.json
bun run test:parity
```

| Script | What it proved |
|---|---|
| `pix-received` | the Pix fee is a **fixed** R$ 1.99 (not a percentage) ✅ our reading was right |
| `credit-card-single-payment` | fee R$ 0.49 + 2.99% → netValue 96.52 ✅ right |
| `installment-350-in-12x` | **11 × R$ 29.16 + R$ 29.24 on the LAST one** ✅ right |
| `installment-on-card` | **staggered** credit at D+32×n ❌ we were wrong |
| `monthly-subscription` | the 1st charge is born **at creation** ❌ we were VERY wrong |
| `bank-slip-with-interest-and-fine` | the shape of discount/fine/interest ❌ field with the wrong name |
| `validation-errors` | code `invalid_object`, not `invalid_cpfCnpj` ❌ wrong |

### What the capture KNOCKED DOWN (real bugs, all fixed)

These are the rules we held as certain — some of them asserted in emphatic
comments in the code, one of them with a warning to "do not fix". All of them were wrong.

| # | We believed | The truth (proven) | Impact |
|---|---|---|---|
| 1 | Creating a subscription does **not** create a charge; the 1st is born 40 days before the due date. | **The 1st charge is born at creation**, and the `nextDueDate` already advances one cycle. The 40-day window governs the NEXT ones. | **Critical.** Our subscription charged nothing. The feature was simply broken — and three tests "proved" it was right. |
| 2 | The installment card fee is `0.49 + pct%` **of each installment**. | It is `0.49 + pct% × TOTAL`, computed **once** and **divided** among the N installments, **truncating**. The remainder stays with the merchant. | **Wrong money.** 12× of R$ 350 gave a R$ 1.65 fee per installment; the right one is **R$ 1.20** (see #16 — the division truncates, and we used to round). |
| 3 | Each card installment credits at D+32 from the confirmation (all together). | Installment `n` credits at **D+32×n**, rolled to the next business day. | **A statement wrong for months.** Confirmed on 9 real dates (3x and 6x), all exactly. |
| 4 | `estimatedCreditDate` is filled at creation, from the due date. | It is **`null` while PENDING**. Asaas does not promise a credit date for money that has not come in. | We invented a date the real API does not give. |
| 5 | `creditDate` only appears when the money lands. | It is filled **already at the confirmation**, pointing to the future. What tells "will land" from "landed" is the `status`. | The merchant could not know when they would receive. |
| 6 | `paymentDate` and `clientPaymentDate` are the same date. | **They are not.** `clientPaymentDate` = when the customer paid. `paymentDate` = when the MERCHANT received — and it is `null` while CONFIRMED. | Two fields with different meanings that we treated as one. |
| 7 | The discount field is called `limitedDate`. | It is called **`limitDate`**. | The spec declares neither — **the contract validation would never catch this.** Only the real API does. It is the exact illustration of why parity exists. |
| 8 | An invalid CPF → `invalid_cpfCnpj`. | → **`invalid_object`**, with the description "O CPF/CNPJ informado é inválido." | It looks wrong. It is what Asaas returns. |
| 9 | An empty body → a list of schema errors. | **One error only**: `invalid_customer`. Asaas validates semantically and short-circuits. | We returned 17 TypeBox errors **in English** ("Expected string"). No Asaas client would see that. → overlay 004 |
| 10 | The `payment` object has a fixed set of keys. | The null relationals are **OMITTED**, not returned as `null`. And there are fields per payment method: only BOLETO has `canBePaidAfterDueDate`; only CREDIT_CARD has `confirmedDate` and `creditCard`. | `'installment' in payment` behaved differently from the real one. |
| 11 | `installment.paymentValue` is the value of each installment. | It is the value of the **LAST** installment — the one that carries the remainder (R$ 29.24, not R$ 29.16). | Counterintuitive; we would never have guessed it. |
| 12 | Without a description, the installment has no description. | Asaas **generates** "Parcela 3 de 12.". | — |
| 13 | `GET /v3/payments` returns in creation order. | It returns **from the newest to the oldest**. | — |
| 14 | A mobile number is any string. | Asaas **refuses repeated digits** (`47999999999` → `invalid_mobilePhone`), just as it does with CPF `11111111111`. | — |
| 15 | `anticipable` is a property of the charge. | It depends on the **account's anticipation limit** (Asaas's credit analysis) AND on a 90-day horizon. | See below. |
| 16 | The total fee of an installment plan is divided by the installments **rounding**. | It **TRUNCATES.** R$ 350 in 12x: total fee = 1446 cents; 1446/12 = 120.5 → Asaas charges **120**, not 121. | **One cent per installment.** And it survived the previous capture because in the cases we had (300/3x, 600/6x) `round` and `trunc` coincide. Only 350/12x separates the two. Golden in `tests/unit/simulator.test.ts`. |
| 17 | The installment plan through `POST /v3/payments` does not exist (it is only `/v3/installments`). | **It exists**, and it is the door the typical client uses. It returns the **first installment** (a `payment` with `installment` filled in), not the plan object. | We refused with 400. The installment purchase flow simply did not exist. |
| 18 | `payWithCreditCard` requires `creditCard` + `creditCardHolderInfo` (the spec says `required`). | It accepts **only `creditCardToken`** — which is the whole point of tokenization: the PAN never travels again. | We refused with 400 **before the handler**, with TypeBox errors in English. → overlay 005 |
| 19 | The Pix QR's `expirationDate` is the due date. | It is the **due date + 1 YEAR**, at 23:59:59. Proven at two points. | — |
| 20 | `POST /v3/myAccount/notifications/settings` exists. | **It does not exist** — it answers 404 in the real Asaas. | Not our bug. The client (PartiuRole) calls it and swallows the error in a `try/catch`. Our 404 is faithful. |

### `anticipable` — the rule that exists but is not reproducible

Deduced from 11 real data points and implemented in `src/domain/anticipable.ts`
(with the 11 cases in `tests/unit/anticipable.test.ts`):

```
anticipable = an anticipatable method (bank slip or card)
            AND value ≤ the account's AVAILABLE anticipation limit
            AND due date ≤ today + 90 days
```

What misled us: a STANDALONE bank slip of R$ 350 due in 10 days came back `false`,
while the R$ 29.16 installment due in the same window came back `true`. It looked like only
an installment plan was anticipatable. **It is not** — the test account had a bank slip
anticipation limit of **R$ 66.66**, and the R$ 350 did not fit.

That limit comes from Asaas's credit analysis and is account-specific
(`GET /v3/anticipations/limits`). No simulator can guess it. That is why
`anticipable` stays **out of the parity comparison** — comparing Asaas's risk
appetite is not comparing our code.

---

## Validation against the real client (PartiuRole) ✅

PartiuRole is the first consumer of this simulator. We extracted the **26 calls**
that its client (`asaas-client.ts`) makes to Asaas, exercised **all of them** against the
mock and compared, field by field, with the response captured from the real sandbox.

**Before: 11/29 calls OK. After: 28/29** — and the one that "fails" is faithful (see #20).

The format was checked key by key (neither a missing field nor an extra one) in:
`POST /customers` · `POST /payments` (Pix, card, installment) · `GET /payments/{id}/pixQrCode` ·
`POST /payments/simulate` · `POST /creditCard/tokenizeCreditCard` ·
`POST /payments/{id}/payWithCreditCard` · `GET /myAccount/status` · `GET /myAccount/documents`.

What the validation found, and that **no contract test would catch** — because Asaas's
spec does not describe any of it:

| Hole | It was |
|---|---|
| `GET /payments/{id}/pixQrCode` | **501.** Without a QR or a "copy and paste", a Pix purchase has no way to be paid. |
| `POST /payments` with `installmentCount` | **400.** The installment purchase flow did not exist (#17). |
| `POST /payments/{id}/payWithCreditCard` with only a token | **400** in the schema, before the handler (#18). |
| `POST /payments/simulate` | **501.** |
| KYC: `GET/POST /myAccount/documents`, `POST /sandbox/myAccount/approve` | **501.** Without them there is no subaccount onboarding. |
| The installment's fee | Wrong by **1 cent per installment** (#16). |

Reproduce it with `tools/` + the script in `tests/integration/partiurole-flows.test.ts`.

### What is still NOT proven

- **Webhook payloads.** The capture covers the HTTP responses. Proving the webhook
  payloads would require a public tunnel — the sandbox does not deliver to localhost,
  which is, after all, the reason this project exists.
- **The error messages beyond the first one.** Asaas short-circuits, so only the
  `customer` message was captured. The others (`billingType`, `value`, `dueDate`)
  are ours — a script per field would settle it.
- **What happens with the installment's description when IT is given** (replaces? concatenates?).
- **The card's 13-21x bracket** and the credit schedule beyond 6 installments.

---

## Known divergences with the real Asaas

Note it here every time you discover one. Turn it into a golden test line.

| Discovered | Rule | What we did |
|---|---|---|
| Track B | **Spec defect:** the webhook's `events` is declared with `type: array` AND an `enum` at the array level (the correct enum is already in `items.$ref`). The codegen checked `enum` before `type` and generated `Type.Union([…literals])` — a single event instead of a list. The contract validation would reject the legitimate response. | `spec/overlays/002-webhook-config.json` removes the spurious `enum` from the 3 webhook DTOs. **The same defect exists in 5 other places** (`CheckoutSessionResponseDTO.billingTypes`/`chargeTypes`, `CheckoutSessionSaveRequestDTO.billingTypes`/`chargeTypes`, `AccountDocumentResponsibleResponseDTO.type`) — whoever picks up track G should fix it for good by inverting the order of the tests in the codegen's `emit()` (`type: 'array'` before `enum`). |
| Track B | **Spec defect:** `WebhookConfigSaveRequestDTO` marks the 9 fields as `required`, including `authToken`, `apiVersion`, `enabled` and `interrupted`. The real Asaas only requires `name`, `url`, `email`, `sendType` and `events`. Requiring them would make the simulator STRICTER than the real API. | The same overlay relaxes the `required`. Defaults: `apiVersion=3`, `enabled=true`, `interrupted=false`, `authToken=null` (without a token, the `asaas-access-token` header is simply not sent). |
| Track F | **A split to an EXTERNAL wallet** (a `walletId` that belongs to no account of this server). In the real Asaas the money LEAVES your account towards another Asaas customer's wallet. | **Deliberate divergence:** we mark the split `DONE` and **move no cent at all** — not even on the origin. There is no account to credit, and debiting the origin without a counterpart would make the amount vanish from the statement with nobody able to check where it went. To see the money really move, create a subaccount (`POST /v3/accounts`) and use its `walletId`. Covered by a test (`split.test.ts` → "external wallet"). |
| Track E | **Spec defect:** `InstallmentSaveRequestDTO` marks `value` as `required`. In the real API you give `value` (the value PER INSTALLMENT) **or** `totalValue` (the total to divide) — and the project's canonical installment plan (R$ 350 in 12x) **only exists through `totalValue`**, because 350/12 is not a representable installment amount. Since Elysia REMOVES from the body every property outside the schema, keeping `value` mandatory would make it impossible to create, here, the most common installment plan there is. | `spec/overlays/003-recurrence.json` takes `value` out of the `required` (in both DTOs, with and without a card). The "give value **or** totalValue" rule becomes the handler's — which is where it lives in Asaas. |
| Track E | **Spec defect:** `SubscriptionUpdateRequestDTO` **has no `value` property**. It is an omission: changing the plan's price is the #1 reason to update a subscription, and it is exactly what `updatePendingPayments` exists to propagate. Without the field in the schema, Elysia would remove it from the body and the simulator would answer **200 without changing anything** — the worst possible defect, because it is silent. | The same overlay adds `value` to the DTO. |
| Track E | **Spec defect:** `GET /v3/installments/{id}/payments` and `GET /v3/subscriptions/{id}/payments` **do not declare `offset`/`limit`** — but the response of both is the listing envelope, *with* `limit`, `offset` and `hasMore` inside. An endpoint that reports pagination and does not accept a pagination parameter is contradictory: with the default of 10, a 12x installment plan would never list its 12 installments. | The same overlay adds the two parameters that every other listing of the spec already declares. |
| PartiuRole | **Spec defect:** `PaymentPayWithCreditCardRequestDTO` marks `creditCard` and `creditCardHolderInfo` as `required`. The real Asaas accepts **only `creditCardToken`** — which is the purpose of tokenization. With the `required`, Elysia refused the body BEFORE the handler, returning a TypeBox error in English. | `spec/overlays/005-pay-with-card-required.json` removes the `required`. The handler already knew how to accept a token OR a card — it was only the schema blocking the door. |
| PartiuRole | **Spec defect:** `AccountDocumentResponsibleResponseDTO.type` is declared `type: "array"`, but the spec's own `example` is the scalar `"ASSOCIATION"` and the `enum` hangs on the array instead of on the `items`. The real sandbox returns a **string**. Without an overlay, we returned the RIGHT string and our own contract validation rejected the response. | `spec/overlays/006-document-responsible-type.json` swaps the field for the enum's `$ref`. It was the 6th and last place with the spurious-enum bug of Asaas's generator that track B catalogued. |
| Track H | **The "twin" operations of phase 0 had a second effect, and it was silent.** `create-new-payment-with-credit-card` shares the `POST /v3/payments` route with `create-new-payment` — and the route is registered with the CANONICAL schema. Since Elysia **removes from the body every property outside the schema**, `creditCard`, `creditCardToken`, `remoteIp` and `authorizeOnly` arrived at the handler already pruned: the card variant was **unreachable**, and the card body created a plain PENDING charge, with no error at all. | `mergeVariantBodies()` in `src/http/register.ts`: the route's schema becomes the canonical + variants union, with the variant's exclusive fields as **optional** (otherwise `remoteIp`, mandatory on the card, would end up being required for a bank slip). Who requires what goes back to the handler — as in Asaas. It applies to the **5** variants of the manifest, not only the card one. |
| Track H | **There is no operation to CREATE a chargeback.** The "Chargeback" tag has 3 ops (list, retrieve, open dispute) and none to open one — consistent with the real world (the issuer opens it), but it leaves the machine's `CHARGEBACK` trigger and the 3 ops without an entry door: the developer would have no way to test the flow. | `POST /_admin/payments/{id}/chargeback` — **outside /v3**, next to time travel. It is simulator control, not API. |
| Track H | **Spec defect:** `PaymentSaveRequestDTO` (and the card variant) marks `value` as `required` — but in an INSTALLMENT charge through `POST /v3/payments` the amount comes in `totalValue`/`installmentValue`. It is the same defect track E fixed in the `InstallmentSaveRequestDTO` (overlay 003), at the other end. | **Not fixed yet:** today you have to send `value` along. When the installment plan through `POST /v3/payments` leaves the `not_implemented`, take `value` out of the `required` in the 2 payment DTOs, in the same overlay. |
| KYC | **Spec defect, PROVEN by the sandbox:** `AccountDocumentResponsibleResponseDTO.type` is declared `type: "array"` (with `items.$ref` for the enum) — but the sandbox capture returns **a string**: `"responsible": { "name": "Pr Soluções Sandbox", "type": "INDIVIDUAL_COMPANY" }`. The spec's own `example` is scalar (`"ASSOCIATION"`), not a list: it is the same generator artifact as the defect on line 175. We return a **string** (the golden gains). | **Overlay NOT YET WRITTEN** — `spec/overlays/` was locked (another agent). Consequence: our `check-pending-documents` response violates the generated schema **on that single point**, and therefore the test calls the raw route, without the harness's `ApiClient`. `tests/integration/account-documents.test.ts` **pins** the divergence (proving it is the only one) and breaks on purpose when the overlay lands. The patch is: `replace /components/schemas/AccountDocumentResponsibleResponseDTO/properties/type` → `{ "$ref": "#/components/schemas/AccountDocumentResponsibleResponseAccountDocumentResponsibleType" }`. After that: delete the tripwire test and replace `getDocuments()` with `h.api.call('check-pending-documents')`. |
| Stitching | **The same silent failure of track H had a second floor, and it only showed up when the tracks were stitched.** With `mergeVariantBodies()` in place, `creditCard` started to REACH the handlers of `POST /v3/subscriptions` and `POST /v3/installments` — but they did not consume it. The subscription was born `billingType: CREDIT_CARD` with `creditCardId: null` (the charge generated 40 days later would have no card to charge), and the installment created the 12 installments `PENDING` without ever charging the card. Two 200 OKs, no error, a wrong result. | Fixed: `resolveCreditCard()` in subscriptions (it tokenizes at creation and reuses it in `update-subscription-credit-card`, instead of duplicating) and `create-installment` now resolves/validates the card **before any write** (declined → 400 without leaving an orphan plan) and confirms the N installments. Locked by a test in both cases. **The lesson:** an unreachable variant fails in two places — the body does not arrive, and the handler does not expect it. Fixing only the first one gives the appearance of a fix. |
| Notifications | **Default customer notifications start with WhatsApp on.** Asaas creates eight settings per customer ([notificacoes-padroes](https://docs.asaas.com/docs/notificacoes-padroes)) with WhatsApp off in every one. | **Deliberate divergence:** here e-mail, SMS and WhatsApp all start on, so a new customer's charges reach Mailpit and the WhatsApp mock with nothing to set. The event, offset and phone-call flags follow the docs. `src/domain/notification-defaults.ts`, covered by `tests/integration/notification-settings.test.ts`. |

## Rules the documentation does not define

We picked a behaviour; it may be wrong.

| Rule | What the docs say | What we did |
|---|---|---|
| Does the interest apply to `value` or to `value + fine`? | not documented | over the original value, without composing with the fine |
| **NFS-e: how long does the city hall take?** | the flow is asynchronous (events `INVOICE_SYNCHRONIZED` → `INVOICE_AUTHORIZED`), with no published deadline | **one tick**: issued (or on the `effectiveDate`) → `SYNCHRONIZED`; the next tick answers. Cancellation likewise (`PROCESSING_CANCELLATION` → `CANCELED`). `/_mock/invoices/:id/*` answers right away. `src/scheduler/jobs/invoice-jobs.ts` |
| **NFS-e: what does the city hall require to authorize?** | it varies by municipality | a registered `POST /v3/fiscalInfo` is enough; without it the note goes to `ERROR` with the reason. `TODO(rule)` in `src/modules/invoices/service.ts` |
| **NFS-e: `updatePayment`** | "update the charge's amount with the invoice's taxes already discounted" | it discounts PIS + COFINS + CSLL + INSS + IR (+ ISS if `retainIss`) from the OPEN charge, over the invoice's amount, recalculates the fee and emits `PAYMENT_UPDATED`. `src/domain/invoice.ts` |
| **NFS-e: scheduling rules** | not documented | `effectiveDate` cannot be passed; one note per charge (a cancellation frees it); the scheduled note of a removed charge is cancelled on the next tick (`INVOICE_CANCELED`). All `TODO(rule)` |
| **NFS-e: the subscription's `invoiceSettings` periods** | only the enum | `ON_PAYMENT_DUE_DATE` = the due date; `BEFORE_PAYMENT_DUE_DATE` = the due date − `daysBeforeDueDate`; `ON_DUE_DATE_MONTH` = the 1st day of the due date's month; `ON_NEXT_MONTH` = the 1st day of the next month; `ON_PAYMENT_CONFIRMATION` = when the money comes in. A date already past becomes today. `receivedOnly` holds the issuance until the payment |
| **NFS-e: the `SYNCHRONIZED` status** | the spec omits it from the response enum, but has the event and lists it in `SubscriptionGetInvoicesRequestInvoiceStatus` | overlay `spec/overlays/008-invoice-status-synchronized.json` |
| **NFS-e: the list of municipal services** | it depends on the account's city | a fixed sample of common items from LC 116/2003 with typical ISS (`GET /v3/fiscalInfo/services`). `TODO(rule)` |
| **The anticipation fee formula** | not documented (only the commercial rates: "from X% a.m.") | **`fee = netValue × (monthlyRateBp/10000) / 30 × daysAnticipated`** — pro-rata die over the MONTHLY rate, 30-day commercial month, simple interest, no minimum fee. The base is NOT the gross amount: it is the **net** of the charge (gross − Asaas's fee), as the spec's own examples show (`totalValue` 80 → `value` 76.01 → `fee` 2.33 → `netValue` 73.68). `src/domain/anticipation.ts`, the numbers in `config.fees.anticipation` (`FEE_ANTICIPATION_*`) |
| The anticipation limit (`GET /v3/anticipations/limits`) | it is Asaas's credit analysis — there is no public formula | a fixed cap of R$ 50,000.00 per receivable type (the number of the spec's example), minus what has already been anticipated and has not settled yet. `ANTICIPATION_LIMIT_CENTS` |
| `isDocumentationRequired` in the anticipation simulation | the spec only describes the field | `true` for a bank slip, `false` for a confirmed card (the issuer already authorized — it is certain money) |
| When is the balance debited in a **scheduled** transfer (`scheduleDate`)? | not documented | **at creation**, not on the scheduled date. It is the conservative reading (the balance cannot be spent twice) and the only one that keeps `GET /v3/finance/balance` honest |
| The free-transfer allowance (`fees.transfer.monthlyWithoutFee`, 30/month) | the docs cite the allowance but do not define what counts towards it | **not applied**: the TED fee is always charged. We do not know whether Pix and TED share the allowance, whether it is per account or per subaccount, nor whether the month is the competence month or the last 30 days — and a fee that appears and vanishes with no checkable rule is worse than a fee always charged |
| How to force a transfer to **FAIL** in the sandbox? | not documented — and without it nobody tests the reversal (`TRANSFER_REVERSAL`) | a deterministic trigger of ours: the Pix key `fail@asaas.com.br` **or** `externalReference: "FAIL"` → the transfer goes to `FAILED` in the scheduler and the money (amount + fee) comes back |
| The default order of `GET /v3/financialTransactions` | the spec has the `order` parameter, without values or default | `asc` (chronological, by insertion order). It is the only order in which the `balance` column — the balance AFTER each entry — makes sense from top to bottom |
| `GET /v3/finance/split/statistics`: which split statuses go into the account? | two one-line descriptions ("Amounts receivable" / "Values to be sent") | only OPEN splits (`PENDING`/`PROCESSING`/`AWAITING_CREDIT`). `income` = what this account has to receive; `value` = what it has to pay. A `DONE` split already became a statement entry — counting it here would be counting the same money twice |
| The default `limit` of the pagination | not documented | 10 |
| A test card that forces `AWAITING_RISK_ANALYSIS` | not documented | none |
| **(H)** How does Asaas detect the BRAND from the number? | the docs only cite the obvious prefixes | a prefix table matched by the **longest** one (`BRAND_RULES` in `src/domain/credit-card.ts`): 34/37→AMEX · 30/36/38→DINERS · 35→JCB · 6011/65/644-649→DISCOVER · 6→ELO · 4→VISA · 5 and 2→MASTERCARD. The real BIN ranges are much more granular (Elo has ~40); it is a `TODO(rule)` and the correction is **only the table**, which is data |
| **(H)** What to do with a number that is not a test card? | the docs list 3 sandbox cards and stay silent about the rest | it passed **Luhn** → it APPROVES. It failed → 400 `invalid_creditCard`. The trap: **`4444444444444444` does NOT pass Luhn** and it is still the card that approves — that is why the test table is consulted **before** the validation |
| **(H)** What is the card's refusal message? | the docs do not publish the catalog | 400 `invalid_creditCard` with **generic** text ("Transação não autorizada…"). Detailing the reason (over the limit / blocked / fraud) is a stolen-card enumeration vector — Asaas does not detail it, and neither do we |
| **Notifications: provider flags of the defaults** | the docs give `emailEnabledForProvider: true` for PAYMENT_RECEIVED and PAYMENT_OVERDUE/0 only, and leave the rest unstated | everything else starts `false` (`emailEnabledForProvider`, `smsEnabledForProvider`). The merchant is never notified by the mock anyway. `TODO(rule)` |
| **Notifications: SEND_LINHA_DIGITAVEL** | sent on the due day when the payer has not viewed the invoice or bank slip yet | the setting exists and is listed, but nothing is sent for it (no message for it yet). `TODO(rule)` |
| **Notifications: two notices on one day** | not documented (an OVERDUE repeat of 1 day falls on the day the charge goes overdue) | one notice per charge, event and day: the scheduled one is skipped when the event was already told that day. `src/scheduler/jobs/notice-jobs.ts` |
| **(H)** The pre-authorization's `daysToExpire`: default and effect | the spec only has the field (example: 5) | default **5**, stored in `settings` (namespaced per account). **The pre-authorization does NOT expire on its own yet** — a scheduler job is missing; today an `AUTHORIZED` charge stays `AUTHORIZED` until someone captures it. `TODO(rule)` in `src/modules/credit-cards/handlers.ts` |
| **The credit schedule of an INSTALLMENT PLAN on a card** | not documented. The issuer authorizes the total at once, but the docs do not say when each installment lands in the merchant's account | the N installments are born **CONFIRMED** (the authorization is single) and each one credits by the normal card rule, **D+32 from the confirmation**. The plausible alternative — D+32 from EACH installment's due date, staggering the credit month by month — is equally defensible and would give very different numbers. **It is one of the targets of the parity suite.** `src/modules/installments/handlers.ts` |
| **KYC: how is an account that is NOT approved in `GET /v3/myAccount/documents`?** | we only have a capture of an **approved** account (group `APPROVED`, `onboardingUrl: null`, **without** the `documents` array and **without** `onboardingUrlExpirationDate`). The pending case came from the spec + from the type the client expects | **every account is born with ONE `IDENTIFICATION` group** (the title and description are the golden's). Subaccount: group `NOT_SENT` + 1 `NOT_SENT` document + `onboardingUrl` (`{PUBLIC_BASE_URL}/onboarding/<hex32>`, which **serves no page**) + `onboardingUrlExpirationDate` = today + 30 days. Main account (seed): group `APPROVED`. **Guessed:** how many and which groups Asaas creates (it varies by person/company type — articles of incorporation, MEI certificate…); the link's 30-day validity; and that the newly approved group starts answering like the golden's approved group (the `documents` disappear) |
| **KYC: `responsible.type` for each account type** | the spec only lists the enum | derived from the registration: FISICA → `ASAAS_ACCOUNT_OWNER`; JURIDICA → `MEI`/`LIMITED_COMPANY`/`ASSOCIATION` according to `companyType`, with `INDIVIDUAL_COMPANY` as the default. **Only `INDIVIDUAL_COMPANY` is proven** (it is the captured account's); the rest is deduced from the enum |
| **KYC: the `{id}` of `POST /v3/myAccount/documents/{id}`** | the spec does not say whether it is the group's or the document's | it is the **DOCUMENT's** (the one that comes in `group.documents[]`) — it is what the real client does. A group id answers 404. In the sandbox **any file is accepted and auto-approved**: the document goes to `APPROVED` and, if it was the last pending one, so does the group. The multipart's `type` field is ignored (the document already exists; the group defines the type) |
| **KYC: `documentation`/`general` in `GET /v3/myAccount/status`** | the spec only describes the 4 fields | `documentation` comes from the **document groups**, not from the registration status — otherwise `POST /v3/sandbox/myAccount/approve` would have no observable effect at all. A new subaccount, therefore, transacts (`commercialInfo: APPROVED`) with `documentation: PENDING` and `general: PENDING`. **Guessed:** that `commercialInfo` and `bankAccountInfo` are born `APPROVED` in a newly created subaccount |
| **(H)** Does the chargeback debit the balance? | the docs do not describe the entry | **yes, the GROSS amount, when the charge had already credited** (`RECEIVED`) — a `CHARGEBACK` entry in the statement, and the account can go negative, because **the fee does not come back**. In a `CONFIRMED` one (which has not become balance yet) there is nothing to debit and no entry is generated. It is the same asymmetry — and the same design — as the `REFUND` |
| **(H)** The deadline to send the dispute's documents | the spec only has the field | 20 calendar days from the opening (`DISPUTE_DEADLINE_DAYS` in `src/modules/chargebacks/service.ts`). `TODO(rule)` |
| The time cutoff of the bank slip's "D+1 business day" | not documented | no cutoff; always the next business day |
| The webhook's `penalizedRequestsCount` — what counts as a "penalized request"? | it only exists as a field in the spec, without a definition | we return a fixed **0**, with a `TODO(rule)` in `src/modules/webhooks/handlers.ts`. Inventing a formula (failed attempts? deferred by the backoff? account throttling?) in a field nobody can check would be false confidence |
| The webhook queue's retention: does Asaas delete the delivery or only stop trying? | not documented | `PENDING` beyond the 14 simulated days → `EXPIRED`; an old `DELIVERED` is deleted; **`INTERRUPTED` is never purged** (it is the state the developer needs to see to understand why the queue froze) |
| `SEQUENTIALLY`: how many deliveries go out per "round"? | the docs only guarantee the ORDER and the queue's blocking | the dispatcher drains the queue in `sequence` order and **stops at the first failure** (real head-of-line blocking). Three events with the endpoint up arrive all three in the same tick; it is enough for the 1st to fail for the other two not to go out |
| **(G1)** The checkout's `minutesToExpire`: what is the default? | not documented | 60 minutes, in `rules.checkoutMinutesToExpire` (env `CHECKOUT_MINUTES_TO_EXPIRE`) |
| **(G1)** What happens to a link's main image when it is REMOVED? | not documented | the oldest one that is left becomes the main one. A link with images and no cover makes no sense |
| **(G1)** Does DELETE `/v3/myAccount` work on any account or only on a white label subaccount? | the spec's summary says "Delete White Label subaccount" | we require `parentAccountId != null` → 400 `invalid_account` on the root account. **The disabled subaccount's key keeps authenticating** (the `authenticate` is in the trunk): the disabling is only a dated fact in `account_disablements` |
| **(G1)** Does the Serasa query debit the fee from the balance? | the docs only publish the PRICE (R$ 16.99) | **we do not debit it.** The fee is recorded in `credit_bureau_reports.fee_cents` from `config.fees.creditBureauReport`, but there is no Asaas `FinancialTransactionType` that we KNOW of for it — inventing a type in the statement would be false confidence. **Track D closes this** (`postEntries` + the real type) |
| **(G1)** `GET /v3/myAccount/commercialInfo` returns a `city` object with IBGE, district etc., but the update request **has no city field** | the docs do not explain where the city comes from | in Asaas it is derived from the postal code. Without a postal-code database, we return `city: null` (or only `{name, state}` if the account has `city` stored). Inventing an IBGE code would be a lie |
| **(G1)** Service fees (notification, NF-e, negative listing, anticipation) | the docs publish the commercial table, but the engine does not charge any of them yet | `GET /v3/myAccount/fees` returns the table from `config.fees` (env `FEE_*`). What the engine does NOT charge (the promotional fee, Pix's percentage fee) goes as `null` — returning a number where there is no charge would make the client reconcile against a phantom fee |
| **(E)** `POST /v3/installments/{id}/refund` accepts a `value` ("Total amount to be refunded") — but **how does that total split among the installments?** By order? Pro-rata? Only the last one? | the docs only describe the field | **a partial reversal is explicitly refused** (400 `invalid_value`), with a `TODO(rule)` in `src/modules/installments/handlers.ts`. A TOTAL reversal works and reverses each paid installment in full. An invented allocation would produce wrong values that look right — in a field the client reconciles against the statement |
| **(E)** When the `nextDueDate` of a subscription changes, is the `dueDate` of the already generated PENDING charges rewritten? | not documented | **it is not.** With short cycles there are several pending ones inside the window and any choice would be a guess. The new `nextDueDate` applies to the NEXT generations; `updatePendingPayments` propagates the amount, the payment method, the description, the fine, the interest and the discount — not the due date. `TODO(rule)` in `src/modules/subscriptions/handlers.ts` |
| **(E)** Does the subscription emit `SUBSCRIPTION_*` when it **expires** (maxPayments/endDate exhausted)? | the enums have `SUBSCRIPTION_CREATED/UPDATED/INACTIVATED/DELETED` — **there is no EXPIRED event** | we emit nothing on the expiration. Emitting `SUBSCRIPTION_UPDATED` would be inventing semantics; the status becomes `EXPIRED` and whoever queries sees it. `SUBSCRIPTION_INACTIVATED` only goes out on an explicit `status: INACTIVE` via `PUT` |
| **(E)** The carnê's (`paymentBook`) `sort`/`order`: which fields are accepted? | the parameters exist, without a list of values | `dueDate` (default) and `value`; anything else falls back to `dueDate`. `TODO(rule)` in `src/modules/booklet.ts` |
| **(E)** Does the carnê (`GET .../paymentBook`) return JSON or PDF? | the spec declares the 200 response **without a schema** | **a real PDF** (`application/pdf`), generated in `src/modules/booklet.ts` — header, xref with correct offsets and trailer. Returning `{"url": "..."}` would break a client that expects bytes; the schema-less response is precisely the sign that it is not JSON |
| **(F)** What is the `resourceType` of a split event's payload? | the spec declares the events (`PAYMENT_SPLIT_CANCELLED`, `…_DIVERGENCE_BLOCK`, `…_DIVERGENCE_BLOCK_FINISHED`) but **none** of the 111 events carries a `split` resource | we send the **charge** (`resourceType: 'payment'`), whose `split[]` field already brings each split with its status, amount and the reason of the cancellation. The client receives everything it needs, in a format it already knows how to read |
| **(F)** Does the 2-business-day block deadline expire at the end of the last day or at its start? | the docs only say "2 business days to adjust" | `blockedUntil` = `addBusinessDays(creation, 2)` is the **last day on which it is still possible to adjust**; the job cancels it when `blockedUntil < today`. Created on a Monday → the deadline is Wednesday → cancelled on Thursday |
| **(F)** When the divergence expires, does Asaas emit `PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED`, `PAYMENT_SPLIT_CANCELLED`, or both? | the docs list both events, but do not say which path each one comes from | we emit **both**: the block ended AND the split was cancelled. They are two distinct facts |
| **(F)** Are the split's values recalculated when the charge is paid with an amount different from the original (late interest/fine)? | the docs only say "the displayed values may be updated after the payment confirmation" | the `split-release` job **redoes `computeSplits` over the FINAL `netValue`** at the moment of the credit. A bank slip paid late is worth more, so the `netValue` is bigger and the percentage split follows. If the sum ends up exceeding the netValue (the charge was edited down), the split is **blocked** instead of credited |
| **(F)** Does the reversal of a charge give back the money the split already credited to the destination? | not documented | **yes.** `applyTransition` posts `INTERNAL_TRANSFER_REVERSAL` in both statements (−on the destination, +on the origin). Without it the recipient would PROFIT from the reversal: they would keep the split of a charge that no longer exists |
| **(F)** An API key's `projectedExpirationDateByLackOfUse` — what is the inactivity window? | it only exists as a field in the spec, without a definition | we return **null**. Guessing a window (30 days? 180?) in a field nobody can check would be false confidence |
| **(F)** The subaccount's `city` is a numeric id from Asaas's registry, but the creation request **has no city field** | not documented | `city: null`. Without Asaas's city table, inventing a number would be a lie (the same decision as G1 in `commercialInfo`) |
