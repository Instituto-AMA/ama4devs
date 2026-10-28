/**
 * The film's visual language: the ama4devs site palette, the site's own
 * typefaces, and the rhythm every scene obeys.
 */

export const palette = {
  base: '#060a1c',
  ground: '#0f2160',
  groundRaise: '#18307e',
  line: '#2a44a0',
  on: '#e8ecfb',
  onSoft: '#aebbec',
  onFaint: '#7d88bd',
  accent: '#4d86ff',
  accentDeep: '#0038e5',
  danger: '#ff6470',
  dangerDeep: '#b8262f',
  warn: '#ffcf4d',
  ok: '#37d39b',
  paper: '#f3f5f1',
  /** The ink of the scrim that holds the captions, over the picture. */
  ink: 'rgba(4, 9, 22, 0.94)',
  /** The gold of the film: the accent of the cards and of the emphasized words. */
  gold: '#e6c98a',
  goldDeep: '#b4883a',
  goldSoft: 'rgba(230, 201, 138, 0.42)',
  /** The paper of the cards, and the ink that sits on it. */
  cream: '#f4efe3',
  creamDeep: '#e7e0cf',
  onCream: '#17140e',
  onCreamSoft: '#6b6353',
} as const

export const fonts = {
  /** Doto — fat display face, used for the giant words and the endcard. */
  display: 'Doto',
  /** Instrument Serif — the editorial voice: the statements and the cards. */
  serif: 'Instrument Serif',
  /** Archivo — the site's sans, used for every sentence. */
  sans: 'Archivo',
  /** Martian Mono — the site's mono, used for code, payloads and endpoints. */
  mono: 'Martian Mono',
} as const

export const layout = {
  pad: 110,
  width: 1920,
  height: 1080,
} as const

/** The frames of the film in one second. */
export const FPS = 30

/** The size of the captured screen, in the pixels of the capture. */
export const capture = {
  width: 1440,
  height: 900,
} as const

/**
 * The camera's rest position: the captured screen fills the height of the
 * frame and leaves a pillar on each side. Every shot pushes in from here, and
 * the camera never shows anything the mock does not have.
 */
export const camera = {
  base: 1.2,
  zoom: 1.38,
} as const

/**
 * The rhythm of the film: how long a shot takes to replace the one before it,
 * and how the words of a caption arrive.
 */
export const motion = {
  /** The frames the new screen takes to replace the old one. */
  dissolve: 20,
  /** The frames between two words of the same caption. */
  captionStagger: 1.7,
  /** The frames the caption waits before the first word arrives. */
  captionLead: 8,
  /** The frames the light sweep takes to cross the picture. */
  sweep: 26,
} as const
