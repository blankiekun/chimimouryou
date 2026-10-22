#!/usr/bin/env python3
"""Splits BIZ UDPGothic (OFL, google/fonts ofl/bizudpgothic) into unicode-range woff2 chunks.

Usage: subset-biz-udpgothic.py SRC_DIR [OUT_DIR]
SRC_DIR holds BIZUDPGothic-Regular.ttf, BIZUDPGothic-Bold.ttf and OFL.txt. Needs fonttools and
brotli (pip install fonttools brotli). OUT_DIR defaults to apps/web/src/lib/assets/fonts/biz-udpgothic.

A page downloads only the chunks whose characters it shows: Latin, symbols, kana (with CJK
punctuation and full-width forms), then kanji by how common they are: the first school grades,
the rest of the Joyo list, the rest of JIS level 1, JIS level 2 in two halves, and everything else.
The font has no tabular figures, so a `tnum` feature is added that widens "1" to the other digits.
"""

import json
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.otlLib.builder import buildSingleSubstSubtable
from fontTools.ttLib.tables import otTables
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

here = Path(__file__).resolve().parent
root = here.parent.parent
src = Path(sys.argv[1])
out = Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'apps/web/src/lib/assets/fonts/biz-udpgothic'
grades = json.loads((root / 'scripts/calibre/jiten/kanji-grades.json').read_text())

WEIGHTS = {400: 'BIZUDPGothic-Regular.ttf', 700: 'BIZUDPGothic-Bold.ttf'}


def is_kanji(cp):
    return 0x3400 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF or 0x20000 <= cp <= 0x3FFFF


def jis_level(cp):
    """1 or 2 for JIS X 0208 kanji (EUC-JP rows 16-47 and 48-84), else 0."""
    try:
        lead = chr(cp).encode('euc_jp')
    except UnicodeEncodeError:
        return 0
    if len(lead) != 2:
        return 0
    return 1 if 0xB0 <= lead[0] <= 0xCF else 2 if 0xD0 <= lead[0] <= 0xF4 else 0


def chunks(cmap):
    latin_extra = set(range(0x2000, 0x2070)) | set(range(0x20A0, 0x20D0)) | set(range(0x2100, 0x2150))
    kana = set(range(0x3000, 0x3100)) | set(range(0x31F0, 0x3200)) | set(range(0xFF00, 0xFFF0))
    named = {name: [] for name in ['latin', 'symbols', 'kana', 'kanji-1', 'kanji-2', 'kanji-3',
                                   'kanji-4', 'kanji-5', 'kanji-6']}
    jis2 = []
    for cp in sorted(cmap):
        char = chr(cp)
        if cp < 0x0250 or cp in latin_extra:
            named['latin'].append(cp)
        elif cp in kana:
            named['kana'].append(cp)
        elif char in grades and grades[char] <= 6:
            named['kanji-1'].append(cp)
        elif char in grades:
            named['kanji-2'].append(cp)
        elif is_kanji(cp) and jis_level(cp) == 1:
            named['kanji-3'].append(cp)
        elif is_kanji(cp) and jis_level(cp) == 2:
            jis2.append(cp)
        elif cp < 0x3000:
            named['symbols'].append(cp)
        else:
            named['kanji-6'].append(cp)
    half = len(jis2) // 2
    named['kanji-4'], named['kanji-5'] = jis2[:half], jis2[half:]
    return named


def unicode_range(cps):
    ranges, start = [], None
    for cp in cps:
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            ranges.append((start, prev))
            start = prev = cp
    if start is not None:
        ranges.append((start, prev))
    return ', '.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in ranges)


def add_tabular_one(font):
    """'one' is narrower than the other digits; add one.tnum at their width, centred."""
    cmap = font.getBestCmap()
    one, two = cmap[ord('1')], cmap[ord('2')]
    width, lsb = font['hmtx'][one]
    target = font['hmtx'][two][0]
    shift = (target - width) // 2
    glyph = Glyph()
    glyph.numberOfContours = -1
    component = GlyphComponent()
    component.glyphName, component.x, component.y, component.flags = one, shift, 0, 0x4
    glyph.components = [component]
    font['glyf']['one.tnum'] = glyph
    font['hmtx']['one.tnum'] = (target, lsb + shift)
    if 'vmtx' in font:
        font['vmtx']['one.tnum'] = font['vmtx'][one]
    # Added to the existing GSUB (vert, ruby… stay): one lookup, one feature, in every script.
    gsub = font['GSUB'].table
    lookup = otTables.Lookup()
    lookup.LookupType, lookup.LookupFlag = 1, 0
    lookup.SubTable = [buildSingleSubstSubtable({one: 'one.tnum'})]
    lookup.SubTableCount = 1
    gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount += 1
    feature = otTables.FeatureRecord()
    feature.FeatureTag = 'tnum'
    feature.Feature = otTables.Feature()
    feature.Feature.FeatureParams = None
    feature.Feature.LookupListIndex = [gsub.LookupList.LookupCount - 1]
    feature.Feature.LookupCount = 1
    gsub.FeatureList.FeatureRecord.append(feature)
    gsub.FeatureList.FeatureCount += 1
    index = gsub.FeatureList.FeatureCount - 1
    for script in gsub.ScriptList.ScriptRecord:
        for lang in [script.Script.DefaultLangSys] + [r.LangSys for r in script.Script.LangSysRecord]:
            if lang:
                lang.FeatureIndex.append(index)
                lang.FeatureCount += 1


def main():
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copy(src / 'OFL.txt', out / 'OFL.txt')
    faces = []
    for weight, name in WEIGHTS.items():
        base = TTFont(src / name)
        add_tabular_one(base)
        prepared = out / f'_{weight}.ttf'
        base.save(prepared)
        for chunk, cps in chunks(base.getBestCmap()).items():
            if not cps:
                continue
            options = subset.Options()
            options.flavor = 'woff2'
            # Alternates (aalt, trad, jp78…) would pull thousands of extra glyphs into each chunk.
            options.layout_features = ['ccmp', 'liga', 'vert', 'vrt2', 'vkna', 'ruby',
                                       'tnum', 'zero', 'frac', 'numr', 'dnom', 'sups']
            options.name_IDs = ['*']
            options.notdef_outline = True
            font = subset.load_font(prepared, options)
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=cps)
            subsetter.subset(font)
            file = f'BIZUDPGothic-{weight}-{chunk}.woff2'
            subset.save_font(font, out / file, options)
            faces.append(
                "@font-face {\n  font-family: 'BIZ UDPGothic';\n  font-style: normal;\n"
                f"  font-weight: {weight};\n  font-display: swap;\n"
                f"  src: url('./{file}') format('woff2');\n"
                f'  unicode-range: {unicode_range(cps)};\n}}\n')
            print(f'{file}: {len(cps)} characters, {(out / file).stat().st_size // 1024} KB')
        prepared.unlink()
    (out / 'biz-udpgothic.css').write_text(
        '/* Generated by scripts/fonts/subset-biz-udpgothic.py; BIZ UDPGothic, SIL OFL 1.1 (OFL.txt). */\n'
        + '\n'.join(faces))


main()
