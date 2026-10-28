import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { beatAt, beats, INTRO_FRAMES, OUTRO_FROM } from '../film.ts'
import { fonts, layout, palette } from '../theme.ts'

/**
 * The furniture of the frame: the chapter the film is in and the wordmark.
 *
 * It lives above the shots, not inside them: the chapter changes once, at the
 * cut, and never two chapters share the same frame. It sits on the lower
 * right, where the picture of the mock has nothing of its own.
 */
export const Furniture = () => {
  const frame = useCurrentFrame()
  const beat = frame >= INTRO_FRAMES && frame < OUTRO_FROM ? beatAt(frame) : null

  const visible =
    interpolate(frame, [INTRO_FRAMES - 6, INTRO_FRAMES + 6], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) *
    interpolate(frame, [OUTRO_FROM - 6, OUTRO_FROM + 6], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })

  // The chapter arrives with the shot that opens it.
  const opened = beat ? beats.find((candidate) => candidate.chapter === beat.chapter) : null
  const chapterIn = opened
    ? interpolate(frame, [opened.from, opened.from + 18], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0

  return (
    <AbsoluteFill style={{ opacity: visible, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          right: layout.pad,
          bottom: 46,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          fontFamily: fonts.sans,
          textShadow: '0 2px 12px rgba(0,0,0,0.7)',
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: 5,
            textTransform: 'uppercase',
            color: palette.gold,
            opacity: chapterIn,
            transform: `translateX(${(1 - chapterIn) * 12}px)`,
          }}
        >
          <span
            style={{
              display: 'block',
              width: 26,
              height: 2,
              background: palette.gold,
            }}
          />
          {beat?.chapterLabel ?? ''}
        </span>
        <span style={{ display: 'block', width: 1, height: 20, background: 'rgba(232,236,251,0.28)' }} />
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: fonts.serif,
            fontSize: 24,
            color: 'rgba(244,239,227,0.82)',
          }}
        >
          ama<span style={{ color: palette.gold, fontStyle: 'italic' }}>4</span>devs
        </span>
      </div>
    </AbsoluteFill>
  )
}
