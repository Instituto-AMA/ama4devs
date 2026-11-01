# The Direct Data contract the generator follows

The provider publishes no OpenAPI for these routes. The files here are its public documentation, kept
byte for byte (Portuguese included) so the mock can be checked against it. Read on 2026-10-31.

| File | Source |
|---|---|
| `score.response.json` | Response example of https://www.directd.com.br/central-de-ajuda/apis/catalogo/Score |
| `boavista-acerta-mais-positivo-pf.response.json` | Response example of https://www.directd.com.br/central-de-ajuda/apis/catalogo/BoaVistaAcertaMaisPositivoPF |
| `score.mcp.json` | `directdata_detalhar_api` (`Score`) on the public MCP `https://mcp.directd.com.br` (no token) |
| `boavista-acerta-mais-positivo-pf.mcp.json` | `directdata_detalhar_api` (`/api/BoaVistaAcertaMaisPositivoPF`) on the same MCP |
| `integration-guide.md` | `directdata_guia_integracao`, topics envelope, async, auth, statuscodes, ratelimit, callback |

## What is documented

- `GET https://apiv3.directd.com.br/api/{Route}?CPF=…&TOKEN=…`; the token is a GUID in the query string,
  never a header. `CPF` may be sent with or without formatting (`529.982.247-25` or `52998224725`).
- Envelope, camelCase: `metaDados { consultaNome, consultaUid, chave, usuario, mensagem, ip, resultadoId,
  resultado, apiVersao, enviarCallback, gerarComprovante, urlComprovante, assincrono, data,
  tempoExecucaoMs }` and `retorno` (null on failure; the cause is in `metaDados.mensagem`).
- `consultaUid` is `direct-{guid}`; `chave` is `CPF=00000000000;`; `apiVersao` is `v3`; `data` is
  `dd/MM/yyyy HH:mm:ss`.
- `consultaNome` is the display name: `Score de Crédito - QUOD`, `Boa Vista - Acerta Mais Positivo
  Pessoa Física`.
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
- Observed (an unauthenticated call, 2026-10-30): `401`, `resultadoId: 3`, `resultado: "Não Autorizado"`,
  `mensagem: "IP ou Token inválido. Verifique."`.
- The provider charges a consultation whose `resultado` is `Sucesso` or `Sucesso com Ressalvas`.

## What is not documented (the mock's own choice, stable, never asserted as the provider's)

- `resultadoId` and `resultado` of 202, 400, 403, 404, 408, 500, 503 and of `Sucesso com Ressalvas`.
- `consultaUid` and `chave` on a failure: `null` when the call is refused before a consultation exists
  (400, 401, 403), set when the consultation itself failed (404, 408, 500, 503).
- The text of `faixaScore`, `perfil`, `capacidadePagamento`, `rendaPresumida.faixa` and every
  descriptive field: plausible values, documented per scenario in the generator's README.
- `Callback=habilitar`: the mock records the flag (`enviarCallback: true`) and never posts anywhere — it
  makes no outbound call.
- `GERARCOMPROVANTE=Habilitar`: `gerarComprovante: true`, `urlComprovante: null`; no PDF is produced.
- `GET /api/Historico?ConsultaUid=` (the `{ info, retorno }` form) is not simulated: the Hub polls
  `ObterRetornoConsultaAsync`.
- When the async read turns `200`: the first read answers `202`, the second and the next ones the final
  envelope; `POST /_mock/directd/queries/{uid}/release` settles a query at once (the only way for
  `neverSettles`). An unknown `ConsultaUid` answers `404` with `consultaNome` `Obter Retorno Consulta Async`.
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
