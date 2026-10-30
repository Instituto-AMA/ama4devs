# Direct Data Mock

Simulator of the Direct Data API v3 (credit bureau queries) for development and tests. The provider has
no sandbox, so the Hub's dev, sandbox mode, unit, integration and e2e runs use this mock.

The mock only answers requests. It never proxies, forwards or passes through to the real API, holds no real
token and makes no outbound HTTP call; a test guards the source tree against client code.

- Port: `PORT`, default `8095` (the Hub maps it).
- Image: `ghcr.io/instituto-ama/directd-mock`.
- Run: `bun src/server.ts`. Tests: `bun test`.

## Token

The one accepted token is `00000000-0000-4000-8000-00000000d1d1`. It is public, not a secret, and opens
nothing outside this mock. Any other or missing token answers 401.

## API

`GET /api/{Route}?CPF=<11 digits>&TOKEN=<guid>[&Async=habilitar]`

| Route | Provider |
|---|---|
| `/api/Score` | Quod |
| `/api/BoaVistaAcertaMaisPositivoPF` | Boa Vista |

- Sync: `200` with `metaDados` (`resultadoId: 1`, `resultado: "Sucesso"`) and `retorno`.
- `Async=habilitar`: `201` with `resultado: "Processando"` and `retorno: null`. Then
  `GET /api/Historico/ObterRetornoConsultaAsync?ConsultaUid=<uid>&TOKEN=…` answers `202` on the first read and `200`
  with the full envelope after. An unknown uid answers `404`.
- Control: `GET /health`, `GET /__mock/requests` (request log), `GET /__mock/state` (counters),
  `DELETE /__mock/state` (reset async queries and the log).

## Scenarios by CPF

Any other valid CPF is low risk; a CPF with invalid check digits is a `400` bad document.

| Scenario | CPF | Result |
|---|---|---|
| Low risk | `11100000143` | 200, score 850, 3,5% |
| Medium risk | `11100111212` | 200, score 650, 18% |
| High risk | `11100222391` | 200, score 420, 41% |
| Restrictions | `11100333460` | 200, debts 3 / R$ 4.230,50, protests 1 / R$ 800,00, restricoes 2 |
| Deceased | `11100444530` | 200, `indicacaoObito: "SIM"` |
| Irregular CPF | `11100555609` | 200, `cpfSituacao: "SUSPENSA"` |
| Bad document | `11111111112` (or any invalid check digits) | 400 |
| Not found | `11100666788` | 404 |
| Timeout | `11100777857` | 408 |
| No balance | `11100888926` | 403, `resultado: "Saldo insuficiente"` |
| Unauthorized | `11101000007` | 401 |
| Rate limited | `11101111186` | 429, `retryAfterSeconds: 30` in the body and `Retry-After: 30` |
| Unavailable | `11101222255` | 503 |
| Internal error | `11101333324` | 500 |
| Slow | `11101444401` | 200 after 25 s (simulated provider latency) |
| Never settles | `11101555572` | async read stays `202` forever |
