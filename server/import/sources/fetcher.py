"""The one HTTP client of Sources: every request to a site goes through fetch(), so the per-host limit is global.

Browser-like User-Agent, at most one request per SOURCES_HOST_INTERVAL seconds per host (default 2), Retry-After
honoured on 429/503, a size cap on the decoded body, and redirects followed only within the caller's hosts.
SOURCES_FIXTURE_URL (tests and the test stack only) sends https://<host>/<path> to <fixture>/<host>/<path>.

Servers a reader added (origin=...) have their own rule: they may be on the LAN, so instead of a list of hosts only
that server's own scheme, host and port pass, redirects included (its credentials go nowhere else), with a shorter
interval (the reader's own server, not a public site) and no fixture rewriting.

fetch_public() is the extensions' fetch proxy rule (anyone with the import permission can name any host there, see
api.proxy): https on port 443 only, no userinfo, every address the host resolves to must be public (no LAN, loopback,
link-local, CGNAT or multicast), checked on every redirect, and the connection goes to the checked address (no DNS
rebinding). It never waits long for the host's slot (Busy instead) and leaves 429/503 to the caller.
"""
import http.client
import ipaddress
import os
import socket
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
# A request someone is waiting on (an API call: search, lookup, covers) waits at most this long for the host (its
# Retry-After or its slot), well under nginx's 300 s; the runners' threads (patient()) keep MAX_RETRY_AFTER.
API_MAX_WAIT = 30
RETRIES = 3

_lock = threading.Lock()
_next: dict[str, float] = {}
_thread = threading.local()


def patient():
    """This thread's requests may wait out a long Retry-After: no one is waiting on its answer (a runner)."""
    _thread.patient = True


class FetchError(Exception):
    def __init__(self, message: str, status: int | None = None, reason: str = ''):
        super().__init__(message)
        self.status = status  # the site's HTTP status, when it answered with an error
        self.reason = reason  # why it couldn't be reached


class Busy(FetchError):
    """The host's next free slot is more than max_wait seconds away."""

    def __init__(self, host: str, wait: float):
        super().__init__(f'{host} is busy; try again in {int(wait) + 1} s', 429)
        self.wait = wait


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _public_address(host: str) -> str:
    """The address to connect to: host's first, once every address it resolves to is public."""
    try:
        answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as error:
        raise FetchError(f"{host} didn't answer ({error})", reason=str(error)) from error
    for answer in answers:
        address = ipaddress.ip_address(answer[4][0].split('%')[0])
        address = getattr(address, 'ipv4_mapped', None) or address
        if not address.is_global or address.is_multicast:
            raise FetchError(f'Refused to fetch {host}: not a public address')
    if not answers:
        raise FetchError(f"{host} didn't answer (no address)")
    return answers[0][4][0]


def _pinned_opener(address: str):
    """An opener whose https connections go to `address`, TLS checked against the URL's host name."""
    class Connection(http.client.HTTPSConnection):
        def connect(self):
            sock = socket.create_connection((address, self.port), self.timeout)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)

    class Handler(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(Connection, req, context=self._context)

    # No ProxyHandler from the environment: a proxy would connect to the host by name again.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect, Handler)


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


def _wait_turn(host: str, interval: float, max_wait: float | None = None):
    """Takes the host's next slot (one per interval), then sleeps until it comes; Busy if it's past max_wait."""
    with _lock:
        now = time.monotonic()
        slot = max(now, _next.get(host, 0.0))
        if max_wait is not None and slot - now > max_wait:
            raise Busy(host, slot - now)
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


def _stream(response, path: str, max_bytes: int):
    if (response.headers.get('Content-Encoding') or 'identity').lower() != 'identity':
        raise FetchError('The server sent the file compressed')
    size = 0
    with open(path, 'wb') as f:
        while chunk := response.read(1 << 20):
            size += len(chunk)
            if size > max_bytes:
                raise FetchError('The file is too large')
            f.write(chunk)


def fetch(url: str, hosts: set[str], headers: dict | None = None, server: str = '',
          max_bytes: int | None = None, to_path: str = '') -> tuple[bytes, str]:
    """GETs url (http(s), a host in `hosts`, or with `server` (an origin()) only on that server); returns (body,
    final url). With to_path the body is streamed into that file instead (uncompressed; b'' is returned; the caller
    removes the file on failure). Raises FetchError with a reader-facing message."""
    return _fetch(url, hosts, headers, server, max_bytes, to_path)[:2]


def fetch_public(url: str, hosts: set[str], headers: dict | None = None, max_bytes: int | None = None,
                 max_wait: float = 20) -> tuple[bytes, str, str]:
    """GETs url under the public rule (module docstring); returns (body, final url, content type)."""
    return _fetch(url, hosts, headers, max_bytes=max_bytes, public=True, max_wait=max_wait)


def _fetch(url: str, hosts: set[str], headers: dict | None = None, server: str = '', max_bytes: int | None = None,
           to_path: str = '', public: bool = False, max_wait: float | None = None) -> tuple[bytes, str, str]:
    max_bytes = max_bytes or MAX_BYTES
    patient = getattr(_thread, 'patient', False)
    longest = MAX_RETRY_AFTER if patient else API_MAX_WAIT
    if max_wait is None and not patient:
        max_wait = API_MAX_WAIT
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlparse(url)
        host = (parts.hostname or '').lower()
        opener = _opener
        if server:
            if origin(url) != server:
                raise FetchError(f'Refused to fetch {host or url}: not on this server')
        elif parts.scheme not in ('http', 'https') or host not in hosts:
            raise FetchError(f'Refused to fetch {host or url}: not a page of this site')
        if public:
            try:
                port = parts.port
            except ValueError:
                port = -1
            if parts.scheme != 'https' or port not in (None, 443) or '@' in parts.netloc:
                raise FetchError(f'Refused to fetch {host}: only https on the usual port')
            address = _public_address(host)
            if not FIXTURE_URL:
                opener = _pinned_opener(address)
        target = f'{FIXTURE_URL}/{host}{parts.path or "/"}' + (f'?{parts.query}' if parts.query else '') \
            if FIXTURE_URL and not server else url
        request = urllib.request.Request(target, headers={
            'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity' if to_path else 'gzip',
            'Accept-Language': 'ja,en;q=0.8', **(headers or {})})
        for attempt in range(1 if public else RETRIES):
            _wait_turn(server or host, SERVER_INTERVAL if server else INTERVAL, max_wait)
            try:
                with opener.open(request, timeout=TIMEOUT) as response:
                    kind = response.headers.get('Content-Type', '')
                    if to_path:
                        _stream(response, to_path, max_bytes)
                        return b'', url, kind
                    raw = response.read(max_bytes + 1)
                    if len(raw) > max_bytes:
                        raise FetchError('The page is too large')
                    return _decode(response, raw, max_bytes), url, kind
            except urllib.error.HTTPError as error:
                if error.code in (301, 302, 303, 307, 308) and error.headers.get('Location'):
                    url = urljoin(url, error.headers['Location'])
                    break
                wait = _retry_after(error.headers.get('Retry-After')) if error.code in (429, 503) else None
                if wait is not None and wait <= MAX_RETRY_AFTER:  # the runners keep to it too
                    with _lock:
                        _next[server or host] = max(_next.get(server or host, 0.0), time.monotonic() + wait)
                if wait is None or wait > longest or attempt == (0 if public else RETRIES - 1):
                    raise FetchError(f"{host} didn't answer ({error.code})", error.code) from error
            except (urllib.error.URLError, OSError) as error:
                reason = str(getattr(error, 'reason', error))
                raise FetchError(f"{host} didn't answer ({reason})", reason=reason) from error
    raise FetchError('Too many redirects')
