"""Shared uploaded-image validation for disease and crop-health screening."""

import io
import logging

from fastapi import HTTPException
from PIL import Image, ImageStat

from image_store import validated_image_type

logger = logging.getLogger(__name__)


def validate_image(
    data: bytes,
    content_type: str | None,
    *,
    allow_declared_mime_mismatch: bool = False,
):
    """Decode an upload once and enforce the existing screening constraints."""
    actual_content_type = validated_image_type(
        data,
        content_type,
        require_declared_match=not allow_declared_mime_mismatch,
    )
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a readable image.") from exc
    if min(image.size) < 32:
        raise HTTPException(
            status_code=400,
            detail="Image resolution is too low. Please upload a larger image.",
        )
    mean = sum(ImageStat.Stat(image).mean) / 3
    if mean < 3 or mean > 252:
        logger.warning("Image has extreme brightness: mean=%.1f", mean)
    return image, actual_content_type
