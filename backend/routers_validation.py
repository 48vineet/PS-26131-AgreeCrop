"""Reviewer-facing routes for expert validation of image screenings.

Every route here is gated on the server-side role in `users.role`. Nothing in the
request body or the JWT decides who may review: `require_reviewer` reads the
column, and the reviewer recorded against a conclusion is always the
authenticated caller.

**Scope.** The review queue is platform-wide, and that is a deliberate
authorisation decision rather than an oversight. Reviewers do not submit
screenings, so a queue scoped to a reviewer's own farms would always be empty and
the capability would not exist. What bounds the exposure is *what* is shown, not
how much: `review_context` is built by allow-list and carries no farmer name,
email, phone, account identifier, farm name, or coordinates. The reasoning, and
what would change under a regional assignment model, is in
backend/docs/EXPERT_VALIDATION.md.

**Reviewers read screenings; they never write farm data.** There is no route here
that touches a farm, crop, location, weather record, risk assessment, or pest
observation. A reviewer's only write is their own conclusion.
"""
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from expert_validation import (
    ALL_STATUSES,
    RECORDABLE_STATUSES,
    REVIEWER_ROLES,
    STATUS_MEANING,
    parse_status_filter,
    record_validation,
    require_reviewer,
    review_context,
    review_queue,
    revise_validation,
    validation_for,
)
from image_store import screening_image
from models_db import DiseaseObservation, User
from translation import current_language, translate_fields

router = APIRouter(prefix='/validation', tags=['expert validation'])

MAX_PAGE = 100

# A reviewer's `notes` explain a verdict, they never prescribe a treatment, so
# they are translatable. Status values, `agrees_with_model`, the validated
# class and reviewer ids are internal and stay untouched.
REVIEW_TEXT_FIELDS = ('notes',)


def _reviewer(current: User = Depends(get_current_user)) -> User:
    """Authenticate, then authorise on the stored role. Used by every route."""
    return require_reviewer(current)


def _observation(db: Session, observation_id: int) -> DiseaseObservation:
    observation = db.get(DiseaseObservation, observation_id)
    if observation is None:
        raise HTTPException(404, 'Screening not found')
    return observation


def _review_detail(db: Session, observation: DiseaseObservation, validation, lang: str = 'en') -> dict:
    """Reviewer detail with a freshly signed image link when one may be shown."""
    detail = review_context(db, observation, validation)
    image = screening_image(observation, viewer='reviewer')
    # Keep the established `sha256` field and add the signed-link lifecycle.
    image['sha256'] = image.pop('image_sha256')
    detail['image'] = image
    return translate_fields(detail, 'en', lang, REVIEW_TEXT_FIELDS)


@router.get('/meta')
def meta(reviewer: User = Depends(_reviewer)):
    """The status vocabulary and its meanings, so the UI never invents wording."""
    return {
        'statuses': [
            {
                'value': status,
                'meaning': STATUS_MEANING[status],
                'recordable': status in RECORDABLE_STATUSES,
            }
            for status in ALL_STATUSES
        ],
        'reviewer_roles': list(REVIEWER_ROLES),
        'your_role': reviewer.role,
        'scope': 'platform-wide review queue; farmer identity is not disclosed',
    }


@router.get('/observations')
def queue(
    db: Session = Depends(get_db),
    reviewer: User = Depends(_reviewer),
    status: str | None = Query(default=None, description='Comma-separated statuses.'),
    crop: str | None = Query(default=None, description='Exact crop name, case-insensitive.'),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=MAX_PAGE),
    offset: int = Query(default=0, ge=0),
):
    """The review queue: screenings and the review state each one holds.

    `status` accepts `PENDING` even though it is never stored — it selects
    screenings with no review, which is what a reviewer most often wants.
    """
    if since is not None and until is not None and since > until:
        raise HTTPException(422, 'The start of the range is after its end.')
    statuses = parse_status_filter(status)
    items, total, counts = review_queue(db, statuses, crop, since, until, limit, offset)
    return {
        'scope': 'reviewer',
        'filters': {
            'status': list(statuses),
            'crop': crop,
            'since': since.isoformat() if since else None,
            'until': until.isoformat() if until else None,
        },
        'counts_by_status': counts,
        'total_matching': total,
        'limit': limit,
        'offset': offset,
        'items': items,
        'note': (
            'A screening is a machine-learning prediction from a photograph. '
            'Reviewing it records a human conclusion; it does not confirm a disease.'
        ),
    }


@router.get('/observations/{observation_id}')
def observation_detail(
    request: Request,
    observation_id: int,
    db: Session = Depends(get_db),
    reviewer: User = Depends(_reviewer),
):
    """Everything a reviewer may see about one screening, and its review state."""
    observation = _observation(db, observation_id)
    return _review_detail(db, observation, validation_for(db, observation_id), current_language(request, reviewer))


@router.post('/observations/{observation_id}', status_code=201)
def create_review(
    request: Request,
    observation_id: int,
    db: Session = Depends(get_db),
    reviewer: User = Depends(_reviewer),
    status: str = Body(..., embed=True),
    validated_class: str | None = Body(default=None, embed=True),
    review_notes: str | None = Body(default=None, embed=True),
):
    """Record a first conclusion about one screening.

    409 if a conclusion already exists — a second reviewer must revise the
    existing one rather than silently overwrite it, so the queue cannot lose a
    verdict to a race.

    `reviewer_id`, `reviewer_role`, `agrees_with_model`, and `reviewed_at` are all
    derived server-side and are ignored if sent.
    """
    observation = _observation(db, observation_id)
    validation = record_validation(
        db, reviewer, observation, status, validated_class, review_notes
    )
    return _review_detail(db, observation, validation, current_language(request, reviewer))


@router.patch('/observations/{observation_id}')
def revise_review(
    request: Request,
    observation_id: int,
    db: Session = Depends(get_db),
    reviewer: User = Depends(_reviewer),
    status: str = Body(..., embed=True),
    validated_class: str | None = Body(default=None, embed=True),
    review_notes: str | None = Body(default=None, embed=True),
):
    """Revise the existing conclusion about one screening.

    404 if there is nothing to revise, so a PATCH cannot quietly become a create
    and bypass the 409 above.
    """
    observation = _observation(db, observation_id)
    validation = validation_for(db, observation_id)
    if validation is None:
        raise HTTPException(
            404,
            'This screening has no review to revise. Use POST to record the first one.',
        )
    validation = revise_validation(
        db, reviewer, observation, validation, status, validated_class, review_notes
    )
    return _review_detail(db, observation, validation, current_language(request, reviewer))
