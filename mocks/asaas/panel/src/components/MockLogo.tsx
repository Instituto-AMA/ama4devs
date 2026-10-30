import wordmark from '../assets/ama4devs-wordmark.jpg'

/**
 * The brand of the SIMULATOR: the ama4devs wordmark.
 *
 * It is NOT the logo of Asaas, and the difference is the point. Whoever opens
 * this screen needs to know, before anything else, that they are not in the
 * Asaas panel — they are in a simulator running on their machine. A logo
 * identical to the real product would be the first lie of a screen whose entire
 * value depends on being honest about what it is.
 *
 * The image is a crop of the repository banner (`site/assets/ama4devs.jpg`),
 * inlined into `ui.html` by the build. It carries its own dark background, so
 * it reads the same in the light and the dark theme.
 */
export const MockLogo = () => (
  <img
    src={wordmark}
    width="150"
    height="34"
    alt="ama4devs Asaas Mock Server"
    style={{ display: 'block', borderRadius: '6px' }}
  />
)
