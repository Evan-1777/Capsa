"""Deterministic normalization, tokenization, scoring and ranking."""

from __future__ import annotations

import json
import unicodedata
from datetime import datetime, timezone


def _is_cjk(char: str) -> bool:
    return "\u4e00" <= char <= "\u9fff"


def normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text or "").lower()


def _words(text: str) -> list[str]:
    words: list[str] = []
    current: list[str] = []
    for char in text:
        if char.isalnum():
            current.append(char)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    return words


def _tokens_of(word: str) -> list[str]:
    """Split a word into tokens: CJK runs become consecutive bigrams."""
    tokens: list[str] = []
    run = ""
    run_is_cjk = False
    for char in word + "\x00":
        char_is_cjk = char != "\x00" and _is_cjk(char)
        if run and (char == "\x00" or char_is_cjk != run_is_cjk):
            if run_is_cjk and len(run) > 1:
                tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
            else:
                tokens.append(run)
            run = ""
        if char != "\x00":
            run += char
            run_is_cjk = char_is_cjk
    return tokens


def tokenize(query: str) -> set[str]:
    return {token for word in _words(normalize(query)) for token in _tokens_of(word)}


def _parse(value: str) -> datetime:
    moment = datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def to_epoch(value: str) -> float:
    return _parse(value).astimezone(timezone.utc).timestamp()


def is_expired(review_at: str | None, now: datetime | None = None) -> bool:
    if not review_at:
        return False
    now = now or datetime.now(timezone.utc)
    return _parse(review_at) < now


def score(memory: dict, terms: set[str], now: datetime | None = None) -> int:
    title = normalize(memory.get("title", ""))
    summary = normalize(memory.get("summary", ""))
    tags = [normalize(tag) for tag in json.loads(memory.get("tags") or "[]")]
    total = 4 * sum(1 for term in terms if term in title)
    total += sum(1 for term in terms if term in summary)
    total += 2 * sum(1 for term in terms if any(term in tag for tag in tags))
    if memory.get("pinned"):
        total += 3
    if is_expired(memory.get("review_at"), now):
        total -= 2
    return total


def rank_memories(
    memories: list[dict], query: str, now: datetime | None = None
) -> list[dict]:
    """Rank a copy of the input; the input list keeps its original order.

    Two stable passes: the id pass fixes the final descending tie-breaker, the
    key pass orders by score, pinned flag and update time.
    """
    ranked = list(memories)
    ranked.sort(key=lambda memory: memory["id"], reverse=True)
    terms = tokenize(query)
    if not terms:
        ranked.sort(
            key=lambda memory: (memory["pinned"], to_epoch(memory["updated_at"])),
            reverse=True,
        )
        return ranked
    now = now or datetime.now(timezone.utc)
    scores = {memory["id"]: score(memory, terms, now) for memory in ranked}
    # A keyword query returns matches only: an entry scoring zero shares no term
    # with the query, so listing it would be noise rather than over-recall.
    ranked = [memory for memory in ranked if scores[memory["id"]] > 0]
    ranked.sort(
        key=lambda memory: (
            scores[memory["id"]],
            memory["pinned"],
            to_epoch(memory["updated_at"]),
        ),
        reverse=True,
    )
    return ranked
