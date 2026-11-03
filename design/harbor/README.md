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
- **Pixelify Sans** for big numerals, such as amounts and step numbers.

## Patterns

- **Eyebrow:** a small accent label above a heading, such as `■ 01 / HOW IT WORKS`.
- **Primary action:** solid accent, square, and on hover it lifts 3px and leaves a hard ink shadow.
- **Dark band:** ink background, paper text, sky eyebrows, a faint scanline overlay.

Harbor is light only. Fonts are licensed under the SIL Open Font License; the texts are in `apps/web/public/licenses/`.
