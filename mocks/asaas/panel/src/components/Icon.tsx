/**
 * The icons. HugeIcons (free license), in the `stroke-rounded` style.
 *
 * They used to be Unicode glyphs (`⌂`, `⚡`, `⑃`), and the change is not
 * cosmetic: half of them had the look of an EMOJI by default, so the browser
 * painted a yellow lightning bolt and a colored little house in the middle of a
 * monochrome navigation — and the same string became a different drawing on
 * each operating system. A font glyph is not an icon: it is whatever the user's
 * font decides it is.
 *
 * We import the DATA (`@hugeicons/core-free-icons`), not the React component of
 * the library. There are 13,624 tree-shakeable icons: the bundle carries only
 * the ones the screen uses, and the project does not gain a React dependency
 * just to draw a little house.
 */
import { h, type JSX } from 'preact'

/** The format of the package: a list of [tag, attributes]. */
export type IconData = ReadonlyArray<readonly [string, Record<string, unknown>]>

export function Icon({
  icon,
  size = 20,
  strokeWidth = 1.6,
  ...rest
}: {
  icon: IconData
  size?: number
  strokeWidth?: number
} & JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      {icon.map(([tag, attrs], i) =>
        // `h(tag, …)` and not a fixed `<path>`: the package also emits `circle`,
        // `rect` and `line`, and a fixed path would swallow those in silence —
        // the icon would render half, with no error at all.
        h(tag, {
          ...attrs,
          // Overrides the `stroke` that comes in the data (a fixed black). Without
          // this the icon ignores the theme and disappears in the dark background.
          stroke: 'currentColor',
          strokeWidth,
          key: i,
        }),
      )}
    </svg>
  )
}
