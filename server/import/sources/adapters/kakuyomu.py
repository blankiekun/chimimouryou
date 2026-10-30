"""Kakuyomu (カクヨム): no official API, so work details and search come from the Apollo state its pages embed
(__NEXT_DATA__), and chapter text from the episode page. Chapter n is the work's n-th episode in its table of
contents. Tested on saved pages (server/tests/fixtures/sources/)."""
import html
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

from .. import build, fetcher

SITE = 'kakuyomu'
NAME = 'Kakuyomu'
DOMAIN = 'kakuyomu.jp'
HOSTS = {'kakuyomu.jp'}
# Covers of works published as books.
COVER_HOSTS = {'cdn.kdkw.jp'}
SEARCH_ORDER = 'weekly ranking'
LATEST = 3
JST = timezone(timedelta(hours=9))

WORK_PATH = re.compile(r'/works/(\d{1,30})(?:/episodes/\d{1,30})?/?')
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>', re.S)
EPISODE_TITLE = re.compile(r'<p class="widget-episodeTitle[^"]*">(.*?)</p>', re.S)
# The episode's text: paragraphs only (no nested divs).
EPISODE_BODY = re.compile(r'<div class="widget-episodeBody[^"]*"[^>]*>(.*?)</div>', re.S)
CHANGED = "Kakuyomu's pages have changed; this app can't read them yet"


def parse_url(url: str) -> tuple[str, str] | None:
    """(work key, work page) for a link to a work or one of its episodes, else None."""
    parts = urlparse(url.strip())
    match = WORK_PATH.fullmatch(parts.path)
    if parts.scheme not in ('http', 'https') or (parts.hostname or '') != 'kakuyomu.jp' or not match:
        return None
    return match[1], work_url(match[1])


def work_url(key: str) -> str:
    return f'https://kakuyomu.jp/works/{key}'


def _get(url: str) -> str:
    try:
        return fetcher.fetch(url, HOSTS)[0].decode('utf-8', 'replace')
    except fetcher.FetchError as error:
        if error.status in (404, 410):
            raise LookupError('Kakuyomu has no such work (removed, or not public)') from error
        raise


def _state(page: str) -> dict:
    """The page's Apollo state: {'Work:<id>': {...}, 'ROOT_QUERY': {...}, ...}."""
    match = NEXT_DATA.search(page)
    try:
        state = json.loads(match[1])['props']['pageProps']['__APOLLO_STATE__']
    except (TypeError, ValueError, KeyError) as error:
        raise ValueError(CHANGED) from error
    if not isinstance(state, dict):
        raise ValueError(CHANGED)
    return state


def _ref(state: dict, value) -> dict:
    return state.get(value.get('__ref', ''), {}) if isinstance(value, dict) else {}


def _ms(iso: str | None) -> int:
    try:
        return int(datetime.fromisoformat((iso or '').replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError:
        return 0


def _summary(state: dict, work: dict) -> dict:
    """The fields search results and details share."""
    return {'title': str(work.get('title') or '').strip(),
            'authors': str(work.get('alternateAuthorName') or _ref(state, work.get('author')).get('activityName')
                           or '').strip(),
            'status': 'finished' if work.get('serialStatus') == 'COMPLETED' else 'ongoing',
            'chapters': int(work.get('publicEpisodeCount') or 0), 'updated': _ms(work.get('lastEpisodePublishedAt'))}


def details(url: str) -> dict:
    """{title, authors, status, chapters, short, summary, updated (ms), latest, cover, episodes (ids in order)}.
    LookupError when the site has no such work; ValueError when its page can't be read."""
    key, page = parse_url(url) or (None, None)
    if not key:
        raise LookupError('Not a Kakuyomu work link')
    state = _state(_get(page))
    work = state.get(f'Work:{key}')
    if not work or not work.get('title'):
        raise ValueError(CHANGED)
    episodes = [_ref(state, episode) for section in work.get('tableOfContentsV2') or []
                for episode in _ref(state, section).get('episodeUnions') or []]
    info = _summary(state, work)
    # A list shorter than the count would silently drop chapters from the volumes.
    if len(episodes) != info['chapters'] or not all(e.get('id') for e in episodes):
        raise ValueError(f"{CHANGED} (it lists {len(episodes)} of {info['chapters']} episodes)")
    latest = [{'n': n, 'title': str(e.get('title') or '').strip(),
               'date': datetime.fromtimestamp(_ms(e.get('publishedAt')) / 1000, JST).strftime('%Y-%m-%d')}
              for n, e in enumerate(episodes, 1)][-LATEST:][::-1]
    return {**info, 'short': False, 'summary': str(work.get('introduction') or '').strip(), 'latest': latest,
            'cover': work.get('adminCoverImageUrl') or work.get('promotionalImageUrl') or '',
            'episodes': [str(e['id']) for e in episodes]}


def parse_chapter(page: str) -> dict:
    """{title, html}: the episode's title and text as clean XHTML."""
    body = EPISODE_BODY.search(page)
    if not body:
        raise ValueError(CHANGED)
    title = EPISODE_TITLE.search(page)
    return {'title': html.unescape(re.sub(r'<[^>]*>', '', title[1])).strip() if title else '',
            'html': build.clean(body[1])}


def chapter(url: str, n: int, details: dict) -> dict:
    """{title, html} of the n-th episode (details: this work's details())."""
    key, page = parse_url(url) or (None, None)
    if not key:
        raise LookupError('Not a Kakuyomu work link')
    if not 1 <= n <= len(details['episodes']):
        raise LookupError(f'Kakuyomu no longer lists episode {n}')
    return parse_chapter(_get(f"{page}/episodes/{details['episodes'][n - 1]}"))


def _list(page: int, **params) -> dict:
    """{total, more, works}: one page (20 works) of Kakuyomu's search."""
    state = _state(_get('https://kakuyomu.jp/search?' + urlencode({**params, 'page': page})))
    found = next((value for name, value in state.get('ROOT_QUERY', {}).items() if name.startswith('searchWorks(')),
                 None)
    if not isinstance(found, dict):
        raise ValueError(CHANGED)
    works = []
    for node in found.get('nodes') or []:
        work = _ref(state, node)
        if str(work.get('id', '')).isdigit():
            works.append({'workKey': work['id'], 'url': work_url(work['id']), **_summary(state, work)})
    return {'total': int(found.get('totalCount') or 0),
            'more': bool((found.get('pageInfo') or {}).get('hasNextPage')), 'works': works}


def search(q: str, page: int) -> dict:
    return _list(page, q=q)


def popular(page: int) -> dict:
    return _list(page, order='weekly_ranking')


def latest(page: int) -> dict:
    return _list(page, order='last_episode_published_at')
