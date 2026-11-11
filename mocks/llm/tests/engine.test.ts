import { describe, expect, test } from 'bun:test'
import { defaultCatalog } from '../src/catalog.ts'
import {
  DEFAULT_ANSWER_TEMPLATE,
  argumentsFor,
  autoReply,
  completionBody,
  decide,
  errorBody,
  estimateTokens,
  fillTemplates,
  formatUsd,
  lastToolName,
  lastToolResult,
  lastUserText,
  matches,
  markersOf,
  pickTool,
  priceOf,
  streamChunks,
  stripMarkers,
  textOf,
  toolRounds,
} from '../src/engine.ts'
import type {
  AnswerIds,
  ChatMessage,
  ChatRequest,
  EngineState,
  Rule,
  Settings,
  ToolSpec,
} from '../src/types.ts'
import type { TemplateContext } from '../src/engine.ts'

const TODAY = '2026-01-01'
const NOW = new Date('2026-01-01T12:00:00.000Z')

/** The settings the tests run with. */
const SETTINGS: Settings = {
  latencyMs: 0,
  streamChunkDelayMs: 0,
  streamChunkChars: 8,
  requireAuth: true,
  unknownModels: 'accept',
  toolStrategy: 'match',
  maxToolRounds: 1,
  answerTemplate: DEFAULT_ANSWER_TEMPLATE,
  reportCost: true,
}

/** The ids an answer carries, fixed so every test is deterministic. */
const IDS: AnswerIds = {
  id: 'chatcmpl-test',
  created: 1767225600,
  callId: (index: number) => `call_${index}`,
}

/** The tools the tests offer. */
const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_patients',
      description: 'Lista os pacientes cadastrados no sistema',
      parameters: {
        type: 'object',
        required: ['since'],
        properties: { since: { type: 'string', format: 'date' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_metrics',
      description: 'Consulta as metricas de faturamento do mes',
    },
  },
]

/** A request with one user message. */
function request(text: string, tools?: ToolSpec[]): ChatRequest {
  const req: ChatRequest = { model: 'openai/gpt-6.1-mini', messages: [{ role: 'user', content: text }] }
  if (tools) req.tools = tools
  return req
}

/** The state the tests decide with: no rule, the default catalog. */
function state(rules: Rule[] = [], settings: Settings = SETTINGS): EngineState {
  return { settings, rules, catalog: defaultCatalog() }
}

describe('textOf', () => {
  test('reads a string, the text parts and nothing else', () => {
    expect(textOf('hello')).toBe('hello')
    expect(
      textOf([
        { type: 'text', text: 'first' },
        { type: 'image_url' },
        { type: 'text', text: 'second' },
      ]),
    ).toBe('first\nsecond')
    expect(textOf(null)).toBe('')
    expect(textOf(undefined)).toBe('')
  })
})

describe('lastUserText', () => {
  test('reads the last user message', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
    ]
    expect(lastUserText(messages)).toBe('second')
    expect(lastUserText([{ role: 'assistant', content: 'answer' }])).toBe('')
  })
})

describe('markersOf', () => {
  test('reads every marker', () => {
    const markers = markersOf(
      'oi [mock:error=429] [mock:text] [mock:tool=list_patients] [mock:latency=1500] [mock:echo]',
    )
    expect(markers).toEqual({
      error: 429,
      text: true,
      tool: 'list_patients',
      latencyMs: 1500,
      echo: true,
    })
  })

  test('ignores a marker out of its range', () => {
    expect(markersOf('[mock:error=200]')).toEqual({})
    expect(markersOf('[mock:error=600]')).toEqual({})
    expect(markersOf('[mock:latency=200000]')).toEqual({})
  })

  test('reads the marker whatever the case of the word', () => {
    expect(markersOf('[MOCK:TEXT]').text).toBe(true)
  })
})

describe('stripMarkers', () => {
  test('removes every marker and trims', () => {
    expect(stripMarkers('[mock:text] hello')).toBe('hello')
    expect(stripMarkers('hello [mock:latency=10] world')).toBe('hello  world')
  })
})

describe('matches', () => {
  const rule = (match: Rule['match']): Rule => ({ id: 'r', match, reply: { kind: 'text', text: 'x' } })

  test('matches the model and the gateway', () => {
    expect(matches(rule({ model: 'openai/gpt-6.1-mini' }), request('oi'), 'vercel')).toBe(true)
    expect(matches(rule({ model: 'other/model' }), request('oi'), 'vercel')).toBe(false)
    expect(matches(rule({ gateway: 'openrouter' }), request('oi'), 'openrouter')).toBe(true)
    expect(matches(rule({ gateway: 'openrouter' }), request('oi'), 'vercel')).toBe(false)
  })

  test('matches the last user message and the system messages', () => {
    expect(matches(rule({ lastUser: 'paciente' }), request('Quantos pacientes?'), 'vercel')).toBe(true)
    expect(matches(rule({ lastUser: 'paciente' }), request('nothing'), 'vercel')).toBe(false)
    const withSystem: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [
        { role: 'system', content: 'You are an assistant' },
        { role: 'developer', content: 'be brief' },
        { role: 'user', content: 'oi' },
      ],
    }
    expect(matches(rule({ system: 'assistant' }), withSystem, 'vercel')).toBe(true)
    expect(matches(rule({ system: 'brief' }), withSystem, 'vercel')).toBe(true)
    expect(matches(rule({ system: 'assistant' }), request('oi'), 'vercel')).toBe(false)
  })

  test('never matches an invalid regular expression', () => {
    expect(matches(rule({ lastUser: '(' }), request('anything'), 'vercel')).toBe(false)
    expect(matches(rule({ system: '[' }), request('anything'), 'vercel')).toBe(false)
  })

  test('matches the tools of the request', () => {
    expect(matches(rule({ hasTools: true }), request('oi', TOOLS), 'vercel')).toBe(true)
    expect(matches(rule({ hasTools: false }), request('oi', TOOLS), 'vercel')).toBe(false)
    expect(matches(rule({ hasTools: false }), request('oi'), 'vercel')).toBe(true)
    expect(matches(rule({ toolOffered: 'list_patients' }), request('oi', TOOLS), 'vercel')).toBe(true)
    expect(matches(rule({ toolOffered: 'other_tool' }), request('oi', TOOLS), 'vercel')).toBe(false)
  })

  test('matches a request whose last message is a tool result', () => {
    const afterTool: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [
        { role: 'user', content: 'oi' },
        { role: 'tool', content: '{}', tool_call_id: 'call_0' },
      ],
    }
    expect(matches(rule({ afterTool: true }), afterTool, 'vercel')).toBe(true)
    expect(matches(rule({ afterTool: false }), afterTool, 'vercel')).toBe(false)
    expect(matches(rule({ afterTool: true }), request('oi'), 'vercel')).toBe(false)
  })

  test('matches the name of the tool whose result is the last message', () => {
    const withTool: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [
        { role: 'user', content: 'oi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_0', type: 'function', function: { name: 'read_data', arguments: '{}' } },
          ],
        },
        { role: 'tool', content: '{"dataset_id":"ds-1"}', tool_call_id: 'call_0' },
      ],
    }
    expect(matches(rule({ lastToolName: 'read_data' }), withTool, 'vercel')).toBe(true)
    expect(matches(rule({ lastToolName: 'show_kpis' }), withTool, 'vercel')).toBe(false)
    expect(matches(rule({ lastToolName: 'read_data' }), request('oi'), 'vercel')).toBe(false)
  })
})

describe('lastToolName', () => {
  test('finds the name of the tool through the tool_call_id', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_0', type: 'function', function: { name: 'read_data', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '{"dataset_id":"ds-1"}', tool_call_id: 'call_0' },
    ]
    expect(lastToolName(messages)).toBe('read_data')
  })

  test('is empty when the last message is not a tool result', () => {
    expect(lastToolName([])).toBe('')
    expect(lastToolName([{ role: 'user', content: 'oi' }])).toBe('')
  })

  test('is empty when no call answers the tool_call_id', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_0', type: 'function', function: { name: 'read_data', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '{}', tool_call_id: 'other' },
    ]
    expect(lastToolName(messages)).toBe('')
  })
})

describe('lastToolResult', () => {
  test('parses the content of the last tool message', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'oi' },
      { role: 'tool', content: '{"dataset_id":"ds-1"}', tool_call_id: 'call_0' },
    ]
    expect(lastToolResult(messages)).toEqual({ dataset_id: 'ds-1' })
  })

  test('is undefined when there is no tool message or it is not JSON', () => {
    expect(lastToolResult([{ role: 'user', content: 'oi' }])).toBeUndefined()
    expect(lastToolResult([{ role: 'tool', content: 'not json', tool_call_id: 'c' }])).toBeUndefined()
    expect(lastToolResult([{ role: 'tool', content: '', tool_call_id: 'c' }])).toBeUndefined()
  })
})

describe('fillTemplates', () => {
  const context: TemplateContext = {
    question: 'How much did we bill?',
    today: '2026-01-01',
    toolResult: {
      dataset_id: 'ds-1',
      count: 42,
      columns: [{ key: 'issued' }, { key: 'billed' }],
      sample: [['a', 'b']],
    },
  }

  test('fills the question and the day', () => {
    expect(fillTemplates('{{question}}', context)).toBe('How much did we bill?')
    expect(fillTemplates('{{today}}', context)).toBe('2026-01-01')
  })

  test('fills the day moved by some days', () => {
    expect(fillTemplates('{{date:-30}}', context)).toBe('2025-12-02')
    expect(fillTemplates('{{date:+1}}', context)).toBe('2026-01-02')
  })

  test('fills the result of the tool through its path', () => {
    expect(fillTemplates('{{tool.dataset_id}}', context)).toBe('ds-1')
    expect(fillTemplates('{{tool.columns.1.key}}', context)).toBe('billed')
    expect(fillTemplates('{{tool.sample.0.0}}', context)).toBe('a')
  })

  test('keeps the type of the value when the string is one placeholder', () => {
    expect(fillTemplates('{{tool.count}}', context)).toBe(42)
    expect(fillTemplates({ total: '{{tool.count}}' }, context)).toEqual({ total: 42 })
  })

  test('writes the text of the value inside a longer string', () => {
    expect(fillTemplates('id: {{tool.dataset_id}}!', context)).toBe('id: ds-1!')
    expect(fillTemplates('count: {{tool.count}}', context)).toBe('count: 42')
  })

  test('walks the objects and the arrays', () => {
    const filled = fillTemplates(
      {
        calls: [{ name: 'show_kpis', arguments: { dataset_id: '{{tool.dataset_id}}' } }],
        labels: ['{{tool.columns.0.key}}', '{{question}}'],
      },
      context,
    )
    expect(filled).toEqual({
      calls: [{ name: 'show_kpis', arguments: { dataset_id: 'ds-1' } }],
      labels: ['issued', 'How much did we bill?'],
    })
  })

  test('empties a placeholder it cannot resolve', () => {
    expect(fillTemplates('{{tool.missing}}', context)).toBe('')
    expect(fillTemplates('id: {{tool.missing}}!', context)).toBe('id: !')
    expect(fillTemplates('{{unknown}}', context)).toBe('')
    expect(fillTemplates('{{tool.columns.9.key}}', context)).toBe('')
  })

  test('never throws and leaves the other values alone', () => {
    expect(() => fillTemplates('{{tool}}', context)).not.toThrow()
    expect(fillTemplates('{{tool}}', context)).toBe('')
    expect(fillTemplates(7, context)).toBe(7)
    expect(fillTemplates(true, context)).toBe(true)
    expect(fillTemplates(null, context)).toBe(null)
  })
})

describe('toolRounds', () => {
  test('counts the assistant calls after the last user message', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c0', type: 'function', function: { name: 'a', arguments: '{}' } }] },
      { role: 'tool', content: '{}' },
    ]
    expect(toolRounds(messages)).toBe(1)
    expect(toolRounds([{ role: 'user', content: 'oi' }])).toBe(0)
  })
})

describe('pickTool', () => {
  test('never calls a tool with the none strategy', () => {
    expect(pickTool(TOOLS, 'quantos pacientes', 'none')).toBeUndefined()
  })

  test('takes the first tool with the first strategy', () => {
    expect(pickTool(TOOLS, 'anything', 'first')?.function.name).toBe('list_patients')
    expect(pickTool(TOOLS, 'anything', 'first', ['list_patients'])?.function.name).toBe('query_metrics')
    expect(pickTool(TOOLS, 'anything', 'first', ['list_patients', 'query_metrics'])).toBeUndefined()
  })

  test('takes the tool that talks about the question', () => {
    expect(pickTool(TOOLS, 'quantos pacientes', 'match')?.function.name).toBe('list_patients')
    expect(pickTool(TOOLS, 'quantos pacientes metricas', 'match')?.function.name).toBe('list_patients')
    expect(pickTool(TOOLS, 'as metricas do mes', 'match')?.function.name).toBe('query_metrics')
  })

  test('ignores an excluded tool', () => {
    expect(pickTool(TOOLS, 'quantos pacientes', 'match', ['list_patients'])).toBeUndefined()
    expect(pickTool(TOOLS, 'quantos pacientes', 'match', ['list_patients'])?.function.name).toBeUndefined()
  })

  test('answers nothing when no tool matches', () => {
    expect(pickTool(TOOLS, 'xyz', 'match')).toBeUndefined()
  })
})

describe('argumentsFor', () => {
  test('fills the required names of the schema', () => {
    const schema = {
      type: 'object',
      required: ['since', 'until', 'status', 'page', 'flag', 'tags'],
      properties: {
        since: { type: 'string', format: 'date' },
        until: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['active', 'inactive'] },
        page: { type: 'integer', minimum: 3 },
        flag: { type: 'boolean' },
        tags: { type: 'array', minItems: 1, items: { type: 'string' } },
        ignored: { type: 'string' },
      },
    }
    expect(argumentsFor(schema, TODAY)).toEqual({
      since: TODAY,
      until: `${TODAY}T00:00:00Z`,
      status: 'active',
      page: 3,
      flag: false,
      tags: [''],
    })
  })

  test('takes the default and the examples', () => {
    expect(
      argumentsFor(
        {
          type: 'object',
          required: ['a', 'b'],
          properties: {
            a: { type: 'string', default: 'default value' },
            b: { type: 'string', examples: ['from example'] },
          },
        },
        TODAY,
      ),
    ).toEqual({ a: 'default value', b: 'from example' })
  })

  test('fills a nested object', () => {
    expect(
      argumentsFor(
        {
          type: 'object',
          required: ['filter'],
          properties: {
            filter: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string', default: 'ana' } },
            },
          },
        },
        TODAY,
      ),
    ).toEqual({ filter: { name: 'ana' } })
  })

  test('answers an empty object for a schema that is not an object', () => {
    expect(argumentsFor(undefined, TODAY)).toEqual({})
    expect(argumentsFor({ type: 'string' }, TODAY)).toEqual({})
    expect(argumentsFor({ type: 'object' }, TODAY)).toEqual({})
  })
})

describe('autoReply', () => {
  test('calls a tool, then answers with the text of the result', () => {
    const req = request('quantos pacientes', TOOLS)
    const first = autoReply(req, SETTINGS, markersOf('quantos pacientes'), TODAY)
    expect(first.kind).toBe('tool_calls')
    if (first.kind !== 'tool_calls') return
    expect(first.calls[0]!.name).toBe('list_patients')
    expect(first.calls[0]!.arguments).toEqual({ since: TODAY })

    const messages: ChatMessage[] = [
      ...req.messages,
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'list_patients', arguments: '{}' } }],
      },
      { role: 'tool', content: '{"total":3}', tool_call_id: 'call_0' },
    ]
    const second = autoReply(
      { ...req, messages },
      SETTINGS,
      markersOf(''),
      TODAY,
    )
    expect(second.kind).toBe('text')
    if (second.kind !== 'text') return
    expect(second.text).toContain('list_patients')
    expect(second.text).toContain('1')
  })

  test('calls a second distinct tool when the rounds allow it', () => {
    const settings: Settings = { ...SETTINGS, maxToolRounds: 2 }
    const messages: ChatMessage[] = [
      { role: 'user', content: 'quantos pacientes e metricas' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'list_patients', arguments: '{}' } }],
      },
      { role: 'tool', content: '{"total":3}', tool_call_id: 'call_0' },
    ]
    const reply = autoReply(
      { model: 'openai/gpt-6.1-mini', messages, tools: TOOLS },
      settings,
      markersOf(''),
      TODAY,
    )
    expect(reply.kind).toBe('tool_calls')
    if (reply.kind !== 'tool_calls') return
    expect(reply.calls[0]!.name).toBe('query_metrics')
  })

  test('answers with the error of the marker', () => {
    const reply = autoReply(request('[mock:error=500]'), SETTINGS, markersOf('[mock:error=500]'), TODAY)
    expect(reply).toEqual({
      kind: 'error',
      status: 500,
      message: 'mock error 500',
      code: 'mock_error',
    })
  })

  test('echoes the question', () => {
    const text = 'quantos pacientes'
    const reply = autoReply(request(`[mock:echo] ${text}`), SETTINGS, markersOf(`[mock:echo] ${text}`), TODAY)
    expect(reply).toEqual({ kind: 'text', text })
  })

  test('answers with text when no tool is offered', () => {
    const reply = autoReply(request('oi'), SETTINGS, markersOf('oi'), TODAY)
    expect(reply.kind).toBe('text')
    if (reply.kind !== 'text') return
    expect(reply.text).toContain('oi')
    expect(reply.text).toContain('nenhuma')
    expect(reply.text).toContain('0')
  })

  test('calls the tool of the marker', () => {
    const text = '[mock:tool=query_metrics] quantos pacientes'
    const reply = autoReply(request(text, TOOLS), SETTINGS, markersOf(text), TODAY)
    expect(reply.kind).toBe('tool_calls')
    if (reply.kind !== 'tool_calls') return
    expect(reply.calls[0]!.name).toBe('query_metrics')
  })
})

describe('estimateTokens', () => {
  test('counts four characters per token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a')).toBe(1)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('priceOf and formatUsd', () => {
  test('multiplies the price without any float', () => {
    expect(priceOf(1000, '0.00000027')).toBe(270000000n)
    expect(formatUsd(priceOf(1000, '0.00000027'))).toBe('0.00027')
    expect(formatUsd(priceOf(1, '0.0000001'))).toBe('0.0000001')
    expect(formatUsd(0n)).toBe('0')
  })
})

describe('decide', () => {
  test('answers the first rule that matches', () => {
    const rules: Rule[] = [
      { id: 'first', match: { model: 'other/model' }, reply: { kind: 'text', text: 'no' } },
      { id: 'second', match: {}, reply: { kind: 'text', text: 'yes' } },
    ]
    const decision = decide(request('oi'), 'vercel', state(rules), NOW)
    expect(decision.ruleId).toBe('second')
    expect(decision.reply).toEqual({ kind: 'text', text: 'yes' })
    expect(decision.model).toBe('openai/gpt-6.1-mini')
  })

  test('adds the latency of the rule and of the marker', () => {
    const rules: Rule[] = [
      { id: 'r', match: {}, reply: { kind: 'text', text: 'yes' }, latencyMs: 100 },
    ]
    const settings: Settings = { ...SETTINGS, latencyMs: 50 }
    const decision = decide(request('[mock:latency=1500] oi'), 'vercel', state(rules, settings), NOW)
    expect(decision.latencyMs).toBe(1650)
  })

  test('answers with text when the model does not call tools', () => {
    const req: ChatRequest = {
      model: 'mock/text-only',
      messages: [{ role: 'user', content: 'quantos pacientes' }],
      tools: TOOLS,
    }
    const decision = decide(req, 'vercel', state(), NOW)
    expect(decision.reply.kind).toBe('text')
  })

  test('never changes the state', () => {
    const rules: Rule[] = [{ id: 'r', match: {}, reply: { kind: 'text', text: 'yes' } }]
    const current = state(rules)
    const before = JSON.stringify(current)
    decide(request('oi'), 'vercel', current, NOW)
    expect(JSON.stringify(current)).toBe(before)
  })

  test('fills the templates of the scripted answer', () => {
    const rules: Rule[] = [
      {
        id: 'r',
        match: { lastToolName: 'read_data' },
        reply: {
          kind: 'tool_calls',
          calls: [
            {
              name: 'show_kpis',
              arguments: {
                dataset_id: '{{tool.dataset_id}}',
                column: '{{tool.columns.1.key}}',
                from: '{{date:-30}}',
              },
            },
          ],
        },
      },
    ]
    const req: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [
        { role: 'user', content: 'faturamos' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_0', type: 'function', function: { name: 'read_data', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          content: '{"dataset_id":"ds-1","columns":[{"key":"issued"},{"key":"billed"}]}',
          tool_call_id: 'call_0',
        },
      ],
    }

    const decision = decide(req, 'vercel', state(rules), NOW)
    expect(decision.ruleId).toBe('r')
    expect(decision.reply.kind).toBe('tool_calls')
    if (decision.reply.kind !== 'tool_calls') return
    expect(decision.reply.calls[0]?.arguments).toEqual({
      dataset_id: 'ds-1',
      column: 'billed',
      from: '2025-12-02',
    })
  })

  test('fills the templates of the scripted text', () => {
    const rules: Rule[] = [
      {
        id: 'r',
        match: { lastToolName: 'read_data' },
        reply: { kind: 'text', text: 'O dataset {{tool.dataset_id}} de {{question}}' },
      },
    ]
    const req: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [
        { role: 'user', content: 'faturamos' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_0', type: 'function', function: { name: 'read_data', arguments: '{}' } },
          ],
        },
        { role: 'tool', content: '{"dataset_id":"ds-1"}', tool_call_id: 'call_0' },
      ],
    }

    const decision = decide(req, 'vercel', state(rules), NOW)
    expect(decision.reply).toEqual({ kind: 'text', text: 'O dataset ds-1 de faturamos' })
  })
})

describe('completionBody', () => {
  const rule: Rule[] = [{ id: 'r', match: {}, reply: { kind: 'text', text: '0123456789' } }]

  test('answers the OpenAI shape', () => {
    const req = request('oi')
    const decision = decide(req, 'vercel', state(rule), NOW)
    const body = completionBody(req, 'vercel', decision, IDS)
    expect(body.id).toBe('chatcmpl-test')
    expect(body.object).toBe('chat.completion')
    expect(body.created).toBe(1767225600)
    expect(body.model).toBe('openai/gpt-6.1-mini')
    const choices = body.choices as Array<Record<string, unknown>>
    expect(choices[0]!.index).toBe(0)
    expect(choices[0]!.finish_reason).toBe('stop')
    expect(choices[0]!.logprobs).toBeNull()
    const message = choices[0]!.message as Record<string, unknown>
    expect(message.role).toBe('assistant')
    expect(message.content).toBe('0123456789')
    const usage = body.usage as Record<string, unknown>
    expect(usage.prompt_tokens).toBe(decision.usage.inputTokens)
    expect(usage.completion_tokens).toBe(decision.usage.outputTokens)
    expect(usage.total_tokens).toBe(decision.usage.inputTokens + decision.usage.outputTokens)
  })

  test('cuts the text and answers length when the request asks for fewer tokens', () => {
    const req: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [{ role: 'user', content: 'oi' }],
      max_tokens: 2,
    }
    const decision = decide(req, 'vercel', state(rule), NOW)
    const body = completionBody(req, 'vercel', decision, IDS)
    const choices = body.choices as Array<Record<string, unknown>>
    expect(choices[0]!.finish_reason).toBe('length')
    expect((choices[0]!.message as Record<string, unknown>).content).toBe('01234567')
    // The usage counts only the text that was sent: two tokens, not three.
    expect(decision.usage.outputTokens).toBe(2)
    expect((body.usage as Record<string, unknown>).completion_tokens).toBe(2)
  })

  test('cuts the streamed text the same way and finishes it with length', () => {
    const req: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [{ role: 'user', content: 'oi' }],
      max_tokens: 2,
      stream: true,
    }
    const decision = decide(req, 'openrouter', state(rule), NOW)
    const chunks = streamChunks(req, 'openrouter', decision, IDS, 100)
    const text = chunks
      .flatMap((chunk) => chunk.choices as Array<Record<string, unknown>>)
      .map((choice) => ((choice.delta as Record<string, unknown> | undefined)?.content as string | undefined) ?? '')
      .join('')
    expect(text).toBe('01234567')
    const finishes = chunks
      .flatMap((chunk) => chunk.choices as Array<Record<string, unknown>>)
      .map((choice) => choice.finish_reason)
      .filter((reason) => reason !== null && reason !== undefined)
    expect(finishes).toEqual(['length'])
    const usage = chunks.at(-1)!.usage as Record<string, unknown>
    expect(usage.completion_tokens).toBe(2)
  })

  test('puts the cost where the gateway wants it', () => {
    const req = request('oi')
    const decision = decide(req, 'openrouter', state(rule), NOW)
    expect(decision.usage.costUsd).not.toBeNull()

    const openrouter = completionBody(req, 'openrouter', decision, IDS)
    const usage = openrouter.usage as Record<string, unknown>
    expect(typeof usage.cost).toBe('number')
    expect(openrouter.provider_metadata).toBeUndefined()

    const vercel = completionBody(req, 'vercel', decision, IDS)
    expect((vercel.usage as Record<string, unknown>).cost).toBeUndefined()
    expect(vercel.provider_metadata).toEqual({ gateway: { cost: decision.usage.costUsd } })
  })

  test('answers the tool calls of the decision', () => {
    const req = request('quantos pacientes', TOOLS)
    const decision = decide(req, 'vercel', state(), NOW)
    const body = completionBody(req, 'vercel', decision, IDS)
    const choices = body.choices as Array<Record<string, unknown>>
    expect(choices[0]!.finish_reason).toBe('tool_calls')
    const message = choices[0]!.message as Record<string, unknown>
    expect(message.content).toBeNull()
    const calls = message.tool_calls as Array<Record<string, unknown>>
    expect(calls[0]!.id).toBe('call_0')
    expect(calls[0]!.type).toBe('function')
    expect((calls[0]!.function as Record<string, unknown>).name).toBe('list_patients')
  })
})

describe('streamChunks', () => {
  test('writes the role, the text, the end and the usage', () => {
    const req: ChatRequest = {
      model: 'openai/gpt-6.1-mini',
      messages: [{ role: 'user', content: 'oi' }],
      stream: true,
      stream_options: { include_usage: true },
    }
    const decision = decide(req, 'vercel', state(), NOW)
    const chunks = streamChunks(req, 'vercel', decision, IDS, 8)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks[0]!.object).toBe('chat.completion.chunk')
    expect(chunks[0]!.id).toBe('chatcmpl-test')
    expect(chunks[0]!.choices).toEqual([
      { index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null },
    ])
    const closing = chunks[chunks.length - 2]!
    expect(closing.choices).toEqual([{ index: 0, delta: {}, finish_reason: 'stop' }])
    const usageChunk = chunks[chunks.length - 1]!
    expect(usageChunk.choices).toEqual([])
    const usage = usageChunk.usage as Record<string, unknown>
    expect(usage.prompt_tokens).toBe(decision.usage.inputTokens)
    expect(usage.completion_tokens).toBe(decision.usage.outputTokens)
  })

  test('writes the tool calls one by one', () => {
    const req = request('quantos pacientes', TOOLS)
    const decision = decide(req, 'openrouter', state(), NOW)
    const chunks = streamChunks(req, 'openrouter', decision, IDS, 8)
    const calls = chunks.find((chunk) => {
      const choices = chunk.choices as Array<Record<string, unknown>>
      const delta = choices[0]?.delta as Record<string, unknown> | undefined
      return delta?.tool_calls !== undefined
    })
    expect(calls).toBeDefined()
    const choices = calls!.choices as Array<Record<string, unknown>>
    const delta = choices[0]!.delta as Record<string, unknown>
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>>
    expect(toolCalls[0]!.id).toBe('call_0')
    expect(toolCalls[0]!.index).toBe(0)
    expect((toolCalls[0]!.function as Record<string, unknown>).name).toBe('list_patients')
  })
})

describe('errorBody', () => {
  test('answers the OpenAI error shape', () => {
    expect(errorBody(429, 'too many')).toEqual({
      error: { message: 'too many', type: 'mock_error', code: '429' },
    })
    expect(errorBody(429, 'too many', 'rate_limit')).toEqual({
      error: { message: 'too many', type: 'rate_limit', code: 'rate_limit' },
    })
  })
})
