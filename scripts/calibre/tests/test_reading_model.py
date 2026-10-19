"""Tests for jiten/reading_model.py and the training in jiten/distil/reading_context.py (no Sudachi)."""
import gzip
import json
import math
import os
import sys
import tempfile
import unittest
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'jiten', 'distil'))
import reading_context as rc  # noqa: E402
from features import Token  # noqa: E402
from reading_model import WINDOW, ReadingModel, build_form, features, token_window  # noqa: E402


def tokens(line, offset=0):
    """One token per space-separated word; 人気 and nouns are content words."""
    result, at = [], offset
    for word in line.split(' '):
        result.append(Token(word, word, word, ('名詞' if word in ('人気', '店', '廊下') else '助詞',) + ('*',) * 5,
                            '', at))
        at += len(word)
    return result


def counts(rows):
    out = {}
    for reading, line in rows:
        ts = tokens(line)
        found = features(token_window(ts, line.split(' ').index('人気'), 0, 99))
        entry = out.setdefault(reading, [0, Counter()])
        entry[0] += 1
        entry[1].update(found)
    return out


HITOKE = [('ひとけ', '廊下 に 人気 が ない')] * 30 + [('ひとけ', '人気 の ない 廊下')] * 30
NINKI = [('にんき', '店 は 人気 が ある')] * 30 + [('にんき', '人気 の 店')] * 10


class FeatureTest(unittest.TestCase):
    def test_window_stops_at_the_line(self):
        ts = tokens('店 は') + tokens('人気 が', 2)
        window = token_window(ts, 2, 2, 5)
        self.assertEqual(window[WINDOW - 1], None)
        self.assertEqual(window[WINDOW], ['が', ''])

    def test_features_are_positions_pairs_and_content_words(self):
        ts = tokens('廊下 に 人気 が ない')
        self.assertEqual(features(token_window(ts, 2, 0, 99)),
                         ['L1:に', 'L2:廊下', 'R1:が', 'R2:ない', 'L:廊下に', 'R:がない', 'W:廊下'])


class ModelTest(unittest.TestCase):
    def setUp(self):
        self.entry = build_form({r: c for r, (_, c) in counts(HITOKE + NINKI).items()},
                                ['L1:に', 'R1:が', 'R2:ない', 'R2:ある', 'R1:の', 'W:店'], [math.log(.5)] * 2)
        # 人家 stands in for a form without hand rules; 人気 has them (features._CONTEXT_RULES).
        self.model = ReadingModel({'人家': self.entry, '人気': self.entry})

    def test_context_decides(self):
        ts = tokens('店 は 人気 が ある')
        self.assertEqual(self.model.reading('店は人気がある', ts, 2, '人家', {('人家', 'にんき'): 1}), 'にんき')
        ts = tokens('人気 が ない')
        self.assertEqual(self.model.reading('人気がない', ts, 0, '人家', {('人家', 'ひとけ'): 1}), 'ひとけ')

    def test_forms_with_hand_rules_are_left_to_the_rules_and_sudachi(self):
        # The table says ひとけ for 人気がない; without a cue no rule fires, so Sudachi's にんき stays.
        from features import context_reading
        known = {('人気', 'ひとけ'): 1, ('人気', 'にんき'): 1}
        ts = tokens('それ は 人気 が ない')
        self.assertEqual(self.model.predict('人気', token_window(ts, 2, 0, 99)), 'ひとけ')
        self.assertIsNone(context_reading('それは人気がない', 3, '人気', '人気', known))
        self.assertIsNone(self.model.reading('それは人気がない', ts, 2, '人気', known))

    def test_only_readings_jiten_lists_and_only_modelled_forms(self):
        ts = tokens('人気 が ない')
        self.assertIsNone(self.model.reading('人気がない', ts, 0, '人気', {('人気', 'にんき'): 1}))
        self.assertIsNone(self.model.reading('人気がない', ts, 0, '本気', {('本気', 'まじ'): 1}))

    def test_unsure_predictions_keep_sudachis_reading(self):
        # No feature in the table: the posterior is the 50/50 prior, under ReadingModel.confidence.
        self.assertIsNone(self.model.predict_features('人気', ['L1:は']))
        self.assertEqual(self.model.predict_features('人気', ['R1:が', 'R2:ない']), 'ひとけ')

    def test_load_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'm.json.gz')
            with gzip.open(path, 'wt', encoding='utf-8') as f:
                json.dump({'version': 1, 'forms': {'人気': self.entry}}, f)
            self.assertEqual(ReadingModel.load(path).forms['人気'][0], ['ひとけ', 'にんき'])
            with gzip.open(path, 'wt', encoding='utf-8') as f:
                json.dump({'version': 2, 'forms': {}}, f)
            with self.assertRaises(ValueError):
                ReadingModel.load(path)


class ServiceTest(unittest.TestCase):
    def test_the_servers_table_wins_and_the_committed_one_fills_in(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        with tempfile.TemporaryDirectory() as tmp:
            paths = [os.path.join(tmp, name) for name in ('server.json.gz', 'aozora.json.gz', 'broken.json.gz')]
            for path, forms in zip(paths, ({'人気': 'server'}, {'人気': 'aozora', '床': 'aozora'})):
                with gzip.open(path, 'wt', encoding='utf-8') as f:
                    json.dump({'version': 1, 'forms': forms}, f)
            with open(paths[2], 'w') as f:
                f.write('not gzip')
            self.assertEqual(service.load_reading_model(paths).forms, {'人気': 'server', '床': 'aozora'})
            self.assertIsNone(service.load_reading_model([os.path.join(tmp, 'missing')]))
        self.assertGreater(len(service.load_reading_model().forms), 30)  # the committed table


class TatoebaTest(unittest.TestCase):
    def test_transcriptions_become_ruby_that_ruby_reading_reads(self):
        from features import aozora_text, ruby_reading
        import fetch_tatoeba
        marked = fetch_tatoeba.to_aozora('[場所|ば|しょ]に[行|い]った。[明日|あした]')
        self.assertEqual(marked, '｜場《ば》｜所《しょ》に｜行《い》った。｜明日《あした》')
        hints = []
        self.assertEqual(aozora_text(marked, None, hints), '場所に行った。明日')
        at = {s: (e, r) for s, e, r in hints}
        self.assertEqual(ruby_reading(at, 0, '場所', '場所', {('場所', 'ばしょ')}), 'ばしょ')
        self.assertEqual(ruby_reading(at, 3, '行っ', '行く', {('行く', 'いく')}), 'いく')


class TrainingTest(unittest.TestCase):
    def test_priors_move_to_the_text_without_ruby(self):
        # Ruby'd: ひとけ 60, にんき 40. Plain text: mostly にんき contexts.
        gold = counts(HITOKE + NINKI)
        plain = []
        for reading, line in NINKI * 4 + HITOKE[:10]:
            ts = tokens(line)
            plain.append(features(token_window(ts, line.split(' ').index('人気'), 0, 99)))
        entry, prior = rc.fit(gold, plain)
        self.assertGreater(prior['にんき'], 0.8)
        self.assertAlmostEqual(math.exp(entry[1][1]), prior['にんき'], places=2)

    def test_shares_of_labelled_text_are_the_prior(self):
        entry, prior = rc.fit(counts(HITOKE + NINKI), [], Counter({'にんき': 38, 'ひとけ': 2}))
        self.assertAlmostEqual(prior['にんき'], 39 / 42)
        self.assertIsNone(rc.fit(counts(HITOKE + NINKI), [], Counter({'にんき': 5})))

    def test_no_model_without_unlabelled_text(self):
        self.assertIsNone(rc.fit(counts(HITOKE + NINKI), []))

    def test_em_keeps_priors_when_unlabelled_text_says_nothing(self):
        self.assertEqual([round(p, 2) for p in rc.em_priors([[0.0, 0.0]] * 10, [0.3, 0.7])], [0.3, 0.7])

    def test_prior_weighted_accuracy(self):
        per = {'ひとけ': (9, 10), 'にんき': (5, 10)}
        self.assertAlmostEqual(rc.prior_weighted(per, {'ひとけ': 0.2, 'にんき': 0.8}), 0.58)


if __name__ == '__main__':
    unittest.main()
