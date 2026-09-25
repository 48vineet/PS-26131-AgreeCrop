"""Machine translation for farmer-facing dynamic prose.

The curated advisory library (`advisories.py`) is deliberately NOT served
through this module. Advisory recommendations, safety notes, dosages and
regulatory instructions are expert-authored and human-curated only; the existing
`advisory_translations` path there stays the sole way they reach a farmer in
Hindi or Marathi.

What this translates is the other farmer-facing prose the platform serves at
runtime and has no curated translation for: risk explanations, weather
explanations, notification bodies, screening notes, reviewer notes, referral
outcomes, extension notes and surveillance descriptions. All of it is
non-authoritative -- it explains or reports, it never doses.

Two invariants, in order of importance:

1. **Never break or blank a page.** `translate_text` returns `None` on any
   provider problem, and `translate_fields` leaves the source string in place.
   A missing API key, a dead endpoint, a rate limit or a malformed completion
   all degrade to the source language with `is_fallback` set.
2. **Never alter authoritative agronomic instructions.** Text matching a
   dose / rate / PHI / regulatory pattern is returned untouched, in the source
   language, whatever the provider is willing to do with it.

Caching is `functools.lru_cache` keyed on (text, source, target): identical
source text and target language is translated at most once per process, which
is the whole of the "do not retranslate" requirement. No cache table, no
schema change, no migration.

Credentials stay here on the backend. There is no browser-side translator and
no DOM-level translation anywhere in this path.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache

from fastapi import HTTPException

from ai_advisory import LANGUAGE_NAMES, _client, AI_ADVISORY_MODEL

logger = logging.getLogger(__name__)

DEFAULT_LANGUAGE = 'en'
LANGUAGES = ('en', 'hi', 'mr')


# ── Language resolution ────────────────────────────────────────────────────

def resolve_language(requested: str | None, user) -> tuple:
    """The language to serve in, and where that choice came from.

    Lives here because `advisories.py` needs the identical rule and there must
    be one rule, not two that drift. An explicit value wins; otherwise the
    caller's stored `users.language` applies; anything unsupported falls back
    to English rather than failing the request.

    Raises 422 for an explicitly requested but unsupported language: the caller
    asked for something specific, so silently answering in another language
    would be worse than saying no.
    """
    if requested is not None and str(requested).strip():
        chosen = str(requested).strip().lower()
        if chosen not in LANGUAGES:
            raise HTTPException(
                422,
                f"'{requested}' is not a language this platform carries advisories in. "
                f'Use one of: {", ".join(LANGUAGES)}.',
            )
        return chosen, 'query'
    stored = (getattr(user, 'language', None) or '').strip().lower()
    if stored in LANGUAGES:
        return stored, 'users.language'
    return DEFAULT_LANGUAGE, 'default'


def language_from_request(request, user) -> tuple:
    """`resolve_language`, with the `Accept-Language` header consulted first.

    The SPA sends `Accept-Language` on every request via the axios interceptor,
    so a farmer who switched language in the navbar gets translated prose
    without any page-specific wiring. Header then stored row, because the
    header reflects the live session and the column only reflects the last
    save that reached the database.
    """
    header = request.headers.get('accept-language') if request is not None else None
    if header:
        for part in header.split(','):
            # `hi-IN,hi;q=0.9` -> try `hi-in` then its primary subtag `hi`.
            code = part.split(';')[0].strip().lower()
            if code in LANGUAGES:
                return code, 'header'
            primary = code.split('-')[0]
            if primary in LANGUAGES:
                return primary, 'header'
    return resolve_language(None, user)


# ── Authoritative-text guard ───────────────────────────────────────────────

# Dose, application rate, pre-harvest interval and registration language. Any
# text matching these is expert-authored agronomic instruction: a mistranslated
# "2 ml per litre" is a safety incident, not a bad sentence. The regexes are
# deliberately broad -- a false positive costs a farmer an English sentence,
# which is cheap.
_AUTHORITATIVE_PATTERNS = (
    re.compile(r'\b\d+(?:\.\d+)?\s*(?:ml|l|litre|liter|litres|liters|g|gm|kg|mg)\b', re.I),
    re.compile(r'\bper\s+(?:litre|liter|acre|hectare|plant|tree|bush|row)\b', re.I),
    re.compile(r'\bpre[\s-]?harvest\b', re.I),
    re.compile(r'\bPHI\b', re.I),
    re.compile(r'\bwaiting\s+(?:period|interval)\b', re.I),
    re.compile(r'\bregistered\s+dose\b', re.I),
    re.compile(r'\blabel\s+dose\b', re.I),
    re.compile(r'\bapplication\s+(?:rate|interval|dose)\b', re.I),
    re.compile(r'\b(?:do(?:se|sage)|spray|spraying|fumigation|application)\s*:', re.I),
    re.compile(r'\bdo\s+not\s+(?:exceed|apply|mix)\b', re.I),
    re.compile(r'\bconcentration\b', re.I),
    re.compile(r'\bactive\s+ingredient\b', re.I),
    re.compile(r'\bregistered\s+under\b', re.I),
)


def is_authoritative(text: str) -> bool:
    """True when `text` carries agronomic instruction we must not machine-translate."""
    return any(pattern.search(text) for pattern in _AUTHORITATIVE_PATTERNS)


def current_language(request=None, user=None) -> str:
    """`Depends()`-friendly wrapper returning just the language code."""
    return language_from_request(request, user)[0]


# ── Provider call ──────────────────────────────────────────────────────────

_SYSTEM_PROMPT = (
    "You are a translator for an Indian agricultural advisory platform. Translate the "
    "user's text into {target}. Preserve every number, unit, chemical name, crop name, "
    "place name, date and technical term exactly as written -- do not convert, expand or "
    "localise them. Return only the translation, with no preamble, no explanation, no "
    "quotation marks and no commentary. If the text is already in {target}, return it "
    "unchanged."
)


@lru_cache(maxsize=4096)
def translate_text(text: str, source_lang: str, target_lang: str) -> str | None:
    """Translate one string, or return `None` so the caller keeps the source.

    `None` is returned -- never `""` -- on every failure path, so a caller can
    never accidentally blank a field.
    """
    if not text or not str(text).strip():
        return None
    if source_lang not in LANGUAGES or target_lang not in LANGUAGES:
        return None
    if source_lang == target_lang:
        return text
    if is_authoritative(text):
        logger.info(
            "translation_skipped_authoritative source=%s target=%s len=%d",
            source_lang, target_lang, len(text),
        )
        return None
    if _client is None:
        logger.warning("translation_unavailable no_api_key")
        return None
    try:
        response = _client.chat.completions.create(
            model=AI_ADVISORY_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT.format(
                    target=LANGUAGE_NAMES.get(target_lang, target_lang))},
                {"role": "user", "content": text},
            ],
            temperature=0,
            max_tokens=2000,
        )
        translated = (response.choices[0].message.content or "").strip()
        if not translated:
            logger.warning(
                "translation_empty_response source=%s target=%s len=%d",
                source_lang, target_lang, len(text),
            )
            return None
        return translated
    except Exception as exc:  # noqa: BLE001 -- must degrade, never break the response
        logger.warning(
            "translation_failed source=%s target=%s error=%s: %s",
            source_lang, target_lang, type(exc).__name__, exc,
        )
        return None


# ── Response shaping ───────────────────────────────────────────────────────

def translate_fields(payload, source_lang: str, target_lang: str, keys) -> dict:
    """Translate the listed string keys of `payload` in place. Returns `payload`.

    Only the named keys are ever touched, so ids, urls, timestamps, status
    codes, confidence values and every other internal technical value pass
    through byte-identical. Each translated field is annotated the way
    `advisories.advisory_payload` already annotates a curated fallback
    (`is_fallback` / `fallback_reason`), so the frontend reads one shape.
    """
    if not isinstance(payload, dict) or source_lang == target_lang:
        return payload
    for key in keys:
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        translated = translate_text(value, source_lang, target_lang)
        if translated is None:
            payload[key] = value
            payload['is_fallback'] = True
            payload['fallback_reason'] = 'authoritative or translation unavailable'
        else:
            payload[key] = translated
            payload['is_fallback'] = False
    payload['language'] = target_lang
    return payload
