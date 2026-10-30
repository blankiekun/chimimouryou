"""OPDS 1.2 catalogs (Komga, Kavita, Calibre-web) and Suwayomi, whose own OPDS feed carries each chapter's pages
(OPDS-PSE), so Suwayomi is an OPDS preset and has no module of its own.

A work is an acquisition feed (a series): its publication entries, every feed page read, are the work's items in the
feed's order. Items come as whole files (EPUB, CBZ) when the feed offers them ("files": each item is one volume,
queued as it came) or as page images ("pages": Suwayomi, or a catalog that only streams pages; built into CBZs of one
chapter or a fixed number of chapters). Every request goes through fetcher.fetch with the server's origin, so nothing
leaves the configured scheme, host and port, and the credentials go only there.
"""
import base64
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from urllib.parse import quote, urljoin, urlparse

from .. import build, fetcher
from . import decrypt

A = '{http://www.w3.org/2005/Atom}'
PSE = '{http://vaemendis.net/opds-pse/ns}'
OPENSEARCH = '{http://a9.com/-/spec/opensearch/1.1/}'
PSE_STREAM = 'http://vaemendis.net/opds-pse/stream'
FILE_TYPES = {'application/epub+zip': 'epub', 'application/vnd.comicbook+zip': 'cbz', 'application/x-cbz': 'cbz',
              'application/zip': 'cbz'}
IMAGE_EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'}
# The same cap as an upload (service.py MAX_BYTES).
FILE_BYTES = 300 * 1024 * 1024
MAX_FEED_PAGES = 100
SUWAYOMI_OPDS = '/api/opds/v1.2'


class NotCatalog(ValueError):
    pass


def _text(element, name: str) -> str:
    found = element.find(A + name)
    return (found.text or '').strip() if found is not None else ''


def _links(element, base: str) -> list[tuple[str, str, str, object]]:
    return [(link.get('rel') or '', (link.get('type') or '').lower().replace(' ', ''), urljoin(base, link.get('href')),
             link) for link in element.findall(A + 'link') if link.get('href')]


def _entry(element, base: str) -> dict:
    out = {'id': _text(element, 'id'), 'title': _text(element, 'title'),
           'authors': ', '.join(n for a in element.findall(A + 'author') if (n := _text(a, 'name'))),
           'summary': _text(element, 'content') or _text(element, 'summary'), 'updated': _text(element, 'updated'),
           'nav': None, 'navKind': '', 'meta': None, 'file': None, 'pages': None, 'cover': None}
    for rel, kind, href, link in _links(element, base):
        if rel.startswith('http://opds-spec.org/acquisition'):
            ext = FILE_TYPES.get(kind.split(';')[0])
            if ext and not out['file']:
                out['file'] = {'href': href, 'ext': ext}
        elif rel == PSE_STREAM:
            count = link.get(PSE + 'count') or ''
            if count.isdigit() and int(count) > 0:
                out['pages'] = {'href': href, 'count': int(count)}
        elif rel.startswith('http://opds-spec.org/image'):
            if rel.endswith('thumbnail') or not out['cover']:  # thumbnails are small enough for a shelf
                out['cover'] = href
        elif kind.startswith('application/atom+xml'):
            if 'type=entry' in kind:
                out['meta'] = href
            elif not out['nav']:
                out['nav'], out['navKind'] = href, 'acquisition' if 'kind=acquisition' in kind else 'navigation'
    return out


def parse(data: bytes, url: str) -> dict:
    """{title, updated, cover, next, search: (href, type) | None, entries} of an OPDS feed (or a single entry)."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise NotCatalog('not XML') from error
    if root.tag == A + 'entry':
        return {'title': '', 'updated': '', 'cover': None, 'next': None, 'search': None,
                'entries': [_entry(root, url)]}
    if root.tag != A + 'feed':
        raise NotCatalog(f'not an Atom feed ({root.tag})')
    links = _links(root, url)
    return {'title': _text(root, 'title'), 'updated': _text(root, 'updated'),
            'cover': next((h for rel, _, h, _ in links if rel.startswith('http://opds-spec.org/image')), None),
            'next': next((h for rel, _, h, _ in links if rel == 'next'), None),
            'search': next(((h, k.split(';')[0]) for rel, k, h, _ in links if rel == 'search'), None),
            'entries': [_entry(e, url) for e in root.findall(A + 'entry')]}


def is_item(entry: dict) -> bool:
    """A publication: a file the app can open, pages, or (Suwayomi) a metadata entry with the pages."""
    return bool(entry['file'] or entry['pages'] or entry['meta'])


def catalog_url(kind: str, url: str) -> str:
    """The OPDS root: the address itself, or Suwayomi's OPDS feed under the server's address."""
    if kind == 'suwayomi' and SUWAYOMI_OPDS not in url:
        return url.rstrip('/') + SUWAYOMI_OPDS
    return url


def work_key(kind: str, href: str) -> str:
    """A series feed's path and query; Suwayomi's chapters in reading order (its default is newest first)."""
    parts = urlparse(href)
    key = parts.path + (f'?{parts.query}' if parts.query else '')
    if kind == 'suwayomi' and re.fullmatch(r'.*/series/\d+/chapters', parts.path) and 'sort=' not in parts.query:
        key = parts.path + '?sort=number_asc'
    return key


def _ms(stamp: str) -> int:
    try:
        return int(datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError:
        return 0


def _check_file(data: bytes, ext: str) -> str:
    """Why a downloaded book isn't usable, or ''."""
    import io
    import zipfile
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
    except zipfile.BadZipFile:
        return f'not a valid {ext.upper()} file'
    if ext == 'epub' and 'META-INF/container.xml' not in names:
        return 'not a valid EPUB file'
    if ext == 'cbz' and not any(os.path.splitext(n)[1].lower() in ('.jpg', '.jpeg', '.png', '.gif', '.webp')
                                for n in names):
        return 'not a manga archive (no images)'
    return ''


class Server:
    """A source_servers row as a site adapter (api.py): details, chapter, and fetching from it alone."""
    FILES = True  # chapters are files in a folder, not text
    SEARCH_ORDER = ''
    COVER_HOSTS: set[str] = set()

    def __init__(self, row: dict):
        self.id, self.type, self.user, self.secret = row['id'], row['type'], row['user'], row['secret']
        self.deleted = bool(row['deleted'])
        self.root = catalog_url(row['type'], row['url'])
        self.origin = fetcher.origin(self.root)
        self.SITE = f'opds:{row["id"]}'
        self.NAME = row['name']
        self.DOMAIN = urlparse(self.root).netloc
        self.TAG = 'Suwayomi' if row['type'] == 'suwayomi' else 'OPDS'

    def url(self, href: str) -> str:
        """href (absolute, or relative to the catalog) as a URL on this server; ValueError for any other."""
        url = urljoin(self.root, href)
        if fetcher.origin(url) != self.origin:
            raise ValueError('Not a link on this server')
        return url

    def get(self, url: str, max_bytes: int | None = None) -> tuple[bytes, str]:
        if self.deleted:
            raise LookupError('The source was removed')
        headers = {}
        if self.user or self.secret:
            password = decrypt(self.secret) if self.secret else ''
            headers['Authorization'] = 'Basic ' + base64.b64encode(f'{self.user}:{password}'.encode()).decode()
        return fetcher.fetch(url, set(), headers, server=self.origin, max_bytes=max_bytes)

    def feed(self, url: str) -> dict:
        data, final = self.get(url)
        return parse(data, final)

    def search_url(self, q: str) -> str:
        """The catalog's search for q (OpenSearch description or template); LookupError when it has none."""
        search = self.feed(self.root)['search']
        if not search:
            raise LookupError("This catalog can't be searched")
        href, kind = search
        if kind == 'application/opensearchdescription+xml':
            try:
                root = ET.fromstring(self.get(self.url(href))[0])
            except ET.ParseError as error:
                raise LookupError("This catalog can't be searched") from error
            urls = [u for u in root.findall(OPENSEARCH + 'Url') if 'atom' in (u.get('type') or '')]
            if not urls or not urls[0].get('template'):
                raise LookupError("This catalog can't be searched")
            href = urljoin(href, urls[0].get('template'))
        return self.url(re.sub(r'\{[^}]*\?\}', '', href.replace('{searchTerms}', quote(q))))

    def details(self, url: str) -> dict:
        """The series feed (every page) as a work: {title, authors, status, chapters, summary, updated, latest,
        cover, items, mode, kind}."""
        first, items, seen, page = None, [], set(), self.url(url)
        while page and page not in seen and len(seen) < MAX_FEED_PAGES:
            seen.add(page)
            try:
                feed = self.feed(page)
            except NotCatalog as error:
                raise LookupError('This address is no longer an OPDS feed') from error
            first = first or feed
            items += [e for e in feed['entries'] if is_item(e)]
            page = self.url(feed['next']) if feed['next'] else None
        files = self.type != 'suwayomi' and any(e['file'] for e in items)
        if files:
            items = [e for e in items if e['file']]
        cover = first['cover'] or next((e['cover'] for e in items if e['cover']), None) or ''
        try:
            cover = self.url(cover) if cover else ''
        except ValueError:
            cover = ''
        return {'title': first['title'] or self.NAME, 'status': 'ongoing', 'chapters': len(items),
                'authors': next((e['authors'] for e in items if e['authors']), ''),
                'summary': next((e['summary'] for e in items if e['summary']), ''),
                'updated': _ms(first['updated']), 'cover': cover,
                'latest': [{'n': n, 'title': e['title'], 'date': e['updated'][:10]}
                           for n, e in list(enumerate(items, 1))[-3:][::-1]],
                'items': items, 'mode': 'files' if files else 'pages',
                'kind': 'novel' if files and all(e['file']['ext'] == 'epub' for e in items) else 'manga'}

    def chapter(self, url: str, n: int, details: dict, folder: str) -> dict:
        """Item n into folder: {title, file} (a whole file) or {title, pages} (page images in order)."""
        if not 1 <= n <= len(details['items']):
            raise LookupError(f'Item {n} is no longer on the server')
        item = details['items'][n - 1]
        os.makedirs(folder, exist_ok=True)
        if details['mode'] == 'files':
            ext = item['file']['ext']
            data = self.get(self.url(item['file']['href']), FILE_BYTES)[0]
            if problem := _check_file(data, ext):
                raise ValueError(f'The server sent {problem}')
            with open(os.path.join(folder, f'book.{ext}'), 'wb') as f:
                f.write(data)
            return {'title': item['title'], 'file': f'book.{ext}'}
        pages = item['pages']
        if not pages and item['meta']:
            pages = next((e['pages'] for e in self.feed(self.url(item['meta']))['entries'] if e['pages']), None)
        if not pages:
            raise LookupError('The server lists no pages for it')
        names = []
        for page in range(pages['count']):  # OPDS-PSE counts pages from 0
            href = pages['href'].replace('{pageNumber}', str(page)).replace('{maxWidth}', '4096')
            data = self.get(self.url(href))[0]
            kind = build.image_type(data)
            if not kind:
                raise ValueError(f'Page {page + 1} is not an image')
            names.append(f'{page + 1:04d}.{IMAGE_EXTENSIONS[kind]}')
            with open(os.path.join(folder, names[-1]), 'wb') as f:
                f.write(data)
        return {'title': item['title'], 'pages': names}
