#!/usr/bin/env node
/**
 * Tests the voice of the film with the options of the provider, one short
 * line at a time.
 *
 * The line is written to the Desktop, so the developer can listen to it. The
 * file is named after the test, and every run keeps its own file: the
 * tests accumulate and can be compared.
 *
 * The options of the v4 model of ElevenLabs are exposed here:
 *
 *   --model <id>       eleven_v4 (the default), eleven_multilingual_v2, ...
 *   --voice <id>       The voice of the provider. The default is the one in
 *                      src/voice.json.
 *   --style <a=b>      The voice settings: stability, similarity_boost,
 *                      style, use_speaker_boost, speed, clone_strength.
 *   --language <code>  The language of the line (ISO 639-1). The default is
 *                      the one in src/voice.json (pt).
 *   --effect <id>      A sound effect of the scene: a filter preset (phone,
 *                      old_radio, robot, cheap_microphone, low_quality_phone,
 *                      bright_phone), a room (small_room, big_room, hall,
 *                      tunnel, street, valley, forest) or a bed (call_center,
 *                      cafe, city, keyboard).
 *   --room <id>        The room of the voice: the effect with a reverb tail.
 *   --noise <id>       The bed of the voice: the effect with a loop.
 *   --filter <id>      The color of the voice: the filter preset.
 *   --seed <number>    The seed that makes the line reproducible.
 *   --pace <number>    The speed of the voice, from 0.7 to 1.2.
 *   --name <text>      The name of the file. The default comes from the text.
 *   --out <path>       Where to write the file. The default is the Desktop.
 *   --json             Print the answer as JSON.
 *
 * Usage:
 *   node scripts/try-voice.mjs --text "Um teste curto." --name teste
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { durationOf, generateSpeech, parseArgs, resolveSpeech, writeAudio } from './tts.mjs'

const VALUE_FLAGS = new Set([
  'text',
  'model',
  'voice',
  'style',
  'language',
  'effect',
  'room',
  'noise',
  'filter',
  'seed',
  'pace',
  'name',
  'out',
])
const { values, flags, loose } = parseArgs(process.argv.slice(2), VALUE_FLAGS)
// A leftover word is part of the line: the quotes around the text are easy
// to forget.
values.text = [values.text, ...loose].filter(Boolean).join(' ')

const option = (name) => values[name]
const flag = (name) => flags.has(name)

const text = (option('text') ?? '').trim()
if (!text) {
  console.error('try-voice.mjs: the line is missing. Use --text "...".')
  process.exit(2)
}

/** The name of the file: the one given, or one made out of the text. */
const slug = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

const name = option('name') ?? slug(text)
const out = option('out') ?? join(homedir(), 'Desktop', `${name}.mp3`)

/** The voice settings, from --style stability=0.4,style=0.5. */
const voiceSettings = {}
for (const pair of (option('style') ?? '').split(',').filter(Boolean)) {
  const [key, value] = pair.split('=')
  const parsed = Number(value)
  if (!Number.isNaN(parsed)) voiceSettings[key.trim()] = parsed
}
if (option('pace')) {
  voiceSettings.speed = Number(option('pace'))
}

/** The sound effects of the scene: the preset, the room and the bed. */
const FILTERS = ['old_radio', 'robot', 'cheap_microphone', 'phone', 'low_quality_phone', 'bright_phone']
const ROOMS = ['small_room', 'big_room', 'hall', 'tunnel', 'street', 'valley', 'forest']
const NOISES = ['call_center', 'cafe', 'city', 'keyboard']

const effects = {}
if (option('filter')) effects.filter_preset_id = option('filter')
if (option('room')) effects.environment_id = option('room')
if (option('noise')) effects.background_noise_id = option('noise')
if (option('effect')) {
  // The shortcut that takes the id of any effect of the catalog. An id that
  // the catalog does not have is an error, not a filter nobody asked for.
  const id = option('effect')
  if (FILTERS.includes(id)) effects.filter_preset_id = id
  else if (ROOMS.includes(id)) effects.environment_id = id
  else if (NOISES.includes(id)) effects.background_noise_id = id
  else {
    console.error(
      `try-voice.mjs: unknown effect '${id}'.\n` +
        `  filters: ${FILTERS.join(', ')}\n` +
        `  rooms:   ${ROOMS.join(', ')}\n` +
        `  noises:  ${NOISES.join(', ')}`,
    )
    process.exit(2)
  }
}

const speech = resolveSpeech()
const models = option('model') ? [option('model')] : undefined

console.log(`model: ${option('model') ?? speech.models.join(', ')}`)
console.log(`voice: ${option('voice') ?? speech.voice}`)
if (Object.keys(voiceSettings).length) {
  console.log(`style: ${JSON.stringify(voiceSettings)}`)
}
if (Object.keys(effects).length) {
  console.log(`effects: ${JSON.stringify(effects)}`)
}

let spoken
try {
  spoken = await generateSpeech({
    text,
    voice: option('voice'),
    voiceSettings,
    models,
    language: option('language'),
    effects: Object.keys(effects).length ? effects : undefined,
    seed: option('seed') === undefined ? undefined : Number(option('seed')),
  })
} catch (error) {
  console.error(`try-voice.mjs: the provider did not answer. ${error.message}`)
  process.exit(2)
}

mkdirSync(dirname(out), { recursive: true })
// The bytes go through a temporary file and are renamed: a listener never
// hears half of a line.
writeAudio(out, spoken.buffer)
const seconds = durationOf(out)

const result = {
  file: out,
  model: spoken.model,
  voice: option('voice') ?? speech.voice,
  seconds: Number(seconds.toFixed(3)),
  text,
  ...(Object.keys(voiceSettings).length ? { voiceSettings } : {}),
  ...(Object.keys(effects).length ? { effects } : {}),
}

if (flag('json')) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log('')
  console.log(`${seconds.toFixed(2)}s — ${out}`)
}
