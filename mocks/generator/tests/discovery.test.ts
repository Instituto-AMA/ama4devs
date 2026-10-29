import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config.ts'
import { asaasPlaces, findAsaas, isAsaas } from '../src/discovery.ts'

/**
 * A fetch that answers only the places it knows; the others are down.
 * @param answers The body each place answers its health check with.
 */
function fakeFetch(answers: Record<string, unknown>): typeof fetch {
  const impl = async (input: any): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const base = url.replace(/\/health$/, '')
    const body = answers[base]
    if (body === undefined) throw new Error(`nothing answers at ${base}`)

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return impl as unknown as typeof fetch
}

/** The health of the Asaas mock, as the mock answers it. */
const ASAAS_HEALTH = { status: 'ok', clockMode: 'VIRTUAL_FLOWING' }

describe('isAsaas', () => {
  test('takes the Asaas mock for it', async () => {
    const answer = await isAsaas('http://asaas:45445', fakeFetch({ 'http://asaas:45445': ASAAS_HEALTH }))

    expect(answer).toBe(true)
  })

  test('does not take another service for it', async () => {
    const answer = await isAsaas(
      'http://asaas:45445',
      fakeFetch({ 'http://asaas:45445': { status: 'ok', service: 'generator' } }),
    )

    expect(answer).toBe(false)
  })

  test('gives up when the place does not answer', async () => {
    const answer = await isAsaas('http://asaas:45445', fakeFetch({}))

    expect(answer).toBe(false)
  })
})

describe('findAsaas', () => {
  test('takes the closest place that answers', async () => {
    const config = loadConfig({})

    await findAsaas(
      config,
      fakeFetch({
        'http://asaas:45445': ASAAS_HEALTH,
        'http://localhost:45445': ASAAS_HEALTH,
      }),
    )

    expect(config.asaasUrl).toBe('http://asaas:45445')
  })

  test('follows the Asaas that answers alone', async () => {
    const config = loadConfig({})

    await findAsaas(config, fakeFetch({ 'http://asaas-mock:45445': ASAAS_HEALTH }))

    expect(config.asaasUrl).toBe('http://asaas-mock:45445')
  })

  test('forgets the Asaas when nobody answers', async () => {
    const config = loadConfig({})

    await findAsaas(config, fakeFetch({ 'http://asaas:45445': ASAAS_HEALTH }))
    await findAsaas(config, fakeFetch({}))

    expect(config.asaasUrl).toBeUndefined()
  })

  test('logs what changed, and only what changed', async () => {
    const config = loadConfig({})
    const lines: string[] = []
    const log = (message: string) => lines.push(message)

    await findAsaas(config, fakeFetch({ 'http://asaas:45445': ASAAS_HEALTH }), log)
    await findAsaas(config, fakeFetch({ 'http://asaas:45445': ASAAS_HEALTH }), log)

    expect(lines).toEqual(['generator: Asaas found at http://asaas:45445'])

    await findAsaas(config, fakeFetch({}), log)

    expect(lines).toEqual([
      'generator: Asaas found at http://asaas:45445',
      'generator: Asaas stopped answering',
    ])
  })

  test('looks for nothing when the Asaas was given as is', async () => {
    const config = loadConfig({ ASAAS_URL: 'http://x:1' })

    await findAsaas(config, fakeFetch({ 'http://x:1': ASAAS_HEALTH }))

    expect(config.asaasUrl).toBe('http://x:1')
  })
})

describe('asaasPlaces', () => {
  test('looks for the Asaas when the URL is not set', () => {
    expect(asaasPlaces({})[0]).toBe('http://asaas:45445')
    expect(asaasPlaces({})).toEqual([
      'http://asaas:45445',
      'http://asaas-mock:45445',
      'http://localhost:45445',
      'http://host.docker.internal:45445',
    ])
  })

  test('looks for nothing when the URL is set', () => {
    expect(asaasPlaces({ ASAAS_URL: 'http://x:1' })).toEqual([])
  })
})
