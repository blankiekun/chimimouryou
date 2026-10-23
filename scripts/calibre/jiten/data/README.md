# Bundled data

`jiten_freq_global.zip` is Jiten's word frequency list, a rank-based Yomitan
frequency dictionary built from all media on jiten.moe.

- Source: https://jiten.moe/frequency-dictionaries (Jiten, https://jiten.moe,
  https://github.com/Sirush/Jiten)
- Revision: "Jiten 26-10-09" (its `index.json`), taken on 2026-10-09
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), per
  Jiten's deck licensing guide (`Jiten.Web/content/guides/deck-licensing.md`).
  Redistributed unmodified. Files derived from it, such as the packed
  `frequency.ygp` the difficulty service writes to its state folder, are
  under CC BY-SA 4.0 too. The rest of this repository keeps its own licence
  (see `LICENSE` and `NOTICE` at its root).

The difficulty service (`../service.py`) copies it to
`state/difficulty/frequency-dictionary.zip` on start when no list is installed
there. A list an admin installed or uploaded is never overwritten; to use a
newer one, upload it in the admin panel (Tools → Estimate difficulty →
"Replace frequency list").
