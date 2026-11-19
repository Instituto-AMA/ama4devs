import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config.ts'
import { decide } from '../src/engine.ts'
import type { ChatMessage, ChatRequest, EngineState, ToolSpec } from '../src/types.ts'

/** The boot file of the Ama-Hub assistant, read the way the server reads it. */
const BOOT_FILE = new URL('../boot/ama-hub-assistant.json', import.meta.url).pathname

/** The day the answers of the test are made on. */
const NOW = new Date('2026-01-01T12:00:00.000Z')

/** The tools the analyst offers the assistant. */
const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: { name: 'read_data', description: 'Lê uma fonte de dados do relatório.' },
  },
  {
    type: 'function',
    function: { name: 'show_table', description: 'Mostra uma tabela de um conjunto de dados.' },
  },
]

/** The state the engine decides with: the rules of the boot file. */
function bootState(): EngineState {
  const config = loadConfig({ LLM_CONFIG_FILE: BOOT_FILE })
  const rules = config.rules.map((rule, index) => ({ ...rule, id: rule.id ?? `rule-${index}` }))
  return { settings: config.settings, rules, catalog: config.catalog }
}

/** A request of the analyst, with the tools the assistant is offered. */
function question(text: string, tools: ToolSpec[] = TOOLS): ChatRequest {
  const req: ChatRequest = {
    model: 'openai/gpt-6.1-mini',
    messages: [{ role: 'user', content: text }],
  }
  if (tools.length > 0) req.tools = tools
  return req
}

/** The request of the analyst after the result of a tool came back. */
function afterTool(req: ChatRequest, name: string, result: string): ChatRequest {
  const messages: ChatMessage[] = [
    ...req.messages,
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_0', type: 'function', function: { name, arguments: '{}' } }],
    },
    { role: 'tool', content: result, tool_call_id: 'call_0' },
  ]
  return { ...req, messages }
}

describe('the boot file of the Ama-Hub assistant', () => {
  test('boots with no error and loads the rules', () => {
    const config = loadConfig({ LLM_CONFIG_FILE: BOOT_FILE })
    expect(config.bootErrors).toEqual([])
    expect(config.rules.length).toBe(18)
    expect(config.rules.every((rule) => typeof rule.id === 'string')).toBe(true)
  })

  test('calls read_data for the free slots of tomorrow', () => {
    const decision = decide(question('Quais horários estão livres amanhã?'), 'vercel', bootState(), NOW)
    expect(decision.ruleId).toBe('ama-hub-free-slots')
    expect(decision.reply.kind).toBe('tool_calls')
    if (decision.reply.kind !== 'tool_calls') return
    expect(decision.reply.calls[0]?.name).toBe('read_data')
    expect(decision.reply.calls[0]?.arguments).toEqual({
      source: 'agenda_free_slots',
      params: { date: '2026-01-02' },
    })
  })

  test('shows the table of the free slots after read_data', () => {
    const req = afterTool(question('Quais horários estão livres amanhã?'), 'read_data', '{"dataset_id":"ds-42"}')
    const decision = decide(req, 'vercel', bootState(), NOW)
    expect(decision.ruleId).toBe('ama-hub-free-slots-table')
    expect(decision.reply.kind).toBe('tool_calls')
    if (decision.reply.kind !== 'tool_calls') return
    expect(decision.reply.calls[0]?.name).toBe('show_table')
    expect(decision.reply.calls[0]?.arguments).toEqual({
      dataset_id: 'ds-42',
      title: 'Horários livres',
    })
  })

  test('answers with the text after show_table', () => {
    const req = afterTool(question('Quais horários estão livres amanhã?'), 'show_table', '{"ok":true}')
    const decision = decide(req, 'vercel', bootState(), NOW)
    expect(decision.ruleId).toBe('ama-hub-free-slots-answer')
    expect(decision.reply.kind).toBe('text')
    if (decision.reply.kind !== 'text') return
    expect(decision.reply.text).toBe(
      'Estes são os horários livres. Diga o paciente e o horário que eu proponho o agendamento.',
    )
  })

  test('answers the questions of the day, the professionals and the receivables', () => {
    const cases: { question: string; rule: string; source: string }[] = [
      { question: 'Quais consultas de hoje?', rule: 'ama-hub-today-appointments', source: 'agenda_appointments' },
      { question: 'Quais profissionais temos?', rule: 'ama-hub-professionals', source: 'professionals' },
      { question: 'Quais parcelas estão em atraso?', rule: 'ama-hub-overdue-receivables', source: 'receivable_installments' },
    ]

    for (const item of cases) {
      const decision = decide(question(item.question), 'vercel', bootState(), NOW)
      expect(decision.ruleId).toBe(item.rule)
      expect(decision.reply.kind).toBe('tool_calls')
      if (decision.reply.kind !== 'tool_calls') continue
      expect(decision.reply.calls[0]?.name).toBe('read_data')
      expect(decision.reply.calls[0]?.arguments.source).toBe(item.source)
    }
  })

  test('proposes the writes of the day: a cancellation and a receipt in cash', () => {
    const tools: ToolSpec[] = [
      ...TOOLS,
      { type: 'function', function: { name: 'propose_action', description: 'Propõe uma escrita que a pessoa confirma.' } },
    ]
    const cases: { question: string; rule: string; source: string; action: string; args: Record<string, unknown> }[] = [
      {
        question: 'Cancele a primeira consulta de hoje',
        rule: 'ama-hub-cancel-first-today',
        source: 'agenda_appointments',
        action: 'cancel_appointment',
        args: { appointment_id: 'appt-1', expected_version: 4, rebooking: 'no_contact' },
      },
      {
        question: 'Receba em dinheiro a parcela em atraso',
        rule: 'ama-hub-receive-in-cash',
        source: 'receivable_installments',
        action: 'receive_installment_in_cash',
        args: { installment_id: 'inst-1', received_on: '2026-01-01', method: 'cash' },
      },
    ]
    const sample = (first: string, at: number, value: string | number): (string | number)[] =>
      Array.from({ length: 15 }, (_, index) => (index === 0 ? first : index === at ? value : 'x'))
    const results: Record<string, string> = {
      'ama-hub-cancel-first-today': JSON.stringify({ dataset_id: 'ds-1', sample: [sample('appt-1', 14, 4)] }),
      'ama-hub-receive-in-cash': JSON.stringify({ dataset_id: 'ds-2', sample: [sample('Lucas', 8, 'inst-1')] }),
    }

    for (const item of cases) {
      const ask = question(item.question, tools)
      const read = decide(ask, 'vercel', bootState(), NOW)
      expect(read.ruleId).toBe(item.rule)
      if (read.reply.kind !== 'tool_calls') throw new Error(`${item.rule}: no tool call`)
      expect(read.reply.calls[0]?.arguments.source).toBe(item.source)

      const propose = decide(afterTool(ask, 'read_data', results[item.rule] ?? ''), 'vercel', bootState(), NOW)
      expect(propose.ruleId).toBe(`${item.rule}-propose`)
      if (propose.reply.kind !== 'tool_calls') throw new Error(`${item.rule}: no proposal`)
      expect(propose.reply.calls[0]?.name).toBe('propose_action')
      expect(propose.reply.calls[0]?.arguments).toEqual({ action: item.action, arguments: item.args })

      const answer = decide(afterTool(ask, 'propose_action', '{"ok":true}'), 'vercel', bootState(), NOW)
      expect(answer.ruleId).toBe(`${item.rule}-answer`)
      expect(answer.reply.kind).toBe('text')
    }
  })

  test('answers a plain chat with no rule of the file', () => {
    const decision = decide(question('Quais horários estão livres amanhã?', []), 'vercel', bootState(), NOW)
    expect(decision.ruleId).toBeUndefined()
    expect(decision.reply.kind).toBe('text')
  })
})
