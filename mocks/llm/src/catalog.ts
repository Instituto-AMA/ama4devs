/**
 * The models the mock answers for, and the shapes the two gateways answer
 * them in (Vercel AI Gateway and OpenRouter).
 *
 * The catalog is data, not behaviour: it is safe to read from anywhere and
 * nothing here talks to the network or to the clock.
 */

import type { CatalogModel } from './types.ts'

/** The models the mock ships with, in the order the docs list them. */
const MODELS: CatalogModel[] = [
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    inputPrice: '0.00000027',
    outputPrice: '0.0000011',
    tools: true,
  },
  {
    id: 'deepseek/deepseek-v4.1',
    name: 'DeepSeek V4.1',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    inputPrice: '0.00000056',
    outputPrice: '0.0000022',
    tools: true,
  },
  {
    id: 'google/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    inputPrice: '0.0000003',
    outputPrice: '0.0000025',
    tools: true,
  },
  {
    id: 'openai/gpt-6.1-mini',
    name: 'GPT-6.1 mini',
    contextWindow: 400000,
    maxOutputTokens: 32768,
    inputPrice: '0.00000025',
    outputPrice: '0.000002',
    tools: true,
  },
  {
    id: 'mock/text-only',
    name: 'Mock text only',
    contextWindow: 32000,
    maxOutputTokens: 4096,
    inputPrice: '0.0000001',
    outputPrice: '0.0000004',
    tools: false,
  },
]

/** The default catalog, frozen: nothing may change the shipped models. */
export const DEFAULT_CATALOG: CatalogModel[] = Object.freeze(
  MODELS.map((model) => Object.freeze({ ...model })),
) as unknown as CatalogModel[]

/**
 * A fresh copy of the default catalog, one model each call, so the caller
 * may edit what it gets without touching the shipped one.
 */
export function defaultCatalog(): CatalogModel[] {
  return DEFAULT_CATALOG.map((model) => ({ ...model }))
}

/** The model with this id, or `undefined` when the catalog does not have it. */
export function findModel(catalog: CatalogModel[], id: string): CatalogModel | undefined {
  return catalog.find((model) => model.id === id)
}

/** Whether the value is a positive integer. */
function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Whether the value is a decimal string of dollars (`"0.00000027"`). */
function isPrice(value: unknown): boolean {
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)
}

/**
 * The problems of a model an operator sent, one message per field; an empty
 * list means the model is valid.
 */
export function validateModel(input: unknown): string[] {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['model must be an object']
  }

  const model = input as Record<string, unknown>
  if (typeof model.id !== 'string' || model.id.trim() === '') {
    errors.push('id must be a non-empty string')
  } else if (!model.id.includes('/')) {
    errors.push('id must contain "/"')
  }
  if (typeof model.name !== 'string' || model.name.trim() === '') {
    errors.push('name must be a non-empty string')
  }
  if (!isPositiveInteger(model.contextWindow)) {
    errors.push('contextWindow must be a positive integer')
  }
  if (!isPositiveInteger(model.maxOutputTokens)) {
    errors.push('maxOutputTokens must be a positive integer')
  }
  if (!isPrice(model.inputPrice)) {
    errors.push('inputPrice must be a decimal string')
  }
  if (!isPrice(model.outputPrice)) {
    errors.push('outputPrice must be a decimal string')
  }
  if (typeof model.tools !== 'boolean') {
    errors.push('tools must be a boolean')
  }
  return errors
}

/**
 * The catalog as the Vercel AI Gateway answers `GET /v1/models`.
 */
export function vercelModels(catalog: CatalogModel[]): Record<string, unknown> {
  return {
    object: 'list',
    data: catalog.map((model) => ({
      id: model.id,
      object: 'model',
      created: 0,
      owned_by: model.id.split('/')[0] ?? model.id,
      name: model.name,
      description: '',
      context_window: model.contextWindow,
      max_tokens: model.maxOutputTokens,
      type: 'language',
      tags: model.tools ? ['tool-use'] : [],
      pricing: { input: model.inputPrice, output: model.outputPrice },
    })),
  }
}

/**
 * The catalog as OpenRouter answers `GET /api/v1/models`.
 */
export function openRouterModels(catalog: CatalogModel[]): Record<string, unknown> {
  return {
    data: catalog.map((model) => ({
      id: model.id,
      name: model.name,
      created: 0,
      description: '',
      context_length: model.contextWindow,
      pricing: {
        prompt: model.inputPrice,
        completion: model.outputPrice,
        request: '0',
        image: '0',
      },
      top_provider: {
        context_length: model.contextWindow,
        max_completion_tokens: model.maxOutputTokens,
        is_moderated: false,
      },
      supported_parameters: model.tools
        ? ['tools', 'tool_choice', 'max_tokens', 'temperature']
        : ['max_tokens', 'temperature'],
      architecture: {
        modality: 'text->text',
        input_modalities: ['text'],
        output_modalities: ['text'],
      },
    })),
  }
}
