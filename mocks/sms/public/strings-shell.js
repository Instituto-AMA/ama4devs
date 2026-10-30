// @ts-check
/**
 * The strings of the shell of the panel: the header, the sidebar, the chat,
 * the thread, the composer and the details drawer, in Brazilian Portuguese and
 * in English.
 *
 * The module registers its strings when it is imported, so every `t()` of the
 * panel finds them.
 */

import { registerStrings } from './i18n.js'

registerStrings({
  pt: {
    // Connection of the live socket.
    'conn.connecting': 'conectando…',
    'conn.open': 'ao vivo',
    'conn.closed': 'reconectando…',

    // Header and dialog buttons.
    'shell.sender': 'Remetente',
    'shell.allSenders': 'Todos os remetentes',
    'shell.search': 'Buscar conversa',
    'shell.new': 'Nova mensagem',
    'shell.tools': 'Painel de controle',
    'shell.close': 'Fechar',
    'shell.cancel': 'Cancelar',
    'shell.conversations': 'Conversas',
    'shell.language': 'Idioma',
    'shell.filters': 'Filtros',

    // Filters of the sidebar.
    'filter.all': 'Tudo',
    'filter.noreply': 'Sem resposta',
    'filter.failed': 'Com falha',

    // Empty state of the chat.
    'empty.title': 'Conversas do mock',
    'empty.lead':
      'Os SMS que a aplicação envia pela API aparecem aqui, com o ciclo de entrega: na fila, enviada, entregue.',
    'empty.lead2':
      'Para testar a entrada, responda como o celular: a mensagem chega à aplicação pelo webhook.',
    'empty.new': 'Nova mensagem de teste',
    'empty.demo': 'Carregar exemplos',
    'empty.tools': 'Abrir painel de controle',

    // The chat on screen.
    'chat.back': 'Voltar para a lista',
    'chat.details': 'Detalhes da mensagem',
    'chat.sub': '{count} mensagens · celular simulado',
    'chat.subOne': '{count} mensagem · celular simulado',

    // The composer of the reply.
    'composer.placeholder': 'Responder como o celular…',
    'composer.send': 'Enviar',
    'composer.counter': '{length}/{perSegment} · {encoding} · {segments} SMS',

    // The drawer of the details.
    'details.title': 'Detalhes da mensagem',
    'details.id': 'ID',
    'details.status': 'Status',
    'details.api': 'API',
    'details.encoding': 'Codificação',
    'details.segments': 'Segmentos',
    'details.from': 'De',
    'details.to': 'Para',
    'details.error': 'Erro',
    'details.created': 'Criada',
    'details.sent': 'Enviada',
    'details.delivered': 'Entregue',
    'details.history': 'Histórico de status',
    'details.empty': 'Nenhuma mensagem selecionada',

    // The dialog of the new message.
    'new.title': 'Nova mensagem de teste',
    'new.hint':
      'Envia pela API, como a sua aplicação faria: a mensagem chega no celular e segue o ciclo de entrega.',
    'new.to': 'Para',
    'new.from': 'De',
    'new.body': 'Mensagem',
    'new.bodyPlaceholder': 'Seu código é 482913',
    'new.submit': 'Enviar',

    // The control panel on top of the app.
    'tools.title': 'Painel de controle',
    'tools.delivery': 'Entrega',
    'tools.webhook': 'Webhook',
    'tools.events': 'Eventos',
    'tools.magic': 'Números mágicos',
    'tools.api': 'API',

    // The status of a message.
    'status.queued': 'Na fila',
    'status.sent': 'Enviada',
    'status.delivered': 'Entregue',
    'status.undelivered': 'Não entregue',
    'status.failed': 'Falhou',
    'status.received': 'Recebida',

    // The bubbles of the thread.
    'bubble.fromPhone': 'Enviada pelo celular',
    'bubble.error': 'erro {code}',
    'bubble.segments': '{count} SMS · {encoding}',

    // The actions of a message.
    'action.deliver': 'Entregar',
    'action.fail': 'Falhar',
    'action.undeliver': 'Não entregue',
    'action.delete': 'Apagar',
    'confirm.delete': 'Apagar esta mensagem?',

    // The days of the thread and of the list.
    'day.today': 'Hoje',
    'day.yesterday': 'Ontem',

    // The list of conversations.
    'list.empty': 'Nenhum SMS ainda',
    'list.emptyHint': 'Envie pela API ou toque em Carregar exemplos.',
    'list.you': 'Você: ',

    // The thread of a conversation.
    'thread.empty': 'Nenhuma mensagem',
    'thread.emptyHint': 'Envie um SMS para começar a conversa.',

    // The messages the panel shows on the corner.
    'toast.copied': 'Código copiado',
    'toast.copyFailed': 'Não foi possível copiar o código',
    'toast.sent': 'SMS enviado',
    'toast.demo': 'Exemplos criados',
    'toast.invalidNumber': 'Número inválido: use +55 11 91234-5678',
    'toast.emptyBody': 'Escreva a mensagem antes de enviar',
  },

  en: {
    // Connection of the live socket.
    'conn.connecting': 'connecting…',
    'conn.open': 'live',
    'conn.closed': 'reconnecting…',

    // Header and dialog buttons.
    'shell.sender': 'Sender',
    'shell.allSenders': 'All senders',
    'shell.search': 'Search conversations',
    'shell.new': 'New message',
    'shell.tools': 'Control panel',
    'shell.close': 'Close',
    'shell.conversations': 'Conversations',
    'shell.language': 'Language',
    'shell.filters': 'Filters',
    'shell.cancel': 'Cancel',

    // Filters of the sidebar.
    'filter.all': 'All',
    'filter.noreply': 'No reply',
    'filter.failed': 'Failed',

    // Empty state of the chat.
    'empty.title': 'Mock conversations',
    'empty.lead':
      'The SMS your application sends through the API shows up here, with the delivery cycle: queued, sent, delivered.',
    'empty.lead2':
      'To test the inbound side, reply as the handset: the message reaches the application through the webhook.',
    'empty.new': 'New test message',
    'empty.demo': 'Load samples',
    'empty.tools': 'Open the control panel',

    // The chat on screen.
    'chat.back': 'Back to the list',
    'chat.details': 'Message details',
    'chat.sub': '{count} messages · simulated handset',
    'chat.subOne': '{count} message · simulated handset',

    // The composer of the reply.
    'composer.placeholder': 'Reply as the handset…',
    'composer.send': 'Send',
    'composer.counter': '{length}/{perSegment} · {encoding} · {segments} SMS',

    // The drawer of the details.
    'details.title': 'Message details',
    'details.id': 'ID',
    'details.status': 'Status',
    'details.api': 'API',
    'details.encoding': 'Encoding',
    'details.segments': 'Segments',
    'details.from': 'From',
    'details.to': 'To',
    'details.error': 'Error',
    'details.created': 'Created',
    'details.sent': 'Sent',
    'details.delivered': 'Delivered',
    'details.history': 'Status history',
    'details.empty': 'No message selected',

    // The dialog of the new message.
    'new.title': 'New test message',
    'new.hint':
      'It sends through the API, the way your application would: the message reaches the handset and follows the delivery cycle.',
    'new.to': 'To',
    'new.from': 'From',
    'new.body': 'Message',
    'new.bodyPlaceholder': 'Your code is 482913',
    'new.submit': 'Send',

    // The control panel on top of the app.
    'tools.title': 'Control panel',
    'tools.delivery': 'Delivery',
    'tools.webhook': 'Webhook',
    'tools.events': 'Events',
    'tools.magic': 'Magic numbers',
    'tools.api': 'API',

    // The status of a message.
    'status.queued': 'Queued',
    'status.sent': 'Sent',
    'status.delivered': 'Delivered',
    'status.undelivered': 'Undelivered',
    'status.failed': 'Failed',
    'status.received': 'Received',

    // The bubbles of the thread.
    'bubble.fromPhone': 'Sent by the handset',
    'bubble.error': 'error {code}',
    'bubble.segments': '{count} SMS · {encoding}',

    // The actions of a message.
    'action.deliver': 'Deliver',
    'action.fail': 'Fail',
    'action.undeliver': 'Undelivered',
    'action.delete': 'Delete',
    'confirm.delete': 'Delete this message?',

    // The days of the thread and of the list.
    'day.today': 'Today',
    'day.yesterday': 'Yesterday',

    // The list of conversations.
    'list.empty': 'No SMS yet',
    'list.emptyHint': 'Send through the API or load the samples.',
    'list.you': 'You: ',

    // The thread of a conversation.
    'thread.empty': 'No messages',
    'thread.emptyHint': 'Send an SMS to start the conversation.',

    // The messages the panel shows on the corner.
    'toast.copied': 'Code copied',
    'toast.copyFailed': 'Could not copy the code',
    'toast.sent': 'SMS sent',
    'toast.demo': 'Sample messages created',
    'toast.invalidNumber': 'Invalid number: use +55 11 91234-5678',
    'toast.emptyBody': 'Write the message before sending',
  },
})
