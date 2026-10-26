"""The fast difficulty core: Sudachi tokens → JMdict compounds joined → word units → frequency ranks →
a book's V98 and a log-rank histogram. No yurigana Reader, no features, no model, so it runs in well under a second.
The browser has the same code in apps/web/src/lib/functions/analysis/core.ts; both check
tests/fixtures/difficulty-core.json, so keep them equal (a change here is a change there, and a
CORE_VERSION bump). Not upstream.

- Segmentation: compound_merge.merge_compounds (the word lists' seam, #259; without the Reader's
  readings: the core never runs it), then word_units: tokens → (lemma, form, reading, name) units.
  Only these two decide what a "word" is; the scoring below never looks at tokens.
- summarise: per lemma, its count and frequency rank (the list's rank of Sudachi's normalized form;
  noise left out as word_list.is_noise_word does). Names are counted apart (`names`).
- V98: the vocabulary size (top-N words of the frequency list) at which 98% of the book's running
  words are known, with a repetition discount: a word met more than REPEAT_CAP times counts as
  learned after REPEAT_CAP, so book-specific terms (聖女 300 times) cost what 10 occurrences cost.
  None: 98% needs words the list doesn't rank.
- hist / histTypes: occurrences and different words per log-rank bucket (BUCKETS_PER_DECADE per
  factor of 10, ranks 1 to 10^6; the last entry holds the unranked words), for a reader's coverage
  of any book without its word list (coverage.ts in the app).
- score: V98 on the frozen 1-10 scale (core-scale.json): log-linear between its anchors.
"""
import bisect
import json
import math
import os

from compound_merge import merge_compounds
from word_list import is_noise_word

# 1: first version.
CORE_VERSION = 1
REPEAT_CAP = 10
BUCKETS_PER_DECADE = 4
RANKED_BUCKETS = 6 * BUCKETS_PER_DECADE
# Lower edges of the ranked buckets: bucket b holds ranks in [EDGES[b], EDGES[b + 1]); integer ranks
# never fall within float error of the irrational edges, and 10, 100… are exact in both languages.
EDGES = [10 ** (b / BUCKETS_PER_DECADE) for b in range(RANKED_BUCKETS)]
# Parts of speech that are vocabulary: particles, auxiliaries, affixes, symbols and blanks are not.
VOCABULARY = {'名詞', '代名詞', '形状詞', '連体詞', '形容詞', '動詞', '副詞', '接続詞', '感動詞'}
SCALE_PATH = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'core-scale.json')


def to_hiragana(text: str) -> str:
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in text)


def word_units(tokens):
    """(lemma, form, reading, name) per vocabulary word from Sudachi's tokens (yurigana's Token)."""
    for token in tokens:
        pos = token.part_of_speech()
        if pos[0] in VOCABULARY:
            yield (token.normalized_form(), token.dictionary_form(), to_hiragana(token.reading_form()),
                   pos[0] == '名詞' and pos[1] == '固有名詞')


def bucket(rank) -> int:
    """The histogram bucket of a rank (None: unranked, the last bucket)."""
    if rank is None:
        return RANKED_BUCKETS
    return min(bisect.bisect_right(EDGES, rank) - 1, RANKED_BUCKETS - 1)


def summarise(units, rank_of) -> dict:
    """The book's core numbers from word_units; `rank_of(lemma)` gives a frequency rank or None."""
    words = {}  # lemma -> [count, rank]
    names = 0
    for lemma, form, _, name in units:
        if name:
            names += 1
            continue
        word = words.get(lemma)
        if word is None:
            rank = rank_of(lemma)
            if is_noise_word(form, rank):
                continue
            word = words[lemma] = [0, rank]
        word[0] += 1
    tokens = sum(n for n, _ in words.values())
    hist, types = [0] * (RANKED_BUCKETS + 1), [0] * (RANKED_BUCKETS + 1)
    for n, rank in words.values():
        hist[bucket(rank)] += n
        types[bucket(rank)] += 1
    # 98% = 49/50, in integers so both languages agree exactly.
    covered = sum(max(n - REPEAT_CAP, 0) for n, _ in words.values())
    v98 = 1 if tokens and covered * 50 >= tokens * 49 else None
    if v98 is None:
        for n, rank in sorted((w for w in words.values() if w[1] is not None), key=lambda w: w[1]):
            covered += min(n, REPEAT_CAP)
            if covered * 50 >= tokens * 49:
                v98 = rank
                break
    return {'v': CORE_VERSION, 'tokens': tokens, 'types': len(words), 'names': names, 'v98': v98,
            'hist': hist, 'histTypes': types}


def round2(value: float) -> float:
    """Half up, as Math.round in core.ts (Python's round() goes to even)."""
    return math.floor(value * 100 + 0.5) / 100


def load_scale(path: str = SCALE_PATH) -> dict:
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def score(v98, scale: dict) -> float:
    """V98 on the 1-10 scale: log-linear between the anchors ([score, V98], both rising), clamped;
    None (beyond the list) is the top. Rounded to two decimals; the app shows one."""
    anchors = scale['anchors']
    if v98 is None:
        return anchors[-1][0]
    x = math.log(v98)
    if x <= math.log(anchors[0][1]):
        return anchors[0][0]
    for (s0, v0), (s1, v1) in zip(anchors, anchors[1:]):
        if x <= math.log(v1):
            return round2(s0 + (s1 - s0) * (x - math.log(v0)) / (math.log(v1) - math.log(v0)))
    return anchors[-1][0]


def book_core(tokens, frequency) -> dict:
    """The book's core numbers from its Sudachi tokens (yurigana's SudachiTokenizer.tokens: offsets,
    symbols and blanks left out) and a FrequencyTable (frequency.py)."""
    ranks = frequency.ranks
    return summarise(word_units(merge_compounds(list(tokens), frequency)), lambda lemma: ranks.get(lemma))


def core_table_text(frequency) -> str:
    """The frequency list as core.ts reads it (parseCoreTable; build.sh gzips it as
    core-frequency.tsv.gz): `term \t rank` lines, a blank line, `term \t reading \t rank` lines, a
    blank line, `compound \t reading` lines, each sorted."""
    return ''.join([*(f'{t}\t{r}\n' for t, r in sorted(frequency.ranks.items())), '\n',
                    *(f'{t}\t{reading}\t{r}\n' for (t, reading), r in sorted(frequency.reading_ranks.items())), '\n',
                    *(f'{form}\t{reading}\n' for form, reading in sorted(frequency.compounds.items()))])
