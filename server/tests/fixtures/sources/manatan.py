"""Manatan v2 extensions for serve.py: a repository at https://repo.example/manatan/ and an invented mokuro.moe.

- manga.min.json: the repository's index, made from the packages here (sha256, size and manifest from each zip).
- mokuro.manatan2: Manatan Community's released Mokuro package, unchanged (Apache-2.0, see NOTICE).
- hostile.manatan2: a component `hostile()` assembles below, in the shape the app's loader reads (core modules,
  shim and fixup instances, canon lower/lift): manga-list loops forever, manga-search grows memory until it can't,
  manga-details fetches the item's key as a URL.
- mokuro.moe: one invented series, "Fixture Manga", two volumes of three pages, as the catalog JSON, .mokuro
  files and CBZs (stored, answered in byte ranges like the real site).
"""
import hashlib
import io
import json
import os
import re
import zipfile
from urllib.parse import unquote

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'extensions', 'manatan')
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kakuyomu', 'cover.png')
SERIES = 'Fixture Manga'
VOLUMES = ['Fixture Manga 01', 'Fixture Manga 02']
PAGES = 3


def leb(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7f
        n >>= 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def sleb(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7f
        n >>= 7
        done = (n == 0 and not byte & 0x40) or (n == -1 and byte & 0x40)
        out.append(byte | (0 if done else 0x80))
        if done:
            return bytes(out)


def name(text: str) -> bytes:
    return leb(len(text.encode())) + text.encode()


def vec(items: list[bytes]) -> bytes:
    return leb(len(items)) + b''.join(items)


def section(sid: int, body: bytes) -> bytes:
    return bytes([sid]) + leb(len(body)) + body


def core(*sections: bytes) -> bytes:
    return b'\0asm\x01\0\0\0' + b''.join(sections)


I32 = 0x7f
GUEST = 'manatan:extensions/guest@2.0.0#'


def functype(params: int, results: int) -> bytes:
    return b'\x60' + vec([bytes([I32])] * params) + vec([bytes([I32])] * results)


def body(code: bytes, locals_: bytes = b'\x00') -> bytes:
    inner = locals_ + code + b'\x0b'
    return leb(len(inner)) + inner


def hostile() -> bytes:
    """The hostile component's bytes (no toolchain: the loader under test is what reads it)."""
    i32 = lambda n: b'\x41' + sleb(n)  # noqa: E731
    store = lambda at, value: i32(at) + value + b'\x36\x02\x00'  # noqa: E731 i32.store
    main = core(
        section(1, vec([functype(0, 1), functype(4, 1), functype(2, 0)])),
        section(2, vec([name('net') + name('fetch') + b'\x00\x02'])),
        section(3, vec([b'\x01', b'\x00', b'\x01', b'\x01', b'\x01'])),
        section(5, vec([b'\x00\x01'])),
        section(6, vec([bytes([I32, 1]) + i32(4096) + b'\x0b'])),
        section(7, vec([
            name('memory') + b'\x02\x00',
            name('cabi_realloc') + b'\x00\x01',
            name(GUEST + 'init') + b'\x00\x02',
            name(GUEST + 'manga-list') + b'\x00\x03',
            name(GUEST + 'manga-search') + b'\x00\x04',
            name(GUEST + 'manga-details') + b'\x00\x05',
        ])),
        section(10, vec([
            # realloc: a bump allocator from 4096 (below: manga-details' request), 8-aligned
            body(b'\x23\x00' + i32(7) + b'\x6a' + i32(-8) + b'\x71\x22\x04\x20\x04\x20\x03\x6a\x24\x00',
                 b'\x01\x01' + bytes([I32])),
            body(i32(0)),  # init: ok (memory at 0 is zero)
            body(b'\x03\x40\x0c\x00\x0b\x00'),  # manga-list: loop { br 0 }
            # manga-search: memory.grow 16 until it fails, then trap
            body(b'\x03\x40' + i32(16) + b'\x40\x00' + i32(-1) + b'\x47\x0d\x00\x0b\x00'),
            # manga-details: net.fetch({method "GET", url = the item's key}) and return its result, whose
            # err case reads as the call's error. The request is {"manga":{"key":"<key>","title":""}}.
            body(store(0x800, i32(0x900)) + store(0x804, i32(3)) + store(0x808, b'\x20\x02' + i32(17) + b'\x6a')
                 + store(0x80c, b'\x20\x03' + i32(31) + b'\x6b') + store(0x900, i32(0x544547))
                 + i32(0x800) + i32(0xa00) + b'\x10\x00' + i32(0xa00)),
        ])),
    )
    shim = core(
        section(1, vec([functype(2, 0)])),
        section(3, vec([b'\x00'])),
        section(4, vec([b'\x70\x00\x01'])),
        section(7, vec([name('0') + b'\x00\x00', name('$imports') + b'\x01\x00'])),
        section(10, vec([body(b'\x20\x00\x20\x01' + i32(0) + b'\x11\x00\x00')])),
    )
    fixup = core(
        section(1, vec([functype(2, 0)])),
        section(2, vec([name('') + name('0') + b'\x00\x00', name('') + name('$imports') + b'\x01\x70\x00\x01'])),
        section(9, vec([b'\x02\x00' + i32(0) + b'\x0b\x00' + vec([b'\x00'])])),
    )
    ext = lambda text: b'\x00' + name(text)  # noqa: E731 a plain export or import name
    core_alias = lambda sort, inst, text: b'\x00' + bytes([sort]) + b'\x01' + leb(inst) + name(text)  # noqa: E731
    lift = lambda fn, realloc: b'\x00\x00' + leb(fn) + vec(  # noqa: E731
        [b'\x03\x00'] + ([b'\x04\x01', b'\x00'] if realloc else [])) + b'\x00'
    return b'\0asm\x0d\x00\x01\x00' + b''.join([
        section(10, vec([ext('manatan:extensions/net@2.0.0') + b'\x05\x00'])),
        section(1, main), section(1, shim), section(1, fixup),
        section(2, vec([b'\x00\x01\x00'])),
        section(6, vec([core_alias(0, 0, '0')])),
        section(2, vec([b'\x01' + vec([name('fetch') + b'\x00\x00'])])),
        section(2, vec([b'\x00\x00' + vec([name('net') + b'\x12\x01'])])),
        section(6, vec([core_alias(2, 2, 'memory'), core_alias(0, 2, 'cabi_realloc'), core_alias(1, 0, '$imports'),
                        b'\x01\x00\x00' + name('fetch')])),
        section(8, vec([b'\x01\x00\x00' + vec([b'\x03\x00', b'\x04\x01', b'\x00'])])),
        section(2, vec([b'\x01' + vec([name('0') + b'\x00\x02', name('$imports') + b'\x01\x00']),
                        b'\x00\x02' + vec([name('') + b'\x12\x03'])])),
        section(6, vec([core_alias(0, 2, GUEST + n) for n in ('init', 'manga-list', 'manga-search', 'manga-details')])),
        section(8, vec([lift(3, False), lift(4, True), lift(5, True), lift(6, True)])),
        section(5, vec([b'\x01' + vec([ext('init') + b'\x01\x01', ext('manga-list') + b'\x01\x02',
                                       ext('manga-search') + b'\x01\x03', ext('manga-details') + b'\x01\x04'])])),
        section(11, vec([ext('manatan:extensions/guest@2.0.0') + b'\x05\x01\x00'])),
    ])


def package(manifest: dict, wasm: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        z.writestr('manifest.json', json.dumps(manifest))
        z.writestr(manifest['wasm'], wasm)
    return out.getvalue()


HOSTILE_MANIFEST = {
    'schemaVersion': 2, 'id': 'hostile', 'name': 'Hostile', 'version': '1.0.0', 'apiVersion': 2,
    'wasm': 'extension.wasm', 'contentType': 'manga',
    'permissions': {'network': {'allow': ['https://kakuyomu.jp']}},
    'sources': [{'id': 'hostile', 'name': 'Hostile', 'lang': 'ja', 'contentType': 'manga',
                 'baseUrl': 'https://kakuyomu.jp', 'listings': [{'id': 'popular'}]}],
}


def packages() -> dict[str, bytes]:
    with open(os.path.join(HERE, 'mokuro.manatan2'), 'rb') as f:
        mokuro = f.read()
    return {'mokuro': mokuro, 'hostile': package(HOSTILE_MANIFEST, hostile())}


def repo(rest: str) -> tuple[int, str, bytes]:
    found = packages()
    if rest == 'manga.min.json':
        entries = []
        for pkg, data in found.items():
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                manifest = json.loads(z.read('manifest.json'))
            entries.append({
                'id': manifest['id'], 'name': manifest['name'], 'version': manifest['version'],
                'contentType': manifest['contentType'], 'lang': manifest['sources'][0]['lang'],
                'extensionType': 'manatan2', 'packageUrl': f'packages/{pkg}.manatan2',
                'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), 'manifest': manifest,
            })
        return 200, 'application/json', json.dumps(entries).encode()
    if (match := re.fullmatch(r'packages/(\w+)\.manatan2', rest)) and match[1] in found:
        return 200, 'application/octet-stream', found[match[1]]
    return 404, 'text/plain', b'not found'


def cbz() -> bytes:
    with open(PAGE, 'rb') as f:
        page = f.read()
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
        for n in range(PAGES):
            z.writestr(f'{n + 1:03}.png', page)
    return out.getvalue()


def mokuro(rest: str, range_header: str) -> tuple[int, str, bytes, dict]:
    """(status, type, body, extra headers) for https://mokuro.moe/<rest>."""
    rest = unquote(rest)
    if rest == 'mokuro-reader/catalog.json':
        return 200, 'application/json', json.dumps({'series': [{
            'series_title': SERIES, 'titles': {'native': 'フィクスチャ漫画'}, 'updated_at': '2026-10-01',
            'volume_count': len(VOLUMES)}]}).encode(), {}
    if rest == 'catalog/api/library':
        return 200, 'application/json', json.dumps({'series': [{'name': SERIES, 'cover': None}]}).encode(), {}
    if rest == f'mokuro-reader/{SERIES}/series.json':
        return 200, 'application/json', json.dumps({'series_title': SERIES, 'updated_at': '2026-10-01', 'volumes': [
            {'volume_title': v, 'page_count': PAGES, 'matched_page_count': PAGES} for v in VOLUMES]}).encode(), {}
    for volume in VOLUMES:
        if rest == f'mokuro-reader/{SERIES}/{volume}.mokuro':
            pages = [{'img_path': f'{n + 1:03}.png'} for n in range(PAGES)]
            return 200, 'application/json', json.dumps({'pages': pages}).encode(), {}
        if rest == f'mokuro-reader/{SERIES}/{volume}.cbz':
            data = cbz()
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', range_header)
            if not match:
                return 200, 'application/zip', data, {}
            start, end = int(match[1]), min(int(match[2] or len(data) - 1), len(data) - 1)
            return 206, 'application/zip', data[start:end + 1], {'Content-Range': f'bytes {start}-{end}/{len(data)}'}
    return 404, 'text/plain', b'not found', {}
