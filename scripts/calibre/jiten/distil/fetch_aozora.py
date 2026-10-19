"""Downloads Aozora Bunko's public-domain works in modern spelling (新字新仮名) as UTF-8 TXT,
OUT/<person id>/<work id>.txt, for training the committed reading model
(`reading_model.py train`, `../reading-model-public.json.gz`).

Only works whose every person (author, translator…) is out of copyright, as Aozora Bunko's
index marks them (作品著作権フラグ and 人物著作権フラグ なし). Their texts are free to use;
Aozora Bunko asks only that its files' own notes stay with copies of the files, and none
are copied here: the table holds word statistics, not text. The header (記号の説明) and
the colophon (底本：…) are left out, as are ［＃…］ notes; a ※ character outside JIS
becomes 〓. Resumable; WORKERS requests at a time, each followed by a pause.

  python3 fetch_aozora.py OUT [--limit N] [--delay 0.3]
"""
import argparse
import csv
import io
import os
import re
import time
import urllib.request
import zipfile

INDEX = 'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip'
MAX_BYTES = 32 * 1024 * 1024
WORKERS = 3


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': 'chimimouryou reading-model builder'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError(f'{url} is too large')
    return data


def public_domain_works(rows) -> dict:
    """work id -> (author's person id, text zip URL) for works in 新字新仮名 whose every
    person is out of copyright."""
    by_work = {}
    for row in rows:
        by_work.setdefault(row['作品ID'], []).append(row)
    works = {}
    for work, people in by_work.items():
        first = people[0]
        if (all(p['作品著作権フラグ'] == 'なし' and p['人物著作権フラグ'] == 'なし' for p in people)
                and first['文字遣い種別'] == '新字新仮名' and first['テキストファイルURL'].endswith('.zip')):
            author = next((p for p in people if p['役割フラグ'] == '著者'), first)
            works[work] = (author['人物ID'], first['テキストファイルURL'])
    return works


def clean(text: str) -> str:
    """The story only: no header, colophon or ［＃…］ notes."""
    lines = text.splitlines()
    rules = [i for i, line in enumerate(lines[:60]) if re.match(r'^-{20,}', line)]
    if len(rules) >= 2:
        lines = lines[:2] + lines[rules[1] + 1:]
    end = next((i for i, line in enumerate(lines) if line.startswith('底本：')), len(lines))
    text = '\n'.join(lines[:end])
    return re.sub(r'［＃[^］\n]*］', '', text.replace('※［＃', '〓［＃'))


def main(out: str, limit: int | None, delay: float):
    os.makedirs(out, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(_get(INDEX))) as archive:
        name = archive.namelist()[0]
        rows = list(csv.DictReader(io.TextIOWrapper(archive.open(name), 'utf-8-sig')))
    works = sorted(public_domain_works(rows).items())[:limit]
    todo = [(work, person, url) for work, (person, url) in works
            if not os.path.exists(os.path.join(out, person, f'{work}.txt'))]

    def fetch(item):
        work, person, url = item
        path = os.path.join(out, person, f'{work}.txt')
        try:
            with zipfile.ZipFile(io.BytesIO(_get(url))) as archive:
                member = next(i for i in archive.infolist() if i.filename.lower().endswith('.txt'))
                if member.file_size > MAX_BYTES:
                    raise ValueError('too large')
                text = archive.read(member).decode('cp932', 'replace')
        except Exception as error:  # a few cards point at missing or odd files
            print(work, url, error, flush=True)
            return False
        finally:
            time.sleep(delay)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + '.tmp', 'w', encoding='utf-8') as f:
            f.write(clean(text))
        os.replace(path + '.tmp', path)
        return True

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(WORKERS) as pool:
        done = sum(pool.map(fetch, todo))
    print(f'{len(works)} works, {len(works) - len(todo)} there already, {done} downloaded, {len(todo) - done} failed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('out')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--delay', type=float, default=0.3)
    args = parser.parse_args()
    main(args.out, args.limit, args.delay)
