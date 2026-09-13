"""Deterministic normalization, tokenization, scoring and ranking."""

from __future__ import annotations

import json
import unicodedata
from datetime import datetime, timezone

SIMILARITY_THRESHOLD = 0.6


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


def normalize_review_at(value: str) -> str:
    """Return an ISO 8601 timestamp normalized to UTC.

    A timestamp without an offset is read as UTC. ValueError from
    datetime.fromisoformat propagates so the tool layer can render it.
    """
    return _parse(value).astimezone(timezone.utc).isoformat()


def title_similarity(left: str, right: str) -> float:
    """Bigram Jaccard coefficient of two titles; two empty token sets score 0."""
    left_tokens = tokenize(left)
    right_tokens = tokenize(right)
    union = left_tokens | right_tokens
    if not union:
        return 0.0
    return len(left_tokens & right_tokens) / len(union)


def find_similar_memories(
    candidates: list[dict], title: str, threshold: float = SIMILARITY_THRESHOLD
) -> list[dict]:
    """Candidates at or above the threshold, each annotated and sorted by similarity."""
    similar = []
    for memory in candidates:
        score = title_similarity(title, memory.get("title", ""))
        if score >= threshold:
            similar.append({**memory, "similarity": round(score, 2)})
    similar.sort(key=lambda memory: memory["similarity"], reverse=True)
    return similar


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


def _hits(memory: dict, terms: set[str]) -> bool:
    """Whether a term matches a searchable field. Pinned and expiry are ranking
    weights, not hits: a pinned entry sharing no term with the query is noise."""
    fields = [normalize(memory.get("title", "")), normalize(memory.get("summary", ""))]
    fields.extend(normalize(tag) for tag in json.loads(memory.get("tags") or "[]"))
    return any(term in field for term in terms for field in fields)


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
    # A keyword query returns matches only: an entry sharing no term with the
    # query is noise even when pinned or live ranking would otherwise float it.
    ranked = [memory for memory in ranked if _hits(memory, terms)]
    scores = {memory["id"]: score(memory, terms, now) for memory in ranked}
    ranked.sort(
        key=lambda memory: (
            scores[memory["id"]],
            memory["pinned"],
            to_epoch(memory["updated_at"]),
        ),
        reverse=True,
    )
    return ranked
