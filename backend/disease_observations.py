"""Persistence for image screenings (SIH #1).

`POST /predict` was stateless: a screening existed only in the response. That
blocked expert validation, monitoring, hotspots, and confirmation learning at
once, because none of them have anything to point at. This module records the
screening without changing what the endpoint returns.

Two rules shape everything here.

**Recording is subordinate to screening.** The prediction is the endpoint's
contract. A storage failure must never turn a successful screening into an
error, so `record_screening` swallows database faults, logs them, and reports
that nothing was stored. The response body is byte-for-byte unchanged either
way.

**Only real, owned context is stored.** An unverifiable `farm_id` is rejected
rather than recorded as NULL, because silently discarding context the caller
supplied would attach the screening to the wrong farm -- or to none -- without
telling them.
"""
import hashlib
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models_db import Crop, DiseaseObservation, Farm, User

logger = logging.getLogger(__name__)


def image_digest(data: bytes) -> str:
    """SHA-256 of the exact uploaded bytes inspected by the model."""
    return hashlib.sha256(data).hexdigest()


def resolve_context(
    db: Session,
    user: User,
    farm_id: int | None,
    crop_id: int | None,
) -> tuple[int | None, int | None]:
    """Validate optional farm/crop context against this user's ownership.

    Screening needs no farm context, so ``(None, None)`` is a valid answer. But
    context that *was* supplied must be real and owned, or the record would
    misattribute the screening.

    Returns 404 for someone else's farm rather than 403, matching the existing
    routers: a farm the caller does not own is a farm that does not exist.
    """
    if farm_id is None and crop_id is None:
        return None, None

    if crop_id is not None and farm_id is None:
        raise HTTPException(422, 'A crop requires the farm it belongs to.')

    farm = db.get(Farm, farm_id)
    if not farm or farm.user_id != user.id:
        raise HTTPException(404, 'Farm not found')

    if crop_id is None:
        return farm.id, None

    crop = db.get(Crop, crop_id)
    if not crop or crop.farm_id != farm.id or crop.archived_at is not None:
        raise HTTPException(404, 'Crop not found')
    return farm.id, crop.id


def resolve_position(
    latitude: float | None,
    longitude: float | None,
) -> tuple[float | None, float | None]:
    """Validate an optional capture position.

    Checked here so out-of-range input is a clean 422 rather than a database
    constraint violation surfacing as a 500. A half-supplied coordinate is
    rejected instead of stored: one axis alone locates nothing.

    Never defaulted from the farm's centroid -- a leaf photo may come from any
    corner of a field, so an unknown position stays NULL.
    """
    if latitude is None and longitude is None:
        return None, None
    if latitude is None or longitude is None:
        raise HTTPException(422, 'Provide both latitude and longitude, or neither.')
    if not -90 <= latitude <= 90:
        raise HTTPException(422, 'Latitude must be between -90 and 90.')
    if not -180 <= longitude <= 180:
        raise HTTPException(422, 'Longitude must be between -180 and 180.')
    return latitude, longitude


def record_screening(
    db: Session,
    user: User,
    prediction: dict,
    image_bytes: bytes,
    model_version: str,
    farm_id: int | None = None,
    crop_id: int | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    collection_group_id: str | None = None,
) -> int | None:
    """Store one screening. Returns its id, or ``None`` if it was not stored.

    ``None`` means the screening still succeeded and was still returned to the
    caller -- it simply was not retained. Callers surface that difference rather
    than implying a record exists.
    """
    observation = DiseaseObservation(
        farm_id=farm_id,
        crop_id=crop_id,
        submitted_by=user.id,
        # The private object is attached only after this row exists, so a stored
        # photograph can never exist without an owning observation.
        image_ref=None,
        image_hash=image_digest(image_bytes),
        collection_group_id=collection_group_id,
        model_version=model_version,
        predicted_class=prediction['disease'],
        confidence=prediction['confidence'],
        top_predictions=prediction['top_predictions'],
        screened_at=datetime.now(timezone.utc).replace(tzinfo=None),
        latitude=latitude,
        longitude=longitude,
    )
    try:
        db.add(observation)
        db.commit()
        db.refresh(observation)
    except SQLAlchemyError:
        # The screening itself succeeded. Losing the record is worth a log, not
        # a 500 for work that completed and was already returned to the caller.
        db.rollback()
        logger.exception('Could not persist screening for user %s', user.id)
        return None
    logger.info(
        'Screening stored: id=%s user=%s farm=%s class=%s',
        observation.id, user.id, farm_id, observation.predicted_class,
    )
    return observation.id
