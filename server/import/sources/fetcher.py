"""The one HTTP client of Sources: every request to a site goes through fetch(), so the per-host limit is global.

Browser-like User-Agent, at most one request per SOURCES_HOST_INTERVAL seconds per host (default 2), Retry-After
honoured on 429/503, a size cap on the decoded body, and redirects followed only within the caller's hosts.
SOURCES_FIXTURE_URL (tests and the test stack only) sends https://<host>/<path> to <fixture>/<host>/<path>.

Servers a reader added (origin=...) have their own rule: they may be on the LAN, so instead of a list of hosts only
that server's own scheme, host and port pass, redirects included (its credentials go nowhere else), with a shorter
interval (the reader's own server, not a public site) and no fixture rewriting.
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
SERVER_INTERVAL = 0.2
# A longer Retry-After fails the request; the job can be retried later.
MAX_RETRY_AFTER = 600
RETRIES = 3

_lock = threading.Lock()
_next: dict[str, float] = {}


class FetchError(Exception):
    def __init__(self, message: str, status: int | None = None, reason: str = ''):
        super().__init__(message)
        self.status = status  # the site's HTTP status, when it answered with an error
        self.reason = reason  # why it couldn't be reached


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def origin(url: str) -> str:
    """scheme://host:port of url ('' when it has no usable host), default ports filled in."""
    parts = urlparse(url)
    try:
        port = parts.port or {'http': 80, 'https': 443}.get(parts.scheme)
    except ValueError:
        return ''
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        return ''
    return f'{parts.scheme}://{parts.hostname.lower()}:{port}'


def _wait_turn(host: str, interval: float):
    """Takes the host's next slot (one per interval), then sleeps until it comes."""
    with _lock:
        now = time.monotonic()
        slot = max(now, _next.get(host, 0.0))
        _next[host] = slot + interval
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


def _decode(response, raw: bytes, max_bytes: int) -> bytes:
    encoding = (response.headers.get('Content-Encoding') or '').lower()
    if encoding not in ('gzip', 'deflate'):
        return raw
    inflater = zlib.decompressobj(zlib.MAX_WBITS | 32 if encoding == 'gzip' else zlib.MAX_WBITS)
    try:
        body = inflater.decompress(raw, max_bytes + 1)
    except zlib.error as error:
        raise FetchError('The site sent a broken page') from error
    if len(body) > max_bytes:
        raise FetchError('The page is too large')
    return body


def fetch(url: str, hosts: set[str], headers: dict | None = None, server: str = '',
          max_bytes: int | None = None) -> tuple[bytes, str]:
    """GETs url (http(s), a host in `hosts`, or with `server` (an origin()) only on that server); returns (body,
    final url). Raises FetchError with a reader-facing message."""
    max_bytes = max_bytes or MAX_BYTES
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlparse(url)
        host = (parts.hostname or '').lower()
        if server:
            if origin(url) != server:
                raise FetchError(f'Refused to fetch {host or url}: not on this server')
        elif parts.scheme not in ('http', 'https') or host not in hosts:
            raise FetchError(f'Refused to fetch {host or url}: not a page of this site')
        target = f'{FIXTURE_URL}/{host}{parts.path or "/"}' + (f'?{parts.query}' if parts.query else '') \
            if FIXTURE_URL and not server else url
        request = urllib.request.Request(target, headers={
            'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip', 'Accept-Language': 'ja,en;q=0.8', **(headers or {})})
        for attempt in range(RETRIES):
            _wait_turn(server or host, SERVER_INTERVAL if server else INTERVAL)
            try:
                with _opener.open(request, timeout=TIMEOUT) as response:
                    raw = response.read(max_bytes + 1)
                    if len(raw) > max_bytes:
                        raise FetchError('The page is too large')
                    return _decode(response, raw, max_bytes), url
            except urllib.error.HTTPError as error:
                if error.code in (301, 302, 303, 307, 308) and error.headers.get('Location'):
                    url = urljoin(url, error.headers['Location'])
                    break
                wait = _retry_after(error.headers.get('Retry-After')) if error.code in (429, 503) else None
                if wait is None or wait > MAX_RETRY_AFTER or attempt == RETRIES - 1:
                    raise FetchError(f"{host} didn't answer ({error.code})", error.code) from error
                with _lock:
                    _next[server or host] = max(_next.get(server or host, 0.0), time.monotonic() + wait)
            except (urllib.error.URLError, OSError) as error:
                reason = str(getattr(error, 'reason', error))
                raise FetchError(f"{host} didn't answer ({reason})", reason=reason) from error
    raise FetchError('Too many redirects')
