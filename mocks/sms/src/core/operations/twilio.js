// @ts-check
/** @typedef {import('../operations.js').Operation} Operation */

/** The account sid every example uses: a fake, the same the mock puts in webhooks. */
const ACCOUNT_SID = 'ACmock00000000000000000000000000'

/** The Twilio-compatible operations: the paths a Twilio SDK calls. @type {Operation[]} */
export const TWILIO_OPERATIONS = [
  {
    id: 'twilio-send',
    kind: 'api',
    tag: { pt: 'Compatível com Twilio', en: 'Twilio-compatible' },
    method: 'POST',
    path: '/2010-04-01/Accounts/{AccountSid}/Messages.json',
    summary: {
      pt: 'Envia uma mensagem no formato de formulário do Twilio',
      en: 'Sends a message in the Twilio form format',
    },
    description: {
      pt: 'Cria uma mensagem a partir dos campos `To`, `From`, `Body` e `StatusCallback` e devolve o recurso no formato do Twilio, com as datas em RFC 2822. Sem `From`, vale o remetente padrão das configurações.',
      en: 'Creates a message from the `To`, `From`, `Body` and `StatusCallback` fields and answers the resource in the Twilio shape, with the dates in RFC 2822. Without a `From`, the default sender of the settings is used.',
    },
    contentType: 'application/x-www-form-urlencoded',
    params: [
      {
        in: 'path',
        name: 'AccountSid',
        required: true,
        type: 'string',
        description: {
          pt: 'A conta que assina o pedido; o mock ignora esse valor.',
          en: 'The account that signs the request; the mock ignores this value.',
        },
      },
    ],
    fields: [
      {
        name: 'To',
        required: true,
        type: 'string',
        description: {
          pt: 'O número que recebe a mensagem, no formato E.164.',
          en: 'The number that receives the message, in the E.164 format.',
        },
      },
      {
        name: 'From',
        type: 'string',
        description: {
          pt: 'O remetente: um número E.164 ou um nome alfanumérico de até 11 caracteres.',
          en: 'The sender: an E.164 number or an alphanumeric sender id of up to 11 characters.',
        },
      },
      {
        name: 'MessagingServiceSid',
        type: 'string',
        description: {
          pt: 'O serviço de mensageria no lugar do `From`; sem `From`, vale o remetente padrão.',
          en: 'The messaging service in place of `From`; without a `From`, the default sender is used.',
        },
      },
      {
        name: 'Body',
        required: true,
        type: 'string',
        description: {
          pt: 'O texto da mensagem, com até 1600 caracteres.',
          en: 'The text of the message, up to 1600 characters.',
        },
      },
      {
        name: 'StatusCallback',
        type: 'string',
        description: {
          pt: 'O endereço que recebe os webhooks de status desta mensagem.',
          en: 'The URL that receives the status webhooks of this message.',
        },
      },
    ],
    request: {
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      form: {
        To: '+5511912340010',
        From: 'AMA4DEVS',
        Body: 'Seu código é 482913',
      },
      auth: 'basic',
    },
    responses: [
      {
        status: '201',
        description: {
          pt: 'A mensagem foi criada e o recurso no formato do Twilio volta na resposta.',
          en: 'The message was created and the resource in the Twilio shape comes back in the answer.',
        },
      },
      {
        status: '400',
        request: { form: { To: 'abc', Body: 'Oi' } },
        description: {
          pt: 'O número de destino não é E.164: o erro 21211 volta no formato do Twilio.',
          en: 'The destination number is not E.164: the 21211 error comes back in the Twilio shape.',
        },
      },
      {
        status: '400',
        request: { form: { To: '+5511912340010', Body: '' } },
        description: {
          pt: 'O corpo da mensagem é obrigatório: o erro 21602 volta no formato do Twilio.',
          en: 'The body of the message is required: the 21602 error comes back in the Twilio shape.',
        },
      },
      {
        status: '400',
        request: { form: { To: '+5511912340010', From: '!!!', Body: 'Oi' } },
        description: {
          pt: 'O remetente não é E.164 nem alfanumérico: o erro 21212 volta no formato do Twilio.',
          en: 'The sender is neither E.164 nor alphanumeric: the 21212 error comes back in the Twilio shape.',
        },
      },
    ],
  },
  {
    id: 'twilio-list',
    kind: 'api',
    tag: { pt: 'Compatível com Twilio', en: 'Twilio-compatible' },
    method: 'GET',
    path: '/2010-04-01/Accounts/{AccountSid}/Messages.json',
    summary: {
      pt: 'Lista as mensagens no formato do Twilio',
      en: 'Lists the messages in the Twilio shape',
    },
    description: {
      pt: 'Devolve as mensagens mais recentes primeiro, filtradas por `To` e `From`, com os campos de paginação que um cliente Twilio lê. `PageSize` vale 50 por padrão e no máximo 1000.',
      en: 'Answers the newest messages first, narrowed by `To` and `From`, with the paging fields a Twilio client reads. `PageSize` is 50 by default and at most 1000.',
    },
    params: [
      {
        in: 'path',
        name: 'AccountSid',
        required: true,
        type: 'string',
        description: {
          pt: 'A conta que assina o pedido; o mock ignora esse valor.',
          en: 'The account that signs the request; the mock ignores this value.',
        },
      },
      {
        in: 'query',
        name: 'To',
        type: 'string',
        description: {
          pt: 'Filtra pelas mensagens enviadas para este número.',
          en: 'Filters the messages sent to this number.',
        },
      },
      {
        in: 'query',
        name: 'From',
        type: 'string',
        description: {
          pt: 'Filtra pelas mensagens enviadas deste remetente.',
          en: 'Filters the messages sent from this sender.',
        },
      },
      {
        in: 'query',
        name: 'PageSize',
        type: 'string',
        description: {
          pt: 'Quantas mensagens a página traz: 50 por padrão, no máximo 1000.',
          en: 'How many messages the page holds: 50 by default, at most 1000.',
        },
      },
    ],
    request: {
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      query: { To: '+5511912340010', PageSize: '50' },
      auth: 'basic',
    },
    responses: [
      {
        status: '200',
        description: {
          pt: 'A página das mensagens volta no formato do Twilio, com a contagem e os links de página.',
          en: 'The page of messages comes back in the Twilio shape, with the count and the page links.',
        },
      },
    ],
  },
  {
    id: 'twilio-get',
    kind: 'api',
    tag: { pt: 'Compatível com Twilio', en: 'Twilio-compatible' },
    method: 'GET',
    path: '/2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json',
    summary: {
      pt: 'Lê uma mensagem pelo seu sid',
      en: 'Reads one message by its sid',
    },
    description: {
      pt: 'Devolve uma mensagem no formato do Twilio. Um sid que o mock não conhece volta como o erro 20404.',
      en: 'Answers one message in the Twilio shape. A sid the mock does not know comes back as the 20404 error.',
    },
    params: [
      {
        in: 'path',
        name: 'AccountSid',
        required: true,
        type: 'string',
        description: {
          pt: 'A conta que assina o pedido; o mock ignora esse valor.',
          en: 'The account that signs the request; the mock ignores this value.',
        },
      },
      {
        in: 'path',
        name: 'MessageSid',
        required: true,
        type: 'string',
        description: {
          pt: 'O sid da mensagem que se quer ler.',
          en: 'The sid of the message to read.',
        },
      },
    ],
    setup: 'message',
    request: {
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/{messageId}.json`,
      auth: 'basic',
    },
    responses: [
      {
        status: '200',
        description: {
          pt: 'A mensagem volta no formato do Twilio.',
          en: 'The message comes back in the Twilio shape.',
        },
      },
      {
        status: '404',
        request: {
          path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/SMunknown00000000000000000000000000.json`,
        },
        description: {
          pt: 'O sid não existe: o erro 20404 volta no formato do Twilio.',
          en: 'The sid does not exist: the 20404 error comes back in the Twilio shape.',
        },
      },
    ],
  },
  {
    id: 'twilio-delete',
    kind: 'api',
    tag: { pt: 'Compatível com Twilio', en: 'Twilio-compatible' },
    method: 'DELETE',
    path: '/2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json',
    summary: {
      pt: 'Apaga uma mensagem pelo seu sid',
      en: 'Deletes one message by its sid',
    },
    description: {
      pt: 'Tira a mensagem do mock. Um sid que o mock não conhece volta como o erro 20404.',
      en: 'Takes the message out of the mock. A sid the mock does not know comes back as the 20404 error.',
    },
    params: [
      {
        in: 'path',
        name: 'AccountSid',
        required: true,
        type: 'string',
        description: {
          pt: 'A conta que assina o pedido; o mock ignora esse valor.',
          en: 'The account that signs the request; the mock ignores this value.',
        },
      },
      {
        in: 'path',
        name: 'MessageSid',
        required: true,
        type: 'string',
        description: {
          pt: 'O sid da mensagem que se quer apagar.',
          en: 'The sid of the message to delete.',
        },
      },
    ],
    setup: 'message',
    request: {
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/{messageId}.json`,
      auth: 'basic',
    },
    responses: [
      {
        status: '204',
        description: {
          pt: 'A mensagem foi apagada; a resposta não tem corpo.',
          en: 'The message was deleted; the answer has no body.',
        },
      },
      {
        status: '404',
        request: {
          path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/SMunknown00000000000000000000000000.json`,
        },
        description: {
          pt: 'O sid não existe: o erro 20404 volta no formato do Twilio.',
          en: 'The sid does not exist: the 20404 error comes back in the Twilio shape.',
        },
      },
    ],
  },
]
