"""Python port of Jiten's Deconjugator (Jiten.Parser/Deconjugator.cs, Apache-2.0).

Breadth-first application of the rules in deconjugator.json (originally from
rampaa/JL). Each result is a candidate dictionary form plus the chain of
conjugation steps ("process") that leads from it to the input text.
"""
import json
import os
import re
from functools import lru_cache
from typing import NamedTuple

MAX_TEXT_GROWTH = 10
MAX_CHAIN_DEPTH_ABOVE_INPUT = 6


_new_tuple = tuple.__new__  # Form(*fields) without the call overhead


class Form(NamedTuple):
    text: str
    original: str
    tags: tuple
    seen: frozenset
    process: tuple


# Rule modes, as ints for the inner loop.
_STD, _ONLY_FINAL, _NEVER_FINAL, _REWRITE, _CONTEXT = range(5)
_MODES = {'stdrule': _STD, 'onlyfinalrule': _ONLY_FINAL, 'neverfinalrule': _NEVER_FINAL,
          'rewriterule': _REWRITE, 'contextrule': _CONTEXT}


def _load_rules(path: str):
    with open(path, encoding='utf-8') as f:
        source = f.read()
    # The file has // comments and trailing commas, which json doesn't accept.
    source = re.sub(r'^\s*//.*$', '', source, flags=re.M)
    source = re.sub(r',(\s*[\]}])', r'\1', source)
    return json.loads(source)


class Deconjugator:
    def __init__(self, rules_path: str = os.path.join(os.path.dirname(__file__), 'deconjugator.json')):
        # con_end -> rules ending in it, each (mode, context, con_end, dec_end, con_tag, dec_tag, step,
        # has_detail), in file order; step is the detail to add to the process (or none).
        self.index: dict[str, list[tuple]] = {}

        for rule in _load_rules(rules_path):
            mode = _MODES.get(rule['type'], _STD)
            context = rule.get('contextrule') if mode == _CONTEXT else None
            dec_tags = rule.get('dec_tag') or [None]
            con_tags = rule.get('con_tag') or [None]
            con_ends = rule['con_end']
            detail = rule['detail']
            for i, dec_end in enumerate(rule['dec_end']):
                con_end = con_ends[i] if i < len(con_ends) else con_ends[0]
                self.index.setdefault(con_end, []).append((
                    mode, context, con_end, dec_end,
                    con_tags[i] if i < len(con_tags) else con_tags[0],
                    dec_tags[i] if i < len(dec_tags) else dec_tags[0],
                    (detail,) if detail else (), bool(detail)))

        self.suffix_lengths = tuple(sorted({len(con_end) for con_end in self.index}))

        # Results hold every intermediate form, so keep the cache small.
        self.deconjugate = lru_cache(maxsize=2000)(self._deconjugate)

    def _deconjugate(self, text: str) -> tuple[Form, ...]:
        if not text:
            return ()
        # Forms are plain tuples (text, original, tags, seen, process) until the end: equal and hashed as Form.
        initial = (text, text, (), frozenset((text,)), ())
        seen = {initial}
        matches = {}
        ordered = [initial]
        novel = [initial]
        max_text = len(text) + MAX_TEXT_GROWTH
        max_tags = len(text) + MAX_CHAIN_DEPTH_ABOVE_INPUT

        while novel:
            new_novel = []
            for form in novel:
                if not form[0] or len(form[0]) > max_text or len(form[2]) > max_tags:
                    continue
                self._apply_rules(form, new_novel, seen, ordered, matches)
            novel = new_novel

        # Longest text first, then ordinal, keeping discovery order for ties.
        ordered.sort(key=lambda f: (-len(f[0]), f[0]))
        return tuple([_new_tuple(Form, f) for f in ordered])

    def _matches(self, text: str) -> list:
        """(stem, rules) for each suffix of `text` that rules end in, shortest suffix first."""
        length = len(text)
        index = self.index
        found = []
        for suffix_len in self.suffix_lengths:
            if suffix_len > length:
                break
            rules = index.get(text[length - suffix_len:])
            if rules:
                found.append((text[:length - suffix_len], rules))
        return found

    def _apply_rules(self, form: tuple, new_novel: list, seen: set, ordered: list, matches: dict):
        text, original, tags, seen_texts, process = form
        last_tag = tags[-1] if tags else None
        found = matches.get(text)
        if found is None:
            found = matches[text] = self._matches(text)
        for stem, rules in found:
            for mode, context, con_end, dec_end, con_tag, dec_tag, step, has_detail in rules:
                if tags:
                    if mode == _ONLY_FINAL or last_tag != con_tag:
                        continue
                elif mode == _NEVER_FINAL or not has_detail:
                    continue
                if mode == _REWRITE and text != con_end:
                    continue
                if mode == _CONTEXT:
                    if context == 'v1inftrap' and tags == ('stem-ren',):
                        continue
                    if context == 'saspecial' and stem and stem[-1] == 'さ':
                        continue
                    if context == 'temirurule' and not stem.endswith(('て', 'で')):
                        continue

                new_text = stem + dec_end
                if new_text == original:
                    continue

                if tags:
                    new_tags = tags + (dec_tag,) if dec_tag else tags
                elif con_tag:
                    new_tags = (con_tag, dec_tag) if dec_tag else (con_tag,)
                else:
                    new_tags = (dec_tag,) if dec_tag else ()
                new_form = (new_text, original, new_tags, seen_texts | {new_text}, process + step)
                if new_form not in seen:
                    seen.add(new_form)
                    ordered.append(new_form)
                    new_novel.append(new_form)
