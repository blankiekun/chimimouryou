"""EPUB 3 from fetched chapters: vertical right-to-left, a nav, one XHTML per chapter. CBZ from page images, with
a ComicInfo.xml naming the series and number.

clean() keeps a whitelist of tags without attributes, so a site's scripts, styles, links and images never reach
the book (the app sanitizes again when it opens it). Standard library only.
"""
import time
import uuid
import zipfile
from html.parser import HTMLParser
from xml.sax.saxutils import escape, quoteattr

ALLOWED = {'p', 'br', 'ruby', 'rb', 'rt', 'rp', 'em', 'strong', 'b', 'i', 'sub', 'sup'}
VOID = {'br'}
# Their text is dropped with them.
SKIPPED = {'script', 'style', 'noscript', 'template', 'iframe', 'object', 'svg', 'math'}

CSS = '''html { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; }
body { margin: 0; line-height: 1.8; }
h2 { font-size: 1.2em; margin: 0 0 0 2em; }
p { margin: 0; }
em { font-style: normal; -webkit-text-emphasis: sesame; text-emphasis: sesame; }
'''


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []
        self.skip = 0

    def close_to(self, tag: str):
        while self.stack:
            top = self.stack.pop()
            self.out.append(f'</{top}>')
            if top == tag:
                return

    def handle_starttag(self, tag, attrs):
        if tag in SKIPPED:
            self.skip += 1
        if self.skip or tag not in ALLOWED:
            return
        if tag in VOID:
            self.out.append(f'<{tag}/>')
            return
        if tag == 'p' and 'p' in self.stack:  # HTML closes an open <p> here
            self.close_to('p')
        self.stack.append(tag)
        self.out.append(f'<{tag}>')

    def handle_startendtag(self, tag, attrs):
        if not self.skip and tag in ALLOWED:
            self.out.append(f'<{tag}/>' if tag in VOID else f'<{tag}></{tag}>')

    def handle_endtag(self, tag):
        if tag in SKIPPED:
            self.skip = max(0, self.skip - 1)
            return
        if not self.skip and tag in self.stack:
            self.close_to(tag)

    def handle_data(self, data):
        if not self.skip:
            self.out.append(escape(data))


def clean(html: str) -> str:
    """Well-formed XHTML body content from a site's chapter HTML."""
    cleaner = _Cleaner()
    cleaner.feed(html)
    cleaner.close()
    cleaner.close_to('')
    return ''.join(cleaner.out)


def _xhtml(title: str, body: str) -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" '
            f'lang="ja">\n<head><meta charset="UTF-8"/><title>{escape(title)}</title>'
            f'<link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>{body}</body>\n</html>\n')


def epub(path: str, title: str, authors: str, series: str, series_index: int, identifier: str,
         chapters: list[dict]):
    """Writes an EPUB of chapters [{title, xhtml (from clean())}] to path."""
    names = [f'c{n:04d}.xhtml' for n in range(1, len(chapters) + 1)]
    modified = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    manifest = '\n'.join(f'<item id="c{n}" href="{name}" media-type="application/xhtml+xml"/>'
                         for n, name in enumerate(names, 1))
    spine = '\n'.join(f'<itemref idref="c{n}"/>' for n in range(1, len(names) + 1))
    opf = f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ja">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, identifier)}</dc:identifier>
<dc:title>{escape(title)}</dc:title>
<dc:creator>{escape(authors)}</dc:creator>
<dc:language>ja</dc:language>
<meta property="dcterms:modified">{modified}</meta>
<meta name="calibre:series" content={quoteattr(series)}/>
<meta name="calibre:series_index" content="{series_index}"/>
<meta name="primary-writing-mode" content="vertical-rl"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
{manifest}
</manifest>
<spine page-progression-direction="rtl">
{spine}
</spine>
</package>
'''
    toc = '\n'.join(f'<li><a href="{name}">{escape(chapter["title"] or f"{n}")}</a></li>'
                    for n, (name, chapter) in enumerate(zip(names, chapters), 1))
    nav = _xhtml(title, f'<nav epub:type="toc" id="toc"><h1>{escape(title)}</h1><ol>\n{toc}\n</ol></nav>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        archive.writestr('META-INF/container.xml', '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
''')
        archive.writestr('OEBPS/content.opf', opf)
        archive.writestr('OEBPS/nav.xhtml', nav)
        archive.writestr('OEBPS/style.css', CSS)
        for name, chapter in zip(names, chapters):
            heading = f'<h2>{escape(chapter["title"])}</h2>' if chapter['title'] else ''
            archive.writestr(f'OEBPS/{name}', _xhtml(chapter['title'] or title, heading + chapter['xhtml']))


IMAGE_TYPES = ((b'\xff\xd8\xff', 'image/jpeg'), (b'\x89PNG\r\n\x1a\n', 'image/png'), (b'GIF8', 'image/gif'))


def image_type(data: bytes) -> str | None:
    """JPEG, PNG, GIF or WebP by their first bytes, else None."""
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return next((kind for magic, kind in IMAGE_TYPES if data.startswith(magic)), None)


def cbz(path: str, title: str, authors: str, series: str, number: int, pages: list[str]):
    """Writes a CBZ of the page image files (in this order) to path."""
    info = (f'<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
            f'<Title>{escape(title)}</Title><Series>{escape(series)}</Series><Number>{number}</Number>'
            f'<Writer>{escape(authors)}</Writer><PageCount>{len(pages)}</PageCount><LanguageISO>ja</LanguageISO>'
            '<Manga>YesAndRightToLeft</Manga></ComicInfo>\n')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as archive:
        for n, page in enumerate(pages, 1):
            archive.write(page, f'{n:04d}{page[page.rfind("."):]}')
        archive.writestr('ComicInfo.xml', info, compress_type=zipfile.ZIP_DEFLATED)
