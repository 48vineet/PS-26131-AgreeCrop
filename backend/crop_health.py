"""Photo-first crop-health orchestration.

The frozen V1 EfficientNet model remains the disease signal. Pest inference is
an independent, local YOLO11 object detector and is never inferred from the
disease prediction.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from typing import Any, Protocol

from PIL import Image

from pest_ai import PestAIInferenceError, PestAIInputError, PestAIUnavailable, get_pest_ai_service
from predict import predict_image

logger = logging.getLogger(__name__)

PROVIDER_NAME = "Local YOLO11s IP102"
PROVIDER_DOCS_URL = "https://huggingface.co/underdogquality/yolo11s-pest-detection"
HIGH_CONFIDENCE = float(os.getenv("CROP_HEALTH_HIGH_CONFIDENCE", "0.80"))
MEDIUM_CONFIDENCE = float(os.getenv("CROP_HEALTH_MEDIUM_CONFIDENCE", "0.45"))
CONFIRMATION_TTL_SECONDS = int(os.getenv("CROP_HEALTH_CONFIRMATION_TTL_SECONDS", "900"))


class PestAnalysisUnavailable(Exception):
    """The local pest model or its runtime dependency is unavailable."""


class PestAnalysisError(Exception):
    """The local pest model failed while analyzing an otherwise valid image."""


class PestAnalyzer(Protocol):
    name: str

    def analyze(self, image: Image.Image | bytes, image_bytes: bytes | None = None) -> dict[str, Any]:
        ...


def confidence_bucket(value: float | None) -> str:
    if value is None or value < MEDIUM_CONFIDENCE:
        return "low"
    if value < HIGH_CONFIDENCE:
        return "medium"
    return "high"


def _normalize_pest(candidate: dict[str, Any]) -> dict[str, Any]:
    confidence = candidate.get("confidence")
    if isinstance(confidence, (int, float)) and not isinstance(confidence, bool):
        confidence = max(0.0, min(1.0, float(confidence)))
    else:
        confidence = None
    return {
        "category": "pest",
        "name": str(candidate.get("name", "")).strip(),
        "confidence": confidence,
        "confidence_percent": round(confidence * 100, 2) if confidence is not None else None,
        "confidence_bucket": confidence_bucket(confidence),
        "count": candidate.get("count") if isinstance(candidate.get("count"), int) and not isinstance(candidate.get("count"), bool) else None,
        "detection_confidence": confidence,
        "provider_diagnosis_id": None,
        "bounding_boxes": candidate.get("bounding_boxes") or [],
    }


def _pest_result(analyzer: PestAnalyzer, image: Image.Image, image_bytes: bytes) -> tuple[str, dict[str, Any], str | None]:
    # Try to get metadata upfront, even if model is unavailable
    metadata = {}
    try:
        if hasattr(analyzer, 'metadata') and callable(analyzer.metadata):
            metadata = analyzer.metadata()
    except Exception:
        pass

    try:
        result = analyzer.analyze(image, image_bytes)
        if not isinstance(result, dict):
            raise PestAnalysisError("local pest model returned an invalid result")
        # Ensure result includes metadata
        if "model_metadata" not in result and metadata:
            result["model_metadata"] = metadata
        return "success", result, None
    except (PestAnalysisUnavailable, PestAIUnavailable) as exc:
        logger.info("pest_ai_unavailable reason=%s", exc)
        # Include model metadata even when unavailable, so client knows which model was attempted
        return "unavailable", {"model_metadata": metadata}, str(exc)
    except (PestAnalysisError, PestAIInferenceError, PestAIInputError) as exc:
        logger.warning("pest_ai_error reason=%s", exc)
        # Include model metadata even when error occurs
        return "error", {"model_metadata": metadata}, str(exc)
    except Exception:
        logger.exception("pest_ai_unexpected_error")
        return "error", {}, "local pest analysis failed"


def orchestrate(
    image: Image.Image,
    image_bytes: bytes,
    crop_name: str | None,
    content_type: str | None,
    pest_service: PestAnalyzer | None = None,
) -> dict[str, Any]:
    """Run V1 disease inference and local pest detection independently."""
    del content_type  # Context is retained by the route and token.
    disease_result = predict_image(image, crop_context=crop_name)

    # If crop validation failed, return that error immediately
    if disease_result.get("unsupported_crop"):
        return disease_result

    analyzer = pest_service or get_pest_ai_service(crop_name)
    status, pest_result, pest_error = _pest_result(analyzer, image, image_bytes)

    raw_candidates = pest_result.get("pests", [])
    if not isinstance(raw_candidates, list):
        raw_candidates = []
    candidates = [
        _normalize_pest(item)
        for item in raw_candidates
        if isinstance(item, dict) and str(item.get("name", "")).strip()
    ]
    primary_raw = pest_result.get("pest")
    primary = _normalize_pest(primary_raw) if isinstance(primary_raw, dict) else (candidates[0] if candidates else None)
    if primary and not candidates:
        candidates = [primary]

    disease = {
        "name": disease_result["disease"],
        "confidence": disease_result["confidence"],
        "top_predictions": disease_result["top_predictions"],
        "source": "V1_EFFICIENTNETB0",
    }
    relevant = disease_result["confidence"] >= MEDIUM_CONFIDENCE * 100
    raw_count = pest_result.get("raw_detection_count", 0)
    if not isinstance(raw_count, int):
        raw_count = 0

    if status != "success":
        pest_status = status
        message = "AI pest analysis is temporarily unavailable. You can record an observation manually."
    elif primary is not None:
        pest_status = "detected" if primary["confidence_bucket"] != "low" else "uncertain"
        message = (
            "AI could not confidently identify the pest. Take one closer photo of the pest or affected area."
            if pest_status == "uncertain"
            else None
        )
    elif raw_count > 0:
        pest_status = "uncertain"
        message = "Take one closer photo of the pest or affected area."
    else:
        pest_status = "not_detected"
        message = "No reliable pest detected from this photo."

    logger.info(
        "crop_health_analysis provider=%s status=%s disease_confidence_bucket=%s pest_confidence_bucket=%s",
        PROVIDER_NAME,
        status,
        confidence_bucket(disease_result["confidence"] / 100),
        confidence_bucket(primary["confidence"] if primary else None),
    )
    return {
        "provider": {
            "name": PROVIDER_NAME,
            "status": status,
            "error": pest_error,
            "documentation_url": PROVIDER_DOCS_URL,
        },
        "disease": disease,
        "pest": primary,
        "pest_status": pest_status,
        "pest_surveillance_relevant": relevant,
        "additional_evidence_required": bool(
            relevant and (primary is None or pest_status == "uncertain")
        ),
        "additional_evidence_message": message,
        "nutrient": None,
        "diagnoses": candidates,
        "raw_detection_count": raw_count,
        "model_metadata": pest_result.get("model_metadata") or {},
        "limitations": (
            "AI-assisted pest identification depends on supported IP102 classes and image quality. "
            "AI-detected count is the number of accepted bounding boxes in this image, not a calibrated field infestation measurement."
        ),
    }


def _secret() -> bytes | None:
    value = os.getenv("CROP_HEALTH_CONFIRMATION_SECRET") or os.getenv("SUPABASE_JWT_SECRET")
    return value.encode() if value else None


def issue_confirmation_token(claims: dict) -> str | None:
    secret = _secret()
    if not secret:
        return None
    payload = dict(claims)
    payload["exp"] = int(time.time()) + CONFIRMATION_TTL_SECONDS
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    ).rstrip(b"=")
    signature = hmac.new(secret, encoded, hashlib.sha256).digest()
    return encoded.decode() + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def read_confirmation_token(token: str) -> dict:
    secret = _secret()
    if not secret or not isinstance(token, str) or "." not in token:
        raise ValueError("confirmation is unavailable")
    encoded, supplied = token.split(".", 1)
    expected = base64.urlsafe_b64encode(
        hmac.new(secret, encoded.encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    if not hmac.compare_digest(expected, supplied):
        raise ValueError("invalid confirmation")
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded + "===").decode())
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("invalid confirmation") from exc
    if not isinstance(payload, dict) or int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("confirmation expired")
    return payload
