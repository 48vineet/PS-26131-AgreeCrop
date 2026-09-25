"""Photo-first crop-health orchestration endpoints."""

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from auth import get_current_user
from crop_health import (
    PROVIDER_NAME,
    issue_confirmation_token,
    orchestrate,
    read_confirmation_token,
)
from database import get_db
from disease_observations import record_screening, resolve_context, resolve_position
from image_store import attach_screening_image
from image_validation import validate_image
from models_db import Crop, DiseaseObservation, PestObservation, User
from pest_surveillance import (
    METHOD_AI_IMAGE_ANALYSIS,
    SOURCE_AI_IMAGE_ANALYSIS,
    UNIT_VISIBLE_DETECTIONS,
    resolve_owned_context,
    serialize,
    validate_measurement,
    validate_observed_at,
    validate_position,
)
from predict import MODEL_VERSION
from schemas import CropHealthConfirmationIn

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/crop-health', tags=['crop health'])


def _analysis_claims(analysis: dict, user: User, farm_id: int, crop_id: int | None, latitude: float | None, longitude: float | None, screening_id: int | None) -> dict:
    pest = analysis.get('pest')
    return {
        'user_id': user.id,
        'farm_id': farm_id,
        'crop_id': crop_id,
        'latitude': latitude,
        'longitude': longitude,
        'observed_at': datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        'screening_id': screening_id,
        'disease': analysis.get('disease'),
        'provider': analysis.get('provider'),
        'pest': pest,
        'model_metadata': analysis.get('model_metadata'),
    }


@router.post('/analyze')
async def analyze_crop_health(
    file: UploadFile = File(...),
    farm_id: int | None = Form(default=None),
    crop_id: int | None = Form(default=None),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    photo_attempt: int = Form(default=1),
    image_consent_review: str | None = Form(default=None),
    consent_training: str | None = Form(default=None, alias='image_consent_' + 'training'),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Analyze one photo, preserving V1 disease and local pest intelligence separately."""
    if farm_id is None:
        raise HTTPException(422, 'Select a farm before checking crop health.')
    if photo_attempt not in (1, 2):
        raise HTTPException(422, 'Only one closer-photo retry is allowed.')
    image_bytes = await file.read()
    # Some browsers preserve a .jpg filename/MIME declaration for WebP bytes.
    # The shared validator still checks the declared type is allowed, verifies
    # the actual bytes, and returns the actual MIME; only this crop-health path
    # permits the safe declaration mismatch so both models receive the same
    # decoded RGB image.
    image, actual_content_type = validate_image(
        image_bytes,
        file.content_type,
        allow_declared_mime_mismatch=True,
    )
    observation_farm_id, observation_crop_id = resolve_context(db, current_user, farm_id, crop_id)
    capture_latitude, capture_longitude = resolve_position(latitude, longitude)
    crop = db.get(Crop, observation_crop_id) if observation_crop_id is not None else None

    crop_name = crop.crop_name if crop else None
    logger.info(f"DEBUG: routers_crop_health crop_name={crop_name}, crop_id={observation_crop_id}")

    analysis = orchestrate(
        image,
        image_bytes,
        crop_name,
        actual_content_type,
    )

    logger.info(f"DEBUG: routers_crop_health after orchestrate - unsupported_crop={analysis.get('unsupported_crop')}")

    # If crop validation failed, return that error immediately
    if analysis.get("unsupported_crop"):
        logger.info(f"DEBUG: routers_crop_health returning unsupported_crop response")
        return analysis

    screening_id = record_screening(
        db,
        current_user,
        {
            'disease': analysis['disease']['name'],
            'confidence': analysis['disease']['confidence'],
            'top_predictions': analysis['disease']['top_predictions'],
        },
        image_bytes,
        MODEL_VERSION,
        farm_id=observation_farm_id,
        crop_id=observation_crop_id,
        latitude=capture_latitude,
        longitude=capture_longitude,
    )
    image_report = attach_screening_image(
        db,
        screening_id,
        image_bytes,
        actual_content_type,
        consent_review=image_consent_review,
        consent_training=consent_training,
    )
    claims = _analysis_claims(
        analysis,
        current_user,
        observation_farm_id,
        observation_crop_id,
        capture_latitude,
        capture_longitude,
        screening_id,
    )
    confirmation_token = issue_confirmation_token(claims)
    analysis.update(
        {
            'context': {
                'farm_id': observation_farm_id,
                'crop_id': observation_crop_id,
                'crop_name': crop.crop_name if crop else None,
                'latitude': capture_latitude,
                'longitude': capture_longitude,
                'analyzed_at': datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
            },
            'screening_id': screening_id,
            'image_stored': bool(image_report.get('stored')),
            'confirmation_token': confirmation_token,
            'confirmation_available': confirmation_token is not None,
            'provider_source': PROVIDER_NAME,
            'photo_attempt': photo_attempt,
        }
    )
    return analysis


@router.post('/confirm', status_code=201)
def confirm_crop_health(
    payload: CropHealthConfirmationIn,
    confirmation_token: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist only a farmer-confirmed pest result from a signed analysis."""
    if payload.confirmation != 'correct':
        logger.info('crop_health_confirmation user=%s result=%s', current_user.id, payload.confirmation)
        return {
            'status': 'not_persisted',
            'confirmation': payload.confirmation,
            'next_action': payload.correction or payload.confirmation,
            'message': 'No pest observation was created. Use a closer photo or the manual fallback when needed.',
        }
    try:
        claims = read_confirmation_token(confirmation_token)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if claims.get('user_id') != current_user.id:
        raise HTTPException(404, 'Analysis not found')
    farm_id = claims.get('farm_id')
    crop_id = claims.get('crop_id')
    if not isinstance(farm_id, int):
        raise HTTPException(400, 'The analysis has no farm context.')
    farm, crop = resolve_owned_context(db, current_user, farm_id, crop_id if isinstance(crop_id, int) else None)
    pest = claims.get('pest')
    if (
        not isinstance(pest, dict)
        or pest.get('category') != 'pest'
        or pest.get('confidence_bucket') == 'low'
        or not isinstance(pest.get('name'), str)
        or not pest['name'].strip()
    ):
        raise HTTPException(422, 'This image did not produce a confident pest result to confirm.')

    confirmation_id = hashlib.sha256(confirmation_token.encode()).hexdigest()[:32]
    existing = (
        db.query(PestObservation)
        .filter(PestObservation.farm_id == farm.id, PestObservation.method == METHOD_AI_IMAGE_ANALYSIS)
        .all()
    )
    for row in existing:
        if isinstance(row.ai_metadata, dict) and row.ai_metadata.get('confirmation_id') == confirmation_id:
            return {'status': 'already_persisted', 'observation': serialize(row, farm, crop)}

    observed_at = datetime.fromisoformat(str(claims.get('observed_at')))
    observed_at = validate_observed_at(observed_at)
    latitude, longitude = validate_position(claims.get('latitude'), claims.get('longitude'))
    count, unit = validate_measurement(pest.get('count'), UNIT_VISIBLE_DETECTIONS)
    screening = db.get(DiseaseObservation, claims.get('screening_id')) if isinstance(claims.get('screening_id'), int) else None
    metadata = {
        'provider': 'local',
        'model': (claims.get('model_metadata') or {}).get('model'),
        'model_source': (claims.get('model_metadata') or {}).get('model_source'),
        'dataset': (claims.get('model_metadata') or {}).get('dataset'),
        'framework': 'Ultralytics YOLO11',
        'model_version_or_hash': (claims.get('model_metadata') or {}).get('model_version_or_hash') if isinstance(claims.get('model_metadata'), dict) else None,
        'provider_diagnosis_id': None,
        'diagnosis_category': 'pest',
        'confidence': pest.get('confidence'),
        'provider_confidence': pest.get('confidence_percent'),
        'confidence_bucket': pest.get('confidence_bucket'),
        'detection_confidence': pest.get('detection_confidence'),
        'detection_count': count,
        'detection_count_provenance': 'bounding_boxes' if count is not None else None,
        'count_provenance': 'bounding_boxes' if count is not None else None,
        'bounding_boxes': pest.get('bounding_boxes') or [],
        'farmer_confirmed': True,
        'farmer_confirmation': 'correct',
        'confirmation_id': confirmation_id,
        'screening_id': screening.id if screening else None,
        'v1_disease': (claims.get('disease') or {}).get('name') if isinstance(claims.get('disease'), dict) else None,
    }
    observation = PestObservation(
        farm_id=farm.id,
        crop_id=crop.id if crop else None,
        observer_user_id=current_user.id,
        observed_at=observed_at,
        method=METHOD_AI_IMAGE_ANALYSIS,
        method_detail=None,
        pest_name=pest['name'].strip(),
        count=count,
        unit=unit,
        trap_id=None,
        latitude=latitude,
        longitude=longitude,
        notes='AI-assisted pest identification; farmer confirmed the suggested result.',
        photo_ref=screening.image_ref if screening else None,
        source=SOURCE_AI_IMAGE_ANALYSIS,
        ai_metadata=metadata,
    )
    db.add(observation)
    db.commit()
    db.refresh(observation)
    logger.info('crop_health_confirmation user=%s result=correct provider=local model=%s category=pest confidence_bucket=%s', current_user.id, metadata['model'], pest.get('confidence_bucket'))
    return {'status': 'persisted', 'observation': serialize(observation, farm, crop)}
