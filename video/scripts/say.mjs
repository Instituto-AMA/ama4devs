#!/usr/bin/env node
/**
 * Speaks one line of the film, on demand.
 *
 * This is the door an LLM uses to put a voice on a line: it gives the text,
 * the pace and the seconds the audio has to last, and the script returns the
 * file, the measured length and the pace that was used.
 *
 *   node scripts/say.mjs --text "Um mock local da API do ásas." --duration 4.5
 *   node scripts/say.mjs --text "..." --pace 0.9 --at 12.4 --id fatura --json
 *
 * The options:
 *
 *   --text <string>      The line to speak. Required, unless --file is given.
 *   --file <path>        Read the line from a file instead.
 *   --id <name>          The segment id. It names the file, the entry in
 *                        src/voice.durations.json and the cue in
 *                        src/voice.cues.json. Without it, the id comes from
 *                        the text.
 *   --pace <number>      The speaking rate: 1 is the voice's own pace, 0.8
 *                        is slower, 1.2 is faster. The provider accepts 0.7
 *                        to 1.2.
 *   --duration <seconds> The length the audio has to have. The pace is
 *                        corrected until the line fits (up to three tries).
 *   --at <seconds>       The second of the film where the line starts. It is
 *                        written to src/voice.cues.json, and the composition
 *                        reads the cue.
 *   --voice <id>         The voice of the endpoint. The default is the one in
 *                        src/voice.json.
 *   --style <a=b,c=d>    The ElevenLabs settings: stability, similarity and
 *                        style, from 0 to 1.
 *   --out <path>         Where to write the audio. The default is
 *                        public/audio/voice/<id>.mp3.
 *   --engine <name>      speech (the endpoint) or edge (the free fallback).
 *   --json               Print the result as JSON, for a machine to read.
 *
 * The key comes from the environment (ELEVENLABS_API_KEY, OPENROUTER_API_KEY
 * or TTS_API_KEY) and is never written to the disk. The engines are tried in
 * that order: ElevenLabs, then OpenRouter, then Microsoft Edge.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  FPS,
  ROOT,
  SPEED_RANGE,
  VOICE_DIR,
  activeProvider,
  durationOf,
  generateEdge,
  generateSpeech,
  hasSpeechEngine,
  narration,
  parseArgs,
  publicPath,
  resolveSpeech,
  speechKey,
  writeAudio,
} from './tts.mjs'

/**
 * The arguments are read the same way in every script of the film: a flag
 * that takes a value takes the next one, and whatever is left over is part
 * of the line. An agent that forgets the quotes around the text still gets
 * the whole line spoken.
 */
const VALUE_FLAGS = new Set(['text', 'file', 'id', 'pace', 'duration', 'at', 'voice', 'style', 'out', 'engine'])
const { values, flags, loose } = parseArgs(process.argv.slice(2), VALUE_FLAGS)

const option = (name) => values[name]
const flag = (name) => flags.has(name)

const spoken = option('text') ?? (option('file') ? readFileSync(option('file'), 'utf8').trim() : undefined)
const text = [spoken, ...loose].filter(Boolean).join(' ').trim()
if (!text) {
  console.error('say.mjs: the line is missing. Use --text or --file.')
  process.exit(2)
}

const pace = Number(option('pace') ?? 1)
const target = option('duration') ? Number(option('duration')) : undefined
const at = option('at') ? Number(option('at')) : undefined
const voice = option('voice')
const provider = activeProvider()
const engine = option('engine') ?? (hasSpeechEngine() ? 'speech' : 'edge')
const out = option('out')

const settings = {}
for (const pair of (option('style') ?? '').split(',').filter(Boolean)) {
  const [name, value] = pair.split('=')
  settings[name.trim()] = Number(value)
}

/** The id of the segment: the one given, or one made out of the text. */
const slug = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

const id = option('id') ?? slug(text)
const targetFile = out ?? join(VOICE_DIR, `${id}.mp3`)

mkdirSync(dirname(targetFile), { recursive: true })

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const speech = resolveSpeech()

/** The audio of the line, and the model that spoke it. */
let model = 'edge-tts'
let speed = clamp(pace, SPEED_RANGE.min, SPEED_RANGE.max)
let seconds = 0
// The voice that speaks: the one of the endpoint, or the Edge voice when the
// free fallback speaks.
let spokenVoice = engine === 'speech' ? (voice ?? speech.voice) : (voice ?? narration.voice)

if (engine === 'speech') {
  if (!speechKey()) {
    console.error(
      'say.mjs: no key in the environment. Set ELEVENLABS_API_KEY or OPENROUTER_API_KEY (or use --engine edge).',
    )
    process.exit(2)
  }
  // The line is spoken once to learn its length; when a duration was asked
  // for, the pace is corrected and the line is spoken again.
  const attempts = target ? 3 : 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const spoken = await generateSpeech({ text, speed, voice, voiceSettings: settings })
    model = spoken.model
    writeAudio(targetFile, spoken.buffer)
    seconds = durationOf(targetFile)
    if (!target) {
      break
    }
    const drift = seconds - target
    if (Math.abs(drift) <= Math.max(0.08, target * 0.03)) {
      break
    }
    const corrected = clamp(speed * (seconds / target), SPEED_RANGE.min, SPEED_RANGE.max)
    if (corrected === speed) {
      console.log(`   ! the pace cannot reach ${target}s: the provider stops at ${SPEED_RANGE.min}–${SPEED_RANGE.max}`)
      break
    }
    speed = corrected
  }
} else {
  generateEdge({ text, target: targetFile, voice: voice ?? narration.voice, rate: rateOf(speed) })
  seconds = durationOf(targetFile)
}

/** The rate of the Edge voice, which takes a percentage instead of a factor. */
function rateOf(value) {
  const percent = Math.round((value - 1) * 100)
  return `${percent >= 0 ? '+' : ''}${percent}%`
}

/** The film reads the length of every line from this file. */
const durationsFile = join(ROOT, 'src/voice.durations.json')
const durations = existsSync(durationsFile) ? JSON.parse(readFileSync(durationsFile, 'utf8')) : {}
const measured = {
  file: publicPath(targetFile),
  seconds: Number(seconds.toFixed(3)),
  frames: Math.ceil(seconds * FPS),
  source: engine === 'edge' ? 'edge' : (provider?.id ?? 'speech'),
}
if (!out) {
  durations[id] = measured
  writeFileSync(durationsFile, `${JSON.stringify(durations, null, 2)}\n`)
}

/** The film reads the moment every line starts from this file. */
const cuesFile = join(ROOT, 'src/voice.cues.json')
const cues = existsSync(cuesFile) ? JSON.parse(readFileSync(cuesFile, 'utf8')) : {}
if (at !== undefined) {
  cues[id] = { at, from: Math.round(at * FPS), file: measured.file }
  writeFileSync(cuesFile, `${JSON.stringify(cues, null, 2)}\n`)
}

const result = {
  id,
  file: measured.file,
  engine,
  provider: measured.source,
  model,
  voice: spokenVoice,
  seconds: measured.seconds,
  frames: measured.frames,
  pace,
  speed: Number(speed.toFixed(3)),
  ...(target === undefined ? {} : { targetSeconds: target, drift: Number((seconds - target).toFixed(3)) }),
  ...(at === undefined ? {} : { at, atFrame: Math.round(at * FPS) }),
  ...(durations[id] ? { timeline: 'src/voice.durations.json' } : {}),
  ...(cues[id] ? { cue: 'src/voice.cues.json' } : {}),
}

if (flag('json')) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`${id}: ${measured.seconds.toFixed(2)}s (${measured.frames} frames), ${model}, pace ${speed}`)
  if (target !== undefined) {
    console.log(`   target ${target}s, drift ${(seconds - target).toFixed(2)}s`)
  }
  if (at !== undefined) {
    console.log(`   starts at ${at}s (frame ${Math.round(at * FPS)})`)
  }
  console.log(`   ${measured.file}`)
  console.log(`   engine: ${measured.source}${provider ? ` (${provider.label})` : ''}`)
}
