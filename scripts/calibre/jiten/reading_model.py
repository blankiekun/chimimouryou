"""Readings in context for word lists: a small naive Bayes classifier per written form that
Jiten lists with several readings (人気: にんき/ひとけ), over the tokens around the word.
Built by distil/reading_context.py from ruby (the readings books print), kept only for forms
where it beat the context rules and Sudachi on books held out. Not upstream.

The table is gzipped JSON: {"version": 1, "forms": {form: [readings, log priors, vocabulary
size, {feature: log P(feature | reading) per reading}]}}. Features not in a form's table are
ignored.
"""
import gzip
import json
import math

from features import _CONTEXT_RULES

WINDOW = 6  # tokens looked at on each side, within the line
NEAR = 2  # tokens whose position counts (L1, L2, R1, R2); the rest are a bag of words
CONTENT_POS = ('名詞', '動詞', '形容詞', '形状詞', '副詞', '代名詞')
# Forms with hand rules (人気: ひとけ only with a cue): when no rule fires they keep Sudachi's
# reading, whatever a table says (tables learnt from ruby lean to the rare reading).
RULE_FORMS = frozenset(_CONTEXT_RULES)


def token_window(tokens, i: int, line_start: int, line_end: int) -> list:
    """[surface, dictionary form or '' (not a content word)] of the WINDOW tokens on each side
    of tokens[i] that begin within [line_start, line_end) (None past the line's ends); the
    word itself is left out."""
    def entry(j):
        if not 0 <= j < len(tokens) or not line_start <= tokens[j].begin < line_end:
            return None
        t = tokens[j]
        return [t.surface(), t.dictionary_form() if t.part_of_speech()[0] in CONTENT_POS else '']
    return [entry(j) for j in range(i - WINDOW, i + WINDOW + 1) if j != i]


def features(window: list) -> list:
    """Features of a token_window: the nearest tokens by position, the two on each side
    together, and the content words around."""
    def surface(k):
        return window[k][0] if window[k] else '|'
    left = [surface(WINDOW - n) for n in range(1, NEAR + 1)]
    right = [surface(WINDOW + n - 1) for n in range(1, NEAR + 1)]
    found = [f'L{n}:{s}' for n, s in enumerate(left, 1)] + [f'R{n}:{s}' for n, s in enumerate(right, 1)]
    found += [f'L:{left[1]}{left[0]}', f'R:{right[0]}{right[1]}']
    found += sorted({f'W:{e[1]}' for e in window if e and e[1]})
    return found


class ReadingModel:
    # Posterior the best reading needs, else the word keeps Sudachi's reading: 0.7 traded a
    # little recall on ruby'd text (biased to rare readings) for fewer changes to plain text.
    confidence = 0.7

    def __init__(self, forms: dict):
        self.forms = forms

    @classmethod
    def load(cls, path: str) -> 'ReadingModel':
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            data = json.load(f)
        if data.get('version') != 1:
            raise ValueError(f'{path}: unknown reading model version')
        return cls(data['forms'])

    def scores(self, form: str, found: list) -> dict | None:
        """reading -> log posterior (unnormalised), or None when the form has no model."""
        entry = self.forms.get(form)
        if not entry:
            return None
        readings, priors, _, table = entry
        totals = list(priors)
        for feature in found:
            logs = table.get(feature)
            if logs:
                totals = [t + v for t, v in zip(totals, logs)]
        return dict(zip(readings, totals))

    def predict_features(self, form: str, found: list) -> str | None:
        scores = self.scores(form, found)
        if not scores:
            return None
        best = max(scores, key=scores.get)
        if sum(math.exp(s - scores[best]) for s in scores.values()) * self.confidence > 1:
            return None
        return best

    def predict(self, form: str, window: list) -> str | None:
        return self.predict_features(form, features(window))

    def reading(self, text: str, tokens, i: int, form: str, known) -> str | None:
        """The reading for the word whose head token is tokens[i], if the form has a model and
        Jiten lists the reading for it (`known`, FrequencyTable.reading_ranks)."""
        if form not in self.forms or form in RULE_FORMS:
            return None
        begin = tokens[i].begin
        line_end = text.find('\n', begin)
        window = token_window(tokens, i, text.rfind('\n', 0, begin) + 1, line_end if line_end >= 0 else len(text))
        reading = self.predict(form, window)
        return reading if (form, reading) in known else None


def build_form(counts: dict, vocabulary: list, log_priors: list) -> list:
    """A form's table entry from feature counts per reading ({reading: Counter}), add-one
    smoothed over `vocabulary`."""
    readings = list(counts)
    size = len(vocabulary)
    totals = {r: sum(counts[r][f] for f in vocabulary) for r in readings}
    table = {f: [round(math.log((counts[r][f] + 1) / (totals[r] + size)), 3) for r in readings] for f in vocabulary}
    return [readings, [round(p, 3) for p in log_priors], size, table]
