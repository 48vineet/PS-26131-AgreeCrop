"""A farmer's own image screenings, and where each one stands with review.

`POST /predict` retains a screening for a signed-in caller but returns only the
prediction — the response contract is six keys and stays six keys. This is how the
farmer reads back what was kept, and it is the only place they learn whether an
expert has looked at it.

Scoped by `submitted_by`. A screening belongs to whoever submitted it, whether or
not it names a farm, so that column is the whole of the ownership question here.

The wording is the point of this router as much as the data. A screening is a
model's prediction; a review is a human conclusion; neither is a confirmed
disease. `validation.meaning` carries the exact semantics of whatever status a
screening holds, so the UI never has to phrase it itself.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from expert_validation import (
    ALL_STATUSES,
    STATUS_MEANING,
    farmer_claim,
    farmer_screenings,
    parse_status_filter,
    validation_for,
    validation_state,
)
from field_confirmation import confirmation_for, confirmation_state
from image_store import image_accessible, screening_image
from models_db import Crop, DiseaseObservation, Farm, User

router = APIRouter(prefix='/screenings', tags=['image screenings'])

MAX_PAGE = 100


@router.get('')
def list_screenings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str | None = Query(default=None, description='Comma-separated statuses.'),
    limit: int = Query(default=25, ge=1, le=MAX_PAGE),
    offset: int = Query(default=0, ge=0),
):
    """The caller's own screenings, newest first, with their review state."""
    statuses = parse_status_filter(status)
    items, total, counts = farmer_screenings(db, current_user, statuses, limit, offset)
    return {
        'scope': 'farmer',
        'filters': {'status': list(statuses)},
        'counts_by_status': counts,
        'total_matching': total,
        'limit': limit,
        'offset': offset,
        'items': items,
        'status_meanings': {status: STATUS_MEANING[status] for status in ALL_STATUSES},
        'note': (
            'A screening is a machine-learning prediction from a photograph, not a '
            'diagnosis. An expert review records a human conclusion about that '
            'evidence; it is not a laboratory or official confirmation.'
        ),
    }


@router.get('/{observation_id}')
def get_screening(
    observation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One of the caller's own screenings.

    404 for a screening submitted by somebody else, matching every other router:
    a record the caller does not own is a record that does not exist. A reviewer
    reads screenings through `/validation/observations/{id}` instead, which shows
    evidence without identity.

    Carries both downstream evidence streams as their own keys, never merged:
    `validation` is a reviewer's verdict on the photograph, `confirmation_state`
    is what was found on the ground. Each is derived read-only here; a farmer
    reading their own screening cannot record either, and `confirmation_state`
    names the confirmer's role only, never their identity.
    """
    observation = db.get(DiseaseObservation, observation_id)
    if observation is None or observation.submitted_by != current_user.id:
        raise HTTPException(404, 'Screening not found')

    farm = db.get(Farm, observation.farm_id) if observation.farm_id else None
    crop = db.get(Crop, observation.crop_id) if observation.crop_id else None
    validation = validation_for(db, observation.id)
    return {
        'observation_id': observation.id,
        'screened_at': observation.screened_at.isoformat(),
        'farm_id': observation.farm_id,
        'farm_name': farm.farm_name if farm else None,
        'crop_id': observation.crop_id,
        'crop_name': crop.crop_name if crop else None,
        'latitude': observation.latitude,
        'longitude': observation.longitude,
        'image_available': image_accessible(observation),
        'image_sha256': observation.image_hash,
        'image': screening_image(observation, viewer='submitter'),
        'validation': validation_state(validation),
        # Decided once in `farmer_claim`, shared with the farmer's screening list
        # and the /predict response. `predicted_class` and `confidence` are no
        # longer at the top level of a farmer-facing response: until a reviewer
        # records VALIDATED, this screening is a submitted photograph and nothing
        # more. See `claim.condition` for what may be shown.
        'claim': farmer_claim(validation, observation.predicted_class, observation.confidence),
        # Additive, and deliberately a sibling of `validation` rather than folded
        # into it: an expert's verdict on the photograph and what was found in the
        # field are different kinds of claim, and merging them would let one borrow
        # the other's authority. PENDING when nobody has checked -- the absence of
        # ground truth, not a finding about the crop. `predicted_class` is passed so
        # the state can report whether the field agreed with the screening.
        'confirmation_state': confirmation_state(
            confirmation_for(db, observation.id), observation.predicted_class
        ),
    }
