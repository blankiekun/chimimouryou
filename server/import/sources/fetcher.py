"""The one HTTP client of Sources: every request to a site goes through fetch(), so the per-host limit is global.

Browser-like User-Agent, at most one request per SOURCES_HOST_INTERVAL seconds per host (default 2), Retry-After
honoured on 429/503, a size cap on the decoded body, and redirects followed only within the caller's hosts.
SOURCES_FIXTURE_URL (tests and the test stack only) sends https://<host>/<path> to <fixture>/<host>/<path>.
"""
import os
import threading
import time
import urllib.error
import urllib.request
import zlib
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse

USER_AGENT = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
              'Chrome/141.0.0.0 Safari/537.36')
INTERVAL = float(os.environ.get('SOURCES_HOST_INTERVAL') or 2.0)
FIXTURE_URL = os.environ.get('SOURCES_FIXTURE_URL', '').rstrip('/')
MAX_BYTES = 20 * 1024 * 1024
TIMEOUT = 30
MAX_REDIRECTS = 5
# A longer Retry-After fails the request; the job can be retried later.
MAX_RETRY_AFTER = 600
RETRIES = 3

_lock = threading.Lock()
_next: dict[str, float] = {}


class FetchError(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _wait_turn(host: str):
    """Takes the host's next slot (one per INTERVAL), then sleeps until it comes."""
    with _lock:
        now = time.monotonic()
        slot = max(now, _next.get(host, 0.0))
        _next[host] = slot + INTERVAL
    time.sleep(max(0.0, slot - now))


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
    except (TypeError, ValueError):
        return None


def _decode(response, raw: bytes) -> bytes:
    encoding = (response.headers.get('Content-Encoding') or '').lower()
    if encoding not in ('gzip', 'deflate'):
        return raw
    inflater = zlib.decompressobj(zlib.MAX_WBITS | 32 if encoding == 'gzip' else zlib.MAX_WBITS)
    try:
        body = inflater.decompress(raw, MAX_BYTES + 1)
    except zlib.error as error:
        raise FetchError('The site sent a broken page') from error
    if len(body) > MAX_BYTES:
        raise FetchError('The page is too large')
    return body


def fetch(url: str, hosts: set[str], headers: dict | None = None) -> tuple[bytes, str]:
    """GETs url (http(s), a host in `hosts`); returns (body, final url). Raises FetchError with a reader-facing
    message."""
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlparse(url)
        host = (parts.hostname or '').lower()
        if parts.scheme not in ('http', 'https') or host not in hosts:
            raise FetchError(f'Refused to fetch {host or url}: not a page of this site')
        target = f'{FIXTURE_URL}/{host}{parts.path or "/"}' + (f'?{parts.query}' if parts.query else '') \
            if FIXTURE_URL else url
        request = urllib.request.Request(target, headers={
            'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip', 'Accept-Language': 'ja,en;q=0.8', **(headers or {})})
        for attempt in range(RETRIES):
            _wait_turn(host)
            try:
                with _opener.open(request, timeout=TIMEOUT) as response:
                    raw = response.read(MAX_BYTES + 1)
                    if len(raw) > MAX_BYTES:
                        raise FetchError('The page is too large')
                    return _decode(response, raw), url
            except urllib.error.HTTPError as error:
                if error.code in (301, 302, 303, 307, 308) and error.headers.get('Location'):
                    url = urljoin(url, error.headers['Location'])
                    break
                wait = _retry_after(error.headers.get('Retry-After')) if error.code in (429, 503) else None
                if wait is None or wait > MAX_RETRY_AFTER or attempt == RETRIES - 1:
                    raise FetchError(f"{host} didn't answer ({error.code})") from error
                with _lock:
                    _next[host] = max(_next.get(host, 0.0), time.monotonic() + wait)
            except (urllib.error.URLError, OSError) as error:
                raise FetchError(f"{host} didn't answer ({getattr(error, 'reason', error)})") from error
    raise FetchError('Too many redirects')

