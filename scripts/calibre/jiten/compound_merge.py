"""JMdict compounds Sudachi splits, joined again (Jiten's parser matches the longest JMdict word):
Sudachi cuts 心配顔 into 心配 | 顔 (SudachiDict-core and -full alike), and the Reader reads that 顔
がお, a rare reading of a common word, so word lists showed a well-known word as unknown. One
function, tokens in and tokens out, run by Analyzer.analyse on the server and, in Pyodide, in the
browser (the same code: browser.py). The table is FrequencyTable.compounds (compound_table), kept
in the frequency pack. Not upstream.

The rule (merge_compounds):
- the longest run of 2-4 adjacent tokens (no gap between them in the text, so never across
  punctuation or spaces) whose surfaces, with the last token's dictionary form (引き|返し: 引き返す),
  spell a JMdict form;
- no particle, auxiliary or numeral in the run (目|を|通す, 三|本 stay apart: JMdict's expressions and
  counter spans would hide words a reader knows);
- the form has a rank in the frequency list (the list counts Jiten's own JMdict longest-match parse,
  so an unranked form is one Jiten never counts: archaic or spurious), and that rank is better than
  its rarest part's, as each part reads alone or in `readings` (the Reader's: 顔 がお 75,124 in
  心配|顔, the compound 54,486). A compound of common parts (その|日, 理学|博士) stays split: its
  parts are words a reader knows, and joining them would only make the text look harder.
The merged token reads as JMdict does: the form's reading with the best rank in the list, else
JMdict's first. Its part of speech is the last token's (a verb's conjugation, a サ変 noun's する), a
noun when that one is an affix (大学|生)."""
from yurigana.reader import jmdict_readings
from yurigana.readings import to_hiragana
from yurigana.tokens import Token

MAX_TOKENS = 4
# Parts that never join: particles, auxiliaries, and numbers (counter spans are read apart).
_APART = ('助詞', '助動詞')
_NOUN = ('名詞', '普通名詞', '一般', '*', '*', '*')


def compound_table(ranks, reading_ranks) -> dict:
    """form -> reading of the JMdict forms of 2+ characters the frequency list ranks: of JMdict's
    readings the one the list ranks best, else JMdict's first. FrequencyTable keeps it (in its pack
    too: ~180,000 forms, ~60 MB as a dict)."""
    table = {}
    for form, readings in jmdict_readings().items():
        if len(form) > 1 and form in ranks:
            ranked = [(reading_ranks[form, r], r) for r in readings if (form, r) in reading_ranks]
            table[form] = min(ranked)[1] if ranked else readings[0]
    return table


def _compound_rank(frequency, form, reading):
    return frequency.reading_ranks.get((form, reading)) or frequency.ranks[form]


def _joins(token) -> bool:
    pos = token.part_of_speech()
    return pos[0] not in _APART and pos[1] != '数詞'


def _rank(token, frequency, readings) -> float:
    reading = readings.get((token.begin, token.end)) or to_hiragana(token.reading_form())
    found = frequency.word(token.normalized_form(), reading)
    return found[0] if found else float('inf')


def merge_compounds(tokens: list, frequency, readings=None) -> list:
    """`tokens` (yurigana Tokens with offsets) with each JMdict compound they spell as one Token.
    `readings`: (begin, end) -> a token's reading in context, where it isn't Sudachi's."""
    table = frequency.compounds
    readings = readings or {}
    merged, i, n = [], 0, len(tokens)
    while i < n:
        token = tokens[i]
        if _joins(token):
            # The run of joinable, adjacent tokens from i (at most MAX_TOKENS).
            end = i + 1
            while end < n and end - i < MAX_TOKENS and tokens[end].begin == tokens[end - 1].end and _joins(tokens[end]):
                end += 1
            for j in range(end, i + 1, -1):
                last = tokens[j - 1]
                stem = ''.join(t.surface() for t in tokens[i:j - 1])
                form = stem + last.dictionary_form()
                reading = table.get(form)
                if reading is None or (_compound_rank(frequency, form, reading)
                                       >= max(_rank(t, frequency, readings) for t in tokens[i:j])):
                    continue
                pos = last.part_of_speech()
                surface = stem + last.surface()
                merged.append(Token(surface, form, form, _NOUN if pos[0] in ('接頭辞', '接尾辞') else pos,
                                    reading if surface == form else '', token.begin))
                i = j
                break
            else:
                merged.append(token)
                i += 1
        else:
            merged.append(token)
            i += 1
    return merged
