"""The fast difficulty core: Sudachi tokens → JMdict compounds joined → word units → frequency ranks →
a book's V98 and a log-rank histogram. No yurigana Reader, no features, no model, so it runs in well under a second.
The browser has the same code in apps/web/src/lib/functions/analysis/core.ts; both check
tests/fixtures/difficulty-core.json, so keep them equal (a change here is a change there, and a
CORE_VERSION bump). Not upstream.

- Segmentation: compound_merge.merge_compounds (the word lists' seam, #259; without the Reader's
  readings: the core never runs it), then word_units: tokens → (lemma, form, reading, name) units.
  Only these two decide what a "word" is; the scoring below never looks at tokens.
- summarise: per lemma, its count and frequency rank (noise left out as word_list.is_noise_word
  does). Names are counted apart (`names`).
- Ranks (version 3): a lemma's best (lowest) rank over its spellings met: Sudachi's normalized form
  (often the rare spelling: 見付かる 22,806, 見つかる 490), the dictionary form and, for an all-kana
  form, the best rank of any term read that way (すわる: 座る's 526). `best_ranks`.
- Untagged names (version 4): a word written in katakana, met at least KATAKANA_NAME_COUNT times and rarer
  than KATAKANA_NAME_RANK, counts as a name (クーク, ゲンゲン, ゴジュウカラ: Sudachi doesn't tag them, and in a
  5,000-word children's book a few of them decided V98); so do katakana technical terms that rare (サブネット).
  Unranked kana words are noise already.
- V98: the vocabulary size (top-N words of the frequency list) at which 98% of the book's running
  words are known, with a repetition discount: a word met more than REPEAT_CAP times counts as
  learned after REPEAT_CAP, so book-specific terms (聖女 300 times) cost what 10 occurrences cost.
  None: 98% needs words the list doesn't rank.
- hist / histTypes: occurrences and different words per log-rank bucket (BUCKETS_PER_DECADE per
  factor of 10, ranks 1 to 10^6; the last entry holds the unranked words), for a reader's coverage
  of any book without its word list (coverage.ts in the app).
- facets (version 2): rubyKanji, the share of the text's kanji under the author's ruby (総ルビ
  children's books are near 1), and sentLen, the mean characters per sentence. Shown beside the
  level, never folded into it.
- score: V98 on the frozen 1-10 scale (core-scale.json): log-linear between its anchors.
- furigana_score: the level for a reader who reads with furigana, from the level and rubyKanji alone
  (stored already, so no CORE_VERSION bump): up to FURIGANA_DROP lower for a fully ruby'd book,
  ramping over FURIGANA_RAMP, so light novels' ruby (0.3-0.45) never moves it. Shown beside the level;
  rank gates and the library's level stay on score.
"""
import bisect
import json
import math
import os
import re

from compound_merge import merge_compounds
from word_list import is_noise_word

# 1: first version. 2: rubyKanji and sentLen (facets). 3: ranks by the best spelling (best_ranks), source
# line breaks folded in book_text (features.py). 4: rare katakana words met KATAKANA_NAME_COUNT times are names.
CORE_VERSION = 4
REPEAT_CAP = 10
KATAKANA_NAME_COUNT = 3
KATAKANA_NAME_RANK = 50_000
BUCKETS_PER_DECADE = 4
RANKED_BUCKETS = 6 * BUCKETS_PER_DECADE
# Lower edges of the ranked buckets: bucket b holds ranks in [EDGES[b], EDGES[b + 1]); integer ranks
# never fall within float error of the irrational edges, and 10, 100… are exact in both languages.
EDGES = [10 ** (b / BUCKETS_PER_DECADE) for b in range(RANKED_BUCKETS)]
# Parts of speech that are vocabulary: particles, auxiliaries, affixes, symbols and blanks are not.
VOCABULARY = {'名詞', '代名詞', '形状詞', '連体詞', '形容詞', '動詞', '副詞', '接続詞', '感動詞'}
# yurigana's is_kanji, and sentences as the difficulty-features study cut them (core.ts: the same).
KANJI = re.compile('[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003134f]')
SENTENCE = re.compile('[^。！？!?\n]+[。！？!?」』]*')
BLANKS = ' \t\r\u00a0\u3000'
KANA = re.compile('[ぁ-ヿ]+')
# Fitted on 60 works against Jiten, LearnNatively and jpdb: a fully ruby'd book's level less the services'
# (mapped onto the scale over the other books) had a median gap of 1.2-2.1 levels; checked on ~480 held-out
# library books Jiten lists (Spearman +0.63 -> +0.71, the books below the ramp unchanged).
FURIGANA_DROP = 2
FURIGANA_RAMP = (0.5, 0.9)
KATAKANA = re.compile('[ァ-ヺー]+')
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


def best_ranks(units, frequency) -> dict:
    """lemma -> its best rank over the units' spellings (normalized form, dictionary form, an all-kana
    form's reading), None when the list ranks none of them. Names are left out."""
    ranks, by_reading, best = frequency.ranks, frequency.best_by_reading, {}
    for lemma, form, _, name in units:
        if name:
            continue
        found = [r for r in (ranks.get(lemma), ranks.get(form),
                             by_reading.get(to_hiragana(form)) if KANA.fullmatch(form) else None) if r is not None]
        rank = min(found, default=None)
        old = best.get(lemma)
        best[lemma] = rank if old is None or (rank is not None and rank < old) else old
    return best


def bucket(rank) -> int:
    """The histogram bucket of a rank (None: unranked, the last bucket)."""
    if rank is None:
        return RANKED_BUCKETS
    return min(bisect.bisect_right(EDGES, rank) - 1, RANKED_BUCKETS - 1)


def summarise(units, rank_of) -> dict:
    """The book's core numbers from word_units; `rank_of(lemma)` gives a frequency rank or None."""
    words = {}  # lemma -> [count, rank, written in katakana]
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
            word = words[lemma] = [0, rank, bool(KATAKANA.fullmatch(form))]
        word[0] += 1
    for lemma, (n, rank, katakana) in list(words.items()):
        if katakana and n >= KATAKANA_NAME_COUNT and rank is not None and rank > KATAKANA_NAME_RANK:
            names += n
            del words[lemma]
    tokens = sum(n for n, *_ in words.values())
    hist, types = [0] * (RANKED_BUCKETS + 1), [0] * (RANKED_BUCKETS + 1)
    for n, rank, _ in words.values():
        hist[bucket(rank)] += n
        types[bucket(rank)] += 1
    # 98% = 49/50, in integers so both languages agree exactly.
    covered = sum(max(n - REPEAT_CAP, 0) for n, *_ in words.values())
    v98 = 1 if tokens and covered * 50 >= tokens * 49 else None
    if v98 is None:
        for n, rank, _ in sorted((w for w in words.values() if w[1] is not None), key=lambda w: w[1]):
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


def furigana_score(level: float, ruby_kanji: float) -> float:
    """The level read with the author's furigana: `level` (score) less FURIGANA_DROP times how far
    rubyKanji is along FURIGANA_RAMP, at least 1."""
    low, high = FURIGANA_RAMP
    ramp = min(max((ruby_kanji - low) / (high - low), 0), 1)
    return max(round2(level - FURIGANA_DROP * ramp), 1.0)


def facets(text: str, ruby_kanji: int) -> dict:
    """rubyKanji: kanji under the author's ruby (`ruby_kanji`, book_text's ruby['kanji']) per kanji
    of the text (ruby left out), at most 1. sentLen: mean characters per sentence; a sentence with
    fewer than two non-blank characters doesn't count."""
    kanji = len(text) - len(KANJI.sub('', text))
    # Two non-blank characters at least = two or more left once the ends are stripped.
    sentences = [s for s in SENTENCE.findall(text) if len(s.strip(BLANKS)) >= 2]
    total, count = sum(map(len, sentences)), len(sentences)
    return {'rubyKanji': round2(min(ruby_kanji / kanji, 1)) if kanji else 0,
            'sentLen': round2(total / count) if count else 0}


def book_core(tokens, frequency, text: str = '', ruby_kanji: int = 0) -> dict:
    """The book's core numbers from its Sudachi tokens (yurigana's SudachiTokenizer.tokens: offsets,
    symbols and blanks left out) and a FrequencyTable (frequency.py), with the facets of its text
    and ruby."""
    units = list(word_units(merge_compounds(list(tokens), frequency)))
    core = summarise(units, best_ranks(units, frequency).get)
    return {**core, **facets(text, ruby_kanji)}


def core_table_text(frequency) -> str:
    """The frequency list as core.ts reads it (parseCoreTable; build.sh gzips it as
    core-frequency.tsv.gz): `term \t rank` lines, a blank line, `term \t reading \t rank` lines, a
    blank line, `compound \t reading` lines, each sorted."""
    return ''.join([*(f'{t}\t{r}\n' for t, r in sorted(frequency.ranks.items())), '\n',
                    *(f'{t}\t{reading}\t{r}\n' for (t, reading), r in sorted(frequency.reading_ranks.items())), '\n',
                    *(f'{form}\t{reading}\n' for form, reading in sorted(frequency.compounds.items()))])
