<p align="center"><a href="README.md">English</a> · <b>Português</b></p>

<p align="center"><img src="docs/icon.svg" alt="" width="72"></p>

# Asaas Mock Server

**Um Asaas local, em Docker.** A API v3 do Asaas simulada com fidelidade de
contrato *e* de comportamento: clientes, cobranças com **Pix**, **boleto** e
**cartão de crédito**, parcelamentos, assinaturas, estornos, split,
subcontas, notificações ao pagador e um relógio virtual. Diferente do sandbox
oficial, ele **entrega webhooks no `localhost`**.

<p align="center">
  <a href="https://github.com/Instituto-AMA/ama4devs/pkgs/container/asaas-mock"><img alt="Imagem" src="https://img.shields.io/badge/ghcr.io-instituto--ama%2Fasaas--mock-0038e5"></a>
  <img alt="API" src="https://img.shields.io/badge/Asaas%20API-v3-0038e5">
  <img alt="Plataformas" src="https://img.shields.io/badge/plataformas-amd64%20%C2%B7%20arm64-0038e5">
  <a href="LICENSE"><img alt="Licença" src="https://img.shields.io/badge/licen%C3%A7a-MIT-0038e5"></a>
</p>

<p align="center">
  <img src="docs/img/dashboard.jpg" alt="O painel do simulador: cobranças recebidas, confirmadas, aguardando pagamento e vencidas com os totais, cartões de teste e a carteira e a chave de API da conta." width="900">
</p>

```bash
docker run --rm -p 45445:45445 ghcr.io/instituto-ama/asaas-mock:latest
```

A chave de API aparece no log da subida. Trocar a sua aplicação do sandbox para
o mock é trocar a URL base:

```diff
- ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
+ ASAAS_BASE_URL=http://localhost:45445/v3
```

## Por que não usar só o sandbox do Asaas

O sandbox não entrega webhook no `localhost`. Isso te obriga a usar túnel,
subir um ambiente de homologação ou montar payload na mão, e nada disso testa o
que importa: o prazo de crédito, os juros do atraso, o split, a retentativa do
webhook. E no sandbox um pagamento no cartão só cai em 32 dias de verdade.

Aqui **o tempo é seu**:

```bash
# Um pagamento no cartão fica em CONFIRMED; o dinheiro cai em D+32.
curl -X POST localhost:45445/_admin/clock/advance \
     -H 'content-type: application/json' -d '{"days": 32}'
# → PAYMENT_RECEIVED chega no seu endpoint. Levou 40 ms.
```

## O que ele simula

Não é um mock de respostas fixas.

- **Uma máquina de estados por forma de pagamento.** Pix vai direto para
  `RECEIVED`; boleto credita em D+1 útil; cartão de crédito em **D+32**; débito
  em D+3. Uma cobrança não paga passa antes por `OVERDUE`.
- **Dinheiro de verdade.** `netValue = value − taxa`, a taxa é debitada no
  extrato, e o extrato fecha com o saldo (um invariante testado).
- **Juros e multa.** A multa uma vez, no primeiro dia de atraso; os juros pro
  rata die sobre um mês comercial de 30 dias.
- **Split entre contas.** Cada chave de API é uma conta com `walletId` e saldo
  próprios. Um split move dinheiro e lança nos **dois** extratos.
- **Webhooks do jeito do Asaas.** Header `asaas-access-token`, **só HTTP 200
  conta como sucesso** (201 e 204 são falha, a regra real), 15 tentativas com
  backoff, `SEQUENTIALLY` com bloqueio de fila de verdade e `interrupted` no
  fim.
- **Cartão de verdade.** Tokenização (o número nunca é guardado), cartões de
  teste, pré-autorização e captura, chargeback. Parcelamento no cartão cobra o
  cartão.
- **Recorrência.** Uma assinatura cria a **primeira cobrança na hora**; as
  seguintes nascem 40 dias antes do vencimento. No parcelamento, a sobra do
  arredondamento vai para a **última** parcela, e no cartão cada uma credita em
  **D+32×n**. *(As três capturadas do sandbox real, as três contradizem o que a
  documentação sugere.)*
- **Pix que paga mesmo.** `GET /v3/payments/{id}/pixQrCode` devolve um **BR Code
  EMV de verdade**, com CRC16, e a imagem do QR: a câmera do celular lê.
- **Ativação de subconta.** Crie a subconta, liste os documentos pendentes,
  envie o arquivo (multipart), aprove.
- **A API inteira.** Toda operação da especificação oficial existe, com
  autenticação, validação e o formato de erro do Asaas. As que ainda não têm
  regra de negócio respondem `501` dizendo qual operação falta, nunca dados
  inventados (`GET /_admin/coverage`).

## Notificações ao pagador

O que o Asaas avisa a quem paga, entregue de verdade na sua máquina:

<table>
<tr>
<td width="56%"><img src="docs/img/charge-notifications.jpg" alt="Uma cobrança com o link da fatura, os botões de pagamento e as notificações ao pagador: o e-mail enviado ao Mailpit e o template enviado ao WhatsApp mock." /></td>
<td>

- Cada evento da cobrança (criada, alterada, vencendo, vencida, recebida) manda
  ao pagador um **e-mail no Mailpit** e um **template de WhatsApp** pela Cloud
  API do [WhatsApp mock](../whatsapp/README.pt-BR.md).
- **O parcelamento é avisado uma vez**: a criação da primeira parcela conta o
  plano inteiro (*R$ 3.000,00 em 5x de R$ 600,00*); lembretes e confirmações
  continuam por parcela.
- Tudo sobe configurado: na subida e a cada ciclo, o número remetente recebe o
  webhook deste servidor e os templates do pagador são criados no WhatsApp
  mock, pelas chamadas da própria Meta.
- O `notificationDisabled` do cliente e as configurações de notificação são
  respeitados, um canal com falha nunca trava a cobrança, e o painel reenvia
  quando você pede.

</td>
</tr>
</table>

## O painel

Abra **http://localhost:45445**. Não é o painel do Asaas: é o do *simulador*, e
mostra o que o Asaas não deixa você ver.

<table>
<tr>
<td width="50%"><img src="docs/img/invoice-pix.jpg" alt="A página da fatura que o pagador abre: valor, vencimento, descrição e o QR code do Pix com copia e cola." /><br><sub><b>A página da fatura.</b> O que o pagador abre (<code>invoiceUrl</code>): Pix com QR code de verdade, boleto com linha digitável, ou cartão. Pagar por ela segue o caminho real: status, extrato, webhooks.</sub></td>
<td width="50%"><img src="docs/img/charges.jpg" alt="A lista de cobranças: avulsas e parcelas com situação, cliente, tipo, forma de pagamento, valor e vencimento, e as abas Assinaturas e Parcelamentos." /><br><sub><b>Cobranças.</b> Avulsas, parcelas e assinaturas, com situação, forma de pagamento e vencimento. <b>Nova cobrança</b> cria qualquer uma das três.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/img/clock.jpg" alt="O relógio virtual: a hora e o modo do simulador, e os botões para avançar um dia, sete dias, trinta e dois dias, rodar um tick ou voltar ao presente." /><br><sub><b>Relógio virtual.</b> <code>+1 dia</code>, <code>+7 dias</code>, <code>+32 dias</code>: cada dia simulado roda um ciclo completo, então assinaturas geram cobrança, cobranças não pagas vencem e cartões creditam.</sub></td>
<td width="50%"></td>
</tr>
</table>

- **Meus Clientes**: criar, editar, remover e restaurar; abra um para ver tudo
  que foi cobrado dele.
- **Cobranças**, **Assinaturas**, **Parcelamentos**, e **Nova cobrança** com os
  três tipos do Asaas (avulsa, parcelada pelo total ou por parcela,
  assinatura), qualquer forma de pagamento, juros, multa, desconto e split.
  **Simular Venda** abre o mesmo formulário.
- **Uma cobrança**: link da fatura, simular pagamento, confirmar recebimento em
  dinheiro, receber, vencer, estornar, excluir, restaurar, e as notificações.
- **Integrações**, por conta: chaves de API (gerar, trocar, expirar no relógio
  virtual), webhooks (com a lista de eventos, pela `/v3/webhooks` real), logs
  de webhook com a resposta do seu endpoint, e os canais de e-mail e WhatsApp.
- **Cartões de teste**: a tabela que o motor lê; aceitar qualquer cartão bem
  formado ou só os listados; criar um cartão com o resultado que ele força.
- **Perfis**: uma conta raiz por cliente da sua aplicação, criada e apagada sem
  reiniciar.

## Use no seu projeto

```yaml
services:
  asaas:
    image: ghcr.io/instituto-ama/asaas-mock:0.6.3   # fixe uma versão, ou :latest
    ports:
      - '45445:45445'
    environment:
      # Fixe a chave, senão um volume novo gera outra.
      # `$$` é um `$` literal no compose: um `$aact_...` simples viraria uma variável vazia.
      ASAAS_API_KEY: '$$aact_hmlg_local'
      # Dentro do container, localhost é o próprio container: isto manda os webhooks para a sua máquina.
      WEBHOOK_LOCALHOST_REWRITE: host.docker.internal
      # O tempo corre, e você pode pular (POST /_admin/clock/advance).
      CLOCK_MODE: VIRTUAL_FLOWING
    extra_hosts:
      - 'host.docker.internal:host-gateway'   # Linux
    volumes:
      - asaas-data:/data
volumes:
  asaas-data:
```

Se a sua aplicação roda na mesma rede do compose, ela chega no mock em
`http://asaas:45445/v3`. **No CI**, tire o rewrite e use
`CLOCK_MODE=VIRTUAL_FROZEN`: o relógio só anda quando o teste manda.

```bash
curl localhost:45445/v3/customers \
  -H 'access_token: $aact_hmlg_local' -H 'content-type: application/json' \
  -d '{"name":"Maria Souza","cpfCnpj":"24971563792","email":"maria@example.com","mobilePhone":"11987654321"}'
```

Para as notificações ao pagador, rode o [WhatsApp mock](../whatsapp/README.pt-BR.md)
e o Mailpit ao lado e defina `WHATSAPP_MOCK_URL` e `MAILPIT_URL` (o
[`docker-compose.yml`](../../docker-compose.yml) da raiz já faz tudo isso).

## Configuração

| Variável | Padrão | |
|---|---|---|
| `PORT` | `45445` | Porta HTTP |
| `ASAAS_API_KEY` | *gerada, aparece na subida* | A chave da conta principal |
| `WEBHOOK_LOCALHOST_REWRITE` | *(vazio)* | Host que substitui `localhost` nas URLs de webhook. **Use `host.docker.internal`.** |
| `CLOCK_MODE` | `REAL` | `REAL` · `VIRTUAL_FLOWING` (corre, dá para pular) · `VIRTUAL_FROZEN` (só anda quando mandam, para CI) |
| `ADMIN_ENABLED` | `true` | As rotas `/_admin/*` e o painel |
| `INVOICE_BASE_URL` | `http://localhost:<PORT>` | Para onde `invoiceUrl` e `bankSlipUrl` apontam, como o navegador chega neste servidor |
| `MAILPIT_URL` | *(vazio: e-mail desligado)* | Mailpit (`http://mailpit:8025`): e-mails ao pagador |
| `WHATSAPP_MOCK_URL` | *(vazio: WhatsApp desligado)* | O WhatsApp mock (`http://whatsapp:3010`): templates ao pagador |
| `WHATSAPP_PHONE_NUMBER_ID` | `5511400000000` | O número remetente no WhatsApp mock |
| `WHATSAPP_WABA_ID` | `100000000000001` | A WABA cuja biblioteca guarda os templates do pagador |
| `NOTIFY_CALLBACK_BASE_URL` | `http://localhost:<PORT>` | Este servidor como o WhatsApp mock o alcança (`http://asaas:45445` no compose) |
| `MAILPIT_UI_URL` · `WHATSAPP_UI_URL` | `http://localhost:8025` · `http://localhost:3010` | As duas telas, como o navegador as abre a partir de Integrações |
| `NOTIFY_FROM_EMAIL` | `notificacoes@asaas.localhost` | Remetente dos e-mails |
| `DATABASE_PATH` | `/data/asaas.db` | Monte um volume em `/data` para guardar |
| `TZ` | `America/Sao_Paulo` | |

## Rotas de administração

Não existem no Asaas: ficam fora de `/v3`, sem `access_token`, e desligam com
`ADMIN_ENABLED=false`.

| | |
|---|---|
| `GET /_admin/clock` · `POST /_admin/clock/advance` · `POST /_admin/clock/set` | O relógio: onde está, `{"days": 32}`, `{"date": "2026-08-01"}` |
| `POST /_admin/tick` | Roda os jobs sem mexer no relógio |
| `GET /_admin/accounts` · `POST /_admin/accounts` · `DELETE /_admin/accounts/:id` | Contas com saldo e chave que funciona; perfil novo; apagar com tudo que ele tem |
| `GET`, `POST /_admin/accounts/:id/keys` · `POST …/keys/:keyId/rotate` · `PUT`, `DELETE …/keys/:keyId` | Chaves de API |
| `GET /_admin/webhooks/events` · `GET /_admin/webhooks/deliveries` · `POST /_admin/webhooks/pause` | Eventos de webhook, o registro de entregas, congelar o despacho |
| `GET /_admin/test-cards` · `PUT /_admin/test-cards/policy` · `POST`, `DELETE /_admin/test-cards…` | Cartões de teste e a política de aceitar qualquer um |
| `GET`, `POST /_admin/notifications` · `GET /_admin/notify/status` · `GET /_admin/notify/arrivals` · `POST /_admin/notify/test` | Notificações ao pagador: enviadas, reenviar, saúde dos canais, o que chegou |
| `GET /_admin/coverage` · `GET /_admin/fees` | Operações com regra de negócio; a tabela de taxas |

## Fidelidade: provada, não prometida

As regras de negócio foram **capturadas do sandbox real do Asaas** e são
conferidas campo a campo por uma suíte de paridade:

```bash
bun run test:parity
```

`tools/capture.ts` roda os cenários no Asaas real e grava as respostas em
`tests/golden/`; a suíte repete os mesmos cenários no simulador e compara tudo
que não é legitimamente volátil, até **o conjunto exato de chaves de cada
objeto**. A captura derrubou 20 regras que tinham sido deduzidas da
documentação, entre elas: a assinatura cria a primeira cobrança na hora; a taxa
do parcelamento no cartão sai do total e a divisão trunca (R$ 350 em 12x dá
R$ 1,20 de taxa por parcela, não R$ 1,21); a parcela `n` credita em D+32×n; o
campo do desconto é `limitDate`, que a especificação nem declara.

As chamadas que uma aplicação real faz ao Asaas também foram testadas no
simulador e comparadas chave a chave com o sandbox, o que achou seis buracos
que uma suíte de contrato não via (o QR code do Pix, parcelamento por
`POST /v3/payments`, pagar com cartão já tokenizado…). Veja `progress.md`.

Para capturar de novo com a sua chave de **sandbox** (o script recusa qualquer
chave que não comece com `$aact_hmlg_`):

```bash
ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun run capture
bun run test:parity
```

## Desenvolvimento

```bash
bun install
bun run codegen        # especificação OpenAPI → TypeBox e o manifesto de operações
bun run db:generate    # migrações a partir do schema Drizzle
bun run dev
bun test
bun run e2e            # sobe o servidor, paga uma cobrança Pix, espera o PAYMENT_RECEIVED
bun run spec:diff      # o Asaas mudou a API?
```

Leia o [`AGENTS.md`](AGENTS.md) antes de contribuir: domínio puro, sem
`Date.now()`, dinheiro em centavos inteiros. Estado do projeto: `progress.md`.

## Licença e aviso

MIT, veja [LICENSE](LICENSE).

**Sem vínculo com o Asaas.** Um simulador independente da API pública deles,
para desenvolvimento local e testes. "Asaas" é marca de seus donos. **Não use
para movimentar dinheiro de verdade**: nenhum pagamento aqui é real.
