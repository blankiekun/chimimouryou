"""Downloads Tatoeba's Japanese sentences with reviewed furigana as Aozora-style TXT, for
the committed reading model: OUT/<half>/<n>/<reviewer>.txt, PER_FILE sentences per file,
one per line. Half `a` (crc32 of the sentence id even) is trained on with Aozora Bunko
(`reading_context.py mine` each, then `train` on both); half `b` only judges the result
(`evaluate --all --prune`), so no form is judged on sentences it was trained on. Each file
is its own folder, i.e. its own "author": the few-authors rule is for books' flavour ruby,
and these readings were all reviewed.

Tatoeba (https://tatoeba.org/en/downloads) publishes its sentences under CC BY 2.0 FR.
`jpn_transcriptions.tsv` has sentence id, lang, script, username, transcription; the
username is whoever last reviewed it; a transcription without one has not been reviewed
(it may be machine-made) and is left out. Readings are marked [場所|ば|しょ]: one
reading per character of the base, or one for the whole base ([明日|あした]). They become
｜場《ば》｜所《しょ》 or ｜明日《あした》, which features.aozora_text and ruby_reading read like
a book's ruby. Nothing from Tatoeba goes in git.

  python3 fetch_tatoeba.py OUT
"""
import bz2
from collections import Counter
import os
import re
import sys
import urllib.request
import zlib

BASE = 'https://downloads.tatoeba.org/exports/per_language/jpn/'
PER_FILE = 20
_READING = re.compile(r'\[([^\[\]|]+)((?:\|[^\[\]|]*)+)\]')


def _get(name: str) -> str:
    request = urllib.request.Request(BASE + name, headers={'User-Agent': 'chimimouryou reading-model check'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return bz2.decompress(response.read()).decode('utf-8')


def half_of(sentence_id: int) -> str:
    return 'ab'[zlib.crc32(str(sentence_id).encode()) % 2]


def to_aozora(transcription: str) -> str:
    """[場所|ば|しょ] → ｜場《ば》｜所《しょ》; [明日|あした] → ｜明日《あした》."""
    def one(match):
        base, readings = match.group(1), match.group(2).split('|')[1:]
        if len(readings) == len(base) and all(readings):
            return ''.join(f'｜{c}《{r}》' for c, r in zip(base, readings))
        return f'｜{base}《{"".join(readings)}》'
    return _READING.sub(one, transcription)


def main(out: str):
    sentences = sum(1 for line in _get('jpn_sentences.tsv.bz2').splitlines() if line)
    by_reviewer, total = {}, 0
    for line in _get('jpn_transcriptions.tsv.bz2').splitlines():
        parts = line.split('\t')
        if len(parts) != 5:
            continue
        total += 1
        sentence, lang, _, user, text = parts
        if lang == 'jpn' and user and re.fullmatch(r'[\w.-]+', user):
            by_reviewer.setdefault(user, []).append((int(sentence), to_aozora(text)))
    files, halves = 0, Counter()
    for user, rows in sorted(by_reviewer.items()):
        for half in 'ab':
            mine = sorted(r for r in rows if half_of(r[0]) == half)
            halves[half] += len(mine)
            for n in range(0, len(mine), PER_FILE):
                files += 1
                path = os.path.join(out, half, f'{files:06}', f'{user}.txt')
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write('\n'.join(text for _, text in mine[n:n + PER_FILE]) + '\n')
    reviewed = sum(len(rows) for rows in by_reviewer.values())
    print(f'{sentences} Japanese sentences, {total} transcriptions, {reviewed} reviewed '
          f'by {len(by_reviewer)} people; half a {halves["a"]}, half b {halves["b"]}')


if __name__ == '__main__':
    main(sys.argv[1])
