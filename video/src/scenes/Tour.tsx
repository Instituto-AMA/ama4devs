import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from 'remotion'
import type { Beat } from '../film.ts'
import { camera, capture, fonts, layout, motion, palette } from '../theme.ts'

/**
 * One shot of the tour: the captured screen under a camera that pushes in on
 * the thing the narration is talking about, the highlight around the element
 * the panel is showing, and the caption of the film.
 *
 * A shot arrives over the previous one the way a cut does in a film: the new
 * picture comes in sharp and a little large, the old one goes out sharp and a
 * little further away, and a light crosses the frame while they trade places.
 */

const ease = Easing.bezier(0.33, 0, 0.16, 1)

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** A grain that never changes from frame to frame, so the render stays fast. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">' +
    '<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/></filter>' +
    '<rect width="180" height="180" filter="url(#g)"/></svg>',
)}")`

interface Word {
  text: string
  emphasis: boolean
}

/**
 * The caption of the film, word by word. A word between asterisks is the one
 * the film emphasizes: it comes out in gold and in italic.
 */
const wordsOf = (caption: string): Word[] => {
  const words: Word[] = []
  caption.split('*').forEach((part, index) => {
    const emphasis = index % 2 === 1
    for (const word of part.split(' ')) {
      if (word) {
        words.push({ text: word, emphasis })
      }
    }
  })
  return words
}

export const Tour = ({ beat }: { beat: Beat }) => {
  const frame = useCurrentFrame()
  const duration = beat.duration

  // The camera travels from the rest position to the box the shot is about.
  const travel = ease(
    interpolate(frame, [0, duration], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  )
  const zoom = beat.zoom ?? camera.zoom
  const focusX = beat.focus ? beat.focus.x + beat.focus.w / 2 : capture.width / 2
  const focusY = beat.focus ? beat.focus.y + beat.focus.h / 2 : capture.height / 2
  const scale = camera.base + (zoom - camera.base) * travel

  // The screen is always centered, and the camera may only travel inside the
  // part of the picture that overflows the frame: the mock has nothing else.
  const slackX = Math.max(0, (capture.width * scale - layout.width) / 2)
  const slackY = Math.max(0, (capture.height * scale - layout.height) / 2)
  const offsetX = clamp(scale * (capture.width / 2 - focusX), -slackX, slackX) * travel
  const offsetY = clamp(scale * (capture.height / 2 - focusY), -slackY, slackY) * travel
  const left = (layout.width - capture.width * scale) / 2 + offsetX
  const top = (layout.height - capture.height * scale) / 2 + offsetY

  // The trade between the two shots: the new one arrives, the old one leaves.
  const enter = interpolate(frame, [0, motion.dissolve], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const exit = interpolate(frame, [duration - motion.dissolve, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const arrive = interpolate(enter, [0, 1], [1.045, 1])
  const leave = interpolate(exit, [0, 1], [1, 1.04])
  const blur = interpolate(enter, [0, 1], [9, 0]) + interpolate(exit, [0, 1], [0, 9])

  // The highlight arrives with the camera and leaves before the cut.
  const spotOpacity = beat.spot
    ? interpolate(
        frame,
        [8, 20, duration - 18, duration - 4],
        [0, 1, 1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      )
    : 0

  // The light that crosses the picture while the two shots trade places.
  const sweep = interpolate(frame, [0, motion.sweep], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // The words of the caption arrive one after the other, like a line read out.
  const words = wordsOf(beat.caption).map((word, index) => {
    const delay = motion.captionLead + index * motion.captionStagger
    const progress = spring({
      frame: Math.max(0, frame - delay),
      fps: 30,
      config: { damping: 30, mass: 0.7, stiffness: 110 },
    })
    return { ...word, progress }
  })

  // The caption leaves with the shot it belongs to.
  const captionOut = interpolate(frame, [duration - 14, duration - 2], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ backgroundColor: palette.base }}>
      {/* the screen under the camera */}
      <AbsoluteFill style={{ overflow: 'hidden', opacity: enter }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: capture.width,
            height: capture.height,
            transform: `translate(${left}px, ${top}px) scale(${scale * arrive * leave})`,
            transformOrigin: 'top left',
            filter: `blur(${blur.toFixed(2)}px)`,
          }}
        >
          <Img src={staticFile(`shots/${beat.file}`)} style={{ width: '100%', height: '100%' }} />
          {beat.spot ? (
            <div
              style={{
                position: 'absolute',
                left: beat.spot.x - 8,
                top: beat.spot.y - 8,
                width: beat.spot.w + 16,
                height: beat.spot.h + 16,
                border: `3px solid ${palette.ok}`,
                borderRadius: 16,
                boxShadow: `0 0 0 9999px rgba(3, 9, 22, 0.16), 0 0 34px ${palette.ok}66`,
                opacity: spotOpacity,
              }}
            />
          ) : null}
        </div>
      </AbsoluteFill>

      {/* the scrim that holds the film's own text: it belongs to the picture */}
      <AbsoluteFill
        style={{
          opacity: enter,
          background:
            'linear-gradient(180deg, rgba(4,9,22,0.86) 0%, rgba(4,9,22,0) 200px, rgba(4,9,22,0) 660px, rgba(4,9,22,0.96) 100%)',
        }}
      />

      {/* the light that crosses the frame while the shots trade places */}
      <AbsoluteFill
        style={{
          overflow: 'hidden',
          pointerEvents: 'none',
          opacity: Math.sin(sweep * Math.PI) * 0.7,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '-40%',
            background:
              'linear-gradient(72deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.07) 46%, rgba(230,201,138,0.13) 50%, rgba(255,255,255,0.07) 54%, rgba(255,255,255,0) 62%)',
            transform: `translateX(${interpolate(sweep, [0, 1], [-34, 34])}%)`,
          }}
        />
      </AbsoluteFill>

      {/* the caption of the film */}
      <div
        style={{
          position: 'absolute',
          left: layout.pad,
          bottom: 96,
          maxWidth: 1240,
          opacity: captionOut,
        }}
      >
        <div
          style={{
            width: interpolate(
              Math.min(1, frame / (motion.captionLead + 10)),
              [0, 1],
              [0, 108],
            ),
            height: 3,
            marginBottom: 22,
            background: `linear-gradient(90deg, ${palette.gold}, ${palette.goldSoft})`,
          }}
        />
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 54,
            fontWeight: 400,
            lineHeight: 1.16,
            letterSpacing: -0.4,
            color: palette.paper,
            textShadow: '0 4px 26px rgba(0,0,0,0.7)',
          }}
        >
          {words.map((word, index) => (
            <span
              key={`${word.text}-${index}`}
              style={{
                display: 'inline-block',
                marginRight: '0.26em',
                opacity: Math.min(1, word.progress),
                transform: `translateY(${((1 - word.progress) * 20).toFixed(2)}px)`,
                color: word.emphasis ? palette.gold : palette.paper,
                fontStyle: word.emphasis ? 'italic' : 'normal',
              }}
            >
              {word.text}
            </span>
          ))}
        </div>
      </div>

      {/* the grain and the vignette of the picture */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          backgroundImage: GRAIN,
          backgroundRepeat: 'repeat',
          opacity: 0.045,
          mixBlendMode: 'overlay',
        }}
      />
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background:
            'radial-gradient(1250px 760px at 50% 44%, rgba(0,0,0,0) 52%, rgba(3,7,18,0.55) 100%)',
        }}
      />
    </AbsoluteFill>
  )
}
