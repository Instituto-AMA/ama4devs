// @ts-check
/** @typedef {import('../operations.js').Operation} Operation */

/** The group of the native API operations. @type {{ pt: string, en: string }} */
const NATIVE_TAG = { pt: 'Envio nativo', en: 'Native API' }

/** The group of the simple API operations. @type {{ pt: string, en: string }} */
const SIMPLE_TAG = { pt: 'Envio simples', en: 'Simple API' }

/** The native API and the simple API: the routes an app calls to send and follow messages. @type {Operation[]} */
export const NATIVE_OPERATIONS = [
  {
    id: 'native-send',
    kind: 'api',
    tag: NATIVE_TAG,
    method: 'POST',
    path: '/v1/messages',
    summary: {
      pt: 'Envia uma mensagem SMS pela API JSON nativa.',
      en: 'Sends an SMS through the native JSON API.',
    },
    description: {
      pt: 'Cria uma mensagem a partir do corpo JSON e devolve o registro da mensagem recém-criada, ainda com o status `queued`. A partir daí o mock conduz o ciclo de vida sozinho: `queued`, `sent` e `delivered`, ou a falha que o número mágico prepara. Quando a requisição traz `callbackUrl`, cada mudança de status é publicada nesse endereço.',
      en: 'Creates a message from the JSON body and answers with the record of the message just created, still `queued`. From there the mock drives the lifecycle on its own: `queued`, `sent` and `delivered`, or the failure the magic number stages. When the request carries a `callbackUrl`, every status change is posted there.',
    },
    contentType: 'application/json',
    fields: [
      {
        name: 'to',
        required: true,
        type: 'string',
        description: {
          pt: 'Número do destinatário em E.164 (`+5511912340010`) ou no formato nacional (`11912340010`); o mock o normaliza para E.164.',
          en: 'The recipient number in E.164 (`+5511912340010`) or in the national form (`11912340010`); the mock normalizes it to E.164.',
        },
      },
      {
        name: 'body',
        required: true,
        type: 'string',
        description: {
          pt: 'Texto da mensagem, de 1 a 1600 caracteres.',
          en: 'The message text, from 1 to 1600 characters.',
        },
      },
      {
        name: 'from',
        type: 'string',
        description: {
          pt: 'Remetente em E.164 ou identificador alfanumérico de até 11 caracteres; sem ele, o mock usa o remetente padrão.',
          en: 'The sender in E.164 or an alphanumeric sender id of up to 11 characters; without it the mock uses the default sender.',
        },
      },
      {
        name: 'callbackUrl',
        type: 'string',
        description: {
          pt: 'Endereço http/https que recebe os eventos de status desta mensagem.',
          en: 'The http/https address that receives the status events of this message.',
        },
      },
    ],
    request: {
      path: '/v1/messages',
      json: {
        to: '+5511912340010',
        body: 'Seu código de verificação é 482913.',
        from: 'AMA4DEVS',
      },
    },
    responses: [
      {
        status: '201',
        description: {
          pt: 'A mensagem foi criada e entrou na fila; a resposta traz o registro completo, com o status `queued`.',
          en: 'The message was created and entered the queue; the answer carries the whole record, with the `queued` status.',
        },
      },
      {
        status: '400',
        request: { json: { to: 'abc', body: 'Oi' } },
        description: {
          pt: 'O `to` não é um número de telefone válido (`invalid_to`); a resposta traz o código, a mensagem e o campo com problema.',
          en: 'The `to` is not a valid phone number (`invalid_to`); the answer carries the code, the message and the field at fault.',
        },
      },
      {
        status: '400',
        request: { json: { to: '+5511912340003', body: 'Oi' } },
        description: {
          pt: 'O número termina em `0003`, o sufixo mágico que a API rejeita (`rejected_number`).',
          en: 'The number ends in `0003`, the magic suffix the API rejects (`rejected_number`).',
        },
      },
      {
        status: '400',
        request: { json: { to: '+5511912340010', body: '' } },
        description: {
          pt: 'O texto da mensagem é obrigatório (`empty_body`): o mock recusa o envio quando o corpo vem vazio.',
          en: 'The message text is required (`empty_body`): the mock refuses the send when the body comes empty.',
        },
      },
    ],
  },
  {
    id: 'native-list',
    kind: 'api',
    tag: NATIVE_TAG,
    method: 'GET',
    path: '/v1/messages',
    summary: {
      pt: 'Lista as mensagens do mock, com filtros e long polling.',
      en: 'Lists the messages of the mock, with filters and long polling.',
    },
    description: {
      pt: 'Devolve as mensagens que atendem aos filtros da query, na ordem em que foram criadas, e a contagem delas. Com `wait`, a resposta espera até 30 segundos pela primeira mensagem que case com os filtros, o que torna a rota útil para testes que esperam por um evento. A listagem responde 200 mesmo quando não há mensagem alguma.',
      en: 'Answers the messages that answer the query filters, in the order they were created, and how many there are. With `wait`, the answer waits up to 30 seconds for the first message that matches the filters, which makes the route useful for tests that wait for an event. The listing answers 200 even when there is no message at all.',
    },
    params: [
      {
        in: 'query',
        name: 'to',
        type: 'string',
        description: {
          pt: 'Mantém as mensagens enviadas para este número.',
          en: 'Keeps the messages sent to this number.',
        },
      },
      {
        in: 'query',
        name: 'from',
        type: 'string',
        description: {
          pt: 'Mantém as mensagens enviadas por este número ou identificador de remetente.',
          en: 'Keeps the messages sent from this number or sender id.',
        },
      },
      {
        in: 'query',
        name: 'number',
        type: 'string',
        description: {
          pt: 'Mantém as mensagens que têm este número de um dos dois lados, destinatário ou remetente.',
          en: 'Keeps the messages that have this number on either side, recipient or sender.',
        },
      },
      {
        in: 'query',
        name: 'status',
        type: 'string',
        description: {
          pt: 'Mantém as mensagens com este status: `queued`, `sent`, `delivered`, `undelivered`, `failed` ou `received`.',
          en: 'Keeps the messages with this status: `queued`, `sent`, `delivered`, `undelivered`, `failed` or `received`.',
        },
      },
      {
        in: 'query',
        name: 'direction',
        type: 'string',
        description: {
          pt: 'Mantém as mensagens de um sentido: `outbound` (do app para o aparelho) ou `inbound` (do aparelho para o app).',
          en: 'Keeps the messages of one direction: `outbound` (app to handset) or `inbound` (handset to app).',
        },
      },
      {
        in: 'query',
        name: 'q',
        type: 'string',
        description: {
          pt: 'Mantém as mensagens cujo texto, número ou código contenha este valor.',
          en: 'Keeps the messages whose text, numbers or codes contain this value.',
        },
      },
      {
        in: 'query',
        name: 'limit',
        type: 'integer',
        description: {
          pt: 'Quantidade máxima de mensagens na resposta; quando há mais, as mais recentes ficam.',
          en: 'The largest number of messages in the answer; when there are more, the newest ones stay.',
        },
      },
      {
        in: 'query',
        name: 'after',
        type: 'string',
        description: {
          pt: 'Identificador de uma mensagem: a lista traz só as mensagens criadas depois dela.',
          en: 'The id of a message: the list carries only the messages created after it.',
        },
      },
      {
        in: 'query',
        name: 'wait',
        type: 'integer',
        description: {
          pt: 'Espera, em milissegundos, pela primeira mensagem que atenda aos filtros; no máximo 30000.',
          en: 'Waits, in milliseconds, for the first message that answers the filters; 30000 at most.',
        },
      },
    ],
    request: {
      path: '/v1/messages',
      query: { to: '+5511912340010', limit: '10' },
    },
    responses: [
      {
        status: '200',
        description: {
          pt: 'A lista das mensagens que atendem aos filtros e a quantidade delas; sem mensagens, a lista vem vazia e o `count` vale zero.',
          en: 'The list of the messages that answer the filters and how many there are; with no message, the list comes empty and `count` is zero.',
        },
      },
    ],
  },
  {
    id: 'native-get',
    kind: 'api',
    tag: NATIVE_TAG,
    method: 'GET',
    path: '/v1/messages/{id}',
    summary: {
      pt: 'Busca uma mensagem pelo identificador.',
      en: 'Fetches one message by its id.',
    },
    description: {
      pt: 'Devolve a mensagem pedida com o corpo, o status atual e o histórico das mudanças de status. O identificador é o `SM` seguido de 32 dígitos hexadecimais, o mesmo que a criação e a listagem devolvem. Quando o mock não conhece o identificador, a resposta é 404.',
      en: 'Answers the requested message with its body, its current status and the history of its status changes. The id is `SM` followed by 32 hexadecimal digits, the same one the creation and the listing return. When the mock does not know the id, the answer is 404.',
    },
    params: [
      {
        in: 'path',
        name: 'id',
        required: true,
        type: 'string',
        description: {
          pt: 'Identificador da mensagem: `SM` seguido de 32 dígitos hexadecimais.',
          en: 'The id of the message: `SM` followed by 32 hexadecimal digits.',
        },
      },
    ],
    request: { path: '/v1/messages/{messageId}' },
    setup: 'message',
    responses: [
      {
        status: '200',
        description: {
          pt: 'A mensagem pedida, com o corpo, o status atual e o histórico das mudanças de status.',
          en: 'The requested message, with the body, the current status and the history of the status changes.',
        },
      },
      {
        status: '404',
        request: { path: '/v1/messages/SM00000000000000000000000000000000' },
        description: {
          pt: 'O mock não tem mensagem com esse identificador (`not_found`), que pode ter sido removida antes.',
          en: 'The mock has no message with that id (`not_found`), which may have been deleted before.',
        },
      },
    ],
  },
  {
    id: 'native-delete',
    kind: 'api',
    tag: NATIVE_TAG,
    method: 'DELETE',
    path: '/v1/messages/{id}',
    summary: {
      pt: 'Apaga uma mensagem pelo identificador.',
      en: 'Deletes one message by its id.',
    },
    description: {
      pt: 'Remove a mensagem do mock e responde 204, sem corpo. A mensagem some da listagem e o painel deixa de mostrá-la. Quando o identificador não existe, a resposta é 404 e nada é apagado.',
      en: 'Removes the message from the mock and answers 204, with no body. The message leaves the listing and the panel stops showing it. When the id does not exist, the answer is 404 and nothing is deleted.',
    },
    params: [
      {
        in: 'path',
        name: 'id',
        required: true,
        type: 'string',
        description: {
          pt: 'Identificador da mensagem: `SM` seguido de 32 dígitos hexadecimais.',
          en: 'The id of the message: `SM` followed by 32 hexadecimal digits.',
        },
      },
    ],
    request: { path: '/v1/messages/{messageId}' },
    setup: 'message',
    responses: [
      {
        status: '204',
        description: {
          pt: 'A mensagem foi apagada; a resposta vem sem corpo.',
          en: 'The message was deleted; the answer comes with no body.',
        },
      },
      {
        status: '404',
        request: { path: '/v1/messages/SM00000000000000000000000000000000' },
        description: {
          pt: 'Não há mensagem com esse identificador (`not_found`), então nada é apagado.',
          en: 'There is no message with that id (`not_found`), so nothing was deleted.',
        },
      },
    ],
  },
  {
    id: 'simple-send-get',
    kind: 'api',
    tag: SIMPLE_TAG,
    method: 'GET',
    path: '/sms/send',
    summary: {
      pt: 'Envia uma mensagem pela API simples, com os parâmetros na query.',
      en: 'Sends a message through the simple API, with the parameters in the query.',
    },
    description: {
      pt: 'É a forma mais curta de enviar uma mensagem: os parâmetros vão na query e a resposta traz o status, o identificador, o destinatário normalizado e a quantidade de segmentos. A mensagem entra na fila como `queued` e segue o mesmo ciclo de vida das demais APIs. Quando um campo está errado, a resposta vem como `status: error`, com o código e a mensagem do erro.',
      en: 'It is the shortest way to send a message: the parameters travel in the query and the answer carries the status, the id, the normalized recipient and the number of segments. The message enters the queue as `queued` and follows the same lifecycle as the other APIs. When a field is wrong, the answer comes as `status: error`, with the code and the message of the error.',
    },
    params: [
      {
        in: 'query',
        name: 'to',
        required: true,
        type: 'string',
        description: {
          pt: 'Número do destinatário em E.164 (`+5511912340010`) ou no formato nacional (`11912340010`).',
          en: 'The recipient number in E.164 (`+5511912340010`) or in the national form (`11912340010`).',
        },
      },
      {
        in: 'query',
        name: 'message',
        required: true,
        type: 'string',
        description: {
          pt: 'Texto da mensagem, de 1 a 1600 caracteres; `text` e `body` são apelidos deste campo.',
          en: 'The message text, from 1 to 1600 characters; `text` and `body` are aliases of this field.',
        },
      },
      {
        in: 'query',
        name: 'sender',
        type: 'string',
        description: {
          pt: 'Remetente em E.164 ou identificador alfanumérico de até 11 caracteres; `from` é o apelido.',
          en: 'The sender in E.164 or an alphanumeric sender id of up to 11 characters; `from` is its alias.',
        },
      },
      {
        in: 'query',
        name: 'callbackUrl',
        type: 'string',
        description: {
          pt: 'Endereço http/https que recebe os eventos de status desta mensagem.',
          en: 'The http/https address that receives the status events of this message.',
        },
      },
    ],
    request: {
      path: '/sms/send',
      query: { to: '11912340010', message: 'Pedido #4821 saiu para entrega', sender: 'LOJA' },
    },
    responses: [
      {
        status: '200',
        description: {
          pt: 'A mensagem foi aceita; a resposta traz `status`, o identificador, o destinatário normalizado e a quantidade de segmentos.',
          en: 'The message was accepted; the answer carries `status`, the id, the normalized recipient and the number of segments.',
        },
      },
      {
        status: '400',
        request: { query: { to: 'abc', message: 'Oi' } },
        description: {
          pt: 'O destinatário não é um número válido (`invalid_to`); a resposta vem como `status: error`, com o código e a mensagem do erro.',
          en: 'The recipient is not a valid number (`invalid_to`); the answer comes as `status: error`, with the code and the message of the error.',
        },
      },
    ],
  },
  {
    id: 'simple-send-post',
    kind: 'api',
    tag: SIMPLE_TAG,
    method: 'POST',
    path: '/sms/send',
    summary: {
      pt: 'Envia uma mensagem pela API simples, com os parâmetros no corpo.',
      en: 'Sends the message through the simple API, with the parameters in the body.',
    },
    description: {
      pt: 'O mesmo envio da versão GET, com `to`, `message`, `sender` e `callbackUrl` no corpo JSON (um formulário urlencoded também vale). Quando a requisição traz corpo e query ao mesmo tempo, o corpo tem a precedência. A resposta traz o status, o identificador, o destinatário normalizado e a quantidade de segmentos, e a mensagem segue o ciclo de vida da fila.',
      en: 'The same send as the GET version, with `to`, `message`, `sender` and `callbackUrl` in the JSON body (a urlencoded form works too). When a request carries both a body and a query, the body wins. The answer carries the status, the id, the normalized recipient and the number of segments, and the message follows the lifecycle of the queue.',
    },
    contentType: 'application/json',
    fields: [
      {
        name: 'to',
        required: true,
        type: 'string',
        description: {
          pt: 'Número do destinatário em E.164 (`+5511912340010`) ou no formato nacional (`11912340010`).',
          en: 'The recipient number in E.164 (`+5511912340010`) or in the national form (`11912340010`).',
        },
      },
      {
        name: 'message',
        required: true,
        type: 'string',
        description: {
          pt: 'Texto da mensagem, de 1 a 1600 caracteres; `text` e `body` são apelidos deste campo.',
          en: 'The message text, from 1 to 1600 characters; `text` and `body` are aliases of this field.',
        },
      },
      {
        name: 'sender',
        type: 'string',
        description: {
          pt: 'Remetente em E.164 ou identificador alfanumérico de até 11 caracteres; `from` é o apelido.',
          en: 'The sender in E.164 or an alphanumeric sender id of up to 11 characters; `from` is its alias.',
        },
      },
      {
        name: 'callbackUrl',
        type: 'string',
        description: {
          pt: 'Endereço http/https que recebe os eventos de status desta mensagem.',
          en: 'The http/https address that receives the status events of this message.',
        },
      },
    ],
    request: {
      path: '/sms/send',
      json: { to: '11912340010', message: 'Código 482913', sender: 'AMA4DEVS' },
    },
    responses: [
      {
        status: '200',
        description: {
          pt: 'A mensagem foi aceita; a resposta traz `status`, o identificador, o destinatário normalizado e a quantidade de segmentos.',
          en: 'The message was accepted; the answer carries `status`, the id, the normalized recipient and the number of segments.',
        },
      },
      {
        status: '400',
        request: { json: { to: '11912340010' } },
        description: {
          pt: 'O corpo não traz o texto da mensagem (`empty_body`); no POST, o corpo tem a precedência sobre a query.',
          en: 'The body carries no message text (`empty_body`); on POST the body wins over the query.',
        },
      },
    ],
  },
]
