from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models_db import Crop, Farm, PestObservation, User
from pest_surveillance import (
    METHOD_AI_IMAGE_ANALYSIS,
    METHODS,
    UNITS,
    resolve_owned_context,
    serialize,
    source_for,
    validate_measurement,
    validate_method,
    validate_observed_at,
    validate_pest_name,
    validate_position,
)
from schemas import PestObservationIn

router = APIRouter(prefix='/pest', tags=['pest surveillance'])


@router.get('/vocabulary')
def vocabulary(current_user: User = Depends(get_current_user)):
    """The controlled lists the recording form must use.

    Served from the backend so the form cannot drift from what the API accepts.
    Pest names are deliberately absent: there is no curated crop-to-pest
    vocabulary in this project, so the pest is free text recorded as entered.
    """
    return {
        'methods': [
            {'value': value, 'label': label}
            for value, label in METHODS.items()
            if value != METHOD_AI_IMAGE_ANALYSIS
        ],
        'units': [{'value': value, 'label': label} for value, label in UNITS.items()],
        'pest_names': None,
        'pest_name_note': 'Recorded as entered. Not validated against a reference list.',
    }


@router.post('/observations', status_code=201)
def create_observation(
    payload: PestObservationIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Record one real pest observation.

    Everything stored is either supplied by the observer or derived server-side.
    Ownership comes from the authenticated user, and `source` from their role --
    neither is taken from the request body.
    """
    farm, crop = resolve_owned_context(db, current_user, payload.farm_id, payload.crop_id)
    if payload.method == METHOD_AI_IMAGE_ANALYSIS:
        raise HTTPException(422, 'AI image observations are created through crop-health confirmation.')
    observed_at = validate_observed_at(payload.observed_at)
    method, method_detail = validate_method(payload.method, payload.method_detail)
    count, unit = validate_measurement(payload.count, payload.unit)
    pest_name = validate_pest_name(payload.pest_name)
    latitude, longitude = validate_position(payload.latitude, payload.longitude)

    observation = PestObservation(
        farm_id=farm.id,
        crop_id=crop.id if crop else None,
        observer_user_id=current_user.id,
        observed_at=observed_at,
        method=method,
        method_detail=method_detail,
        pest_name=pest_name,
        count=count,
        unit=unit,
        trap_id=(payload.trap_id or '').strip() or None,
        latitude=latitude,
        longitude=longitude,
        notes=(payload.notes or '').strip() or None,
        # No image store exists yet, exactly as with DiseaseObservation.image_ref.
        photo_ref=None,
        source=source_for(current_user),
    )
    db.add(observation)
    db.commit()
    db.refresh(observation)
    return serialize(observation, farm, crop)


@router.get('/observations')
def list_observations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    farm_id: int | None = Query(default=None),
    crop_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """The caller's own observations, newest observation first.

    Scoped to farms the caller owns. A `farm_id` filter is checked for ownership
    so probing another user's farm returns 404 rather than an empty list, which
    would confirm the farm exists.
    """
    if farm_id is not None:
        resolve_owned_context(db, current_user, farm_id, None)

    owned_farm_ids = [row[0] for row in db.query(Farm.id).filter(Farm.user_id == current_user.id).all()]
    if not owned_farm_ids:
        return {'total': 0, 'limit': limit, 'offset': offset, 'observations': []}

    query = db.query(PestObservation).filter(PestObservation.farm_id.in_(owned_farm_ids))
    if farm_id is not None:
        query = query.filter(PestObservation.farm_id == farm_id)
    if crop_id is not None:
        query = query.filter(PestObservation.crop_id == crop_id)

    total = query.count()
    rows = (
        query.order_by(PestObservation.observed_at.desc(), PestObservation.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    farms = {f.id: f for f in db.query(Farm).filter(Farm.id.in_(owned_farm_ids)).all()}
    crop_ids = [r.crop_id for r in rows if r.crop_id]
    crops = {c.id: c for c in db.query(Crop).filter(Crop.id.in_(crop_ids)).all()} if crop_ids else {}

    return {
        'total': total,
        'limit': limit,
        'offset': offset,
        'observations': [
            serialize(row, farms.get(row.farm_id), crops.get(row.crop_id) if row.crop_id else None)
            for row in rows
        ],
    }


@router.get('/observations/{observation_id}')
def get_observation(
    observation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    observation = db.get(PestObservation, observation_id)
    if not observation:
        raise HTTPException(404, 'Observation not found')
    farm = db.get(Farm, observation.farm_id)
    # Ownership is checked through the farm, so another user's observation is
    # indistinguishable from one that does not exist.
    if not farm or farm.user_id != current_user.id:
        raise HTTPException(404, 'Observation not found')
    crop = db.get(Crop, observation.crop_id) if observation.crop_id else None
    return serialize(observation, farm, crop)
