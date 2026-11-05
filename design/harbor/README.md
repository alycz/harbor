# Harbor design

Harbor follows the NEAR hackathon's visual language: warm cream paper, ink text, one cobalt accent, square corners and hairline rules.

- `tokens.css`: every colour, type, spacing, radius and motion token, as `--harbor-*` custom properties. `packages/ui` maps them onto the shadcn variables, so shadcn components pick them up unchanged.
- `assets/harbor-mark.svg`: the mark, a beacon inside a breakwater arch over a waterline, drawn on a 12×12 pixel grid. `harbor-mark-band.svg` is the same mark for dark ink sections. In the app the mark is the `HarborMark` component, so it takes the theme colours.

## Palette

| Token | Value | Use |
|---|---|---|
| `--harbor-background` | `#e9e1cd` | Page |
| `--harbor-surface` | `#eee7d6` | Cards |
| `--harbor-surface-raised` | `#f4eddd` | Popovers, menus |
| `--harbor-sand` | `#dcd2ba` | Secondary, muted, hover |
| `--harbor-text` | `#322e25` | Text, and the background of dark bands |
| `--harbor-text-secondary` | `#655d4f` | Labels, secondary text |
| `--harbor-border` | `#b7ac94` | Borders, inputs |
| `--harbor-accent` | `#005fb0` | The one accent: actions, links, focus, eyebrows |
| `--harbor-brand-blue` | `#0091fd` | The beacon, highlights |
| `--harbor-sky` | `#83dcff` | Accent text on dark bands |
| `--harbor-error` | `#b53124` | Errors, destructive actions |

## Type

- **IBM Plex Mono** for everything you read, at 400, 500 and 600.
- **Arial / Helvetica, bold** for headings, set uppercase and tight (`-1px` to `-4px`), with one phrase in the accent colour.
- **Pixelify Sans** for step numbers and decoration only. Its 5 and 8 read as S and B at small sizes, so money and percentages use bold Arial instead.

## Patterns

- **Eyebrow:** a small accent label above a heading, such as `■ 01 / HOW IT WORKS`.
- **Primary action:** solid accent, square, with an animated rainbow along the bottom edge and a soft rainbow glow underneath. On hover it lifts 3px and leaves a hard ink shadow.
- **Dark band:** ink background, paper text, sky eyebrows, a faint scanline overlay. One per page at most.

## Workspace

Every page except the landing uses a second look, taken from Pilot (`alycz/pilot`), which follows Royco: warm paper, off-white cards with 12px corners and 6px controls, hairline warm-grey rules, Inter for reading and figures, Newsreader for display, and one cobalt accent. The landing keeps the NEAR look above.

- `apps/web/src/styles/workspace.css`: the workspace tokens. The shell sets `data-surface="workspace"` on `<html>` while it is mounted, so they also reach popovers, dialogs and sheets that portal to `<body>`, and they never touch the landing. Inside the workspace, a filled button is solid cobalt, without the rainbow edge.
- `apps/web/src/components/workspace.tsx`: the building blocks.
  - **Page header:** a small label with an icon, a serif title, one paragraph, actions to the right.
  - **Hero card:** Royco's ink card: a serif statement and the page's few headline figures, each on a hairline. One per page, where the page spends its emphasis (Research, Earn, the disconnected Portfolio, the rules on Policy).
  - **Panel:** a card with an optional title row and an aside for a status or count.
  - **Tabs:** underline tabs and Royco's segmented control, each with a highlight that slides to the choice.
  - **Chips:** small rounded status labels, coloured by meaning only. A status that changes rolls rather than swapping.
- Tables follow Royco's market table: one card, the filters in its header, sentence-case heads, roomy rows, numbers right-aligned.
- Logos are real marks from DefiLlama's icon CDN (chains, protocols, swap assets); a bridged asset such as `USDC.arb` carries its chain as a small badge.

Motion follows Benji Taylor's Stageshow rules: feedback stays quick (150ms); arrivals take `cubic-bezier(0.25, 0.8, 0.25, 1)`; things that travel take `cubic-bezier(0.45, 0, 0.1, 1)`; sections stagger 60ms in reading order; numbers roll digit by digit (`RollingNumber`), and words roll in place (`RollText`). Everything holds still under reduced motion.

Loading states use Skullet: data is wrapped in its `<Skeleton>` with a sample from `apps/web/src/lib/samples.ts`, so the skeleton is measured from the real layout and nothing moves when the content arrives.

Both looks are light only. Fonts are licensed under the SIL Open Font License; the texts are in `apps/web/public/licenses/`.
