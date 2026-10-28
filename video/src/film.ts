import filmData from './film.json'
import shotsData from './shots.json'
import durationsData from './voice.durations.json'
import cuesData from './voice.cues.json'
import { FPS, motion } from './theme.ts'

/**
 * The timeline of the film, computed from three files:
 *
 *   shots.json          the stills captured from the running mock, with the
 *                       box the camera focuses on and the box it highlights;
 *   film.json           what the film says over each shot: the caption line,
 *                       the chapter and the narration;
 *   voice.durations.json  the length of every narration file, written by
 *                       scripts/voice.mjs.
 *
 * A beat lasts as long as its narration needs, plus a breath. The next beat
 * starts DISSOLVE frames early, so the picture dissolves into the next one.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Shot {
  file: string
  name: string
  url: string
  caption: string
  focus: Box | null
  spot: Box | null
}

interface BeatEntry {
  file: string
  caption: string
  chapter: number
  voice: string | null
  /** Where the camera looks, in the pixels of the capture. */
  focus: [number, number]
  /** Whether the frame highlights the element the panel is showing. */
  spot: boolean
  /** How close the camera ends up. */
  zoom?: number
}

interface Film {
  title: string
  kicker: string
  tagline: string
  chapters: string[]
  intro: { voice: string | null }
  outro: { voice: string | null; chips: string[]; line: string }
  beats: BeatEntry[]
}

interface VoiceLength {
  file: string
  seconds: number
  frames: number
  source: string
}

export interface Beat {
  index: number
  file: string
  caption: string
  chapter: number
  chapterLabel: string
  focus: Box | null
  spot: Box | null
  from: number
  duration: number
  voice: string | null
  zoom: number
}

export interface VoiceCue {
  id: string
  file: string
  from: number
  frames: number
}

/** The frames the picture of one shot dissolves into the next. */
export const DISSOLVE = motion.dissolve
/** The shortest a shot may stay on screen. */
const MIN_BEAT = 58
/** The silence after the narration of a shot, before the cut. */
const VOICE_PAD = 26
/** The silence before the narration of a shot starts. */
const VOICE_LEAD = 7
/** The silence between two narrations. */
const VOICE_GAP = 8

const film = filmData as Film
const shots = shotsData as Shot[]
const lengths = durationsData as Record<string, VoiceLength>

/** The lines pinned to a second of the film, written by scripts/say.mjs. */
const cues = cuesData as Record<string, { at?: number; from?: number; file?: string }>

/**
 * The capture writes the size of a box in two shapes (the browser measurement
 * and the one of the overlay). The film reads them both.
 */
const toBox = (raw: Box | null): Box | null => {
  if (!raw) {
    return null
  }
  const source = raw as unknown as Record<string, number>
  const w = source.w ?? source.width ?? 0
  const h = source.h ?? source.height ?? 0
  if (!w || !h) {
    return null
  }
  return { x: source.x, y: source.y, w, h }
}

const voiceFrames = (id: string | null): number => {
  if (!id) {
    return 0
  }
  return lengths[id]?.frames ?? 0
}

export const beats: Beat[] = film.beats.map((entry, index) => {
  const shot = shots.find((candidate) => candidate.file === entry.file)
  if (!shot) {
    throw new Error(`the film wants the shot ${entry.file}, and the capture does not have it`)
  }
  return {
    index,
    file: shot.file,
    caption: entry.caption,
    chapter: entry.chapter,
    chapterLabel: film.chapters[entry.chapter] ?? '',
    focus: { x: entry.focus[0], y: entry.focus[1], w: 0, h: 0 },
    spot: entry.spot ? toBox(shot.spot) : null,
    from: 0,
    duration: MIN_BEAT,
    voice: entry.voice,
    zoom: entry.zoom ?? 1.38,
  }
})

/** The opening card, before the first screen: as long as its narration. */
export const INTRO_FRAMES = voiceFrames(film.intro.voice) + 24
/** The closing card, after the last screen: as long as its narration. */
export const OUTRO_FRAMES = voiceFrames(film.outro.voice) + 44

/** Every narration of the film, placed on the timeline. */
export const voiceCues: VoiceCue[] = []

const place = (id: string | null, from: number) => {
  if (!id) {
    return
  }
  const length = lengths[id]
  if (!length) {
    return
  }
  voiceCues.push({ id, file: length.file, from, frames: length.frames })
}

/**
 * The shots are laid out one after the other, and each one lasts as long as
 * its narration needs. Two narrations never talk over each other: when a line
 * would start while the previous one is still speaking, the shot waits.
 *
 * A cue in voice.cues.json pins a line to the second it must start at; the
 * shot grows to fit it. A pinned line never talks over the previous one: the
 * cue waits for it.
 */
place(film.intro.voice, 10)
let cursor = INTRO_FRAMES
let spokenUntil = voiceFrames(film.intro.voice) + 10
for (const beat of beats) {
  const narration = voiceFrames(beat.voice)
  const pinned = beat.voice ? cues[beat.voice]?.from : undefined
  const wanted = pinned ?? Math.max(cursor + VOICE_LEAD, spokenUntil + VOICE_GAP)
  const start = Math.max(wanted, cursor, spokenUntil + VOICE_GAP)
  beat.from = cursor
  beat.duration = Math.max(MIN_BEAT, start - cursor + narration + VOICE_PAD)
  if (narration) {
    place(beat.voice, start)
    spokenUntil = start + narration
  }
  cursor += beat.duration - DISSOLVE
}

/** The frame the last screen gives way to the closing card. */
export const OUTRO_FROM = cursor + DISSOLVE
export const TOTAL_FRAMES = OUTRO_FROM + OUTRO_FRAMES

/**
 * The shot on the screen at a given frame. During a dissolve the shot that
 * started last is the one the film is in.
 */
export const beatAt = (frame: number): Beat | null => {
  let current: Beat | null = null
  for (const beat of beats) {
    if (beat.from <= frame) {
      current = beat
    }
  }
  return current
}

place(film.outro.voice, OUTRO_FROM + 18)

export const filmInfo = {
  title: film.title,
  kicker: film.kicker,
  tagline: film.tagline,
  chips: film.outro.chips,
  line: film.outro.line,
}
