"""A fake OPDS catalog (like Komga's) and a fake Suwayomi, served by serve.py at /opds/ and /suwayomi/.

Server sources use the address the reader typed (no SOURCES_FIXTURE_URL), so the test stack adds
http://127.0.0.1:8799/opds/catalog (user `reader`, password `kagi-1234`) or http://127.0.0.1:8799/suwayomi.
Invented titles; every book file and page image is generated here (tiny PNGs), nothing copied.

  /opds/catalog                      navigation: All series (a relative link), a broken entry; OpenSearch
  /opds/series[?page=2|?search=q]    navigation, two pages: series as kind=acquisition links with covers
  /opds/series/s1                    EPUB volumes, two pages (2 + 1, and a PDF the app can't use)
  /opds/series/s2                    CBZ volumes with page streaming too (the file wins)
  /opds/series/s3                    an "EPUB" that is a login page
  /opds/broken                       HTML, not a catalog
  /opds/redirect                     a redirect to another host
  /suwayomi/api/opds/v1.2/...        Suwayomi's OPDS: chapters newest first unless sort=number_asc, five per page
                                     (pageNumber=), pages behind each chapter's metadata entry (OPDS-PSE)
VOLUMES (each series' volume numbers in feed order) and CHAPTERS (Suwayomi's chapter numbers in reading order) can be
changed by tests: a followed work gets a new entry, or one inserted mid-feed.
"""
import base64
import io
import struct
import zipfile
import zlib
from xml.sax.saxutils import escape, quoteattr

USER, PASSWORD = 'reader', 'kagi-1234'
SERIES = {'s1': ('星降る町の配達人', '架空 作者', 'epub'), 's2': ('灯台守と七つの鍵', '試験 画家', 'cbz'),
          's3': ('壊れた本', '架空 作者', 'epub')}
VOLUMES = {'s1': [1, 2, 3], 's2': [1, 2], 's3': [1]}
CHAPTERS = {'order': list(range(1, 13))}
PAGES = 2
MANGA = '月影の工房'
ACQ = 'application/atom+xml;profile=opds-catalog;kind=acquisition'
NAV = 'application/atom+xml;profile=opds-catalog;kind=navigation'
ATOM = 'application/atom+xml'


def png(seed: int) -> bytes:
    """A 2x2 PNG whose colour depends on seed."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pixel = bytes([seed * 37 % 256, seed * 91 % 256, seed * 53 % 256])
    raw = b''.join(b'\x00' + pixel * 2 for _ in range(2))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class _Zip(zipfile.ZipFile):
    """Fixed timestamps, so the same file is the same bytes (tests compare what Calibre got)."""
    def writestr(self, name, data, *args, **kwargs):
        super().writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), data, *args, **kwargs)


def epub(title: str) -> bytes:
    out = io.BytesIO()
    with _Zip(out, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:'
                   'tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/'
                   'oebps-package+xml"/></rootfiles></container>')
        z.writestr('c.opf', f'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
                   'unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   f'<dc:identifier id="id">urn:fake:{escape(title)}</dc:identifier><dc:title>{escape(title)}'
                   '</dc:title><dc:language>ja</dc:language></metadata><manifest>'
                   '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
                   '<item id="t" href="t.xhtml" media-type="application/xhtml+xml"/></manifest>'
                   '<spine><itemref idref="t"/></spine></package>')
        z.writestr('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                   f'<body><nav epub:type="toc"><ol><li><a href="t.xhtml">{escape(title)}</a></li></ol></nav>'
                   '</body></html>')
        z.writestr('t.xhtml', f'<html xmlns="http://www.w3.org/1999/xhtml"><body><p>{escape(title)}。'
                   '試験の本文です。</p></body></html>')
    return out.getvalue()


def cbz(seed: int) -> bytes:
    out = io.BytesIO()
    with _Zip(out, 'w') as z:
        for n in range(3):
            z.writestr(f'{n + 1:03d}.png', png(seed * 10 + n))
    return out.getvalue()


def link(rel: str, href: str, kind: str, extra: str = '') -> str:
    return f'<link rel={quoteattr(rel)} href={quoteattr(href)} type={quoteattr(kind)}{extra}/>'


def entry(id_: str, title: str, links: list[str], author: str = '', summary: str = '') -> str:
    return (f'<entry><id>{escape(id_)}</id><title>{escape(title)}</title><updated>2026-10-01T00:00:00Z</updated>'
            + (f'<author><name>{escape(author)}</name></author>' if author else '')
            + (f'<content type="text">{escape(summary)}</content>' if summary else '') + ''.join(links) + '</entry>')


def feed(id_: str, title: str, entries: list[str], links: list[str] = ()) -> bytes:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" '
            'xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:pse="http://vaemendis.net/opds-pse/ns">'
            f'<id>{escape(id_)}</id><title>{escape(title)}</title><updated>2026-10-01T00:00:00Z</updated>'
            + ''.join(links) + ''.join(entries) + '</feed>').encode()


def series_entry(key: str) -> str:
    title, author, _ = SERIES[key]
    # s2's cover is on another host: the app must never fetch it.
    cover = '/opds/covers/s1.png' if key == 's1' else f'http://images.example/{key}.png'
    return entry(f'urn:fake:series:{key}', title, [
        link('subsection', f'/opds/series/{key}', ACQ),
        link('http://opds-spec.org/image/thumbnail', cover, 'image/png')], author)


def opds(rest: str, query: dict, auth: str) -> tuple[int, str, bytes]:
    if auth != 'Basic ' + base64.b64encode(f'{USER}:{PASSWORD}'.encode()).decode():
        return 401, 'text/plain', b'Unauthorized'
    page = query.get('page', ['1'])[0]
    if rest == 'catalog':
        return 200, ATOM, feed('urn:fake:root', '試験カタログ', [
            entry('urn:fake:all', 'All series', [link('subsection', 'series', NAV)]),
            entry('urn:fake:broken', 'Broken', [link('subsection', '/opds/broken', NAV)])],
            [link('search', '/opds/search.xml', 'application/opensearchdescription+xml')])
    if rest == 'search.xml':
        return 200, 'application/opensearchdescription+xml', (
            '<?xml version="1.0"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">'
            f'<Url type="{ATOM}" template="/opds/series?search={{searchTerms}}"/></OpenSearchDescription>').encode()
    if rest == 'series':
        if q := query.get('search', [''])[0]:
            keys = [k for k, (title, _, _) in SERIES.items() if q in title]
            return 200, ATOM, feed('urn:fake:search', f'Search: {q}', [series_entry(k) for k in keys])
        if page == '1':
            return 200, ATOM, feed('urn:fake:series', 'All series', [series_entry('s1')],
                                   [link('next', '/opds/series?page=2', NAV)])
        return 200, ATOM, feed('urn:fake:series', 'All series', [series_entry('s2'), series_entry('s3')])
    if rest.startswith('series/') and (key := rest[7:]) in SERIES:
        title, author, kind = SERIES[key]
        numbers = VOLUMES[key]
        shown = numbers[:2] if page == '1' else numbers[2:]
        entries = []
        for n in shown:
            links = [link('http://opds-spec.org/acquisition', f'/opds/files/{key}-{n}.{kind}',
                          'application/epub+zip' if kind == 'epub' else 'application/vnd.comicbook+zip'),
                     link('http://opds-spec.org/image', '/opds/covers/s1.png', 'image/png')]
            if kind == 'cbz':
                links.append(link('http://vaemendis.net/opds-pse/stream', f'/opds/pages/{key}-{n}/{{pageNumber}}',
                                  'image/png', ' pse:count="3"'))
            entries.append(entry(f'urn:fake:{key}:{n}', f'{title} 第{n}巻', links, author, f'{title}の第{n}巻。'))
        if page != '1' and key == 's1':
            entries.append(entry('urn:fake:s1:extra', '付録', [
                link('http://opds-spec.org/acquisition', '/opds/files/extra.pdf', 'application/pdf')]))
        more = [link('next', f'/opds/series/{key}?page=2', ACQ)] if page == '1' and len(numbers) > 2 else []
        return 200, ATOM, feed(f'urn:fake:series:{key}', title, entries, more)
    if rest.startswith('files/'):
        name = rest[6:]
        if name.startswith('s3-'):
            return 200, 'application/epub+zip', b'<html><body>Please sign in</body></html>'
        if name.endswith('.epub'):
            key, n = name[:-5].split('-')
            return 200, 'application/epub+zip', epub(f'{SERIES[key][0]} 第{n}巻')
        if name.endswith('.cbz'):
            return 200, 'application/vnd.comicbook+zip', cbz(int(name[:-4].split('-')[1]))
    if rest.startswith('covers/'):
        return 200, 'image/png', png(1)
    if rest == 'broken':
        return 200, 'text/html', b'<!DOCTYPE html><html><body><p>Komga web UI</p></body></html>'
    if rest == 'redirect':
        return 302, 'http://images.example/elsewhere', b''
    return 404, 'text/plain', b'not found'


def suwayomi(rest: str, query: dict) -> tuple[int, str, bytes]:
    api = '/suwayomi/api/opds/v1.2'
    if rest in ('api/opds/v1.2', 'api/opds/v1.2/'):
        return 200, ATOM, feed('urn:suwayomi:root', 'Suwayomi OPDS', [
            entry('urn:suwayomi:library', 'Library', [link('subsection', f'{api}/library/series', NAV)])])
    if rest == 'api/opds/v1.2/library/series':
        return 200, ATOM, feed('urn:suwayomi:library', 'Library', [entry('urn:suwayomi:manga:7', MANGA, [
            link('subsection', f'{api}/series/7/chapters', ACQ),
            link('http://opds-spec.org/image', '/suwayomi/api/v1/manga/7/thumbnail', 'image/png')], '試験 画家')])
    if rest == 'api/opds/v1.2/series/7/chapters':
        numbers = list(CHAPTERS['order'])
        if query.get('sort', [''])[0] != 'number_asc':  # Suwayomi's default: newest first
            numbers.reverse()
        page = int(query.get('pageNumber', ['1'])[0])
        shown = numbers[(page - 1) * 5:page * 5]
        more = [link('next', f'{api}/series/7/chapters?sort={query.get("sort", [""])[0]}&pageNumber={page + 1}', ACQ)] \
            if page * 5 < len(numbers) else []
        return 200, ATOM, feed('urn:suwayomi:series:7:chapters', MANGA, [entry(
            f'urn:suwayomi:chapter:{n}', f'Ch. {n}',
            [link('subsection', f'{api}/series/7/chapter/{n}/metadata',
                  'application/atom+xml;type=entry;profile=opds-catalog')]) for n in shown], more)
    parts = rest.split('/')
    if rest.startswith('api/opds/v1.2/series/7/chapter/') and parts[-1] == 'metadata':
        n = int(parts[-2])
        return 200, ATOM, feed(f'urn:suwayomi:chapter:{n}:metadata', f'Ch. {n}', [entry(
            f'urn:suwayomi:chapter:{n}', f'Ch. {n}',
            [link('http://vaemendis.net/opds-pse/stream',
                  f'/suwayomi/api/v1/manga/7/chapter/{n}/page/{{pageNumber}}?updateProgress=false', 'image/jpeg',
                  f' pse:count="{PAGES}"')])])
    if rest.startswith('api/v1/manga/7/chapter/') and parts[-2] == 'page':
        n, page = int(parts[-3]), int(parts[-1])
        return (200, 'image/png', png(n * 10 + page)) if page < PAGES else (404, 'text/plain', b'no page')
    if rest == 'api/v1/manga/7/thumbnail':
        return 200, 'image/png', png(7)
    return 404, 'text/plain', b'not found'
