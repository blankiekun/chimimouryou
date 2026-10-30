"""Request handling shared by the services behind nginx (account, api, import, jiten, mokuro).

Each service keeps its own handler and settings and passes them in, so a service's tests can still
change its INTERNAL_TOKEN_FILE, CORS_ORIGINS or ALLOW_HTTP. Images copy this file to /app beside the
services' folders; each service puts its parent folder on sys.path. Standard library only.
"""
import hmac
import json
import re
import sys
import traceback

# Origins of the standalone app allowed to sign in with tokens: exact https origins, or http on
# loopback with a port (the desktop app, http://127.0.0.1:41917); others are ignored. Empty = off.
CORS_ORIGIN_RE = r'https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://(127\.0\.0\.1|localhost):[0-9]{1,5}'


class HttpError(Exception):
    """Answered with `status` and {"error": message, **body}, plus `headers`."""

    def __init__(self, status: int, message: str, headers: dict | None = None, body: dict | None = None):
        super().__init__(message)
        self.status = status
        self.headers = headers or {}
        self.body = body or {}


def parse_cors_origins(value: str) -> set[str]:
    return {origin for origin in value.split() if re.fullmatch(CORS_ORIGIN_RE, origin)}


def from_nginx(headers, token_file: str) -> bool:
    """Whether the request carries nginx's internal token (none configured: refuse everything)."""
    try:
        with open(token_file, encoding='ascii') as f:
            token = f.read().strip()
    except OSError:
        return False
    return bool(token) and hmac.compare_digest(token, headers.get('X-Internal-Token', ''))


def same_site(headers, cors_origins: set[str], allow_http: bool) -> bool:
    """Whether a POST may go on: from this site's own pages, or a server-connect token request (HTTPS)
    from a listed origin or, like the account service's, from none (native apps; browsers always send
    Origin on POSTs). nginx has checked the account; this stops other sites from posting with its cookie.
    The api service has no such check: its write routes take only content types that force a CORS
    preflight (read_body's `types`), so never give one text/plain or form bodies."""
    origin = headers.get('Origin')
    if cors_origins and headers.get('X-Forwarded-Proto') == 'https' and \
            headers.get('Authorization', '').lower().startswith('bearer ') and \
            (origin is None or origin in cors_origins):
        return True
    scheme = 'http' if allow_http and headers.get('X-Forwarded-Proto') == 'http' else 'https'
    return origin == f"{scheme}://{headers.get('Host', '')}"


def read_body(handler, limit: int, types: tuple[str, ...] | None = None) -> bytes:
    """The request body, checked before it is read: content type (when given), Content-Length, size."""
    if types is not None:
        content_type = handler.headers.get('Content-Type', '').split(';')[0].strip().lower()
        if content_type not in types:
            raise HttpError(415, 'Unsupported content type')
    length = handler.headers.get('Content-Length', '')
    if not length.isdigit():
        raise HttpError(411, 'Content-Length required')
    if int(length) > limit:
        raise HttpError(413, 'Too large')
    data = handler.rfile.read(int(length))
    if len(data) != int(length):
        raise HttpError(400, 'Incomplete request')
    return data


def send_json(handler, status: int, body: dict | None = None, headers: dict | None = None):
    """A JSON answer (None: an empty one), never cached."""
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else b''
    handler.send_response(status)
    if body is not None:
        handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(data)))
    handler.send_header('Cache-Control', 'no-store')
    for name, value in (headers or {}).items():
        handler.send_header(name, value)
    handler.end_headers()
    handler.wfile.write(data)


def guard(handler, respond):
    """Runs respond(): an HttpError becomes its answer, anything else a logged 500, never a dropped
    connection (which nginx turns into a 502 with no reason)."""
    try:
        respond()
    except HttpError as error:
        send_json(handler, error.status, {'error': str(error), **error.body}, error.headers)
    except (BrokenPipeError, ConnectionResetError):
        pass  # the client went away
    except Exception:  # noqa: BLE001 - log it, don't leak details
        sys.stderr.write(f"{handler.command} {handler.path.split('?')[0]}: {traceback.format_exc()}")
        try:
            # shortcut: an error after the answer's headers went out appends a second answer; all
            # services answer last, so it only happens when the connection is already broken.
            send_json(handler, 500, {'error': 'Internal error'})
        except OSError:
            pass
