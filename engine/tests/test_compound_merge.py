"""Tests for jiten/compound_merge.py over synthetic Sudachi tokens (no Sudachi needed; JMdict is yurigana's)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compound_merge import compound_table, merge_compounds  # noqa: E402
from yurigana.tokens import Token  # noqa: E402

NOUN = ('名詞', '普通名詞', '一般', '*', '*', '*')
SURU = ('名詞', '普通名詞', 'サ変可能', '*', '*', '*')
VERB = ('動詞', '一般', '*', '*', '五段-サ行', '連用形-一般')
PARTICLE = ('助詞', '格助詞', '*', '*', '*', '*')
AUX = ('助動詞', '*', '*', '*', '助動詞-タ', '終止形-一般')
NUMBER = ('名詞', '数詞', '*', '*', '*', '*')
SUFFIX = ('接尾辞', '名詞的', '一般', '*', '*', '*')


class Frequency:
    """FrequencyTable's ranks, reading_ranks, compounds and word()."""
    def __init__(self, ranks, reading_ranks):
        self.ranks, self.reading_ranks = ranks, reading_ranks
        self.compounds = compound_table(ranks, reading_ranks)

    def word(self, key, reading=None):
        rank = self.reading_ranks.get((key, reading)) or self.ranks.get(key)
        return (rank, 1 / rank) if rank else None


FREQUENCY = Frequency({'心配': 2000, '顔': 113, '心配顔': 54486, '引く': 300, '引き返す': 8000,
                       '目': 100, '通す': 2000, '目を通す': 5000, '三': 200, '本': 150, '三本': 9000, '大学': 900,
                       '大学生': 3000, 'その': 50, '日': 60, 'その日': 1252, '泣く': 800},
                      {('顔', 'かお'): 113, ('顔', 'がお'): 75124, ('心配顔', 'しんぱいがお'): 54486})


def tokens(*parts):
    """(surface, dictionary form, pos) per token, or None for a gap (punctuation the tokens leave out)."""
    out, at = [], 0
    for part in parts:
        if part is None:
            at += 1
            continue
        surface, form, pos = part
        out.append(Token(surface, form, form, pos, '', at))
        at += len(surface)
    return out


def merged(*parts, readings=None):
    return [(t.surface(), t.dictionary_form(), t.reading_form(), t.part_of_speech()[0], t.begin)
            for t in merge_compounds(tokens(*parts), FREQUENCY, readings)]


class MergeCompoundsTest(unittest.TestCase):
    def test_a_rare_tail_joins_with_its_jmdict_reading(self):
        # The Reader reads 顔 がお here (75,124): the compound is commoner (54,486)
        self.assertEqual(merged(('心配', '心配', SURU), ('顔', '顔', NOUN), ('で', 'で', PARTICLE),
                                readings={(2, 3): 'がお'}),
                         [('心配顔', '心配顔', 'しんぱいがお', '名詞', 0), ('で', 'で', '', '助詞', 3)])

    def test_common_parts_stay_apart(self):
        # 顔 read かお (113) is commoner than 心配顔; その日 is rarer than その and 日
        self.assertEqual(len(merged(('心配', '心配', SURU), ('顔', '顔', NOUN), readings={(2, 3): 'かお'})), 2)
        self.assertEqual(len(merged(('その', 'その', ('連体詞', '*', '*', '*', '*', '*')), ('日', '日', NOUN))), 2)

    def test_conjugated_tail_takes_the_last_tokens_dictionary_form(self):
        # 返す is unranked in this list, so the compound is commoner than its rarest part
        result = merged(('引き', '引く', VERB), ('返し', '返す', VERB), ('た', 'た', AUX))
        self.assertEqual(result[0], ('引き返し', '引き返す', '', '動詞', 0))
        self.assertEqual(result[1][0], 'た')

    def test_never_across_gaps_particles_or_numbers(self):
        self.assertEqual(len(merged(('心配', '心配', SURU), None, ('顔', '顔', NOUN))), 2)
        self.assertEqual(len(merged(('目', '目', NOUN), ('を', 'を', PARTICLE), ('通す', '通す', VERB))), 3)
        self.assertEqual(len(merged(('三', '三', NUMBER), ('本', '本', SUFFIX))), 2)

    def test_affix_tail_is_a_noun(self):
        self.assertEqual(merged(('大学', '大学', NOUN), ('生', '生', SUFFIX))[0][:4], ('大学生', '大学生', 'だいがくせい', '名詞'))

    def test_unranked_forms_stay_split(self):
        # 泣き顔 is in JMdict but not in this list
        self.assertEqual(len(merged(('泣き', '泣く', VERB), ('顔', '顔', NOUN))), 2)


if __name__ == '__main__':
    unittest.main()
