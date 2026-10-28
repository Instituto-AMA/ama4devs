/**
 * The voice engines of the film: one speech endpoint and, when there is no
 * key, Microsoft Edge neural voices.
 *
 * Both scripts of the film use this module — `voice.mjs` generates the whole
 * narration, `say.mjs` generates one line on demand — so the engine, the key
 * and the voice are decided in one place.
 *
 * The key is read from the environment and never written to the disk.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FPS = 30
export const VOICE_DIR = join(ROOT, 'public/audio/voice')
export const RECORDED_DIR = join(ROOT, 'public/audio/recorded')
export const OPENROUTER_SPEECH = 'https://openrouter.ai/api/v1/audio/speech'

/** The narration of the film: the segments and the engine they use. */
export const narration = JSON.parse(readFileSync(join(ROOT, 'src/voice.json'), 'utf8'))

/**
 * The first key that actually carries a value. An environment variable set
 * to an empty string (a placeholder in .env.sandbox) is not a key: sending
 * `Authorization: Bearer ` would reach the provider as an anonymous request.
 */
export const firstKey = (...keys) => keys.find((value) => Boolean(value && value.trim())) ?? ''

/** The speech endpoint of the environment, with the file as the default. */
export const resolveSpeech = () => ({
  base_url: process.env.TTS_BASE_URL ?? narration.speech?.base_url ?? OPENROUTER_SPEECH,
  models: process.env.TTS_MODEL
    ? [process.env.TTS_MODEL]
    : (narration.speech?.models ?? [narration.speech?.model].filter(Boolean)),
  voice: process.env.TTS_VOICE ?? narration.speech?.voice,
  response_format: narration.speech?.response_format ?? 'mp3',
  ...(narration.speech?.extra ?? {}),
})

/** The key of the speech endpoint, whichever provider it is. */
export const speechKey = () =>
  firstKey(process.env.ELEVENLABS_API_KEY, process.env.OPENROUTER_API_KEY, process.env.TTS_API_KEY)

/** Whether the film can speak through an endpoint, or falls back to Edge. */
export const hasSpeechEngine = () => {
  const speech = resolveSpeech()
  return Boolean(speechKey()) && speech.models.length > 0
}

/** The speed the provider accepts: a fifth under and a fifth over the pace. */
export const SPEED_RANGE = { min: 0.7, max: 1.2 }

/**
 * The voice settings of ElevenLabs. The style of the film lives here: a
 * stable voice, close to the original, with a little expression.
 */
export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.8,
  style: 0.35,
  use_speaker_boost: true,
}

/**
 * Speaks a text and returns the audio.
 *
 * ElevenLabs has its own shape, and the engine speaks it too: a base url
 * with elevenlabs.io in it uses the native endpoint (xi-api-key, text,
 * model_id, voice_settings); anything else uses the OpenAI-compatible one
 * (Authorization, input, voice, response_format, speed).
 *
 * The models are tried in order: the newest one may be out of the plan.
 */
export const generateSpeech = async ({
  text,
  speed,
  voice,
  voiceSettings,
  models,
}) => {
  const speech = resolveSpeech()
  const key = speechKey()
  const elevenlabs = speech.base_url.includes('elevenlabs.io')
  const headers = { 'content-type': 'application/json' }
  const settings = { ...DEFAULT_VOICE_SETTINGS, ...(voiceSettings ?? {}) }
  let lastError = 'no model'

  for (const model of models ?? speech.models) {
    let url = speech.base_url
    let body

    if (elevenlabs) {
      // The native ElevenLabs endpoint: the voice is in the path.
      headers['xi-api-key'] = key
      url = speech.base_url.replace('{voice}', encodeURIComponent(voice ?? speech.voice))
      body = {
        text,
        model_id: model,
        voice_settings: {
          ...settings,
          ...(speed === undefined ? {} : { speed }),
        },
        ...(speech.extra ?? {}),
      }
    } else {
      if (key) {
        headers.authorization = `Bearer ${key}`
      }
      if (process.env.OPENROUTER_API_KEY) {
        headers['x-title'] = 'ama4devs video'
      }
      body = {
        model,
        input: text,
        voice: voice ?? speech.voice,
        response_format: speech.response_format,
        ...(speed === undefined ? {} : { speed }),
        ...(speech.extra ?? {}),
      }
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (response.ok) {
      return { buffer: Buffer.from(await response.arrayBuffer()), model }
    }
    const detail = await response.text()
    lastError = `${model} answered ${response.status}: ${detail.slice(0, 300)}`
    console.log(`   ! ${lastError}`)
  }
  throw new Error(lastError)
}

/**
 * The voice of Microsoft Edge: free, no account, good enough for a draft.
 * It writes the file and returns its path.
 */
export const generateEdge = ({
  text,
  target,
  voice,
  rate,
}) => {
  const args = [
    '--from',
    'edge-tts',
    'edge-tts',
    '--voice',
    voice ?? narration.voice,
    `--rate=${rate ?? narration.rate}`,
    '--text',
    text,
    '--write-media',
    target,
  ]
  execFileSync('uvx', args, { stdio: ['ignore', 'ignore', 'inherit'] })
  return target
}

/** The length of an audio file, in seconds. */
export const durationOf = (file) => {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  )
  return Number.parseFloat(out.trim())
}

/**
 * The path of a file inside public/, the way staticFile() wants it: without
 * the public/ prefix and with forward slashes.
 */
export const publicPath = (file) =>
  relative(ROOT, file).split('\\').join('/').replace(/^public\//, '')

/** Writes an audio file and returns its path. */
export const writeAudio = (target, buffer) => {
  writeFileSync(target, buffer)
  return target
}
