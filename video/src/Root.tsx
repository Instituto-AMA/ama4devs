import type { ReactNode } from 'react'
import { AbsoluteFill, Audio, Composition, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Closing, Intro } from './scenes/Cards.tsx'
import { Furniture } from './scenes/Furniture.tsx'
import { Tour } from './scenes/Tour.tsx'
import bedData from './bed.json'
import { beats, INTRO_FRAMES, CLOSING_FRAMES, CLOSING_FROM, TOTAL_FRAMES, voiceCues } from './film.ts'
import { palette } from './theme.ts'

interface MusicBed {
  file: string
  seconds: number
  volume: number
}

const bed = bedData as MusicBed | null

/**
 * The narration: one file per line, placed on the timeline by the shot the
 * line belongs to. The lengths come from src/voice.durations.json, written by
 * scripts/voice.mjs.
 */
const Voice = () => (
  <>
    {voiceCues.map((cue) => (
      <Sequence key={cue.id} from={cue.from} durationInFrames={cue.frames}>
        <Audio src={staticFile(cue.file)} />
      </Sequence>
    ))}
  </>
)

/** The optional music bed, under the voice, from the first frame to the last. */
const MusicBed = () => {
  if (!bed) {
    return null
  }
  return (
    <Sequence from={0} durationInFrames={TOTAL_FRAMES}>
      <Audio src={staticFile(bed.file)} volume={bed.volume} />
    </Sequence>
  )
}

/**
 * The line of the film that says how far the tour has gone: one segment per
 * shot, filling as the film walks through the screens.
 */
const Progress = () => {
  const frame = useCurrentFrame()
  const gap = 4
  const width = (100 - gap * (beats.length - 1)) / beats.length

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        gap: `${gap}px`,
      }}
    >
      {beats.map((beat) => {
        const fill = interpolate(frame, [beat.from, beat.from + beat.duration], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        return (
          <div
            key={beat.file}
            style={{
              width: `${width}%`,
              height: 3,
              background: 'rgba(232,236,251,0.16)',
            }}
          >
            <div
              style={{
                width: `${fill * 100}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${palette.goldDeep}, ${palette.gold})`,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

const AsaasTour = () => (
  <AbsoluteFill style={{ backgroundColor: palette.base }}>
    <Sequence from={0} durationInFrames={INTRO_FRAMES + 18}>
      <Intro />
    </Sequence>
    {beats.map((beat) => (
      <Sequence key={beat.file} from={beat.from} durationInFrames={beat.duration}>
        <Tour beat={beat} />
      </Sequence>
    ))}
    <Sequence from={CLOSING_FROM} durationInFrames={CLOSING_FRAMES}>
      <Closing />
    </Sequence>
    <Furniture />
    <Progress />
    <MusicBed />
    <Voice />
  </AbsoluteFill>
)

export const RemotionRoot = () => {
  return (
    <Composition
      id="AsaasTour"
      component={AsaasTour}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
  )
}
