"""Syosetu (小説家になろう, and its R18 site): work details from the official novel API, the latest chapters from
the work's last index page, chapter text from its page. Tested on saved pages (server/tests/fixtures/sources/)."""
import html
import json
import math
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from .. import build, fetcher

SITE = 'syosetu'
NAME = 'Syosetu'
# Named in the app's "<domain> allows 1 page every 2 s".
DOMAIN = 'syosetu.com'
HOSTS = {'ncode.syosetu.com', 'novel18.syosetu.com', 'api.syosetu.com'}
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


def details(url: str) -> dict:
    """{title, authors, status, chapters, short, summary, updated (ms), latest}. LookupError when the site has no
    such work."""
    key, work_url = parse_url(url) or (None, None)
    if not key:
        raise LookupError('Not a Syosetu work link')
    api = 'novel18api' if 'novel18.' in work_url else 'novelapi'
    answer = json.loads(_get(f'https://api.syosetu.com/{api}/api/?out=json&ncode={key}'))
    if not answer or answer[0].get('allcount', 0) < 1 or len(answer) < 2:
        raise LookupError('Syosetu has no such work (removed, or not public)')
    work = answer[1]
    short = work.get('novel_type', work.get('noveltype')) == 2
    chapters = 1 if short else int(work.get('general_all_no') or 0)
    try:
        updated = int(datetime.strptime(work.get('general_lastup', ''), '%Y-%m-%d %H:%M:%S')
                      .replace(tzinfo=JST).timestamp() * 1000)
    except ValueError:
        updated = 0
    latest = []
    if not short and chapters:
        page = math.ceil(chapters / INDEX_PAGE_SIZE)
        latest = parse_index(_get(work_url + (f'?p={page}' if page > 1 else '')))[-LATEST:][::-1]
    return {'title': work.get('title', '').strip(), 'authors': work.get('writer', '').strip(),
            'status': 'finished' if work.get('end') == 0 else 'ongoing', 'chapters': chapters, 'short': short,
            'summary': work.get('story', '').strip(), 'updated': updated, 'latest': latest}


def chapter(url: str, n: int, short: bool) -> dict:
    """{title, html} of chapter n; a short story's text is on the work page itself."""
    _, work_url = parse_url(url) or (None, None)
    if not work_url:
        raise LookupError('Not a Syosetu work link')
    return parse_chapter(_get(work_url if short else f'{work_url}{n}/'))
