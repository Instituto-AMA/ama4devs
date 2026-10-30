// @ts-check
/** @typedef {import('../operations.js').Operation} Operation */

/** The operations only a test or the panel calls: the control routes, the health check and the live feed. @type {Operation[]} */
export const MOCK_OPERATIONS = [
  {
    id: 'mock-settings-get',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'GET',
    path: '/_mock/sms/settings',
    summary: {
      pt: 'Lê as configurações do mock',
      en: 'Reads the settings of the mock',
    },
    description: {
      pt: 'Devolve as configurações de execução: o atraso de entrega, a entrega automática, o endereço e o segredo do webhook e o remetente padrão.',
      en: 'Answers the runtime settings: the delivery delay, the automatic delivery, the webhook URL and secret and the default sender.',
    },
    request: { path: '/_mock/sms/settings' },
    responses: [
      {
        status: '200',
        description: {
          pt: 'As configurações atuais voltam em JSON.',
          en: 'The current settings come back as JSON.',
        },
      },
    ],
  },
  {
    id: 'mock-settings-put',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'PUT',
    path: '/_mock/sms/settings',
    summary: {
      pt: 'Muda uma parte das configurações do mock',
      en: 'Changes part of the settings of the mock',
    },
    description: {
      pt: 'Aplica uma mudança parcial: só os campos enviados mudam e os outros ficam como estavam. Um valor do tipo errado recusa a mudança inteira.',
      en: 'Applies a partial change: only the sent fields change and the others stay as they were. A value of the wrong type refuses the whole change.',
    },
    fields: [
      {
        name: 'deliveryDelayMs',
        type: 'number',
        description: {
          pt: 'O tempo entre o `queued` e o `delivered`, em milissegundos: de 0 a 2147483647.',
          en: 'The time between `queued` and `delivered`, in milliseconds: from 0 to 2147483647.',
        },
      },
      {
        name: 'autoDeliver',
        type: 'boolean',
        description: {
          pt: 'Quando é falso, a mensagem fica no `queued` até alguém mudar o status à mão.',
          en: 'When false, the message stays in `queued` until someone changes the status by hand.',
        },
      },
      {
        name: 'webhookUrl',
        type: 'string',
        description: {
          pt: 'O endereço que recebe os eventos de status e de entrada; vazio, nenhum webhook sai.',
          en: 'The URL that receives the status and inbound events; empty, no webhook goes out.',
        },
      },
      {
        name: 'webhookSecret',
        type: 'string',
        description: {
          pt: 'O segredo que assina o corpo do webhook com HMAC-SHA256; vazio, o webhook sai sem assinatura.',
          en: 'The secret that signs the webhook body with HMAC-SHA256; empty, the webhook goes out unsigned.',
        },
      },
      {
        name: 'defaultFrom',
        type: 'string',
        description: {
          pt: 'O remetente usado quando o pedido não nomeia um.',
          en: 'The sender used when the request names none.',
        },
      },
    ],
    request: {
      path: '/_mock/sms/settings',
      json: { deliveryDelayMs: 1500, autoDeliver: true },
    },
    responses: [
      {
        status: '200',
        description: {
          pt: 'As configurações já com a mudança aplicada voltam em JSON.',
          en: 'The settings with the change applied come back as JSON.',
        },
      },
      {
        status: '400',
        request: { json: { deliveryDelayMs: 'logo' } },
        description: {
          pt: 'O atraso não é um número inteiro: o erro `invalid_settings` recusa a mudança.',
          en: 'The delay is not an integer: the `invalid_settings` error refuses the change.',
        },
      },
    ],
  },
  {
    id: 'mock-inbound',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'POST',
    path: '/_mock/sms/inbound',
    summary: {
      pt: 'Escreve uma resposta de entrada, como o aparelho faria',
      en: 'Writes an inbound reply, as the handset would',
    },
    description: {
      pt: 'Guarda a mensagem que o aparelho recebeu, com a direção `inbound` e o status `received`, e dispara o webhook de entrada. Sem `to`, vale o remetente padrão.',
      en: 'Stores the message the handset received, with the `inbound` direction and the `received` status, and fires the inbound webhook. Without a `to`, the default sender is used.',
    },
    fields: [
      {
        name: 'from',
        required: true,
        type: 'string',
        description: {
          pt: 'O número que escreveu a mensagem, no formato E.164.',
          en: 'The number that wrote the message, in the E.164 format.',
        },
      },
      {
        name: 'to',
        type: 'string',
        description: {
          pt: 'O número que recebeu a mensagem; sem ele, vale o remetente padrão.',
          en: 'The number that received the message; without it, the default sender is used.',
        },
      },
      {
        name: 'body',
        required: true,
        type: 'string',
        description: {
          pt: 'O texto da mensagem, com até 1600 caracteres.',
          en: 'The text of the message, up to 1600 characters.',
        },
      },
    ],
    request: {
      path: '/_mock/sms/inbound',
      json: { from: '+5511912340010', body: 'CONFIRMAR' },
    },
    responses: [
      {
        status: '201',
        description: {
          pt: 'A mensagem de entrada foi guardada e volta como criada.',
          en: 'The inbound message was stored and comes back as created.',
        },
      },
      {
        status: '400',
        request: { json: { from: 'abc', body: 'Oi' } },
        description: {
          pt: 'O número de origem não é E.164: o erro `invalid_from` recusa a mensagem.',
          en: 'The origin number is not E.164: the `invalid_from` error refuses the message.',
        },
      },
    ],
  },
  {
    id: 'mock-status',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'POST',
    path: '/_mock/sms/messages/{id}/status',
    summary: {
      pt: 'Muda o status de uma mensagem à mão',
      en: 'Changes the status of one message by hand',
    },
    description: {
      pt: 'Move uma mensagem de saída para o status pedido e avisa o webhook. `errorCode` é opcional e entra no erro da falha.',
      en: 'Moves an outbound message to the status asked for and tells the webhook. `errorCode` is optional and goes into the error of the failure.',
    },
    params: [
      {
        in: 'path',
        name: 'id',
        required: true,
        type: 'string',
        description: {
          pt: 'O id da mensagem que vai mudar de status.',
          en: 'The id of the message that changes status.',
        },
      },
    ],
    fields: [
      {
        name: 'status',
        required: true,
        type: 'string',
        description: {
          pt: 'O status novo: `sent`, `delivered`, `undelivered` ou `failed`.',
          en: 'The new status: `sent`, `delivered`, `undelivered` or `failed`.',
        },
      },
      {
        name: 'errorCode',
        type: 'number',
        description: {
          pt: 'O código do erro da falha; sem ele, cada status traz o seu.',
          en: 'The code of the failure; without it, each status carries its own.',
        },
      },
    ],
    setup: 'message',
    request: {
      path: '/_mock/sms/messages/{messageId}/status',
      json: { status: 'delivered' },
    },
    responses: [
      {
        status: '200',
        description: {
          pt: 'A mensagem com o status novo volta em JSON.',
          en: 'The message with the new status comes back as JSON.',
        },
      },
      {
        status: '400',
        request: { json: { status: 'lost' } },
        description: {
          pt: 'O status não é um dos quatro permitidos: o erro `invalid_status` recusa a mudança.',
          en: 'The status is not one of the four allowed: the `invalid_status` error refuses the change.',
        },
      },
      {
        status: '404',
        request: { path: '/_mock/sms/messages/SMunknown00000000000000000000000000/status' },
        description: {
          pt: 'O id não existe: o erro `not_found` devolve a mensagem como desconhecida.',
          en: 'The id does not exist: the `not_found` error answers that the message is unknown.',
        },
      },
    ],
  },
  {
    id: 'mock-reset',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'POST',
    path: '/_mock/sms/reset',
    summary: {
      pt: 'Limpa as mensagens e o log de webhooks',
      en: 'Clears the messages and the webhook log',
    },
    description: {
      pt: 'Apaga todas as mensagens e todas as tentativas de webhook; o mock volta como se tivesse acabado de subir.',
      en: 'Drops every message and every webhook attempt; the mock goes back to how it looked when it started.',
    },
    request: { path: '/_mock/sms/reset' },
    responses: [
      {
        status: '204',
        description: {
          pt: 'O mock foi limpo; a resposta não tem corpo.',
          en: 'The mock was cleared; the answer has no body.',
        },
      },
    ],
  },
  {
    id: 'mock-deliveries',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'GET',
    path: '/_mock/sms/webhooks/deliveries',
    summary: {
      pt: 'Lista as tentativas de webhook',
      en: 'Lists the webhook attempts',
    },
    description: {
      pt: 'Devolve as últimas tentativas de postar um webhook, com o endereço, o resultado e o corpo que foi enviado.',
      en: 'Answers the last attempts to post a webhook, with the URL, the result and the body that was sent.',
    },
    request: { path: '/_mock/sms/webhooks/deliveries' },
    responses: [
      {
        status: '200',
        description: {
          pt: 'A lista das tentativas volta em JSON, da mais recente para a mais antiga.',
          en: 'The list of attempts comes back as JSON, newest first.',
        },
      },
    ],
  },
  {
    id: 'mock-deliveries-clear',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'DELETE',
    path: '/_mock/sms/webhooks/deliveries',
    summary: {
      pt: 'Esvazia o log de webhooks',
      en: 'Empties the webhook log',
    },
    description: {
      pt: 'Apaga as tentativas registradas; as mensagens continuam no mock.',
      en: 'Drops the recorded attempts; the messages stay in the mock.',
    },
    request: { path: '/_mock/sms/webhooks/deliveries' },
    responses: [
      {
        status: '204',
        description: {
          pt: 'O log foi esvaziado; a resposta não tem corpo.',
          en: 'The log was emptied; the answer has no body.',
        },
      },
    ],
  },
  {
    id: 'mock-demo',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'POST',
    path: '/_mock/sms/demo',
    summary: {
      pt: 'Popula a caixa de entrada com mensagens de exemplo',
      en: 'Fills the inbox with sample messages',
    },
    description: {
      pt: 'Semeia uma caixa de entrada de exemplo: um código de banco e a resposta, um aviso de entrega, uma promoção longa e um número que sempre falha. As mensagens de saída passam pelo ciclo de vida real.',
      en: 'Seeds a sample inbox: a bank code and the reply, a delivery notice, a long promotion and a number that always fails. The outbound messages go through the real lifecycle.',
    },
    request: { path: '/_mock/sms/demo' },
    responses: [
      {
        status: '201',
        description: {
          pt: 'As mensagens de exemplo foram criadas e voltam em JSON.',
          en: 'The sample messages were created and come back as JSON.',
        },
      },
    ],
  },
  {
    id: 'health',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'GET',
    path: '/health',
    summary: {
      pt: 'Confere se o mock está de pé',
      en: 'Checks that the mock is up',
    },
    description: {
      pt: 'A única rota que qualquer página pode chamar: devolve o estado do serviço e a versão, sem exigir chave nem host local.',
      en: 'The one route any page may call: it answers the state of the service and the version, asking for no key and no local host.',
    },
    request: { path: '/health' },
    responses: [
      {
        status: '200',
        description: {
          pt: 'O serviço responde `status`, `service` e `version` em JSON.',
          en: 'The service answers `status`, `service` and `version` as JSON.',
        },
      },
    ],
  },
  {
    id: 'mock-ws',
    kind: 'mock',
    tag: { pt: 'Controle do mock', en: 'Mock control' },
    method: 'GET',
    path: '/ws',
    summary: {
      pt: 'Acompanha o mock em tempo real por WebSocket',
      en: 'Follows the mock live over a WebSocket',
    },
    description: {
      pt: 'A conexão começa com um quadro `snapshot` (mensagens, configurações, entregas e versão) e depois recebe os eventos do mock: `message.created`, `message.updated`, `message.deleted`, `reset`, `settings.updated`, `delivery` e `deliveries.cleared`. O `/ws` e o `GET /sms/send` recusam uma origem estrangeira.',
      en: 'The connection starts with a `snapshot` frame (messages, settings, deliveries and version) and then receives the events of the mock: `message.created`, `message.updated`, `message.deleted`, `reset`, `settings.updated`, `delivery` and `deliveries.cleared`. `/ws` and `GET /sms/send` refuse a foreign Origin.',
    },
    request: null,
    responses: [
      {
        status: '101',
        description: {
          pt: 'A conexão sobe para WebSocket e os quadros começam a chegar.',
          en: 'The connection upgrades to a WebSocket and the frames start to arrive.',
        },
      },
    ],
  },
]
