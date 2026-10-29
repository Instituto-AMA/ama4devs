/**
 * The voice engines of the film: ElevenLabs first, OpenRouter second, and
 * Microsoft Edge neural voices when there is no key at all.
 *
 * Both scripts of the film use this module — `voice.mjs` generates the whole
 * narration, `say.mjs` generates one line on demand — so the engine, the key
 * and the voice are decided in one place.
 *
 * The order of the providers is the order of the table below, and it never
 * changes at runtime:
 *
 *   1. ElevenLabs, straight from the official provider (the primary engine).
 *      `ELEVENLABS_API_KEY` -> api.elevenlabs.io, the native shape.
 *   2. OpenRouter (the secondary engine). `OPENROUTER_API_KEY` ->
 *      openrouter.ai, the OpenAI-compatible shape.
 *   3. Microsoft Edge neural voices: free, no account, the last resort.
 *
 * The keys are read from the environment and never written to the disk. The
 * script `scripts/voice-key.sh` asks for them with the input hidden and saves
 * them in `.env.sandbox`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FPS = 30
export const VOICE_DIR = join(ROOT, 'public/audio/voice')
export const RECORDED_DIR = join(ROOT, 'public/audio/recorded')

/** The native endpoint of ElevenLabs: the voice is in the path. */
export const ELEVENLABS_SPEECH = 'https://api.elevenlabs.io/v1/text-to-speech/{voice}'
/** The OpenAI-compatible endpoint of OpenRouter. */
export const OPENROUTER_SPEECH = 'https://openrouter.ai/api/v1/audio/speech'

/** The narration of the film: the segments and the engine they use. */
export const narration = JSON.parse(readFileSync(join(ROOT, 'src/voice.json'), 'utf8'))

/**
 * The first key that actually carries a value. An environment variable set
 * to an empty string (a placeholder in .env.sandbox) is not a key: sending
 * `Authorization: Bearer ` would reach the provider as an anonymous request.
 */
export const firstKey = (...keys) => keys.find((value) => Boolean(value && value.trim())) ?? ''

/**
 * The arguments of a command line, read the same way in every script.
 *
 * A flag that takes a value takes the next one; the flags that take no value
 * are collected apart; whatever is left over is returned as `loose`, and each
 * script decides what a leftover means (the text of a line, the id of a
 * segment).
 */
export const parseArgs = (argv, valueFlags) => {
  const values = {}
  const all = {}
  const flags = new Set()
  const loose = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--')) {
      const name = arg.slice(2)
      if (valueFlags.has(name)) {
        const value = argv[index + 1]
        values[name] = value
        all[name] = [...(all[name] ?? []), value]
        index += 1
        continue
      }
      flags.add(name)
      continue
    }
    loose.push(arg)
  }
  return { values, all, flags, loose }
}

/**
 * The providers of the voice, in the order they are tried. The first one
 * with a key in the environment speaks the film.
 *
 * A provider carries its name and the environment variable of its key, and
 * nothing else: the endpoint, the models and the voice live in
 * `src/voice.json` (`speech` for ElevenLabs, `speech_fallback` for
 * OpenRouter). The file is the one place where the film declares its voice;
 * the table below only says which key speaks first.
 */
export const PROVIDERS = [
  { id: 'elevenlabs', label: 'ElevenLabs', env: 'ELEVENLABS_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', env: 'OPENROUTER_API_KEY' },
]

/** The endpoint of each provider, used when the file does not declare one. */
const DEFAULT_BASE_URL = {
  elevenlabs: ELEVENLABS_SPEECH,
  openrouter: OPENROUTER_SPEECH,
  custom: ELEVENLABS_SPEECH,
}

/**
 * The provider that speaks the film: the first one with a key.
 *
 * The developer may also point the film at another engine (a local Kokoro,
 * for instance) with `TTS_API_KEY` and `TTS_BASE_URL`. That endpoint is not
 * part of the order of the providers — it is an explicit choice, and it wins
 * over them.
 */
export const activeProvider = () => {
  const provider = PROVIDERS.find((entry) => firstKey(process.env[entry.env]))
  if (provider) return provider
  if (firstKey(process.env.TTS_API_KEY)) {
    return { id: 'custom', label: 'Custom TTS', env: 'TTS_API_KEY' }
  }
  return null
}

/**
 * The speech endpoint of the environment, with the file as the default.
 *
 * `TTS_BASE_URL`, `TTS_MODEL` and `TTS_VOICE` point the film at another
 * engine (a local Kokoro, for instance) and win over everything else.
 */
export const resolveSpeech = () => {
  const provider = activeProvider()
  const declared = narration.speech ?? {}
  const fallback = narration.speech_fallback ?? {}
  const chosen = provider?.id === 'openrouter' ? fallback : declared
  const baseUrl =
    process.env.TTS_BASE_URL ??
    chosen.base_url ??
    DEFAULT_BASE_URL[provider?.id ?? 'elevenlabs']
  // An endpoint that is not ElevenLabs speaks the OpenAI shape: the format of
  // the provider, its dictionary and its settings do not travel with it.
  const elevenlabs = baseUrl.includes('elevenlabs.io')
  return {
    provider: provider?.id ?? 'edge',
    base_url: baseUrl,
    models: process.env.TTS_MODEL ? [process.env.TTS_MODEL] : (chosen.models ?? []),
    voice: process.env.TTS_VOICE ?? chosen.voice,
    response_format: elevenlabs ? (chosen.response_format ?? 'mp3_44100_128') : 'mp3',
    language_code: elevenlabs
      ? (process.env.TTS_LANGUAGE ?? chosen.language_code)
      : process.env.TTS_LANGUAGE,
    voice_settings: elevenlabs ? (chosen.voice_settings ?? {}) : {},
    pronunciation_dictionary_id: elevenlabs
      ? (process.env.TTS_PRONUNCIATION_DICTIONARY ?? chosen.pronunciation_dictionary_id)
      : undefined,
    pronunciation_dictionary_version_id: elevenlabs
      ? (process.env.TTS_PRONUNCIATION_DICTIONARY_VERSION ??
        chosen.pronunciation_dictionary_version_id)
      : undefined,
    // The fields that go straight to the body of the request, without a name
    // of their own.
    extra: chosen.extra ?? {},
  }
}

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
 * The native endpoint also takes what the v4 models added: the language of
 * the line (`language_code`), the sound effects of the scene
 * (`audio_effects`) and the seed that makes a line reproducible.
 *
 * The models are tried in order: the newest one may be out of the plan.
 */
export const generateSpeech = async ({
  text,
  speed,
  voice,
  voiceSettings,
  models,
  language,
  effects,
  seed,
}) => {
  const speech = resolveSpeech()
  const key = speechKey()
  const elevenlabs = speech.base_url.includes('elevenlabs.io')
  const headers = { 'content-type': 'application/json' }
  const settings = { ...DEFAULT_VOICE_SETTINGS, ...speech.voice_settings, ...(voiceSettings ?? {}) }
  let lastError = 'no model'

  for (const model of models ?? speech.models) {
    let url = speech.base_url
    let body

    if (elevenlabs) {
      // The native ElevenLabs endpoint: the voice is in the path and the
      // format is a query parameter.
      headers['xi-api-key'] = key
      url = speech.base_url.replace('{voice}', encodeURIComponent(voice ?? speech.voice))
      const format = new URLSearchParams({
        output_format: speech.response_format?.startsWith('mp3_') ? speech.response_format : 'mp3_44100_128',
      })
      url = `${url}?${format.toString()}`
      body = {
        text,
        model_id: model,
        voice_settings: {
          ...settings,
          ...(speed === undefined ? {} : { speed }),
        },
        ...(language ?? speech.language_code
          ? { language_code: language ?? speech.language_code }
          : {}),
        ...(effects ? { audio_effects: effects } : {}),
        ...(seed === undefined ? {} : { seed }),
        // The pronunciation dictionary: the words the model would say wrong
        // are written the way they must be heard.
        ...(speech.pronunciation_dictionary_id
          ? {
              pronunciation_dictionary_locators: [
                {
                  pronunciation_dictionary_id: speech.pronunciation_dictionary_id,
                  version_id: speech.pronunciation_dictionary_version_id,
                },
              ],
            }
          : {}),
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
  ]
  // The file is written through a temporary one and renamed, like the audio
  // of a provider: a reader never hears half of a line. The extension stays,
  // because the format of the file is read from it.
  const extension = extname(target)
  const temp = `${target.slice(0, target.length - extension.length)}.${process.pid}.tmp${extension}`
  execFileSync('uvx', [...args, '--write-media', temp], { stdio: ['ignore', 'ignore', 'inherit'] })
  renameSync(temp, target)
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

/**
 * Writes an audio file and returns its path.
 *
 * The bytes go to a temporary file in the same folder and are renamed over
 * the target: a reader (the listen, a render) never sees a half-written
 * audio, and a file that was interrupted keeps the old content.
 */
export const writeAudio = (target, buffer) => {
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, buffer)
  renameSync(temp, target)
  return target
}
