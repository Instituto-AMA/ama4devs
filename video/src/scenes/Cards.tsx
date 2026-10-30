import { AbsoluteFill, interpolate, spring, useCurrentFrame } from 'remotion'
import { filmInfo, CLOSING_FRAMES } from '../film.ts'
import { fonts, layout, palette } from '../theme.ts'

/**
 * The two cards of the film: the opening wordmark and the closing wordmark.
 * Between them, the tour is the real screen of the mock.
 *
 * The cards are paper, not screen: cream, ink and gold, set in the editorial
 * serif. The picture of the tour takes the frame back when it comes in.
 */

const rise = (frame: number, delay: number) =>
  interpolate(frame, [delay, delay + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">' +
    '<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/></filter>' +
    '<rect width="180" height="180" filter="url(#g)"/></svg>',
)}")`

/** The paper the cards are printed on. */
const Paper = () => (
  <>
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(1100px 700px at 22% 28%, rgba(255,255,255,0.9), rgba(244,239,227,0) 62%), radial-gradient(900px 620px at 82% 76%, rgba(230,201,138,0.16), rgba(244,239,227,0) 70%)',
        backgroundColor: palette.cream,
      }}
    />
    <AbsoluteFill
      style={{
        backgroundImage: GRAIN,
        opacity: 0.05,
        mixBlendMode: 'multiply',
        pointerEvents: 'none',
      }}
    />
  </>
)

const Wordmark = ({ size }: { size: number }) => (
  <div
    style={{
      fontFamily: fonts.serif,
      fontSize: size,
      fontWeight: 400,
      letterSpacing: size * -0.02,
      lineHeight: 0.94,
      color: palette.onCream,
    }}
  >
    ama<span style={{ color: palette.goldDeep, fontStyle: 'italic' }}>4</span>devs
  </div>
)

/** The gold hairline that opens the cards. */
const Rule = ({ frame, delay, width }: { frame: number; delay: number; width: number }) => (
  <div
    style={{
      width: interpolate(rise(frame, delay), [0, 1], [0, width]),
      height: 2,
      background: `linear-gradient(90deg, ${palette.goldDeep}, ${palette.goldSoft})`,
    }}
  />
)

export const Intro = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: palette.cream }}>
      <Paper />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          paddingLeft: layout.pad + 40,
        }}
      >
        <div style={{ opacity: rise(frame, 2) }}>
          <Rule frame={frame} delay={0} width={140} />
        </div>
        <div
          style={{
            marginTop: 34,
            fontFamily: fonts.sans,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 9,
            textTransform: 'uppercase',
            color: palette.goldDeep,
            opacity: rise(frame, 4),
            transform: `translateY(${(1 - rise(frame, 4)) * 16}px)`,
          }}
        >
          {filmInfo.kicker}
        </div>
        <div
          style={{
            marginTop: 26,
            opacity: rise(frame, 8),
            transform: `translateY(${(1 - rise(frame, 8)) * 22}px)`,
          }}
        >
          <Wordmark size={168} />
        </div>
        <div
          style={{
            marginTop: 30,
            fontFamily: fonts.serif,
            fontStyle: 'italic',
            fontSize: 52,
            lineHeight: 1.1,
            color: palette.onCreamSoft,
            opacity: rise(frame, 16),
            transform: `translateY(${(1 - rise(frame, 16)) * 20}px)`,
          }}
        >
          {filmInfo.tagline}
        </div>
        <div
          style={{
            marginTop: 46,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            fontFamily: fonts.mono,
            fontSize: 19,
            letterSpacing: 1.2,
            color: palette.onCreamSoft,
            opacity: rise(frame, 24),
          }}
        >
          <span
            style={{
              display: 'block',
              width: 54,
              height: 1,
              background: palette.onCreamSoft,
              opacity: 0.6,
            }}
          />
          mock da API · docker · sem cadastro
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export const Closing = () => {
  const frame = useCurrentFrame()
  const inCard = spring({ frame, fps: 30, config: { damping: 200, stiffness: 90, mass: 0.8 } })
  const out = interpolate(frame, [CLOSING_FRAMES - 16, CLOSING_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.cream,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: inCard * (1 - out),
      }}
    >
      <Paper />
      <div style={{ textAlign: 'center', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'center', opacity: rise(frame, 4) }}>
          <Rule frame={frame} delay={4} width={140} />
        </div>
        <div
          style={{
            marginTop: 28,
            opacity: rise(frame, 8),
            transform: `translateY(${(1 - rise(frame, 8)) * 22}px)`,
          }}
        >
          <Wordmark size={132} />
        </div>
        <div
          style={{
            marginTop: 36,
            display: 'flex',
            justifyContent: 'center',
            gap: 16,
            opacity: rise(frame, 16),
          }}
        >
          {filmInfo.chips.map((chip) => (
            <span
              key={chip}
              style={{
                fontFamily: fonts.sans,
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: 0.4,
                color: palette.onCream,
                padding: '14px 28px',
                borderRadius: 999,
                border: `1px solid rgba(23, 20, 14, 0.28)`,
              }}
            >
              {chip}
            </span>
          ))}
        </div>
        <div
          style={{
            marginTop: 44,
            fontFamily: fonts.serif,
            fontStyle: 'italic',
            fontSize: 36,
            color: palette.onCreamSoft,
            opacity: rise(frame, 24),
          }}
        >
          {filmInfo.line}
        </div>
      </div>
    </AbsoluteFill>
  )
}
