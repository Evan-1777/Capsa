"""Identifier and token generation."""

from __future__ import annotations

import hashlib
import secrets
import string

_ALNUM_LOWER = string.ascii_lowercase + string.digits
_SECRET_ALPHABET = string.ascii_letters + string.digits + "_-"


def new_key_id() -> str:
    return "".join(secrets.choice(_ALNUM_LOWER) for _ in range(8))


def new_secret() -> str:
    return "".join(secrets.choice(_SECRET_ALPHABET) for _ in range(32))


def new_memory_id() -> str:
    return "mem_" + "".join(secrets.choice(_ALNUM_LOWER) for _ in range(6))


def hash_token(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()
