"""AI-generated disease guidance for screenings the curated advisory library does not cover.

`advisories.py` deliberately never composes or generates agronomic advice: every
sentence it serves traces to a curated, cited row, and it says so in its own
`claim` field. That guarantee is not touched here. This module is a separate
fallback that `routers_advisories.py` calls only after `advisories.py` has
already reported `no_match_reason` -- i.e. only when there is nothing curated to
show. Its output is never merged into the curated shape: it comes back under its
own `ai_fallback` key, always carries `ai_generated: true`, and always carries a
disclaimer distinct from `SCREENING_DISCLAIMER`.

The one failure mode the curated system exists to prevent -- a wrong dose of a
real chemical -- is blocked at the prompt level: the model is instructed to never
name a specific pesticide, active ingredient, brand, or dose, and to point to a
local extension officer for chemical control instead. This is the same
escalation this platform already asks farmers to make for curated chemical
advisories (see `SAFETY_STATEMENTS` in advisories.py); the AI path adds it
because it has no other way to guarantee dosing safety.
"""
from __future__ import annotations

import json
import logging
import os

from openai import OpenAI

logger = logging.getLogger(__name__)

TOKEN_ROUTER_API_KEY = os.getenv("TOKEN_ROUTER_API_KEY", "")
TOKEN_ROUTER_BASE_URL = os.getenv(
    "TOKEN_ROUTER_BASE_URL", "https://api.groq.com/openai/v1")
AI_ADVISORY_MODEL = os.getenv("AI_ADVISORY_MODEL", "openai/gpt-oss-120b")

_client = (
    OpenAI(base_url=TOKEN_ROUTER_BASE_URL, api_key=TOKEN_ROUTER_API_KEY)
    if TOKEN_ROUTER_API_KEY
    else None
)

LANGUAGE_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi"}

AI_ADVISORY_DISCLAIMER = {
    "en": (
        "AI-generated guidance, not a curated advisory. It has no named source, no "
        "citation, and has not been reviewed by an agricultural authority. It is shown "
        "only because this platform holds no sourced advisory for this crop or "
        "condition yet. Confirm with your Krishi Vigyan Kendra (KVK) or state "
        "extension officer before acting on it, and before using any chemical control."
    ),
    "hi": (
        "यह एआई-जनित सुझाव है, कोई सत्यापित सलाह नहीं। इसका कोई स्रोत या उद्धरण नहीं है और "
        "किसी कृषि प्राधिकरण ने इसकी समीक्षा नहीं की है। यह इसलिए दिखाया गया है क्योंकि इस फसल या "
        "स्थिति के लिए अभी कोई सोर्स्ड सलाह उपलब्ध नहीं है। इस पर कार्रवाई करने से पहले, और किसी भी "
        "रासायनिक उपचार का उपयोग करने से पहले, अपने कृषि विज्ञान केंद्र (KVK) या राज्य विस्तार "
        "अधिकारी से पुष्टि करें।"
    ),
    "mr": (
        "ही एआय-निर्मित माहिती आहे, पडताळणी केलेली सल्ला नाही. याला कोणताही स्रोत किंवा संदर्भ नाही "
        "आणि कोणत्याही कृषी प्राधिकरणाने याचे पुनरावलोकन केलेले नाही. या पिकासाठी किंवा स्थितीसाठी अजून "
        "कोणतीही स्रोत असलेली सल्ला उपलब्ध नसल्यामुळे हे दाखवले जात आहे. यावर कृती करण्यापूर्वी, आणि "
        "कोणत्याही रासायनिक उपचारापूर्वी, आपल्या कृषी विज्ञान केंद्राशी (KVK) किंवा राज्य विस्तार "
        "अधिकाऱ्याशी संपर्क साधा."
    ),
}

_PROMPT_TEMPLATE = """You are giving general information to an Indian smallholder farmer about a crop health condition an ML model has screened for in a photo. You are not a certified agronomist and this is not a confirmed diagnosis -- it is a screening guess, and you must not write as if it were more certain than that.

Crop: {crop}
Screened condition: {condition}

Respond with ONLY a JSON object in exactly this shape, written in {language_name}:
{{
  "summary": "one or two sentences on what this condition generally is",
  "symptoms_to_check": ["short phrase", "..."],
  "non_chemical_steps": ["short, actionable step", "..."],
  "cultural_practices": ["short, actionable step", "..."],
  "when_to_seek_help": "one sentence on when to escalate to an expert"
}}

Rules, no exceptions:
- Never name a specific pesticide, fungicide, brand, active ingredient, dose, or concentration. If chemical control is relevant, say only that chemical options exist and must be chosen and dosed by a local extension officer or licensed agronomist -- never propose one yourself.
- Never claim certainty. This is general information about a screened condition, not a verified diagnosis for this farmer's specific field.
- Keep every list item under 20 words. Keep symptoms_to_check, non_chemical_steps, and cultural_practices each to at most 4 items.
- Output valid JSON only -- no markdown fences, no commentary outside the JSON object."""


def _build_prompt(crop: str | None, condition: str | None, language: str) -> str:
    return _PROMPT_TEMPLATE.format(
        crop=crop or "an unspecified crop",
        condition=condition or "an unspecified condition",
        language_name=LANGUAGE_NAMES.get(language, "English"),
    )


def _parse_json_response(raw: str) -> dict | None:
    """Returns None on anything that isn't a usable answer, instead of a
    placeholder dict -- `generate_fallback_guidance` treats None as a failure.
    AI_ADVISORY_MODEL is a reasoning model that can spend its whole token
    budget thinking and leave nothing (or a mid-sentence fragment) in `raw`;
    showing that fragment as if it were the answer is worse than saying the
    attempt failed.
    """
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    guidance = {
        "summary": data.get("summary") or "",
        "symptoms_to_check": data.get("symptoms_to_check") or [],
        "non_chemical_steps": data.get("non_chemical_steps") or [],
        "cultural_practices": data.get("cultural_practices") or [],
        "when_to_seek_help": data.get("when_to_seek_help") or "",
    }
    has_content = guidance["summary"] or any(
        guidance[key] for key in ("symptoms_to_check", "non_chemical_steps", "cultural_practices")
    )
    return guidance if has_content else None


# Keyed by (crop, condition, language), not by observation: the same screened
# condition should not re-prompt the model every time a farmer reopens the same
# result. Resets on restart -- this is a fallback, not a system of record, so
# that's an acceptable cost for not re-billing every page reload.
_cache: dict[tuple[str, str, str], dict] = {}


def generate_fallback_guidance(
    crop: str | None,
    condition: str | None,
    language: str = "en",
) -> dict:
    """AI-generated guidance for a crop/condition the curated library has no advisory for.

    Never raises: any failure -- missing API key, network error, bad response --
    degrades to `available: false` with a plain-language reason, because this is a
    fallback layered on top of a screening result that has already succeeded.
    """
    disclaimer = AI_ADVISORY_DISCLAIMER.get(
        language, AI_ADVISORY_DISCLAIMER["en"])
    key = ((crop or "").strip().lower(),
           (condition or "").strip().lower(), language)

    if key in _cache:
        return _cache[key]

    if _client is None:
        return {
            "ai_generated": True,
            "available": False,
            "reason": "AI guidance is not configured on this server.",
            "disclaimer": disclaimer,
        }

    unavailable = {
        "ai_generated": True,
        "available": False,
        "reason": "AI guidance could not be generated right now. Try again shortly.",
        "disclaimer": disclaimer,
    }

    # AI_ADVISORY_MODEL's free tier is observed to intermittently return a
    # zero-token completion (HTTP 200, no error, nothing generated) under load,
    # unrelated to prompt or token budget -- confirmed by immediately repeating
    # an identical request and getting a full answer on one attempt and empty
    # replies on the next two. One retry recovers most of these for free: it
    # only costs extra latency in the case that would otherwise fail anyway.
    for attempt in range(2):
        try:
            response = _client.chat.completions.create(
                model=AI_ADVISORY_MODEL,
                messages=[{"role": "user", "content": _build_prompt(
                    crop, condition, language)}],
                temperature=0.3,
                max_tokens=3000,
            )
            choice = response.choices[0]
            raw = choice.message.content or ""
            guidance = _parse_json_response(raw)
            if guidance is None:
                logger.warning(
                    "ai_advisory_empty_response crop=%s condition=%s attempt=%d finish_reason=%s raw_len=%d",
                    crop, condition, attempt, choice.finish_reason, len(raw),
                )
                continue
            result = {
                "ai_generated": True,
                "available": True,
                "crop": crop,
                "condition": condition,
                "model": AI_ADVISORY_MODEL,
                "guidance": guidance,
                "disclaimer": disclaimer,
            }
            _cache[key] = result
            return result
        except Exception as exc:  # noqa: BLE001 -- must degrade, never break the screening response
            logger.warning(
                "ai_advisory_generation_failed crop=%s condition=%s attempt=%d error=%s: %s",
                crop, condition, attempt, type(exc).__name__, exc,
            )

    return unavailable
