"""How often the service's tokenisation gives a word the right reading in context.

readings-test.tsv: book id or '-', sentence, form, character offset of the form in the
sentence, gold reading (hiragana; several allowed as a|b), source ('hand' = written and
checked by hand). Prints accuracy per form and the macro average (each form weighs the same).

Run where `jiten/requirements.txt` is installed (the `difficulty` image's /opt/venv):
  python eval_readings.py [readings-test.tsv]
"""
import csv
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


def main(path):
    from features import Analyzer, to_hiragana
    tokenizer = Analyzer().tokenizer
    results = defaultdict(list)
    with open(path, encoding='utf-8') as f:
        for row in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
            sentence, form, offset = row['sentence'], row['form'], int(row['offset'])
            if sentence[offset:offset + len(form)] != form:
                raise ValueError(f'{form} is not at {offset} in {sentence}')
            token = next(m for m in tokenizer.tokenize(sentence) if m.begin() <= offset < m.end())
            # The reading the service keeps (features.py, Word.reading): only for whole, unconjugated words.
            reading = to_hiragana(token.reading_form()) if token.surface() == token.dictionary_form() else None
            ok = token.surface() == form and reading in row['reading'].split('|')
            got = reading if token.surface() == form else f'{token.surface()}:{reading}'
            results[form].append((ok, got, row))
    print('form\tright\treading given (gold)')
    for form, rows in results.items():
        wrong = ', '.join(f"{got} ({row['reading']})" for ok, got, row in rows if not ok)
        print(f"{form}\t{sum(ok for ok, *_ in rows)}/{len(rows)}\t{wrong}")
    accuracy = [sum(ok for ok, *_ in rows) / len(rows) for rows in results.values()]
    total = [ok for rows in results.values() for ok, *_ in rows]
    print(f'macro {sum(accuracy) / len(accuracy):.1%} over {len(accuracy)} forms, '
          f'micro {sum(total) / len(total):.1%} over {len(total)} sentences')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'readings-test.tsv'))
