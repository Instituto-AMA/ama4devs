#!/usr/bin/env node
/**
 * Generates the narration of the film.
 *
 * For every segment in src/voice.json it produces one audio file and
 * measures it, writing src/voice.durations.json — the composition reads
 * that file to place each line on the timeline.
 *
 * Two sources for the voice:
 *
 *   1. A recording of a human voice: drop a file at
 *      public/audio/recorded/<id>.m4a (or .mp3, .wav, .aac) and it wins over
 *      the generated one. Nothing else changes — the timeline follows the
 *      length of the file.
 *   2. A generated voice, from the first engine that has a key:
 *        ELEVENLABS_API_KEY set  -> ElevenLabs, straight from the official
 *          provider (the primary engine).
 *        OPENROUTER_API_KEY set -> OpenRouter (the secondary engine).
 *        no key                 -> Microsoft Edge neural voices (free, no
 *          account), `uvx --from edge-tts edge-tts`.
 *
 * The key is read from the environment and never written to the disk. The
 * script `scripts/voice-key.sh` asks for it with the input hidden and saves
 * it in `.env.sandbox`.
 *
 * One line at a time, with the pace and the seconds it must last, is
 * `scripts/say.mjs`.
 *
 * Usage:
 *   node scripts/voice.mjs            # generate the missing files
 *   node scripts/voice.mjs --force    # regenerate everything
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FPS,
  RECORDED_DIR,
  ROOT,
  VOICE_DIR,
  activeProvider,
  durationOf,
  generateEdge,
  generateSpeech,
  hasSpeechEngine,
  narration,
  publicPath,
  resolveSpeech,
  writeAudio,
} from './tts.mjs'

const force = process.argv.includes('--force')
const AUDIO_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.aac']

const findRecording = (id) => {
  for (const extension of AUDIO_EXTENSIONS) {
    const candidate = join(RECORDED_DIR, `${id}${extension}`)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * The generated voice of the segment, written to public/audio/voice.
 *
 * The file is written through a temporary one and renamed: a reader (the
 * listen, a render) never sees a half-written audio.
 *
 * It also says which model spoke it, and whether the line was spoken again:
 * a file that was already there was spoken by the model the film declares.
 */
const generate = async (id, text) => {
  const target = join(VOICE_DIR, `${id}.mp3`)
  if (existsSync(target) && !force) {
    return { file: target, model: resolveSpeech().models[0] ?? null, spoke: false }
  }
  if (hasSpeechEngine()) {
    const spoken = await generateSpeech({ text })
    writeAudio(target, spoken.buffer)
    console.log(`  ${id}: generated with ${spoken.model}`)
    return { file: target, model: spoken.model, spoke: true }
  }
  console.log(`  ${id}: generating with ${narration.voice}`)
  generateEdge({ text, target })
  return { file: target, model: null, spoke: true }
}

mkdirSync(VOICE_DIR, { recursive: true })
mkdirSync(RECORDED_DIR, { recursive: true })

// The engine that speaks the film: ElevenLabs first, OpenRouter second.
const provider = activeProvider()

// `--require-engine` refuses the free fallback: the film is not narrated with
// Edge when a provider was asked for. `make video-voice` uses it, so a
// missing key is an error and not a silent downgrade.
if (process.argv.includes('--require-engine') && !provider) {
  console.error(
    'voice.mjs: no speech key in the environment.\n' +
      '  Set ELEVENLABS_API_KEY (primary) or OPENROUTER_API_KEY (secondary) in .env.sandbox.\n' +
      '  Run: make video-key engine=elevenlabs',
  )
  process.exit(2)
}

console.log(
  provider
    ? `engine: ${provider.label} (${provider.id})`
    : 'engine: Microsoft Edge (no key in the environment)',
)

const durationsFile = join(ROOT, 'src/voice.durations.json')
// The durations that are already there: a file that is not spoken again keeps
// the engine that spoke it, even when the environment of the day is another.
const previous = existsSync(durationsFile) ? JSON.parse(readFileSync(durationsFile, 'utf8')) : {}

const durations = {}
for (const segment of narration.segments) {
  const recorded = findRecording(segment.id)
  const spoken = recorded ? null : await generate(segment.id, segment.text)
  const file = recorded ?? spoken.file
  const seconds = durationOf(file)
  const known = previous[segment.id] ?? {}
  durations[segment.id] = {
    file: publicPath(file),
    seconds: Number(seconds.toFixed(3)),
    frames: Math.ceil(seconds * FPS),
    // The name of the engine that spoke it: the provider of the environment,
    // the custom endpoint of `TTS_API_KEY`, or Edge.
    source: recorded
      ? 'recorded'
      : spoken.spoke
        ? (provider?.id ?? 'speech')
        : (known.source ?? provider?.id ?? 'edge'),
    // The model that spoke it: the one that answered, or the one the film
    // declares for a file that was not spoken again.
    model: recorded ? null : (spoken.spoke ? spoken.model : (known.model ?? spoken.model)),
  }
  console.log(
    `  ${segment.id}: ${durations[segment.id].source}, ${seconds.toFixed(2)}s ` +
      `(${durations[segment.id].frames} frames)`,
  )
}

writeFileSync(durationsFile, `${JSON.stringify(durations, null, 2)}\n`)

// The music bed is optional: drop a track at public/audio/bed.mp3 (or .m4a,
// .wav) and the composition plays it under the narration, from the first frame
// to the last. Without the file the film is voice only.
let bed = null
for (const extension of AUDIO_EXTENSIONS) {
  const candidate = join(ROOT, 'public/audio', `bed${extension}`)
  if (existsSync(candidate)) {
    const seconds = durationOf(candidate)
    bed = {
      file: `audio/bed${extension}`,
      seconds: Number(seconds.toFixed(3)),
      volume: 0.22,
    }
    break
  }
}
writeFileSync(join(ROOT, 'src/bed.json'), `${JSON.stringify(bed, null, 2)}\n`)

console.log(`\n${Object.keys(durations).length} segments written to src/voice.durations.json`)
console.log(bed ? `music bed: ${bed.file}` : 'music bed: none (voice only)')
