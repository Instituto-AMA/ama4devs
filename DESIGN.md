---
name: The Running Receipt
surface: site/ (GitHub Pages), mocks/asaas/panel/ (the Asaas mock's operator panel)
colors:
  ground-home: "#1d1838"
  ground-whatsapp: "#0e3a2f"
  ground-asaas: "#0f2160"
  on-ground: "#ece9f7"
  on-ground-soft: "#b9b2d9"
  paper: "#f3f5f1"
  paper-dark-scheme: "#e9ece6"
  paper-band: "#e6e9e2"
  paper-rule: "#c9cdc4"
  ink: "#23212b"
  ink-soft: "#4b4857"
  fade: "#5f5880"
  print-red: "#b8262f"
  key-confirm: "#17804a"
  key-correct: "#f2c232"
  key-face: "#f7f7f4"
typography:
  display: "Doto 800, dot-matrix; receipt headers, sheet h2, wordmark, step numbers"
  headline: "Archivo 800, wdth 75-80; h1 clamp(40px, 6.2vw, 84px), band h2 clamp(30px, 3.6vw, 48px)"
  body: "Archivo 400, 17px/1.6, measure 66ch"
  code: "Martian Mono, wdth 87.5; receipt lines 12.5px, code blocks 13px"
shapes:
  tooth: 14px serrated paper edge (CSS conic-gradient mask)
  key-radius: 10px (small 8px)
  code-radius: 6px
---

# ama4devs: The Running Receipt

## Overview

The site is the mocks' own event log printed on a thermal receipt. Every call, status
change and webhook a mock produces is a timestamped line on cool thermal paper, and the
Asaas mock's virtual clock feeds paper. It refuses the developer-tool default (a dark hero
with a terminal and a grid of feature cards).

Each page stands on a deep printer-body ground: violet for the home, bottle green for the
WhatsApp mock, ultramarine for the Asaas mock (`<body data-tool="whatsapp|asaas">`). What
the visitor reads sits on paper with torn edges. Controls are card-machine keypad keys.

## Colors

- **Grounds** own whole pages and change per mock; text on a ground uses `on-ground` and
  `on-ground-soft`, tinted from the ground, never gray.
- **Paper** is the only reading surface. `fade` (a faded thermal violet) carries
  timestamps, comments and secondary print; `print-red` is the second color of a thermal
  printer: refusals, errors, removed lines, required markers.
- **Keys**: green confirms (the primary action of a view), yellow corrects (again, reset),
  white is a plain key. Green holds white text at 4.97:1.
- Under `prefers-color-scheme: dark` only the paper dims to `paper-dark-scheme`; the grounds
  are already dark.

## Typography

- **Doto** (dot-matrix) is the print head: the receipt brand, day lines, the headings of
  paper sheets, the planned stubs' heading, step numbers and the wordmark. Never body.
- **Archivo** at condensed widths sets page headlines on the ground and all prose.
- **Martian Mono** is for code, receipt lines and data only, never as a costume for labels.

## Layout

- Page cap 1240px with a `clamp(16px, 4vw, 44px)` gutter.
- **Hero**: copy left on the ground (headline, lead, the one command, keys); the printer
  right (paper window, machine body with slot and keypad). Stacks under 960px.
- **Bands** separate sections on the ground with a 1px `ground-line` rule.
- **Vias**: two receipt copies side by side, one per mock (stack under 900px).
- **Doc pages** (quick start, API, docs): index on the ground at 220px, sticky; content on
  one long paper sheet. Sections on paper are torn apart by a dotted perforation, not a rule.
- **Planned mocks** are blank slots: dashed outlines on the ground, no link, no date.

## Components

- **Printer** (`[data-printer]`): lines live in the HTML with `data-step`; step 0 prints
  when the printer enters the view, each later step waits for the green key, whose label is
  the next step's action. The yellow key reprints. Lines sweep in with `steps(16)` and the
  paper jerks up with `steps(3)`; reduced motion prints instantly. Every line replays a
  real run of the images: change a line only after rerunning it.
- **Command** (`.cmd`): the one line to type, on the ground, with a copy key.
- **Code block** (`.code`): printed on `paper-band`, wraps instead of scrolling, copy key
  top right (above the code under 640px). `.add`/`.del` lines for base-URL swaps.
- **Keys** (`.key`, `.confirm`, `.correct`, `.small`): a 4px pressed depth that drops to 1px
  on press, stepped transition.
- **Tabs** (`.tabs`): Overview, Quick start, API, Docs; the current one is a paper key.
- **API rows** (`details.op-row`): method, path, behavior badge (`live` green, `spec`
  plain), summary; opening one fetches `site/data/<mock>-api-details.json` once and renders
  parameters, body fields, request examples and responses as chips per status (2xx green,
  errors red). `#op-<id>` links open a row.

## Motion

One authored moment per page: the printer. Keys step on press. No scroll-triggered
entrances, no hover animations on cards.

## The panel

The Asaas mock's operator panel is this world at the size of a workbench: the same
ground, the same paper, the same keys, the same three voices. It is a screen the
developer works in, so the expression shrinks to precision and the ledger carries the
personality.

- **The machine**: the rail (left) and the strip (top) are the printer body — the
  ground. The open section of the rail is a white key pressed into the body.
- **The sheet**: the work sits on one paper sheet whose top edge is torn by the row of
  teeth where the paper leaves the slot. The sheet has no rounded card in it: a
  section is a heading and a rule.
- **Keys and slots**: a key belongs to the machine and keeps its white face in both
  themes, with a dark label on it. A slot belongs to the paper and follows it: in the
  dark receipt the search, the input and the chip are cut in the sheet itself.
- **The dark receipt**: the theme is an explicit choice, not the system's. The ground
  stays the ground; the paper becomes a deep violet stock and the ink turns light.
  Every slot, key, stamp and rule stays readable in both.
- **The ledger**: the tables are the receipt's body — Martian Mono for ids, dates and
  money, dashed perforations between the lines, the column heads in small caps.
- **Stamps**: a state is a stamp, a small rectangle in the tone's hairline and ink,
  never a pill that shouts over the number it belongs to.
- **Print head**: Doto is for the small pieces (section labels, group names, stamps).
  The page headline is Archivo 800 narrow; a dot matrix at title size turns into a
  mosaic nobody reads.

## Do's and Don'ts

- Do keep every claim and every printed line true to the mocks today; planned providers
  show as blank slots.
- Do give a new mock its own ground hue and reuse paper, keys and type unchanged.
- Don't add cards with icons, eyebrow labels, gradient text or glass.
- Don't use Doto for prose or Martian Mono for labels.
- Don't hand-edit `site/data/`; run `node scripts/site-api-data.mjs`.
- Don't paint a screen with a primitive: the panel's screens consume the semantic
  names (`--paper`, `--ink`, `--slot-face`, `--key-face`), so the dark receipt can
  change the sheet without hunting a hex in six files.
