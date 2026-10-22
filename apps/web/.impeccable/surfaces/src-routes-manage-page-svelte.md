---
version: 1
slug: 'src-routes-manage-page-svelte'
primary_target: 'src/routes/manage/+page.svelte'
related_targets:
  [
    'src/routes/b/+page.svelte',
    'src/routes/settings/+page.svelte',
    'src/routes/admin/+page.svelte',
    'src/routes/m/+page.svelte',
    'src/routes/v/+page.svelte'
  ]
---

# Surface: app shell (library, reader chrome, settings, admin, players)

Mode: Operate. Scope: every surface except the book text, which keeps the reader's own theme. Design in Figma first, approved there, then code-led build.

## Direction contract

THESIS: chimimouryou as a 参考書 (study reference book): black ink plus one green spot colour on white paper, structure from boxed key points and labelled steps, not from cards, icons and shadows. Refuses the cream + mincho + vermilion library, icons before every heading, and outlined pills.

OWN-WORLD: White paper ground, near-black ink, one green spot (#0F7A5C) for structure: active tab, section labels, key-point frames, primary buttons. BIZ UDPGothic (UD face made for teaching materials) across the whole scale, tabular digits. Ruled tables, square 2-4px corners, 1px rules, no shadows, no gradients. Dark: ink-black ground, light ink, lifted green.

STORY: The learner sees today's reading as a key point, picks up where they left off, and finds the next book at their level.

FIRST VIEWPORT: Top bar (name, Home/Store/Statistics/Settings tabs, Import, account). Home: a POINT box with today's 字 count, streak and the week's figures as a ruled table; Continue reading covers on one baseline with progress bars; Read next as books at the learner's level.

FORM: Study book & red sheet, position 1 of the ordered list (the pick), seed:808452492bcfc791.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
