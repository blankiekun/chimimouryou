"""Request checks shared by the services behind nginx (account, api, import, jiten, mokuro).

Each service keeps its own handler and settings and passes them in, so a service's tests can still
change its INTERNAL_TOKEN_FILE, CORS_ORIGINS or ALLOW_HTTP. Images copy this file to /app beside the
services' folders; each service puts its parent folder on sys.path. Standard library only.
"""
import hmac


def from_nginx(headers, token_file: str) -> bool:
    """Whether the request carries nginx's internal token (none configured: refuse everything)."""
    try:
        with open(token_file, encoding='ascii') as f:
            token = f.read().strip()
    except OSError:
        return False
    return bool(token) and hmac.compare_digest(token, headers.get('X-Internal-Token', ''))


def same_site(headers, cors_origins: set[str], allow_http: bool) -> bool:
    """Whether a POST may go on: from this site's own pages, or a server-connect token request from a
    listed origin. nginx has checked the account; this stops other sites from posting with its cookie."""
    scheme = 'http' if allow_http and headers.get('X-Forwarded-Proto') == 'http' else 'https'
    token_request = cors_origins and headers.get('X-Forwarded-Proto') == 'https' and \
        headers.get('Authorization', '').lower().startswith('bearer ') and \
        headers.get('Origin') in cors_origins
    return bool(token_request) or headers.get('Origin') == f"{scheme}://{headers.get('Host', '')}"
