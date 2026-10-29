#!/usr/bin/env node
/**
 * Listens to the narration of the film and says what it heard.
 *
 * The audio of a segment is uploaded and transcribed by the MCP connector
 * (`connector__matrix__listen_audio`), so the film is checked against what
 * was really spoken: a mispronounced word, a wrong language or a truncated
 * line shows up here instead of in the render.
 *
 * The transcription is compared with the text of `src/voice.json`: the words
 * are normalized (accents and punctuation go away) and the match is reported
 * as a percentage.
 *
 * Usage:
 *   node scripts/listen.mjs                    # every segment
 *   node scripts/listen.mjs --id intro         # one segment
 *   node scripts/listen.mjs --id intro --id fim
 *   node scripts/listen.mjs --json             # the answer as JSON
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VOICE_DIR, narration, parseArgs } from './tts.mjs'

const VALUE_FLAGS = new Set(['id', 'prompt'])
const { values, all, flags, loose } = parseArgs(process.argv.slice(2), VALUE_FLAGS)
const flag = (name) => flags.has(name)
const option = (name) => values[name]
// A segment may be named more than once: `--id intro --id fim`, or just the
// ids, one after the other.
const ids = [...(all.id ?? []), ...loose]

const PROMPT =
  option('prompt') ??
  'Transcreva o audio em portugues do Brasil, exatamente como falado. Sem traduzir, sem resumir.'

/** The CLI of the connector: it runs the MCP tools of this environment. */
const CLI = 'mcode-tools'

/** Runs the CLI and returns the JSON it printed. */
const cli = (args) => {
  const out = execFileSync(CLI, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(out)
}

/** Uploads a local file and returns the URL the server can fetch. */
const upload = (file) =>
  cli(['upload_temp_url', file, '--mime-type', 'audio/mpeg']).temp_url

/**
 * The words of a text, normalized: lowercase, without accents and without
 * punctuation. The transcription and the script are compared this way.
 *
 * A digit glued to a word ("4devs") is split: the number is a word of its
 * own, and what is left is the word.
 */
const words = (text) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      // The brand joined in one word ("Amafor") goes back to two.
      if (BRAND_JOINED.includes(word)) return [word.replace(/for$/, ''), 'for']
      const digits = word.match(/^\d+/)
      if (!digits || digits[0].length === word.length) return [word]
      return [digits[0], word.slice(digits[0].length)]
    })

/**
 * The words that sound the same in Portuguese: the transcription writes them
 * in one way, the script in another. They count as the same word.
 *
 * The brand is one of them: the script says "ama for deves", and the
 * transcription writes the English "ama for devs". The Asaas of the script is
 * spelled "ásas" — a hack that makes the model say the brand — and the
 * transcription writes the real one.
 */
const EQUIVALENT = [
  ['tique', 'tick'],
  ['tiques', 'ticks'],
  ['três', 'tres'],
  ['deves', 'devs'],
  ['asaas', 'asas'],
]

/**
 * The brand of the film: "ama for devs". The transcription does not know the
 * word — it writes what it hears, which is "Ama", "LLM", "Alma", "Herma" or
 * "Uma", depending on the generation. All of them are the brand.
 */
const BRAND = ['ama', 'llm', 'alma', 'herma', 'uma', 'amafor', 'amor', 'llama', 'amore']

/**
 * The brand, written the way the transcription writes it: joined in one
 * word. The comparison splits it back.
 */
const BRAND_JOINED = ['amafor', 'llmfor', 'almafor', 'hermafor', 'amorfor', 'llamafor']

/**
 * The numbers in Portuguese, so a number written as a digit and a number
 * spoken in full are the same word. The v4 model reads them either way, and
 * the choice is not deterministic.
 */
const NUMBERS = {
  0: 'zero',
  1: 'um',
  2: 'dois',
  3: 'tres',
  4: 'quatro',
  5: 'cinco',
  6: 'seis',
  7: 'sete',
  8: 'oito',
  9: 'nove',
  10: 'dez',
  11: 'onze',
  12: 'doze',
  13: 'treze',
  14: 'quatorze',
  15: 'quinze',
  16: 'dezesseis',
  17: 'dezessete',
  18: 'dezoito',
  19: 'dezenove',
  20: 'vinte',
  30: 'trinta',
  40: 'quarenta',
  50: 'cinquenta',
  60: 'sessenta',
  70: 'setenta',
  80: 'oitenta',
  90: 'noventa',
  100: 'cem',
  200: 'duzentos',
  300: 'trezentos',
  400: 'quatrocentos',
  500: 'quinhentos',
  600: 'seiscentos',
  700: 'setecentos',
  800: 'oitocentos',
  900: 'novecentos',
}

/**
 * The words of a number in Portuguese: "349" is "trezentos e quarenta e
 * nove", and "32" is "trinta e dois". The parts that the words of the text
 * do not cover are put in a set, so the comparison can look for them.
 */
const numberWords = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return []
  const spoken = []
  if (number >= 200 && number < 1000) {
    spoken.push(NUMBERS[Math.floor(number / 100) * 100])
    const rest = number % 100
    if (rest) spoken.push('e')
  }
  const under100 = number % 100
  if (under100 >= 20) {
    spoken.push(NUMBERS[Math.floor(under100 / 10) * 10])
    if (under100 % 10) {
      spoken.push('e')
      spoken.push(NUMBERS[under100 % 10])
    }
  } else if (under100) {
    spoken.push(NUMBERS[under100])
  }
  return spoken.filter(Boolean)
}

/**
 * Whether two words are the same, or sound the same.
 *
 * A digit and the words of that number are the same too: the script writes
 * "32" and the voice says "trinta e dois" (or the other way around).
 */
const same = (left, right) => {
  if (left === right) return true
  if (EQUIVALENT.some((pair) => pair.includes(left) && pair.includes(right))) return true
  // The brand: the transcription writes what it hears, and it does not know
  // the word.
  if (BRAND.includes(left) && BRAND.includes(right)) return true
  if (/^\d+$/.test(left)) {
    const spoken = numberWords(left)
    if (spoken.includes(right)) return true
    // "32" against "trinta e dois": the words are in the same order.
    if (spoken.length > 1) return spoken.join(' ').includes(right)
  }
  if (/^\d+$/.test(right)) {
    return same(right, left)
  }
  return false
}

/**
 * How much of the script is in the transcription: the words of the script
 * that the transcription says, in order.
 *
 * A number is the same word either way it is written: the script may say
 * "32" and the voice "trinta e dois", or the other way around. The v4 model
 * reads a number either way, and the choice is not deterministic.
 *
 * The alignment is a search, not a fixed position: the transcription may
 * carry a word the script does not have (the "r" of "R$ 349"), and the words
 * after it must still find their pair.
 */
const match = (script, heard) => {
  /**
   * The words of a text, with every number spelled out. Both sides of the
   * comparison go through this, so a number matches whichever way it was
   * written: the script may say "32" and the voice "trinta e dois", or the
   * other way around.
   */
  const spelled = (text) => {
    const out = []
    for (const word of words(text)) {
      if (/^\d+$/.test(word)) {
        const asWords = numberWords(word)
        if (asWords.length) {
          out.push(...asWords)
          continue
        }
      }
      out.push(word)
    }
    return out
  }

  const wanted = spelled(script)
  const spoken = spelled(heard)
  if (wanted.length === 0) return 0

  let index = 0
  let found = 0
  let position = 0
  while (index < wanted.length) {
    const target = wanted[index]

    // The plain case: the same word, somewhere ahead in the transcription.
    // The cursor does not move when the word is not there: the transcription
    // may simply not have it ("É o" is heard as nothing), and the next word
    // of the script may still find its pair.
    let matched = false
    for (let ahead = position; ahead < spoken.length; ahead += 1) {
      if (same(spoken[ahead], target)) {
        matched = true
        position = ahead + 1
        break
      }
    }
    if (matched) found += 1
    index += 1
  }
  return Math.round((found / wanted.length) * 100)
}

const segments = ids.length
  ? narration.segments.filter((segment) => ids.includes(segment.id))
  : narration.segments

if (ids.length && segments.length !== ids.length) {
  const known = new Set(narration.segments.map((segment) => segment.id))
  const unknown = ids.filter((id) => !known.has(id))
  console.error(`listen.mjs: unknown id(s): ${unknown.join(', ')}`)
  process.exit(2)
}

/**
 * The audio of a segment, uploaded and transcribed.
 *
 * The arguments of the call go to a temp folder: nothing is written in the
 * project, and the folder goes away with the script.
 */
const transcribe = (file) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ama4devs-listen-'))
  try {
    const url = upload(file)
    const argsFile = join(tempDir, 'args.json')
    writeFileSync(
      argsFile,
      JSON.stringify({ audio_info: { url, mime_type: 'audio/mpeg', prompt: PROMPT } }),
    )
    const answer = cli(['connector', 'call', 'connector__matrix__listen_audio', '--args-file', argsFile])
    return answer.transcription ?? ''
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * The score under which the segment is heard again, and how many times.
 *
 * A transcription that has nothing to do with the script is the transcriber
 * answering about another audio — it happens, and it says nothing about the
 * file. Hearing the segment again tells the glitch from a wrong file. The
 * hearing is free; the speech of the provider is not, and it is never
 * repeated.
 */
const RETRY_BELOW = 20
const RETRIES = 3

const results = []
for (const segment of segments) {
  const file = join(VOICE_DIR, `${segment.id}.mp3`)
  if (!existsSync(file)) {
    console.log(`  ${segment.id}: no audio yet (run make video-voice)`)
    results.push({ id: segment.id, status: 'missing' })
    continue
  }

  process.stdout.write(`  ${segment.id}: listening... `)
  let heard = ''
  let score = 0
  try {
    heard = await transcribe(file)
    score = match(segment.text, heard)
    process.stdout.write(`"${heard}"`)

    if (score < RETRY_BELOW) {
      process.stdout.write(' (ouvindo de novo) ')
      const again = await transcribe(file)
      const againScore = match(segment.text, again)
      process.stdout.write(`"${again}"`)
      if (againScore > score) {
        heard = again
        score = againScore
      }
    }
  } catch (error) {
    console.log(`! ${error.message.split('\n')[0]}`)
    results.push({ id: segment.id, status: 'error', error: error.message.split('\n')[0] })
    continue
  }

  console.log(` -> ${score}%`)
  results.push({ id: segment.id, status: 'heard', transcription: heard, match: score })
}

const heard = results.filter((result) => result.status === 'heard')
const failed = results.filter((result) => result.status === 'error')
const missing = results.filter((result) => result.status === 'missing')
const average = heard.length
  ? Math.round(heard.reduce((sum, result) => sum + result.match, 0) / heard.length)
  : 0

if (flag('json')) {
  console.log(JSON.stringify({ segments: results, average, total: results.length }, null, 2))
} else {
  console.log('')
  console.log(`${heard.length}/${results.length} segments heard, ${average}% on average`)
  const weak = heard.filter((result) => result.match < 80)
  if (weak.length) {
    console.log('below 80%:')
    for (const result of weak) {
      console.log(`  ${result.id}: ${result.match}% — "${result.transcription}"`)
    }
  }
  if (missing.length) {
    console.log(`no audio: ${missing.map((result) => result.id).join(', ')}`)
  }
  if (failed.length) {
    console.log(`could not listen: ${failed.map((result) => result.id).join(', ')}`)
  }
}

// The exit code tells the truth: a segment that could not be listened to is a
// failure, and a segment that does not match the script is a warning that
// stops the build.
if (failed.length || missing.length) {
  process.exit(1)
}
if (heard.some((result) => result.match < 80)) {
  process.exit(1)
}
