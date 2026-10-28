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
 *   2. A generated voice, from the engine in the environment:
 *        OPENROUTER_API_KEY set  -> OpenRouter's speech endpoint (ElevenLabs,
 *          Gemini TTS, ...), the model and the voice in src/voice.json. The
 *          key is read from the environment and never written to the disk.
 *        no key                 -> Microsoft Edge neural voices (free, no
 *          account), `uvx --from edge-tts edge-tts`.
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
  durationOf,
  generateEdge,
  generateSpeech,
  hasSpeechEngine,
  narration,
  publicPath,
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

/** The generated voice of the segment, written to public/audio/voice. */
const generate = async (id, text) => {
  const target = join(VOICE_DIR, `${id}.mp3`)
  if (existsSync(target) && !force) {
    return target
  }
  if (hasSpeechEngine()) {
    const spoken = await generateSpeech({ text })
    writeFileSync(target, spoken.buffer)
    console.log(`  ${id}: generated with ${spoken.model}`)
    return target
  }
  console.log(`  ${id}: generating with ${narration.voice}`)
  generateEdge({ text, target })
  return target
}

mkdirSync(VOICE_DIR, { recursive: true })
mkdirSync(RECORDED_DIR, { recursive: true })

const durations = {}
for (const segment of narration.segments) {
  const recorded = findRecording(segment.id)
  const file = recorded ?? (await generate(segment.id, segment.text))
  const seconds = durationOf(file)
  durations[segment.id] = {
    file: publicPath(file),
    seconds: Number(seconds.toFixed(3)),
    frames: Math.ceil(seconds * FPS),
    source: recorded ? 'recorded' : hasSpeechEngine() ? 'speech' : 'edge',
  }
  console.log(
    `  ${segment.id}: ${durations[segment.id].source}, ${seconds.toFixed(2)}s ` +
      `(${durations[segment.id].frames} frames)`,
  )
}

writeFileSync(
  join(ROOT, 'src/voice.durations.json'),
  `${JSON.stringify(durations, null, 2)}\n`,
)

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
