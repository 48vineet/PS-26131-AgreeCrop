"""Reading and withdrawing a screening's photograph (SIH #7).

Two routes and no upload route. Images arrive with `POST /predict`, whose response
is six keys and stays six keys; the orchestrator calls
`image_store.attach_screening_image` from that path. Adding a second way in would
mean an image with no screening attached to it, which nothing in the platform can
use and nobody consented to.

The authorisation is the substance of this file.

**Who may see a photograph.** The farmer who submitted it, and any reviewing
account. A reviewer needs the image because reviewing metadata alone is what the
review queue has been reduced to until now, and `review_context` says so in the
`image.reason` field. Nobody else, including `official` and `admin` accounts:
seeing a dashboard is not seeing into someone's field. Everyone else gets 404, the
same answer this codebase gives for any resource the caller does not own.

**Who may withdraw it.** Only the submitting farmer. A reviewer gets 403 rather
than 404 here, deliberately breaking the ownership convention for one case: the
reviewer can already see through `GET` that the screening exists, so a 404 would
be a lie they can immediately disprove. 403 tells them the truth -- withdrawal is
the farmer's decision, not a reviewer's.

**Absence is not an error.** An unconfigured store, a screening with no image, a
withdrawn consent, and a bucket that will not sign are all 200 with
``available: false`` and a specific reason. The state is normal and permanent on
this deployment, and a client cannot render "we cannot show you this, here is why"
out of a 404.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from expert_validation import is_reviewer
from image_store import (
    DEFAULT_SIGNED_URL_TTL,
    MAX_SIGNED_URL_TTL,
    MIN_SIGNED_URL_TTL,
    screening_image,
    withdraw_image_consent,
)
from models_db import DiseaseObservation, User

router = APIRouter(prefix='/images', tags=['screening images'])


def _owned_or_reviewable(
    db: Session, observation_id: int, user: User
) -> tuple[DiseaseObservation, str]:
    """Resolve one screening for a viewer, or 404.

    Returns the observation and which of the two grounds admitted the caller, so
    the response can state it. Ownership is checked against `submitted_by` only:
    a screening belongs to whoever submitted it, whether or not it names a farm.
    """
    observation = db.get(DiseaseObservation, observation_id)
    if observation is None:
        raise HTTPException(404, 'Screening not found')
    if observation.submitted_by == user.id:
        return observation, 'submitter'
    if is_reviewer(user):
        return observation, 'reviewer'
    raise HTTPException(404, 'Screening not found')


@router.get('/screenings/{observation_id}')
def get_screening_image(
    observation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ttl_seconds: int = Query(
        default=DEFAULT_SIGNED_URL_TTL,
        ge=MIN_SIGNED_URL_TTL,
        le=MAX_SIGNED_URL_TTL,
        description='How long the returned link stays valid, in seconds.',
    ),
):
    """A short-lived signed link to one screening's photograph, or the reason there is none.

    The link is a bearer credential: anyone holding it can fetch the image without
    authenticating, which is why it is minted per request with a short life rather
    than stored anywhere. `ttl_seconds` is bounded by the route, so an oversized
    request is a 422 and never a long-lived public URL.
    """
    observation, viewer = _owned_or_reviewable(db, observation_id, current_user)
    return screening_image(observation, ttl_seconds, viewer)


@router.delete('/screenings/{observation_id}')
def delete_screening_image(
    observation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The submitting farmer withdraws consent for their photograph.

    Idempotent: a second call is a 200 that reports the same state, and the
    recorded deletion time does not move. Safe on a screening that never had a
    stored image -- the withdrawal is still recorded, because it is a statement
    about the farmer's photograph rather than about a file.

    The screening, its prediction, and any review recorded from the image all
    remain. Deleting the evidence a reviewer already examined would not unmake
    their conclusion, and quietly erasing the conclusion would be a worse answer
    than keeping it.
    """
    observation = db.get(DiseaseObservation, observation_id)
    if observation is None:
        raise HTTPException(404, 'Screening not found')
    if observation.submitted_by != current_user.id:
        if is_reviewer(current_user):
            # 403, not 404: this reviewer can already see the screening through
            # GET, so denying its existence would be a lie. Withdrawal belongs to
            # the farmer whose photograph it is.
            raise HTTPException(
                403,
                'Only the farmer who submitted a screening can withdraw consent for '
                'its photograph. Reviewers cannot delete a submitted image.',
            )
        raise HTTPException(404, 'Screening not found')
    return withdraw_image_consent(db, observation)
