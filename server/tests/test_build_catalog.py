"""Tests for build-catalog.py. Run from the repo root:
python3 -m unittest discover -s server/tests
"""
import importlib.util
import io
import json
import os
import tempfile
import sys
import unittest
import zipfile
from unittest import mock

spec = importlib.util.spec_from_file_location(
    'build_catalog', os.path.join(os.path.dirname(__file__), '..', 'build-catalog.py'))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
import apidb  # noqa: E402


class SplitVolumeTest(unittest.TestCase):
    def test_volume_numbers(self):
        cases = {
            'ダンタリアンの書架１': ('ダンタリアンの書架', 1.0),
            '魔法科高校の劣等生 (12)': ('魔法科高校の劣等生', 12.0),
            '物語 第三巻': ('物語', 3.0),
            '物語 下巻': ('物語', 3),
            'Some Title Vol. 4': ('Some Title', 4.0),
            '物語 2 【電子特別版】': ('物語', 2.0),
            '[作者] 物語 十二': ('物語', 12.0),
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(catalog.split_volume(title), expected)

    def test_publisher_label(self):
        self.assertEqual(catalog.split_volume('無職転生 ～異世界行ったら本気だす～ 2 (MFブックス)'),
                         ('無職転生 ~異世界行ったら本気だす~', 2.0))

    def test_no_volume(self):
        self.assertEqual(catalog.split_volume('吾輩は猫である'), ('吾輩は猫である', None))

    def test_kanji_number(self):
        self.assertEqual(catalog.kanji_number('二十三'), 23.0)
        self.assertEqual(catalog.kanji_number('百五'), 105.0)
        self.assertEqual(catalog.kanji_number('2.5'), 2.5)
        self.assertIsNone(catalog.kanji_number('上'))

    def test_series_name(self):
        self.assertTrue(catalog.is_series_name('物語'))
        self.assertFalse(catalog.is_series_name('b522apdm'))
        self.assertFalse(catalog.is_series_name('物'))


def make_epub(files: dict, opf: str) -> zipfile.ZipFile:
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as epub:
        epub.writestr('META-INF/container.xml', '''<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>''')
        epub.writestr('OEBPS/content.opf', opf)
        for name, content in files.items():
            epub.writestr(name, content)
    return zipfile.ZipFile(data)


OPF = '''<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata>{meta}</metadata>
<manifest>{items}</manifest>
<spine>{spine}</spine>
</package>'''


class CoverTest(unittest.TestCase):
    def test_cover_image_property(self):
        epub = make_epub({}, OPF.format(meta='', spine='', items='''
            <item id="a" href="images/a.jpg" media-type="image/jpeg"/>
            <item id="c" href="images/c.jpg" media-type="image/jpeg" properties="cover-image"/>'''))
        self.assertEqual(catalog.epub_cover_name(epub), 'OEBPS/images/c.jpg')

    def test_meta_cover(self):
        epub = make_epub({}, OPF.format(meta='<meta name="cover" content="b"/>', spine='', items='''
            <item id="a" href="a.png" media-type="image/png"/>
            <item id="b" href="b.png" media-type="image/png"/>'''))
        self.assertEqual(catalog.epub_cover_name(epub), 'OEBPS/b.png')

    def test_oversized_pages_are_not_read(self):
        epub = make_epub({}, OPF.format(meta='', spine='', items='<item id="c" href="c.jpg" media-type="image/jpeg"/>'))
        limit = catalog.MAX_PAGE_BYTES
        catalog.MAX_PAGE_BYTES = 100  # the OPF is bigger
        try:
            with self.assertRaises(ValueError):
                catalog.epub_cover_name(epub)
        finally:
            catalog.MAX_PAGE_BYTES = limit

    def test_first_page_image(self):
        epub = make_epub(
            {'OEBPS/text/p1.xhtml': '<html><body><img src="../img/front.jpg"/></body></html>'},
            OPF.format(meta='', spine='<itemref idref="p1"/>', items='''
                <item id="p1" href="text/p1.xhtml" media-type="application/xhtml+xml"/>
                <item id="i" href="img/front.jpg" media-type="image/jpeg"/>
                <item id="z" href="img/zzz.jpg" media-type="image/jpeg"/>'''))
        self.assertEqual(catalog.epub_cover_name(epub), 'OEBPS/img/front.jpg')

    def test_jpeg_unchanged(self):
        data = catalog.JPEG_MAGIC + b'rest'
        self.assertIs(catalog.as_jpeg(data), data)


class MangaTest(unittest.TestCase):
    def archive(self, names):
        import tempfile
        path = os.path.join(tempfile.mkdtemp(), 'm.cbz')
        with zipfile.ZipFile(path, 'w') as archive:
            for name in names:
                archive.writestr(name, b'x')
        return path

    def test_pages_in_natural_order(self):
        path = self.archive(['10.jpg', '2.jpg', '1.png', '__MACOSX/._1.png', 'info.txt'])
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(catalog.manga_pages(archive), ['1.png', '2.jpg', '10.jpg'])

    def test_only_image_archives_are_manga(self):
        self.assertTrue(catalog.is_valid_book(self.archive(['1.jpg', '2.jpg', 'a.txt']), 'ZIP'))
        self.assertFalse(catalog.is_valid_book(self.archive(['book.epub']), 'ZIP'))

    def test_onscripter_games_are_listed(self):
        game = self.archive(['Game/0.txt', 'Game/arc.nsa', 'Game/arc1.nsa'])
        self.assertTrue(catalog.is_valid_book(game, 'ZIP'))
        self.assertTrue(catalog.is_vn_file(game))
        self.assertFalse(catalog.is_vn_file(self.archive(['1.jpg'])))


class VnFolderTest(unittest.TestCase):
    def test_game_folders_are_listed_with_their_script_folder_and_cover(self):
        import tempfile
        vn_dir = tempfile.mkdtemp()
        for path in ('ノベル/0.txt', 'ノベル/cover.png', 'Nested/Game/nscript.dat', 'Empty/readme.txt'):
            os.makedirs(os.path.dirname(os.path.join(vn_dir, path)), exist_ok=True)
            open(os.path.join(vn_dir, path), 'w').close()
        games = {game['title']: game for game in catalog.vn_games(vn_dir)}
        self.assertEqual(sorted(games), ['Nested', 'ノベル'])
        self.assertEqual(games['ノベル']['file'], 'ノベル')
        self.assertEqual(games['ノベル']['cover'], 'ノベル/cover.png')
        self.assertEqual(games['Nested']['file'], 'Nested/Game')
        self.assertTrue(all(game['id'] < 0 and game['format'] == 'VN' for game in games.values()))

    def test_a_folder_name_that_is_not_utf8_is_skipped(self):
        vn_dir = tempfile.mkdtemp()
        for name in (b'\x83Q\x81[\x83\x80', 'ノベル'.encode()):  # ゲーム in Shift JIS, then UTF-8
            os.makedirs(os.path.join(os.fsencode(vn_dir), name))
            open(os.path.join(os.fsencode(vn_dir), name, b'0.txt'), 'w').close()
        self.assertEqual([game['title'] for game in catalog.vn_games(vn_dir)], ['ノベル'])


class UniqueTitlesTest(unittest.TestCase):
    @staticmethod
    def titles(*books):
        books = [{'id': i, 'title': t, 'authors': a, 'added': added} for i, t, a, added in books]
        catalog.unique_titles(books)
        return {b['id']: b['title'] for b in books}

    def test_the_newest_keeps_the_plain_title(self):
        self.assertEqual(self.titles((1, 'こころ', '夏目漱石', 100), (2, 'こころ', '別人', 200)),
                         {1: 'こころ (夏目漱石)', 2: 'こころ'})
        # Removing the newest gives the plain title back.
        self.assertEqual(self.titles((1, 'こころ', '夏目漱石', 100)), {1: 'こころ'})

    def test_ties_go_to_the_higher_id_and_ids_break_the_rest(self):
        self.assertEqual(self.titles((3, 'A', 'X', 5), (4, 'A', 'X', 5), (5, 'A', '', 1), (6, 'A', 'X', 1)),
                         {4: 'A', 3: 'A (X)', 6: 'A (X) [6]', 5: 'A [5]'})


def write_library(library, books):
    """A minimal Calibre library: metadata.db (rewritten) and one EPUB per book. Books are dicts with
    id, title and optionally series, uuid, authors, added (Calibre timestamp)."""
    import sqlite3
    db_path = os.path.join(library, 'metadata.db')
    if os.path.exists(db_path):
        os.remove(db_path)
    db = sqlite3.connect(db_path)
    db.executescript("""
        CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, path TEXT, timestamp TEXT,
                            series_index REAL, pubdate TEXT, uuid TEXT);
        CREATE TABLE data (book INTEGER, format TEXT, name TEXT, uncompressed_size INTEGER);
        CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
        CREATE TABLE books_authors_link (book INTEGER, author INTEGER);
        CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE books_series_link (book INTEGER, series INTEGER);
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE books_tags_link (book INTEGER, tag INTEGER);
        CREATE TABLE ratings (id INTEGER PRIMARY KEY, rating INTEGER);
        CREATE TABLE books_ratings_link (book INTEGER, rating INTEGER);
        CREATE TABLE publishers (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE books_publishers_link (book INTEGER, publisher INTEGER);
    """)
    for book in books:
        book_id = book['id']
        os.makedirs(os.path.join(library, str(book_id)), exist_ok=True)
        with zipfile.ZipFile(os.path.join(library, str(book_id), 'b.epub'), 'w') as epub:
            epub.writestr('META-INF/container.xml', '<container/>')
        db.execute('INSERT INTO books VALUES (?, ?, ?, ?, 1, NULL, ?)',
                   (book_id, book['title'], str(book_id), book.get('added', '2026-01-01 00:00:00+00:00'),
                    book.get('uuid')))
        db.execute('INSERT INTO data VALUES (?, "EPUB", "b", 1)', (book_id,))
        if book.get('series'):
            db.execute('INSERT OR IGNORE INTO series (name) VALUES (?)', (book['series'],))
            db.execute('INSERT INTO books_series_link SELECT ?, id FROM series WHERE name = ?',
                       (book_id, book['series']))
        if book.get('authors'):
            db.execute('INSERT OR IGNORE INTO authors (name) VALUES (?)', (book['authors'],))
            db.execute('INSERT INTO books_authors_link SELECT ?, id FROM authors WHERE name = ?',
                       (book_id, book['authors']))
    db.commit()
    db.close()


class BuildTest(unittest.TestCase):
    """A whole build from a minimal Calibre library."""

    def build(self, books):
        library = tempfile.mkdtemp()
        write_library(library, [{'id': i, 'title': t, 'series': s} for i, t, s in books])
        output = os.path.join(library, 'out', 'catalog.json')
        os.makedirs(os.path.dirname(output))
        catalog.main(library, output)
        with open(output, encoding='utf-8') as f:
            return {b['id']: (b['series'], b['seriesIndex']) for b in json.load(f)['books']}

    def test_inferred_volumes_join_a_calibre_series_written_differently(self):
        series = '無職転生 ～異世界行ったら本気だす～'
        result = self.build([
            (1, '無職転生 ～異世界行ったら本気だす～ 1 (MFブックス)', series),
            (2, '無職転生 ～異世界行ったら本気だす～ 2 (MFブックス)', None),
            (3, '別の本 1', None),
        ])
        self.assertEqual(result[1], (series, 1.0))
        self.assertEqual(result[2], (series, 2.0))
        # A single volume without a matching series stays on its own.
        self.assertEqual(result[3], ('', None))


class CatalogDbTest(unittest.TestCase):
    """Builds with API_DB set: books are kept in library.db and their unique titles are sticky."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.library = os.path.join(tmp.name, 'library')
        self.vn = os.path.join(tmp.name, 'vn')
        os.makedirs(self.library)
        self.output = os.path.join(tmp.name, 'state', 'catalog', 'catalog.json')
        os.makedirs(os.path.dirname(self.output))
        self.db_path = os.path.join(tmp.name, 'state', 'api', 'library.db')
        patcher = mock.patch.dict(os.environ, {'API_DB': self.db_path})
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def book(book_id, title, authors='', day=1):
        return {'id': book_id, 'title': title, 'authors': authors, 'uuid': f'uuid-{book_id}',
                'added': f'2026-01-{day:02d} 00:00:00+00:00'}

    def build(self, books, vn_dir=None):
        write_library(self.library, books)
        catalog.main(self.library, self.output, vn_dir, force=True)
        with open(self.output, encoding='utf-8') as f:
            return {b['id']: b['title'] for b in json.load(f)['books']}

    def rows(self):
        db = apidb.Database(self.db_path)
        try:
            return {row['calibre_id']: row for row in db.query('SELECT * FROM books')}
        finally:
            db.connection.close()

    def rev(self):
        db = apidb.Database(self.db_path)
        try:
            return apidb.current_rev(db.connection)
        finally:
            db.connection.close()

    def test_first_build_keeps_todays_titles(self):
        books = [self.book(1, '猫', 'A', 1), self.book(2, '猫', 'A', 2), self.book(3, '猫', 'B', 3)]
        with mock.patch.dict(os.environ, {'API_DB': ''}):
            today = self.build(books)
        self.assertEqual(today, {3: '猫', 2: '猫 (A)', 1: '猫 (A) [1]'})
        self.assertEqual(self.build(books), today)
        self.assertEqual({i: row['unique_title'] for i, row in self.rows().items()}, today)

    def test_new_same_title_gets_suffix(self):
        self.assertEqual(self.build([self.book(1, '猫', 'A', 1)]), {1: '猫'})
        self.assertEqual(self.build([self.book(1, '猫', 'A', 1), self.book(2, '猫', 'B', 2)]),
                         {1: '猫', 2: '猫 (B)'})

    def test_soft_delete_and_return_keeps_title(self):
        books = [self.book(1, '猫', 'A', 1), self.book(2, '犬', 'B', 2)]
        self.build(books)
        before = self.rows()[1]
        self.assertEqual(self.build(books[1:]), {2: '犬'})
        self.assertEqual(self.rows()[1]['deleted'], 1)
        self.assertEqual(self.build(books), {1: '猫', 2: '犬'})
        after = self.rows()[1]
        self.assertEqual((after['deleted'], after['id'], after['unique_title']), (0, before['id'], '猫'))

    def test_unchanged_build_bumps_no_rev(self):
        books = [self.book(1, '猫', 'A', 1), self.book(2, '犬', 'B', 2)]
        self.build(books)
        rev = self.rev()
        self.build(books)
        self.assertEqual(self.rev(), rev)

    def test_calibre_title_edit_keeps_unique_title(self):
        self.build([self.book(1, '猫', 'A', 1)])
        self.assertEqual(self.build([self.book(1, '吾輩は猫である', 'A', 1)]), {1: '猫'})
        row = self.rows()[1]
        self.assertEqual((row['title'], row['unique_title']), ('吾輩は猫である', '猫'))

    def test_vn_key(self):
        os.makedirs(os.path.join(self.vn, 'game1'))
        open(os.path.join(self.vn, 'game1', '0.txt'), 'w').close()
        self.build([self.book(1, '猫')], self.vn)
        db = apidb.Database(self.db_path)
        try:
            self.assertEqual([row['key'] for row in db.query('SELECT key FROM books WHERE vn = 1')], ['vn:game1'])
        finally:
            db.connection.close()


@unittest.skipUnless(catalog.Image, 'needs Pillow (python3-pil)')
class ThumbnailTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.library, self.vn = os.path.join(self.root, 'library'), os.path.join(self.root, 'vn')
        catalog.Image.new('RGB', (1500, 2100), 'red').save(self.mkdirs(self.library, 'A/B (1)/cover.jpg'))
        catalog.Image.new('RGBA', (800, 600), (0, 0, 0, 0)).save(self.mkdirs(self.vn, 'Game/cover.png'))
        self.output = os.path.join(self.root, 'state', 'catalog.json')
        with open(self.mkdirs(self.output), 'w', encoding='utf-8') as f:
            json.dump({'books': [{'format': 'EPUB', 'cover': 'A/B (1)/cover.jpg'},
                                 {'format': 'VN', 'cover': 'Game/cover.png'},
                                 {'format': 'EPUB', 'cover': ''}]}, f)

    @staticmethod
    def mkdirs(*parts):
        path = os.path.join(*parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def test_makes_small_jpegs_once(self):
        self.assertEqual(catalog.add_thumbnails(self.library, self.output, self.vn), 2)
        thumbs = os.path.join(self.root, 'state', 'thumbs')
        with catalog.Image.open(os.path.join(thumbs, 'library', 'A/B (1)/cover.jpg')) as image:
            self.assertEqual((image.format, image.size), ('JPEG', (280, 392)))
        with catalog.Image.open(os.path.join(thumbs, 'vn', 'Game/cover.png')) as image:
            self.assertEqual((image.format, image.mode), ('JPEG', 'RGB'))
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
        self.assertEqual(catalog.add_thumbnails(self.library, self.output, self.vn), 0)
        # A changed cover gets a new thumbnail.
        cover = os.path.join(self.library, 'A/B (1)/cover.jpg')
        os.utime(cover, (os.path.getmtime(cover) + 10,) * 2)
        self.assertEqual(catalog.add_thumbnails(self.library, self.output, self.vn), 1)

    def test_stops_at_the_deadline_and_skips_broken_covers(self):
        self.assertEqual(catalog.add_thumbnails(self.library, self.output, self.vn, seconds=-1), 0)
        with open(os.path.join(self.vn, 'Game/cover.png'), 'wb') as f:
            f.write(b'not an image')
        self.assertEqual(catalog.add_thumbnails(self.library, self.output, self.vn), 1)


if __name__ == '__main__':
    unittest.main()
