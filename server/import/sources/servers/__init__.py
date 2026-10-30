"""Servers a reader adds as sources (OPDS catalogs; Suwayomi through its OPDS feed): their passwords at rest.

Passwords are encrypted (Fernet, python3-cryptography) with a key derived from SOURCES_SECRET_KEY, which lives in
the environment, not in DATA_PATH, so a copy of the data folder alone doesn't reveal them. Without the key a
server with a password can't be added; servers without one work either way.
"""
import base64
import hashlib
import os

SECRET_KEY = os.environ.get('SOURCES_SECRET_KEY', '')


class SecretError(ValueError):
    pass


def _fernet():
    if not SECRET_KEY:
        raise SecretError('Passwords need SOURCES_SECRET_KEY set on the server (see CONFIGURATION.md)')
    from cryptography.fernet import Fernet  # only the import image has it
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest()))


def encrypt(password: str) -> str:
    return _fernet().encrypt(password.encode()).decode()


def decrypt(token: str) -> str:
    from cryptography.fernet import InvalidToken
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as error:
        raise SecretError("The server's password can't be read (SOURCES_SECRET_KEY changed?); "
                          'edit the source and type it again') from error
