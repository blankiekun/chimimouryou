"""Syosetu (小説家になろう, and its R18 site): work details and search from the official novel API, the latest
chapters from the work's last index page, chapter text from its page. Tested on saved pages
(server/tests/fixtures/sources/)."""
import html
import json
import math
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

from .. import build, fetcher

SITE = 'syosetu'
NAME = 'Syosetu'
# Named in the app's "<domain> allows 1 page every 2 s".
DOMAIN = 'syosetu.com'
HOSTS = {'ncode.syosetu.com', 'novel18.syosetu.com', 'api.syosetu.com'}
# Web novels on Syosetu have no covers.
COVER_HOSTS: set[str] = set()
# Search results' order, as the app names it.
SEARCH_ORDER = 'most bookmarked'
PAGE_SIZE = 20
# The API answers at most this many results of one search.
MAX_RESULTS = 2000
WORK_HOSTS = ('ncode.syosetu.com', 'novel18.syosetu.com')
# R18 pages redirect to an age check without it.
HEADERS = {'Cookie': 'over18=yes'}
INDEX_PAGE_SIZE = 100
LATEST = 3
JST = timezone(timedelta(hours=9))

WORK_PATH = re.compile(r'/(?:novelview/infotop/ncode/)?(n\d{4}[a-z]{1,4})(?:/\d+)?/?', re.I)
INDEX_ENTRY = re.compile(r'<a href="/n\w+/(\d+)/" class="p-eplist__subtitle">(.*?)</a>\s*'
                         r'<div class="p-eplist__update">\s*(\d{4})/(\d{2})/(\d{2})', re.S)
TITLE = re.compile(r'<h1 class="p-novel__title[^"]*">(.*?)</h1>', re.S)
# Preface, text and afterword, in page order; they hold only paragraphs (no nested divs).
TEXT = re.compile(r'<div class="js-novel-text[^"]*">(.*?)</div>', re.S)


def parse_url(url: str) -> tuple[str, str] | None:
    """(work key, work page) for a link to a work or one of its chapters, else None."""
    parts = urlparse(url.strip())
    match = WORK_PATH.fullmatch(parts.path)
    if parts.scheme not in ('http', 'https') or (parts.hostname or '') not in WORK_HOSTS or not match:
        return None
    key = match[1].lower()
    return key, f'https://{parts.hostname}/{key}/'


def work_url(key: str) -> str:
    return f'https://ncode.syosetu.com/{key}/'


def _get(url: str) -> str:
    return fetcher.fetch(url, HOSTS, HEADERS)[0].decode('utf-8', 'replace')


def _text(fragment: str) -> str:
    return html.unescape(re.sub(r'<[^>]*>', '', fragment)).strip()


def parse_index(page: str) -> list[dict]:
    """[{n, title, date}] of an index page, in page order."""
    return [{'n': int(n), 'title': _text(title), 'date': f'{y}-{m}-{d}'}
            for n, title, y, m, d in INDEX_ENTRY.findall(page)]


def parse_chapter(page: str) -> dict:
    """{title, html}: the chapter's title and its preface, text and afterword as clean XHTML."""
    title = TITLE.search(page)
    blocks = [build.clean(block) for block in TEXT.findall(page)]
    return {'title': _text(title[1]) if title else '', 'html': '<p><br/></p>'.join(blocks)}


def _updated(work: dict) -> int:
    try:
        return int(datetime.strptime(work.get('general_lastup', ''), '%Y-%m-%d %H:%M:%S')
                   .replace(tzinfo=JST).timestamp() * 1000)
    except ValueError:
        return 0


def _short(work: dict) -> bool:
    return work.get('novel_type', work.get('noveltype')) == 2


def details(url: str) -> dict:
    """{title, authors, status, chapters, short, summary, updated (ms), latest, cover}. LookupError when the site
    has no such work."""
    key, work_url = parse_url(url) or (None, None)
    if not key:
        raise LookupError('Not a Syosetu work link')
    api = 'novel18api' if 'novel18.' in work_url else 'novelapi'
    answer = json.loads(_get(f'https://api.syosetu.com/{api}/api/?out=json&ncode={key}'))
    if not answer or answer[0].get('allcount', 0) < 1 or len(answer) < 2:
        raise LookupError('Syosetu has no such work (removed, or not public)')
    work = answer[1]
    short = _short(work)
    chapters = 1 if short else int(work.get('general_all_no') or 0)
    latest = []
    if not short and chapters:
        page = math.ceil(chapters / INDEX_PAGE_SIZE)
        latest = parse_index(_get(work_url + (f'?p={page}' if page > 1 else '')))[-LATEST:][::-1]
    return {'title': work.get('title', '').strip(), 'authors': work.get('writer', '').strip(),
            'status': 'finished' if work.get('end') == 0 else 'ongoing', 'chapters': chapters, 'short': short,
            'summary': work.get('story', '').strip(), 'updated': _updated(work), 'latest': latest, 'cover': ''}


def chapter(url: str, n: int, details: dict) -> dict:
    """{title, html} of chapter n; a short story's text is on the work page itself."""
    _, page = parse_url(url) or (None, None)
    if not page:
        raise LookupError('Not a Syosetu work link')
    return parse_chapter(_get(page if details['short'] else f'{page}{n}/'))


def _list(page: int, **params) -> dict:
    """{total, more, works: [{workKey, url, title, authors, status, chapters, updated}]}: one page of the general
    site's works from the novel API (R18 works aren't listed)."""
    start = (page - 1) * PAGE_SIZE + 1
    if start > MAX_RESULTS:
        return {'total': 0, 'more': False, 'works': []}
    answer = json.loads(_get('https://api.syosetu.com/novelapi/api/?' + urlencode(
        {'out': 'json', 'lim': PAGE_SIZE, 'st': start, **params})))
    if not isinstance(answer, list) or not answer or not isinstance(answer[0], dict):
        raise ValueError("Syosetu's search answered in an unknown form")
    total = int(answer[0].get('allcount') or 0)
    works = []
    for work in answer[1:]:
        key = str(work.get('ncode', '')).lower()
        if not WORK_PATH.fullmatch(f'/{key}/'):
            continue
        works.append({'workKey': key, 'url': work_url(key), 'title': str(work.get('title', '')).strip(),
                      'authors': str(work.get('writer', '')).strip(),
                      'status': 'finished' if work.get('end') == 0 else 'ongoing',
                      'chapters': 1 if _short(work) else int(work.get('general_all_no') or 0),
                      'updated': _updated(work)})
    return {'total': total, 'more': start + PAGE_SIZE - 1 < min(total, MAX_RESULTS), 'works': works}


def search(q: str, page: int) -> dict:
    return _list(page, word=q, order='favnovelcnt')


def popular(page: int) -> dict:
    return _list(page, order='weekly')


def latest(page: int) -> dict:
    return _list(page, order='new')
