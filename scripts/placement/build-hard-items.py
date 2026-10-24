#!/usr/bin/env python3
"""Builds the hard word test's items (apps/web/src/lib/data/placement-hard-items.json).

Each item has a word's readings (typed in the test) and four meanings, the right one
first (the test shuffles them). Words are sampled like build-items.py's, in the
same bands, but only those Japanese Wiktionary defines with their main reading,
and no loanwords (their reading is the word itself).

- Readings: the word's most frequent reading in Jiten's list first, then every
  other one it has in JMdict, Jiten's list or Wiktionary: the test accepts any.
- Meanings: Wiktionary's first usable gloss for that reading, cut to about 60
  characters. Wrong ones are glosses of homophones (機会/機械), of words
  sharing a kanji, then of words of about the same rank. None contains the
  headword or its reading, is a gloss of the word itself, or belongs to a
  synonym or spelling variant of it, and each has as many of the word's kanji
  as the right one, so the kanji don't point to it (略章: 略式の勲章).

    python3 scripts/placement/build-hard-items.py JMdict_e.gz wty-ja-ja.zip

wty-ja-ja.zip is wiktionary-to-yomitan's Japanese Wiktionary (CC BY-SA 4.0,
https://github.com/yomidevs/wiktionary-to-yomitan, from
https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/ja/ja/wty-ja-ja.zip);
only the glosses shown go
into the output. JMdict is read only to filter. Seeded, like build-items.py.
"""

import argparse
import importlib.util
import json
import random
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('build_items', Path(__file__).with_name('build-items.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

OUT = ROOT / 'apps/web/src/lib/data/placement-hard-items.json'
MAX_GLOSS = 60

HIRAGANA = re.compile(r'^[ぁ-ゖー]+$')
# Redirects and grammar notes rather than definitions.
NOT_A_GLOSS = re.compile(
    r'(に同じ|の略|を参照|を見よ|の旧字体|の異体字|の誤用|の表記|の音読み|の訓読み|の(連用|未然|終止|連体|已然|仮定|命令)形)'
)
# Notes about usage, names and bare loanwords (ヘンルーダ) aren't meanings anyone can pick.
NOT_A_MEANING = re.compile(r'(語義|※|《|姓|地名|人名|^[ァ-ヺー・]+$)')


def hira(text):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in text)


def flat(node, skip=('details', 'tags', 'backlink', 'related-words')):
    """Plain text of a structured-content node, examples and tags left out."""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return ''.join(flat(n, skip) for n in node)
    if not isinstance(node, dict):
        return ''
    if node.get('tag') in ('details', 'ol', 'ul') or (node.get('data') or {}).get('content') in skip:
        return ''
    return flat(node.get('content', ''), skip)


def senses(content):
    """The glosses (list items' text), synonyms and source page of one Wiktionary entry."""
    glosses, synonyms, page = [], set(), [None]

    def walk(node):
        if isinstance(node, list):
            for n in node:
                walk(n)
        elif isinstance(node, dict):
            kind = (node.get('data') or {}).get('content')
            if kind == 'glosses':
                for li in node.get('content', []):
                    if isinstance(li, dict) and li.get('tag') == 'li':
                        glosses.append(flat(li.get('content', '')).strip())
                return
            if kind == 'synonym-item':
                synonyms.add(flat(node.get('content', '')))
                return
            href = node.get('href') or ''
            if 'wiktionary.org/wiki/' in href:
                page[0] = unquote(href.split('/wiki/')[1].split('#')[0])
            walk(node.get('content'))

    walk(content)
    return glosses, synonyms, page[0]


def load_wiktionary(path, entries):
    """(term, reading) → glosses; term → synonyms; reading → terms.

    Kanji spellings on a kana page (着る on きる) all carry the page's first entry (切る),
    so they keep it only when the page's spellings are one JMdict word (楽しい, 愉しい);
    otherwise only the page's glosses labelled with them, （聞く）….
    """
    glosses, synonyms, by_reading = defaultdict(list), defaultdict(set), defaultdict(set)
    kana_rows, page_glosses = defaultdict(list), defaultdict(list)
    with zipfile.ZipFile(path) as archive:
        about = json.loads(archive.read('index.json'))
        for name in archive.namelist():
            if not name.startswith('term_bank'):
                continue
            for term, reading, *_, content, _, _ in json.loads(archive.read(name)):
                reading = hira(reading or term)
                found, syn, page = senses(content)
                synonyms[term] |= syn
                if page and page != term:
                    kana_rows[page, reading].append((term, found))
                    continue
                if page and not base.KANJI.search(term):
                    page_glosses[term] += found
                glosses[term, reading] += found
                by_reading[reading].add(term)
    for (page, reading), rows in kana_rows.items():
        words = {seq for term, _ in rows for seq, _ in entries.get(term, [])[:1]}
        for term, found in rows:
            if len(words) > 1:
                found = [g for g in page_glosses[page] if re.match(rf'^[（(]([^）)]*[、・])?{re.escape(term)}[、・）)]', g)]
            if found:
                glosses[term, reading] += found
                by_reading[reading].add(term)
    return glosses, synonyms, by_reading, about


def clean_gloss(text, reading):
    """The gloss as plain short text, or None when it is for another reading or not a definition."""
    if NOT_A_MEANING.search(text):
        return None
    label = re.match(r'^[（(]([^）)]*)[）)]', text)
    while label:
        # （おおや）…: a gloss of one of the entry's readings only.
        names = [hira(n.strip()) for n in re.split(r'[、,・]', label.group(1))]
        if all(HIRAGANA.match(n) for n in names) and reading not in names:
            return None
        text = text[label.end():].strip()
        label = re.match(r'^[（(]([^）)]*)[）)]', text)
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) < 4 or NOT_A_GLOSS.search(text):
        return None
    if len(text) > MAX_GLOSS:
        cut = text.find('。')
        text = text[:cut] if 0 < cut <= MAX_GLOSS else text[: MAX_GLOSS - 1] + '…'
    return text.rstrip('。')


def first_gloss(glosses, reading):
    for g in glosses:
        text = clean_gloss(g, reading)
        if text:
            return text
    return None


def load_readings(path):
    """form → {reading: best rank} from Jiten's list."""
    out = defaultdict(dict)
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.startswith('term_meta_bank'):
                continue
            for form, _, data in json.loads(archive.read(name)):
                if 'reading' not in data:
                    continue
                reading, value = hira(data['reading']), data['frequency']['value']
                out[form][reading] = min(out[form].get(reading, value), value)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('jmdict', type=Path)
    parser.add_argument('--freq', type=Path, default=base.FREQ)
    parser.add_argument('wiktionary', type=Path)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--seed', type=int, default=1)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    ranks = base.load_frequency(args.freq)
    form_readings = load_readings(args.freq)
    entries = {}
    _, _, common, _ = base.load_jmdict(args.jmdict, entries)
    glosses, synonyms, by_reading, about = load_wiktionary(args.wiktionary, entries)
    wikt_readings = defaultdict(set)
    for term, reading in glosses:
        wikt_readings[term].add(reading)

    def main_reading(form):
        options = form_readings.get(form)
        return min(options, key=options.get) if options else None

    def all_readings(form):
        return set(form_readings.get(form, {})) | wikt_readings[form] | {
            hira(r) for _, rs in entries.get(form, []) for r in rs
        }

    def same_word(a, b):
        """Spelling variants (one JMdict entry), synonyms, or one named in the other's glosses."""
        ids_a = {i for i, _ in entries.get(a, [])}
        if ids_a & {i for i, _ in entries.get(b, [])}:
            return True
        if b in synonyms[a] or a in synonyms[b]:
            return True
        text_a = ''.join(g for (t, _), gs in ((k, glosses[k]) for k in ((a, r) for r in wikt_readings[a])) for g in gs)
        text_b = ''.join(g for (t, _), gs in ((k, glosses[k]) for k in ((b, r) for r in wikt_readings[b])) for g in gs)
        return b in text_a or a in text_b

    def gives_away(text, form, readings):
        return form in text or any(r in hira(text) for r in readings if len(r) > 1)

    main = {form: main_reading(form) for form in form_readings}
    # Defined words of up to 4 characters: by rank (filler meanings) and by kanji.
    defined = [(rank, form) for form, rank in ranks.items()
               if base.KANJI.search(form) and len(form) <= 4 and (form, main.get(form)) in glosses]
    by_rank = sorted(defined)
    by_kanji = defaultdict(list)
    for rank, form in by_rank:
        for c in set(form):
            if base.KANJI.match(c):
                by_kanji[c].append(form)

    def build(form, rank):
        reading = main_reading(form)
        if not reading or (form, reading) not in glosses:
            return None
        readings = all_readings(form)
        right = first_gloss(glosses[form, reading], reading)
        if not right or gives_away(right, form, readings):
            return None
        def overlap(text):
            return sum(c in text for c in set(form) if base.KANJI.match(c))

        own = {clean_gloss(g, r) for r in wikt_readings[form] for g in glosses[form, r]}

        others = sorted(r for r in readings if r != reading and HIRAGANA.match(r))

        # Meanings: a homophone, words sharing a kanji, then words of about the same rank.
        def candidates():
            homophones = sorted((ranks.get(t, 10**7), t) for t in by_reading[reading]
                                if t != form and base.KANJI.search(t))
            yield [t for _, t in homophones[:6]]
            shared = sorted({(abs(ranks[t] - rank), t) for c in set(form) for t in by_kanji.get(c, []) if t != form})
            yield [t for _, t in shared[:30]]
            at = next((i for i, (r, _) in enumerate(by_rank) if r >= rank), len(by_rank) - 1)
            near = [t for _, t in by_rank[max(0, at - 200):at + 200]]
            rng.shuffle(near)
            yield near

        wrong = []
        for limit, group in zip((1, 3, 3), candidates()):
            taken = 0
            for t in group:
                if len(wrong) == 3 or taken == limit:
                    break
                r = reading if t in by_reading[reading] else main.get(t)
                if r is None or (t, r) not in glosses or same_word(form, t):
                    continue
                text = first_gloss(glosses[t, r], r)
                if not text or text in own or text == right or text in wrong or gives_away(text, form, readings):
                    continue
                if overlap(text) != overlap(right):
                    continue
                wrong.append(text)
                taken += 1
        if len(wrong) < 3:
            return None
        return {'w': form, 'r': rank, 'k': [reading] + others, 'm': [right] + wrong}

    built = {}

    def keep(form):
        if form not in built:
            built[form] = build(form, ranks[form])
        return built[form] is not None

    bands = base.BANDS + [max(ranks.values())]
    items = []
    for item in base.real_words(ranks, common, set(), bands, rng, keep):
        items.append({**built[item['w']], 'b': item['b']})
    data = {
        'about': 'Hard word test items. Words and ranks: Jiten frequency list (https://jiten.moe, '
        'revision "Jiten 26-10-09"), CC BY-SA 4.0. Meanings: excerpts from Japanese Wiktionary '
        f'(https://ja.wiktionary.org) by its contributors, via wiktionary-to-yomitan ({about.get("url")}, '
        f'revision {about.get("revision")}), CC BY-SA 4.0. Readings: also JMdict (EDRDG, '
        'CC BY-SA 4.0). This file is under CC BY-SA 4.0 too. Every reading (k) is right, the first '
        'is the main one; the first meaning (m) is right. Built by scripts/placement/build-hard-items.py.',
        'bands': bands,
        'items': items,
    }
    args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'{len(items)} items -> {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
