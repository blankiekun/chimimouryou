#!/usr/bin/env python3
"""Builds the placement check's items (apps/web/src/lib/data/placement-items.json).

Real words are sampled from Jiten's frequency list (engine/data/,
CC BY-SA 4.0), a few per rank band: kanji words in dictionary form whose
spelling is JMdict's first, common one (no rare/irregular spellings, nothing
usually written in kana, no archaic or proper nouns), plus a few common katakana
loanwords in each band up to rank 15,000; past rank 56,000, where JMdict's
priority tags run out, any first spelling. The last band runs to the end of the list. Pseudo-words are kanji
compounds and okurigana words made from parts of common words that are in
neither list (and, when SudachiPy is installed, not one token in its
dictionary either).

    python3 scripts/placement/build-items.py JMdict_e.gz [--freq ZIP] [--out JSON]
        [--check-dicts DIR_OR_ZIP ...]

--check-dicts also rejects pseudo-words that are a headword or reading in any of
the given Yomitan dictionaries (a folder means every .zip in it); include
JMnedict so names are out too. Nothing from them goes into the output.

JMdict_e.gz is EDRDG's file (https://www.edrdg.org/jmdict/j_jmdict.html); it is
read only to filter, nothing from it goes into the output. The sampling is
seeded, so the same inputs give the same list.
"""

import argparse
import gzip
import io
import json
import random
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FREQ = ROOT / 'engine/data/jiten_freq_global.zip'
OUT = ROOT / 'apps/web/src/lib/data/placement-items.json'

# Upper rank of each band (the first starts at 1), log-spaced: the test (placement.ts) walks
# up and down these bands one at a time, so each needs enough words for several visits.
# The last band runs to the end of the list, so advanced readers get a real ceiling.
BANDS = [1000, 1700, 2500, 3500, 5000, 7000, 10000, 14000, 20000, 28000, 40000, 56000, 80000, 115000, 165000, 240000]
# Past this rank few words carry JMdict's priority tags: any first spelling will do.
COMMON_UNTIL = 56000
# Crude words JMdict doesn't tag; the public word test shows these items too.
AVOID = {'飲尿'}
PER_BAND = 40
LOANS_PER_BAND = 4  # about 1 in 10 in the bands that have them
PSEUDO = 150  # each test draws 3, 5 or 7, so they aren't memorised
# Honorific and number kanji make almost anything a plausible real word (御合, 二夜).
NOT_IN_PSEUDO = set('御一二三四五六七八九十百千万何')
ENDINGS = ['める', 'かす', 'らす', 'まる', 'げる', 'れる', 'しい', 'やか']

KANJI = re.compile(r'[一-鿿々]')
WORD = re.compile(r'^[一-鿿々ぁ-ゖ]{2,4}$')
BAD_SPELLING = {'rK', 'iK', 'oK', 'sK', 'ateji', 'io'}
BAD_SENSE = {'uk', 'arch', 'obs', 'rare', 'vulg', 'X', 'derog', 'sl', 'col', 'abbr', 'on-mim'}
KATAKANA = re.compile(r'^[ァ-ヺー]{3,6}$')
# Loanwords: LOANS_PER_BAND per band, only up to this rank (owner, 2026-10-23: common ones are
# often not the English word, マンション, but rare ones are easy guesses for English speakers).
LOAN_MAX_RANK = 15000
BAD_POS = {'exp', 'int', 'pref', 'suf', 'ctr', 'prt', 'conj', 'aux', 'aux-v', 'aux-adj', 'n-pr', 'num'}


def load_frequency(path):
    """form → best rank, from the Yomitan rank-based term_meta banks."""
    ranks = {}
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.startswith('term_meta_bank'):
                continue
            for form, _, data in json.loads(archive.read(name)):
                value = data['frequency']['value'] if 'frequency' in data else data['value']
                ranks[form] = min(ranks.get(form, value), value)
    return ranks


def load_jmdict(path, entries=None):
    """Every kanji spelling, every reading, first spellings (with whether they are common) and loanwords.

    `entries`, when given, gets each spelling's (entry number, readings) pairs."""
    spellings, readings, loans = set(), set(), set()
    common = {}  # first spelling -> has a JMdict priority tag
    # JMdict's tags are entities (&n; …) declared in its DTD: keep their names instead.
    text = gzip.open(path).read().decode()
    text = text[text.index('<JMdict>'):]
    text = re.sub(r'&(?!amp;|lt;|gt;|quot;|apos;)([\w-]+);', r'\1', text)
    for _, entry in ET.iterparse(io.StringIO(text), events=('end',)):
        if entry.tag != 'entry':
            continue
        kebs = entry.findall('k_ele')
        rebs = [r.findtext('reb') for r in entry.findall('r_ele')]
        for k in kebs:
            spellings.add(k.findtext('keb'))
            if entries is not None:
                entries.setdefault(k.findtext('keb'), []).append((entry.findtext('ent_seq'), rebs))
        readings.update(rebs)
        senses = entry.findall('sense')
        if kebs and senses:
            first = kebs[0]
            tags = {i.text for i in first.findall('ke_inf')}
            misc = {m.text for m in senses[0].findall('misc')}
            pos = {p.text for s in senses for p in s.findall('pos')}
            priority = first.findall('ke_pri')
            if not (tags & BAD_SPELLING or misc & BAD_SENSE or pos & BAD_POS):
                common[first.findtext('keb')] = bool(priority)
        elif senses and not kebs:
            first = entry.find('r_ele')
            reb = first.findtext('reb')
            misc = {m.text for m in senses[0].findall('misc')}
            pos = {p.text for s in senses for p in s.findall('pos')}
            loanword = any(s.find('lsource') is not None for s in senses)
            if (
                KATAKANA.match(reb) and loanword and first.findall('re_pri')
                and not (misc & BAD_SENSE or pos & BAD_POS)
            ):
                loans.add(reb)
        entry.clear()
    return spellings, readings, common, loans


def dictionary_terms(paths, lengths=range(2, 4)):
    """Yomitan zip name → its headwords and readings of `lengths` characters (the pseudo-words')."""
    zips = []
    for path in paths:
        zips += sorted(path.glob('*.zip')) if path.is_dir() else [path]
    out = {}
    for path in zips:
        terms = set()
        try:
            archive = zipfile.ZipFile(path)
        except zipfile.BadZipFile:
            continue
        with archive:
            for name in archive.namelist():
                if not name.startswith(('term_bank', 'term_meta_bank')):
                    continue
                for row in json.loads(archive.read(name)):
                    data = row[2] if len(row) > 2 else None
                    found = [row[0], row[1] if isinstance(row[1], str) else '']
                    if isinstance(data, dict):
                        found.append(data.get('reading') or '')
                    terms.update(t for t in found if len(t) in lengths)
        if terms:
            out[path.stem] = terms
    return out


def sudachi_word():
    """A test 'is this one dictionary word', or None without SudachiPy."""
    try:
        from sudachipy import dictionary
    except ImportError:
        return None
    tokenizer = dictionary.Dictionary().create()
    return lambda text: len(tokenizer.tokenize(text)) == 1


def real_words(ranks, common, loans, bands, rng, keep=None):
    """PER_BAND words per band; with `keep`, only words it accepts (tried in random order)."""
    items = []
    low = 0
    for band, high in enumerate(bands):
        pool = sorted(
            (rank, form)
            for form, rank in ranks.items()
            if low < rank <= high and form in common and (common[form] or low >= COMMON_UNTIL)
            and form not in AVOID and WORD.match(form) and KANJI.match(form)
        )
        loan_pool = sorted((rank, form) for form, rank in ranks.items() if low < rank <= high and form in loans)
        if len(pool) < PER_BAND:
            sys.exit(f'Only {len(pool)} words between ranks {low} and {high}')
        # One word from each of PER_BAND equal runs of the band's words, so it is covered
        # evenly; in bands up to LOAN_MAX_RANK (not the first), LOANS_PER_BAND runs give a
        # loanword from anywhere in the band instead, when there is one.
        loan_parts = set(rng.sample(range(PER_BAND), LOANS_PER_BAND)) if band and high <= LOAN_MAX_RANK else set()
        taken = set()
        for part in range(PER_BAND):
            run = pool[len(pool) * part // PER_BAND:len(pool) * (part + 1) // PER_BAND]
            choices = run
            if part in loan_parts:
                choices = [p for p in loan_pool if p[1] not in taken] or run
            if keep:
                choices = choices[:]
                rng.shuffle(choices)
                choices = [next((p for p in choices if keep(p[1])), None)]
                if not choices[0]:
                    sys.exit(f'No word kept between ranks {run[0][0]} and {run[-1][0]}')
            rank, form = rng.choice(choices)
            taken.add(form)
            items.append({'w': form, 'r': rank, 'b': band})
        low = high
    return items


def pseudo_words(ranks, spellings, readings, common, one_word, rng, dicts=None, rejected=None):
    kanji2 = [f for f, r in ranks.items() if r <= 8000 and common.get(f) and re.fullmatch(r'[一-鿿]{2}', f)]
    verbs = [f for f, r in ranks.items() if r <= 8000 and common.get(f) and re.fullmatch(r'[一-鿿][ぁ-ゖ]?[うくすつぬぶむる]', f)]
    kanji2.sort()
    verbs.sort()
    taken = set()

    def ok(text):
        return (
            text not in taken
            and text[0] != text[1]
            and not set(text) & NOT_IN_PSEUDO
            and text not in ranks
            and text not in spellings
            and text not in readings
            and not (one_word and one_word(text))
            and not in_dicts(text)
        )

    def in_dicts(text):
        hits = [name for name, terms in (dicts or {}).items() if text in terms]
        for name in hits:
            rejected[name] = rejected.get(name, 0) + 1
        return bool(hits)

    out = []
    # Mostly two-kanji compounds (the bulk of the real items), a few okurigana words.
    for count, make in ((PSEUDO - 30, lambda: rng.choice(kanji2)[0] + rng.choice(kanji2)[1]),
                        (30, lambda: rng.choice(verbs)[0] + rng.choice(ENDINGS))):
        made = 0
        while made < count:
            text = make()
            if ok(text):
                taken.add(text)
                out.append({'w': text})
                made += 1
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('jmdict', type=Path)
    parser.add_argument('--freq', type=Path, default=FREQ)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--check-dicts', type=Path, nargs='+', default=[], metavar='DIR_OR_ZIP')
    args = parser.parse_args()

    rng = random.Random(args.seed)
    ranks = load_frequency(args.freq)
    spellings, readings, common, loans = load_jmdict(args.jmdict)
    one_word = sudachi_word()
    if not one_word:
        print('SudachiPy not installed: pseudo-words are checked against the lists only', file=sys.stderr)

    dicts = dictionary_terms(args.check_dicts)
    rejected = {}

    bands = BANDS + [max(ranks.values())]
    items = real_words(ranks, common, loans, bands, rng) + pseudo_words(
        ranks, spellings, readings, common, one_word, rng, dicts, rejected
    )
    for name in dicts:
        print(f'{name}: rejected {rejected.get(name, 0)} pseudo-word candidates', file=sys.stderr)
    data = {
        'about': 'Placement check items. Real words and ranks: Jiten frequency list '
        '(https://jiten.moe, revision "Jiten 26-10-09"), CC BY-SA 4.0; this file is under '
        'CC BY-SA 4.0 too. Made-up words are in none of JMdict, JMnedict and Japanese Wiktionary '
        '(wiktionary-to-yomitan), and were checked against further dictionaries. '
        'Built by scripts/placement/build-items.py.',
        'bands': bands,
        'items': items,
    }
    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
    print(f'{len(items)} items -> {args.out}')


if __name__ == '__main__':
    main()
