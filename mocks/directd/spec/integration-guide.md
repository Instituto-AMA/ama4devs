# Envelope de resposta (MetaDados + Retorno)

Toda resposta segue o formato:

    {
      "metaDados": {
        "consultaNome": "Cadastro Pessoa Física",
        "consultaUid": "direct-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "chave": "CPF=00000000000;",
        "mensagem": "Sucesso",
        "resultadoId": 1,
        "resultado": "Sucesso",
        "apiVersao": "v3",
        "data": "03/06/2026 10:00:00",
        "tempoExecucaoMs": 1500
      },
      "retorno": { ... }   // payload da consulta; null em erro
    }

- Sempre cheque `metaDados.resultadoId` / `metaDados.resultado` para o status de negócio.
- `retorno` vem `null` quando há falha; a causa está em `metaDados.mensagem`.

# Consulta assíncrona

Para consultas demoradas, habilite o modo assíncrono e faça polling do resultado:

1. Dispare com `?Async=habilitar`:

       GET /api/{Consulta}?CPF=...&Async=habilitar&TOKEN={TOKEN}
       → HTTP 201, devolve metaDados.consultaUid = "direct-{guid}"

2. Faça polling do resultado:

       GET /api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-{guid}&TOKEN={TOKEN}
       → HTTP 202  → ainda em processamento (tente de novo em alguns segundos)
       → HTTP 200  → pronto; devolve o envelope completo (metaDados + retorno)

Existe também `GET /api/Historico?ConsultaUid=direct-{guid}` (formato { info, retorno }), mas o
endpoint `ObterRetornoConsultaAsync` é melhor para polling por distinguir 202 (processando) de 200 (pronto).

# Autenticação (TOKEN)

Toda consulta paga exige o seu TOKEN da plataforma DirectData, enviado como **query string**:

    GET https://apiv3.directd.com.br/api/{Consulta}?CPF=00000000000&TOKEN={SEU_TOKEN}

- O TOKEN é um GUID (ex: `1a2b3c4d-....`). Não vai em header — vai em `?TOKEN=`.
- Ele é removido do documento OpenAPI por um filtro de segurança, mas continua sendo obrigatório.
- Erros de credencial/saldo voltam da própria APIv3: 401 (token inválido), 403 (saldo insuficiente / cliente bloqueado / plano incompatível).

# Status codes

| Código | Significado |
|--------|-------------|
| 200 | Sucesso — `retorno` preenchido |
| 201 | Async criada — use `metaDados.consultaUid` |
| 202 | Async ainda em processamento (no polling) |
| 400 | Parâmetro inválido/ausente |
| 401 | Token inválido ou ausente |
| 403 | Saldo insuficiente / cliente bloqueado / plano incompatível |
| 404 | Nada encontrado para os parâmetros |
| 408 | Tempo limite excedido |
| 429 | Rate limit (veja o tópico ratelimit) |
| 500 | Falha interna — contate suporte@directd.com.br |
| 503 | Consulta em manutenção |

# Rate limit

O limite é por IP: **30 requisições/segundo**. Ao estourar, a APIv3 responde **429 Too Many Requests** com:

    {
      "status": 429,
      "error": "Too Many Requests",
      "message": "Você realizou muitas requisições. Aguarde N segundos e tente novamente.",
      "retryAfterSeconds": N
    }

- Há punição progressiva: rejeições repetidas aumentam o tempo de bloqueio (30s → 60s → 120s → 240s → 300s).
- Respeite o header `Retry-After` / o campo `retryAfterSeconds` antes de tentar de novo.
- Em integrações em lote/cascata, serialize ou aplique backoff para não disparar o bloqueio.

# Callback (webhook)

Em vez de fazer polling, você pode receber o resultado por webhook:

    GET /api/{Consulta}?CPF=...&Async=habilitar&Callback=habilitar&TOKEN={TOKEN}

A DirectData fará um POST com o envelope da consulta na URL de callback configurada no seu cadastro.
Combine sempre `Callback=habilitar` com `Async=habilitar`.

