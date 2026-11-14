import { expect, test } from 'bun:test'
import { makeApp } from './helpers.ts'
import type { App } from '../src/app.ts'

/** The answer of the embeddings route, as the test reads it. */
interface EmbeddingsBody {
  object: string
  model: string
  data: {
    object: string
    index: number
    embedding: number[]
  }[]
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

/**
 * A request to the embeddings route.
 * @param app The app of the test.
 * @param input The text or texts to embed.
 * @param authorization The authorization header, when there is one.
 */
function requestEmbeddings(
  app: App,
  input: string | string[],
  authorization: string | null = 'Bearer test-key',
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (authorization !== null) headers.authorization = authorization

  return app.fetch(
    new Request('http://localhost/api/v1/embeddings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'mock-embedding-model', input }),
    }),
  )
}

/**
 * The dot product of two vectors.
 * @param left The first vector.
 * @param right The second vector.
 */
function dotProduct(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0)
}

test('answers deterministic OpenRouter embeddings', async () => {
  const { app } = makeApp()
  const inputs = ['passage: a b', 'query: a c', 'd e']

  const response = await requestEmbeddings(app, inputs)
  expect(response.status).toBe(200)
  const body = (await response.json()) as EmbeddingsBody

  expect(body.object).toBe('list')
  expect(body.model).toBe('mock-embedding-model')
  expect(body.data.map((item) => item.index)).toEqual([0, 1, 2])
  expect(body.data.every((item) => item.embedding.length === 1024)).toBe(true)

  const shared = body.data[0]?.embedding ?? []
  const related = body.data[1]?.embedding ?? []
  const unrelated = body.data[2]?.embedding ?? []
  expect(dotProduct(shared, related)).toBeGreaterThan(dotProduct(shared, unrelated))

  const repeated = (await (await requestEmbeddings(app, inputs[0] ?? '')).json()) as EmbeddingsBody
  expect(repeated.data[0]?.embedding).toEqual(shared)

  const first = (await (await requestEmbeddings(app, inputs[0] ?? '')).json()) as EmbeddingsBody
  const second = (await (await requestEmbeddings(app, inputs[1] ?? '')).json()) as EmbeddingsBody
  const third = (await (await requestEmbeddings(app, inputs[2] ?? '')).json()) as EmbeddingsBody
  expect(body.data[0]?.embedding).toEqual(first.data[0]?.embedding)
  expect(body.data[1]?.embedding).toEqual(second.data[0]?.embedding)
  expect(body.data[2]?.embedding).toEqual(third.data[0]?.embedding)

  const refused = await requestEmbeddings(app, 'a', null)
  expect(refused.status).toBe(401)
})
