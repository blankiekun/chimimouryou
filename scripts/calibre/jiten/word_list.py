"""A book's word list (the difficulty service's words/<id>, and the standalone's analysis tools in
the browser) from features.Analyzer's analysis. Not upstream."""
import re
from collections import Counter

from yurigana.kana import UNVOICED

# Not vocabulary, left out of the book's word totals (uniqueWords, tokens) like the reader's
# word coverage does (isNoiseWord in book-words.ts): particles, numbers, lone kana, and kana-only
# words without a frequency rank (tokenizer noise).
PARTICLES = set('は が を に で と も の へ や か な ね よ わ ぞ ぜ さ て ば し から まで より だけ ほど '
                'くらい ぐらい など なら って けど けれど のに ので しか こそ でも ても さえ'.split())
NUMBER = re.compile(r'[0-9０-９〇一二三四五六七八九十百千万]+')
SINGLE_KANA = re.compile(r'[\u3041-\u309f\u30a0-\u30ffー]')
KANJI = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003134f]')


def is_noise_word(form: str, rank) -> bool:
    return (form in PARTICLES or bool(NUMBER.fullmatch(form)) or bool(SINGLE_KANA.fullmatch(form))
            or (rank is None and not KANJI.search(form)))


def word_rows(analysis, frequency):
    """The book's words, most frequent first, as [form, reading or None, count in the book, frequency
    rank or None, lemma (Sudachi's normalized form: 分かる for わかる and 判る)], one row per reading
    (他: ほか and た). Rows of one form and reading from different Sudachi words (ある: 有る and 或る)
    are merged. A word met only conjugated takes the form's most common reading in the book, else
    Sudachi's reading of the form (None only when neither exists). A voiced reading the list lacks
    counts for the unvoiced one it gives (箱 ばこ: はこ); one it has takes the better of the two ranks
    (顔 がお: かお's). Names, affixes (今 read こん, from 今回),
    particles, auxiliaries and unclassified tokens are left out. Also returns the number of rows and
    their occurrences, without noise (is_noise_word)."""
    merged = {}  # (form, reading) -> [form, reading, count, rank, lemma, the lemma's count]
    by_form = {}  # form -> Counter of readings
    conjugated = []

    def add(word, reading, n):
        lemma = word.key.split('\t')[0]
        # A voiced reading the list lacks (この箱 ばこ, 小屋 ごや as a compound's tail) is the word's plain one.
        plain = reading and reading[0].translate(UNVOICED) + reading[1:]
        if plain != reading and (lemma, reading) not in frequency.reading_ranks and (lemma, plain) in frequency.reading_ranks:
            reading = plain
        data = frequency.word(word.key, reading)
        rank = data[0] if data else None
        # A compound tail the list ranks voiced too (顔 がお 75,124, from 心配顔) is as common as the word (かお 113).
        if plain != reading and (lemma, plain) in frequency.reading_ranks:
            rank = min(rank or float('inf'), frequency.reading_ranks[lemma, plain])
        row = merged.get((word.form, reading))
        if row is None:
            merged[word.form, reading] = [word.form, reading, n, rank, lemma, n]
        else:
            row[2] += n
            row[3] = min(filter(None, (row[3], rank)), default=None)
            if n > row[5]:
                row[4], row[5] = lemma, n
        by_form.setdefault(word.form, Counter())[reading] += n

    for word_key, (word, count) in analysis.words.items():
        if word.pos in ('name', 'fix', 'other', 'particle', 'aux'):
            continue
        readings = Counter(analysis.readings.get(word_key) or {word.reading: count})
        # Conjugated occurrences have no reading: they go to the word's most common one.
        unknown = readings.pop(None, 0)
        if readings:
            readings[readings.most_common(1)[0][0]] += unknown
        elif unknown:
            conjugated.append((word, word_key, unknown))
        for reading, n in readings.items():
            add(word, reading, n)
    for word, word_key, n in conjugated:
        known = by_form.get(word.form)
        add(word, known.most_common(1)[0][0] if known else analysis.form_readings.get(word_key), n)
    rows = [row[:5] for row in merged.values()]
    vocabulary = [row for row in rows if not is_noise_word(row[0], row[3])]
    return sorted(rows, key=lambda row: -row[2]), len(vocabulary), sum(row[2] for row in vocabulary)
