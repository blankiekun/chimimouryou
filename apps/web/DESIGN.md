---
name: chimimouryou
description: Study Book, the default look of a self-hosted Japanese reader, set like a 参考書 (study book)
colors:
  paper: '#ffffff'
  paper-2: '#f3f5f4'
  ink: '#1b1b1b'
  ink-2: '#5a5f5d'
  ink-subtle: '#6a6f6d'
  rule: '#d5d9d7'
  spot: '#0f7a5c'
  spot-hover: '#0b6249'
  on-spot: '#ffffff'
  danger: '#b42318'
  warning: '#8a5300'
  dark-paper: '#121413'
  dark-paper-2: '#1b1e1d'
  dark-ink: '#e9ebea'
  dark-ink-2: '#a3a9a6'
  dark-rule: '#2e3331'
  dark-spot: '#4fbf95'
  dark-spot-hover: '#6fd0ab'
  dark-on-spot: '#0b1a15'
  dark-danger: '#f28b82'
typography:
  display:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '2.5rem'
    fontWeight: 700
  figure:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '2.75rem'
    fontWeight: 700
    lineHeight: 1.1
    fontFeature: 'tnum'
  headline:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '1.75rem'
  title:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 400
    lineHeight: 1.3
  number:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '1.375rem'
    fontFeature: 'tnum'
  body:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
  button:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 700
    lineHeight: 1.2
  small:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '0.8125rem'
  label:
    fontFamily: 'BIZ UDPGothic, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 700
rounded:
  sm: '2px'
spacing:
  control: '40px'
  control-touch: '44px'
  track: '3px'
components:
  button-primary:
    backgroundColor: '{colors.spot}'
    textColor: '{colors.on-spot}'
    typography: '{typography.button}'
    rounded: '{rounded.sm}'
    padding: '0 16px'
    height: '{spacing.control}'
  button-primary-hover:
    backgroundColor: '{colors.spot-hover}'
  button-secondary:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    typography: '{typography.button}'
    rounded: '{rounded.sm}'
    padding: '0 16px'
    height: '{spacing.control}'
  button-quiet:
    textColor: '{colors.spot}'
    typography: '{typography.button}'
  button-danger:
    textColor: '{colors.danger}'
    typography: '{typography.button}'
    rounded: '{rounded.sm}'
    height: '{spacing.control}'
  input:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.sm}'
    padding: '6px 10px'
    height: '{spacing.control}'
  segment-selected:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
    typography: '{typography.button}'
  switch-on:
    backgroundColor: '{colors.spot}'
    rounded: '{rounded.sm}'
    width: '40px'
    height: '24px'
  section-tag:
    backgroundColor: '{colors.spot}'
    textColor: '{colors.on-spot}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    height: '24px'
  point-box-tag:
    backgroundColor: '{colors.spot}'
    textColor: '{colors.on-spot}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
  progress-track:
    backgroundColor: '{colors.rule}'
    height: '{spacing.track}'
---

# Design System: chimimouryou

## Overview

**Creative North Star: "The Study Book (参考書)"**

The app's chrome is set like a Japanese study book: white paper, near-black ink and one green spot colour that carries all the structure. The green marks where you are and what matters (the active tab, numbered section tags, the POINT box frame, primary buttons, switches that are on, progress, selection). Everything else is ink on paper, divided by rules rather than boxes or shadows. Book text keeps the reader's own font and theme; Study Book dresses the library, settings, statistics, words pages and the reader's chrome around the book.

Study Book is the default, not a lock: it ships as the built-in themes Chimi Light and Chimi Dark (`chimi-light`/`chimi-dark`, `defaultLightThemeId`/`defaultDarkThemeId` in `src/lib/data/theme/themes.ts`). Washi, Sumi and the other built-ins stay available, and custom themes can recolour every token. The interface is English ("chars", "Vol. 1"); book content stays Japanese.

**Key Characteristics:**

- One spot colour; all other colour is ink, paper and rule.
- Flat: no shadows, no gradients, no blur (`shadow`, `coverShadow` and `blur` are transparent/0 in both Chimi themes).
- Square corners (2px), 1px rules, 2px ink rules on top of tables.
- One chrome face, BIZ UDPGothic, on a fixed type scale with tabular digits for figures.
- Numbered section heads and one POINT box per screen instead of icons and cards.

## Colors

Paper, ink and one green; dark mode inverts paper and ink and lifts the green.

### Primary

- **Spot Green** (light `spot`, dark `dark-spot`): the only accent. Active tab underline, section tags, POINT box frame and tag, primary buttons, quiet buttons' text, switches on, progress fills, focus ring, success, selection (24% / 32% alpha in the reader), heatmap high. Hover darkens in light (`spot-hover`) and lightens in dark (`dark-spot-hover`).
- **On Spot** (`on-spot`, `dark-on-spot`): text and switch knobs on a green fill.

### Neutral

- **Paper** (`paper`, `dark-paper`): page, header, controls and the light reader panel.
- **Paper 2** (`paper-2`, `dark-paper-2`): the one tonal step: hover backgrounds, the dark reader panel, empty heatmap cells.
- **Ink** (`ink`, `dark-ink`): text, secondary button outlines, the selected segment's fill, the 2px top rule of tables.
- **Ink 2** (`ink-2`, `dark-ink-2`): muted text, counts, table headers, header icons, control borders, switches off.
- **Ink Subtle** (`ink-subtle`): placeholders and the faintest meta text.
- **Rule** (`rule`, `dark-rule`): 1px dividers, header border, progress tracks.

### Functional

- **Danger** (`danger`, `dark-danger`) and **Warning** (`warning`): destructive buttons, the settings danger zone and errors only. Missing keys and empty states are ink-2 text, not danger.

### Named Rules

**The One Spot Rule.** Green means structure or state. Never use it for decoration, and never introduce a second accent.

**The Token Rule.** Every colour goes through a theme variable listed in `src/lib/data/theme/theme-tokens.ts` (or the Tailwind colours mapped to them in `tailwind.config.cjs`: `text-fg`, `text-muted`, `border-line`, `bg-accent`, `text-danger`, `bg-overlay`…). A new role is a new token with a value in every built-in theme; `themes.test.ts` checks every built-in theme for WCAG AA.

## Typography

**Chrome Font:** BIZ UDPGothic (fallbacks Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif), self-hosted in unicode-range woff2 chunks, `--app-font-ui`. A theme's `uiFont` may replace it.
**Book Font:** the reader's own choice (KZ UDMincho by default); never set by chrome styles.

**Character:** a universal-design gothic: plain, even, readable at small sizes, at home with both Latin and kana.

### Hierarchy

The scale lives in `src/app.scss` as `--type-*` and in Tailwind as `text-display`, `text-h1`… Nothing is set below 12px.

- **Display** (40px): rare page-level figures and titles.
- **Figure** (44px, bold, tabular): the POINT box's key number.
- **Headline / H1** (28px): page titles.
- **Title / H2** (20px, regular, 1.3): section head titles.
- **Number** (22px, tabular): figures in dashboards and tables.
- **Body** (15px): default text, inputs, settings labels.
- **Button** (14px, bold): buttons and segments.
- **Small** (13px): descriptions, counts, table headers.
- **Label** (12px, bold): section tags, POINT tags, footers.

### Named Rules

**The Tabular Figures Rule.** Counts, percentages, tables and tags use `font-variant-numeric: tabular-nums` so columns of figures line up.

## Layout

- **Shell:** every page and the reader use the shared `app-header` (`src/lib/components/app-header/`): a flat bar with the ち logo alone on the left, text tabs Home / Store / Words / Statistics / Settings (the active one gets a 3px spot underline), and Import and the account on the right. Below 640px the tabs move to a bottom tab bar (body padding 3.5rem plus the safe area); the reader has no bottom bar.
- **Controls:** 40px tall, 44px on coarse pointers (`--app-control-height`).
- **Settings:** sidebar areas with collapsible section groups; each row is `SettingsItemGroup`: label left, control right (`wide` stacks them). On phones the sidebar becomes a list that drills into one area.
- **Shelves:** covers share one size and one baseline on every shelf and in the Store grid.
- **Reader:** a slim bar (back, title + chapter + %, Aa quick settings, More •••, panel toggle) and ONE side panel, 26.75rem wide from 768px up (`panelWidthRem` in `src/lib/data/reader-panel.ts`); the book narrows beside it. Below that the panel is a bottom sheet with its tabs in a row.

## Elevation & Depth

None. Surfaces are flat paper divided by 1px rules; the only tonal layer is Paper 2. Overlays dim with `overlay` (ink at 40%, black at 60% in dark). The Chimi themes set `shadow`, `coverShadow` and `insetHighlight` to transparent and `blur` to 0, so inherited shadow rules render as nothing.

### Named Rules

**The Flat Paper Rule.** No shadows, no gradients, no glass. Separate with a rule or a Paper 2 field, never with depth.

## Shapes

Square corners: 2px on controls, tags, boxes and switch tracks (`--app-radius-scale` 0.3, so controls compute to about 2px). Lines are 1px rules; emphasis lines are 2px (POINT frame, table top rule, panel title rule) or 3px (active tab underline, progress track). No pills.

## Components

### Buttons

Plain and printed. All share 40px height, 0 16px padding, Button type, 2px corners (`.app-button` in `app.scss`, `buttonClasses` in `css-classes.ts`).

- **Secondary (default):** 1px ink outline, transparent fill; hover adds ink at 6%.
- **Primary:** spot fill, on-spot text; hover `spot-hover`.
- **Quiet:** spot text with no frame, like a link; hover underlines.
- **Danger:** 1px danger outline and text.
- **Disabled:** 50% opacity.

### Inputs / Fields

- **Style:** `.app-input`: 1px ink-2 border, paper fill, 2px corners, 40px, Body type.
- **Focus:** border and a 2px outline in the spot colour, offset 2px. No glow.

### Switch and Segmented Control

`ButtonToggleGroup` renders on/off groups as a switch and other groups as a segmented control, named by its settings row.

- **Switch** (`.app-switch`): square 40x24 track. Off: 1px ink-2 outline with an ink-2 knob. On: spot fill with an on-spot knob slid right.
- **Segmented** (`.app-segmented`): 1px ink-2 frame with 2px gaps; the selected segment is filled with ink and set bold in paper.

### Section Head (signature)

`section-head.svelte`: a spot tag with the two-digit number (01, 02…, Label bold, tabular), the title in H2 regular, an optional count in Small ink-2, and a 1px rule running to the right edge. It replaces icons before headings.

### POINT Box (signature)

`point-box.svelte`: the one key figure of a screen. 2px spot frame, a spot tag in the top-left corner holding just its label ("Today"), the figure in Figure type with an optional unit in Body ink-2; anything else goes below. Without a figure it frames guidance.

### Ruled Table

`.app-table`: 2px ink rule on top, a 1px rule under each row, Small ink-2 headers, left-aligned, tabular digits. Status tags (`.app-tag`) are square: Known in spot, Ignored muted.

### Cover Card

`book-card/cover-card.svelte`, used by every shelf and the Store: one fixed cover size, a 3px progress track under the cover (rule track, spot fill), then the title and one line of meta.

### Navigation (app-header)

Flat paper bar with a 1px rule under it; tabs are text in ink, the active one in ink with a 3px spot underline. The ち logo is a circle mark drawn in `currentColor`.

### Reader Panel

`book-reader/reader-panel.svelte`: index tabs standing vertically on the panel's edge (Contents, Search, Highlights | Listen | Story with the AI plugin: Story so far, then Lore, in one scrolling view); the active tab joins the panel with a spot border. Each tab opens with its title over a 2px ink rule, and rows are divided by 1px rules. Ask AI opens inside the panel. On phones it is a bottom sheet with the tabs in a row.

## Do's and Don'ts

### Do:

- **Do** take every colour from a theme variable or its Tailwind mapping, and add a token to every built-in theme for a new role.
- **Do** open a section with `SectionHead` and give a screen at most one `PointBox`.
- **Do** use `.app-button`, `.app-input`, `.app-switch`, `.app-segmented` and `.app-table` rather than one-off control styles.
- **Do** keep controls at `--app-control-height` (40px, 44px on touch) and set text from the `--type-*` scale.
- **Do** label buttons with words ("Export", "Delete all", "Difficulty").
- **Do** write the interface in plain English sentence case ("chars", "Vol. 1").

### Don't:

- **Don't** use shadows, gradients, blur or pill shapes.
- **Don't** put icons before headings, or use unlabelled glyph buttons where a word fits.
- **Don't** use Tailwind palette classes (`bg-gray-700`, `text-red-500`) or fixed colours in components.
- **Don't** add a second accent colour or use green as decoration.
- **Don't** mark rows with a coloured left stripe; use a small square swatch.
- **Don't** set Japanese text in the interface (badges, labels); only book content is Japanese.
- **Don't** style book text from chrome; it belongs to the reader's settings and theme.
