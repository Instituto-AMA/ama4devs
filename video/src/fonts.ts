import { loadFont } from '@remotion/fonts'
import { staticFile } from 'remotion'

/**
 * The site's own typefaces, served from the project so the render never
 * depends on a font CDN being up. Every file is the variable font: the whole
 * weight axis is available to the film.
 */

loadFont({
  family: 'Doto',
  url: staticFile('fonts/Doto-latin.woff2'),
  weight: '400 900',
})

loadFont({
  family: 'Archivo',
  url: staticFile('fonts/Archivo-latin.woff2'),
  weight: '100 900',
})

loadFont({
  family: 'Martian Mono',
  url: staticFile('fonts/MartianMono-latin.woff2'),
  weight: '100 800',
})

loadFont({
  family: 'Instrument Serif',
  url: staticFile('fonts/InstrumentSerif-latin.woff2'),
  weight: '400',
})

loadFont({
  family: 'Instrument Serif',
  url: staticFile('fonts/InstrumentSerif-latin-italic.woff2'),
  weight: '400',
  style: 'italic',
})
