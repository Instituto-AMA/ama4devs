import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CATALOG,
  defaultCatalog,
  findModel,
  openRouterModels,
  validateModel,
  vercelModels,
} from '../src/catalog.ts'

/** A model that passes every rule of `validateModel`. */
const VALID = {
  id: 'vendor/model',
  name: 'Model',
  contextWindow: 1000,
  maxOutputTokens: 100,
  inputPrice: '0.0000001',
  outputPrice: '0.0000002',
  tools: true,
}

describe('default catalog', () => {
  test('ships the documented models and prices', () => {
    expect(DEFAULT_CATALOG.length).toBe(5)
    expect(DEFAULT_CATALOG.map((model) => model.id)).toEqual([
      'deepseek/deepseek-v4.1-flash',
      'deepseek/deepseek-v4.1',
      'google/gemini-3.8-flash',
      'openai/gpt-6.1-mini',
      'mock/text-only',
    ])
    const flash = findModel(DEFAULT_CATALOG, 'deepseek/deepseek-v4.1-flash')
    expect(flash?.name).toBe('DeepSeek V4.1 Flash')
    expect(flash?.contextWindow).toBe(128000)
    expect(flash?.maxOutputTokens).toBe(8192)
    expect(flash?.inputPrice).toBe('0.00000027')
    expect(flash?.outputPrice).toBe('0.0000011')
    expect(flash?.tools).toBe(true)
    expect(findModel(DEFAULT_CATALOG, 'mock/text-only')?.tools).toBe(false)
  })

  test('hands out a fresh copy each call', () => {
    const first = defaultCatalog()
    const second = defaultCatalog()
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(first[0]).toEqual(DEFAULT_CATALOG[0])
    first[0]!.name = 'changed'
    expect(DEFAULT_CATALOG[0]!.name).toBe('DeepSeek V4.1 Flash')
    expect(defaultCatalog()[0]!.name).toBe('DeepSeek V4.1 Flash')
  })
})

describe('findModel', () => {
  test('finds by id and answers undefined for an unknown one', () => {
    expect(findModel(DEFAULT_CATALOG, 'google/gemini-3.8-flash')?.name).toBe('Gemini 3.8 Flash')
    expect(findModel(DEFAULT_CATALOG, 'vendor/missing')).toBeUndefined()
  })
})

describe('validateModel', () => {
  test('accepts a complete model', () => {
    expect(validateModel(VALID)).toEqual([])
  })

  test('names the field of every problem', () => {
    const errors = validateModel({
      id: 'no-slash',
      name: '',
      contextWindow: 0,
      maxOutputTokens: 1.5,
      inputPrice: 'free',
      outputPrice: '0.1',
      tools: 'yes',
    })
    expect(errors).toContain('id must contain "/"')
    expect(errors).toContain('name must be a non-empty string')
    expect(errors).toContain('contextWindow must be a positive integer')
    expect(errors).toContain('maxOutputTokens must be a positive integer')
    expect(errors).toContain('inputPrice must be a decimal string')
    expect(errors).toContain('tools must be a boolean')
    expect(errors).not.toContain('outputPrice must be a decimal string')
  })

  test('rejects anything that is not an object', () => {
    expect(validateModel(null)).toEqual(['model must be an object'])
    expect(validateModel('model')).toEqual(['model must be an object'])
  })
})

describe('vercelModels', () => {
  test('answers the Vercel shape', () => {
    const answer = vercelModels(DEFAULT_CATALOG)
    expect(answer.object).toBe('list')
    const data = answer.data as Array<Record<string, unknown>>
    expect(data.length).toBe(5)
    const first = data[0]!
    expect(first.id).toBe('deepseek/deepseek-v4.1-flash')
    expect(first.object).toBe('model')
    expect(first.created).toBe(0)
    expect(first.owned_by).toBe('deepseek')
    expect(first.name).toBe('DeepSeek V4.1 Flash')
    expect(first.description).toBe('')
    expect(first.context_window).toBe(128000)
    expect(first.max_tokens).toBe(8192)
    expect(first.type).toBe('language')
    expect(first.tags).toEqual(['tool-use'])
    expect(first.pricing).toEqual({ input: '0.00000027', output: '0.0000011' })
    const textOnly = data.find((model) => model.id === 'mock/text-only')!
    expect(textOnly.tags).toEqual([])
    expect(textOnly.owned_by).toBe('mock')
  })
})

describe('openRouterModels', () => {
  test('answers the OpenRouter shape', () => {
    const answer = openRouterModels(DEFAULT_CATALOG)
    const data = answer.data as Array<Record<string, unknown>>
    expect(data.length).toBe(5)
    const first = data[0]!
    expect(first.id).toBe('deepseek/deepseek-v4.1-flash')
    expect(first.name).toBe('DeepSeek V4.1 Flash')
    expect(first.created).toBe(0)
    expect(first.description).toBe('')
    expect(first.context_length).toBe(128000)
    expect(first.pricing).toEqual({
      prompt: '0.00000027',
      completion: '0.0000011',
      request: '0',
      image: '0',
    })
    expect(first.top_provider).toEqual({
      context_length: 128000,
      max_completion_tokens: 8192,
      is_moderated: false,
    })
    expect(first.supported_parameters).toEqual([
      'tools',
      'tool_choice',
      'max_tokens',
      'temperature',
    ])
    expect(first.architecture).toEqual({
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text'],
    })
    const textOnly = data.find((model) => model.id === 'mock/text-only')!
    expect(textOnly.supported_parameters).toEqual(['max_tokens', 'temperature'])
  })
})
