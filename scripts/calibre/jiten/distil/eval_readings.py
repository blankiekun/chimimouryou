"""How often the service's tokenisation gives a word the right reading in context.

readings-test.tsv: book id or '-', sentence, form, character offset of the form in the
sentence, gold reading (hiragana; several allowed as a|b), source ('hand' = written and
checked by hand, 'hand-ruby' = the same with the book's ruby in Aozora markup, 人気《ひとけ》
or ｜人気《ひとけ》; offsets count without the markup). Prints accuracy per form and the
macro average (each form weighs the same).

With --dictionary (Jiten's frequency list, the service's frequency-dictionary.zip), ruby,
the context rules and then the reading model (--model, default ../reading-model-public.json.gz)
give the reading as in the service (features.ruby_reading, context_reading, reading_model),
and the result without ruby is printed too; without it none applies.

Run where `jiten/requirements.txt` is installed (the `difficulty` image's /opt/venv):
  python eval_readings.py [readings-test.tsv] [--dictionary frequency-dictionary.zip]
"""
import argparse
import csv
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


def score(results, label):
    accuracy = [sum(ok for ok, *_ in rows) / len(rows) for rows in results.values()]
    if not accuracy:
        return
    total = [ok for rows in results.values() for ok, *_ in rows]
    print(f'{label}macro {sum(accuracy) / len(accuracy):.1%} over {len(accuracy)} forms, '
          f'micro {sum(total) / len(total):.1%} over {len(total)} sentences')


def main(path, dictionary=None, model_path=None):
    from features import Analyzer, aozora_text, context_reading, ruby_reading, to_hiragana
    analyzer = Analyzer()
    tokenizer = analyzer.tokenizer
    known, model = (), None
    if dictionary:
        from frequency import FrequencyTable
        from reading_model import ReadingModel
        known = FrequencyTable.load(dictionary).reading_ranks
        model = ReadingModel.load(model_path) if model_path and os.path.exists(model_path) else None
    results, without_ruby = defaultdict(list), defaultdict(list)
    with open(path, encoding='utf-8') as f:
        for row in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
            hints = []
            sentence, form, offset = aozora_text(row['sentence'], None, hints), row['form'], int(row['offset'])
            if sentence[offset:offset + len(form)] != form:
                raise ValueError(f'{form} is not at {offset} in {sentence}')
            token = next(m for m in tokenizer.tokenize(sentence) if m.begin() <= offset < m.end())
            # The reading the service keeps (features.py, Word.reading): only for whole, unconjugated words.
            sudachi = to_hiragana(token.reading_form()) if token.surface() == token.dictionary_form() else None
            ruby = ruby_reading({s: (e, r) for s, e, r in hints}, token.begin(), token.surface(),
                                token.dictionary_form(), known)
            rule = context_reading(sentence, token.begin(), token.surface(), token.dictionary_form(), known)
            tokens = list(analyzer._tokens(sentence))
            index = next((i for i, t in enumerate(tokens) if t.begin == token.begin()), None)
            if model and index is not None:
                rule = rule or model.reading(sentence, tokens, index, token.dictionary_form(), known)
            for reading, out in ((ruby or rule or sudachi, results), (rule or sudachi, without_ruby)):
                ok = token.surface() == form and reading in row['reading'].split('|')
                got = reading if token.surface() == form else f'{token.surface()}:{reading}'
                out[form].append((ok, got, row))
    print('form\tright\treading given (gold)')
    for form, rows in results.items():
        wrong = ', '.join(f"{got} ({row['reading']})" for ok, got, row in rows if not ok)
        print(f"{form}\t{sum(ok for ok, *_ in rows)}/{len(rows)}\t{wrong}")
    if dictionary:
        score(without_ruby, 'without ruby: ')
        ruby_rows = {form: [r for r in rows if r[2]['source'].endswith('-ruby')] for form, rows in results.items()}
        plain_rows = {form: [r for r in rows if r[2]['source'].endswith('-ruby')] for form, rows in without_ruby.items()}
        score({k: v for k, v in plain_rows.items() if v}, 'ruby rows without ruby: ')
        score({k: v for k, v in ruby_rows.items() if v}, 'ruby rows with ruby: ')
    score(results, 'with ruby: ' if dictionary else '')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('path', nargs='?', default=os.path.join(HERE, 'readings-test.tsv'))
    parser.add_argument('--dictionary', help="Jiten's frequency list, to use the sentences' ruby")
    parser.add_argument('--model', default=os.path.join(os.path.dirname(HERE), 'reading-model-public.json.gz'),
                        help='reading model table (reading_model.py); with --dictionary')
    args = parser.parse_args()
    main(args.path, args.dictionary, args.model)
