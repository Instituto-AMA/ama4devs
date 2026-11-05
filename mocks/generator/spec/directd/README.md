# The Direct Data contract the generator follows

The provider publishes no OpenAPI for these routes. The files here are its public documentation, kept
byte for byte (Portuguese included) so the mock can be checked against it. Read on 2026-11-04.

| File | Source |
|---|---|
| `score.response.json` | Response example of https://www.directd.com.br/central-de-ajuda/apis/catalogo/Score |
| `boavista-acerta-mais-positivo-pf.response.json` | Response example of https://www.directd.com.br/central-de-ajuda/apis/catalogo/BoaVistaAcertaMaisPositivoPF |
| `dossie-credito-completo.response.json` | Response example of https://www.directd.com.br/central-de-ajuda/apis/catalogo/DossieCreditoCompleto |
| `boavista-acerta-completo-positivo-pf.response.json` | Response example of https://www.directd.com.br/central-de-ajuda/apis/catalogo/BoaVistaAcertaCompletoPositivoPF |
| `score.mcp.json` | `directdata_detalhar_api` (`Score`) on the public MCP `https://mcp.directd.com.br` (no token) |
| `boavista-acerta-mais-positivo-pf.mcp.json` | `directdata_detalhar_api` (`/api/BoaVistaAcertaMaisPositivoPF`) on the same MCP |
| `dossie-credito-completo.mcp.json` | `directdata_detalhar_api` (`Dossiê QUOD - Completo`) on the same MCP |
| `boavista-acerta-completo-positivo-pf.mcp.json` | `directdata_detalhar_api` (`/api/BoaVistaAcertaCompletoPositivoPF`) on the same MCP |
| `integration-guide.md` | `directdata_guia_integracao`, topics envelope, async, auth, statuscodes, ratelimit, callback |
| `webhook.md` | The `WEBHOOK` paths of https://api.app.directd.com.br/swagger/v1/swagger.json, byte for byte (read on 2026-11-04) |
| `marketplace-get-balance.response.json` | The real answer of `GET /api/Marketplace/GetBalance`, captured on 2026-11-04 |
| `billing-get-consumption-api-v3.response.json` | The real answer of `GET /api/Billing/GetConsumptionApiV3`, captured on 2026-11-04 |

## What is documented

- `GET https://apiv3.directd.com.br/api/{Route}?CPF=…&TOKEN=…`; the token is a GUID in the query string,
  never a header. `CPF` may be sent with or without formatting (`529.982.247-25` or `52998224725`).
- Envelope, camelCase: `metaDados { consultaNome, consultaUid, chave, usuario, mensagem, ip, resultadoId,
  resultado, apiVersao, enviarCallback, gerarComprovante, urlComprovante, assincrono, data,
  tempoExecucaoMs }` and `retorno` (null on failure; the cause is in `metaDados.mensagem`).
- `consultaUid` is `direct-{guid}`; `chave` is `CPF=00000000000;`; `apiVersao` is `v3`; `data` is
  `dd/MM/yyyy HH:mm:ss`.
- `consultaNome` is the display name: `Score de Crédito - QUOD`, `Boa Vista - Acerta Mais Positivo
  Pessoa Física`, `Boa Vista - Acerta Completo Positivo Pessoa Física`, `Dossiê QUOD - Completo`.
- Async: `Async=habilitar` → `201` with `consultaUid`; the example of the 201 is `resultadoId: 1`,
  `resultado: "Sucesso"`, `mensagem: "Requisição async criada com sucesso. Utilize o ConsultaUid para
  consultar o resultado."`, `retorno: null`. `GET /api/Historico/ObterRetornoConsultaAsync?ConsultaUid=
  direct-{guid}&TOKEN=…` → `202` while processing, `200` with the full envelope when ready.
- Statuses: 200, 201, 202, 400, 401, 403 (no balance / blocked client / plan), 404, 408, 429, 500, 503.
- 429 is **not** an envelope: `{ "status": 429, "error": "Too Many Requests", "message": "Você realizou
  muitas requisições. Aguarde N segundos e tente novamente.", "retryAfterSeconds": N }` plus the
  `Retry-After` header. The limit is 30 requests per second per IP.
- Score `retorno`: `dataConsulta`, `documentoConsultado`, `pessoaFisica { score (number), faixaScore,
  capacidadePagamento, perfil }`, `pessoaJuridica`, `observacao`. No PDF receipt.
- Boa Vista `retorno`: every value is a string; the full key list is in
  `boavista-acerta-mais-positivo-pf.response.json`. Counts are `quantidadeOcorrencia` in the amount
  blocks and `quantidadeOcorrencias` in `restricoes`, `participacaoEmEmpresas`, `scores`,
  `passagensComerciais`; creditors are `pendenciasFinanceiras.totalCredores`; the default probability is
  `scores.ocorrencias[].probabilidadeInadimplencia`. `GERARCOMPROVANTE=Habilitar|Desabilitar` asks for a
  PDF receipt.
- Phones and addresses are documented twice: the catalog example has a flat `telefone`, `rua`, `bairro`,
  `cidade`, `uf`, `cep` and `somenteTelefone.dados[]` / `somenteEndereco.dados[]`; the MCP field list has
  `telefones[] { ddd, numero, telefoneComDDD }` and `enderecos[] { logradouro, numero, complemento,
  bairro, cidade, uf, cep }`. The mock sends both shapes, filled with the same data.
- **Acerta Mais and Acerta Completo do not carry the same key list.** The catalog page documents 49 keys
  for Acerta Mais (the flat phone and address fields, plus `somenteTelefone` and `somenteEndereco`) and 43
  for Acerta Completo (`telefones[]` and `enderecos[]`, without the two `somente*` blocks, and with
  `decisao.resultado` where Acerta Mais has `decisao.observacoes`). The MCP field list, on the other
  hand, gives **both** products the same 43 fields — it disagrees with the catalog page about Acerta
  Mais. The mock follows the catalog page for each route: Acerta Mais sends the union of both shapes
  (so a reader of either documentation finds its keys), and Acerta Completo sends exactly the 43 keys
  of its own page.
- Acerta Completo `retorno`: every leaf is a string, like Acerta Mais; the full key list is in
  `boavista-acerta-completo-positivo-pf.response.json`. The phone and the address come as the
  `telefones[]` and `enderecos[]` arrays, and the two `somente*` blocks are absent.
- Dossiê QUOD `retorno`: four keys — `documentoConsultado`, `entidadeJuridica`, `entidadeFisica`,
  `observacao`. For a person `entidadeJuridica` is `null`, and so is
  `entidadeFisica.scoreEntidade.entidadeJuridica`. The leaves the Hub reads are **numbers**, not
  strings: `entidadeFisica.scoreEntidade.entidadeFisica.score`,
  `entidadeFisica.pendenciaFinanceira.totalPendencia`,
  `entidadeFisica.pendenciaFinanceira.negativacoes[].valor` and
  `entidadeFisica.pendenciaFinanceira.protestos[].valorTotal`;
  `entidadeFisica.dadosCadastrais.possuiObito` is a boolean and
  `entidadeFisica.dadosCadastrais.status` is `REGULAR` (or `SUSPENSA`). The route takes a `CPF` and a
  `CNPJ`; it has no PDF receipt.
- Observed (an unauthenticated call, 2026-10-30): `401`, `resultadoId: 3`, `resultado: "Não Autorizado"`,
  `mensagem: "IP ou Token inválido. Verifique."`.
- The provider charges a consultation whose `resultado` is `Sucesso` or `Sucesso com Ressalvas`.

## The webhook and the account

- `POST /api/Webhook/CreateUrlCallBack` takes the token in the `Token` header and a body `{"Url": "…"}`; it
  answers `200` with `{ id, result: "Created", status: "OK", elapsedTimeMs, dateTimeExecution }`. The provider
  then posts the code to that URL (the receiver answers `201`) and the code comes back through
  `ConfirmUrlCallBack`: the `201` is not the confirmation.
- `POST /api/Webhook/ConfirmUrlCallBack` takes the token in the `Token` header and a body `{"Code": "…"}`; it
  answers `200` with `{ id, result: "Confirmed", status: "OK", elapsedTimeMs, dateTimeExecution }`.
- The callback of a consultation carries `Product`, `Id`, `Status` and `Url`, in that order; the products are
  `Enrichment`, `AdvancedSearch`, `LookALike`, `Dossier`, `CorporateLinkage`, `APIv3` and
  `APIv3-StatusAvailability`; the statuses are `Created`, `Processing`, `Error`, `Canceled`, `Modified` and
  `Finished`.
- `GET /api/Marketplace/GetBalance` and `GET /api/Billing/GetConsumptionApiV3` take the token in the `Token`
  header; their real answers were captured on 2026-11-04 (`marketplace-get-balance.response.json` and
  `billing-get-consumption-api-v3.response.json`) and are the shape the mock answers.

## What is not documented (the mock's own choice, stable, never asserted as the provider's)

- `resultadoId` and `resultado` of 202, 400, 403, 404, 408, 500, 503 and of `Sucesso com Ressalvas`.
- `consultaUid` and `chave` on a failure: `null` when the call is refused before a consultation exists
  (400, 401, 403), set when the consultation itself failed (404, 408, 500, 503).
- The text of `faixaScore`, `perfil`, `capacidadePagamento`, `rendaPresumida.faixa` and every
  descriptive field: plausible values, documented per scenario in the generator's README.
- `Callback=habilitar`: the mock records the flag (`enviarCallback: true`) and, on an async consultation, posts the
  callback to the URL of a confirmed registration, and to nowhere else. A synchronous consultation posts nothing.
- `GERARCOMPROVANTE=Habilitar`: `gerarComprovante: true`, `urlComprovante: null`; no PDF is produced.
- `GET /api/Historico?ConsultaUid=` (the `{ info, retorno }` form) is not simulated: the Hub polls
  `ObterRetornoConsultaAsync`.
- When the async read turns `200`: the first read answers `202`, the second and the next ones the final
  envelope. A consultation that settles on its own (a callback consultation with a confirmed URL), a release
  or a fail turns the first read into the final envelope; `POST /_mock/directd/queries/{uid}/release` settles
  a query at once (the only way for `neverSettles`). An unknown `ConsultaUid` answers `404` with
  `consultaNome` `Obter Retorno Consulta Async`.
- The settling delay of an async consultation that asked for a callback: about 1 s (25 s for the slow CPF) —
  the mock's own.
- `POST /_mock/directd/queries/{uid}/fail` and the forced failure of the management routes are control routes,
  not provider behavior; the body of a forced failure is the mock's own. A query already read, or whose callback
  already went out, answers `409` to a fail: the read never contradicts the callback.
- Which URL gets a callback: the one confirmed when the consultation settles. Whether it settles on its own is
  decided when it is created; a registration cleared or replaced by an unconfirmed one in between stops the post,
  not the settling; the timer does not try again, and a later read announces only if a URL is confirmed by then.
- The `Url` of a callback names the mock as `http://localhost:<port>`, whatever name the caller reached it by.
- The body of the availability notice: `{ Product, Status }` only, since the provider documents no body and no
  status words for it; the status word is the tester's.
- `Async=habilitar` on a CPF whose outcome fails answers that failure synchronously, with no `201`.
- The `429` comes from its test CPF only: no requests are counted per second, `retryAfterSeconds` is always
  `30`, and the progressive block (30 s → 60 s → … → 300 s) is not simulated.
- Parameter names are matched whatever their case (`cpf`, `async`, `token`), the way the provider's
  documentation itself mixes them (`CPF`, `Async`, `ConsultaUid`, `TOKEN`).
- `Access-Control-Allow-Origin: *` on every `/api/*` answer: a transport header, so the playground on
  Pages can call a container on the developer's machine. The body and the status do not change.
- The public endpoint on Pages (`generator/api/<route>/<cpf>`) holds the synchronous answer of each test
  CPF on both routes, built by `scripts/build-generator-api.mjs` from this core with a fixed date and a
  stable `consultaUid`. Pages answers HTTP 200 for every file; `generator/api/directd.json` lists the
  status the container answers. A static file checks no token and runs no async query.
- The code of a registration: `CALL-` and four uppercase alphanumerics, drawn from the id the provider gave
  it. The provider's own example is `CALL-A123`; the format of the four characters is the mock's choice.
- A new `CreateUrlCallBack` replaces the previous registration: the provider's behaviour with two registered
  URLs is not documented.
- An unknown code answers `400`; the body of the refusal is the mock's own (`{ "error": { "code": … } }`).
- The destination guard: the mock posts only to a loopback host (`127.0.0.1`, `::1`, `localhost`) or to a
  single-label host (a service of a compose network); any other host answers `400` and nothing is posted. A
  redirect from the receiver is not followed.
- The cost of each product (`Score` 1.98, `BoaVistaAcertaMaisPositivoPF` 11.18,
  `BoaVistaAcertaCompletoPositivoPF` 14.03, `DossieCreditoCompleto` 6.99): the prices of the
  provider's catalog, as the mock reads them; the provider does not document them on the API.
- The balance starts at `DIRECTD_BALANCE` (500 by default); a charged consultation subtracts the cost of its
  product, a top-up adds to it, and `addedLast30Days` and `consumedLast30Days` are the running sums since the
  mock booted — the 30-day window itself is not simulated. An async consultation is charged when it is read and
  the balance is checked when it is created, so reads can take the balance below zero.
- A balance shorter than the cost of the product answers the `403` of the `Saldo insuficiente` outcome, the
  same answer the provider gives.
- The bodies of the `401` and of the `405` of the webhook and account routes: `{ "error": { "code": … } }`, the
  mock's own.
- `consumption.active` false is the shape of the captured answer with its value switched.
