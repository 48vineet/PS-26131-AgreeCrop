"""Confirmer-facing routes for field confirmation of image screenings.

Every route here is gated on the server-side role in `users.role`. Nothing in the
request body decides who may confirm: `require_confirmer` reads the column, and
the confirmer recorded against a finding is always the authenticated caller.
`confirmed_by`, `confirmer_role`, `confirmed_at`, and `case_id` are all derived,
and a body that supplies them is not refused -- those keys simply are not
parameters of these routes, so they have no effect.

**Two gates on a write, not one.** The role gate keeps farmers out; it does not
make a confirmation independent. A confirming account can also submit a screening
-- `POST /predict` is open to every signed-in role -- so both write routes also
call `require_independent_confirmer`, which refuses a confirmer whose own
`submitted_by` is on the screening. Without it the role gate could be satisfied
while the circularity it exists to prevent happened anyway: submit a photo, read
the model's guess, record that guess as ground truth.

**Scope.** The register is platform-wide, the same deliberate decision as the
review queue: confirmers do not submit screenings, so a register scoped to their
own farms would always be empty. What bounds the exposure is what each row shows
-- `confirmation_context` and the register rows are built by allow-list and carry
no farmer name, email, phone, account identifier, farm name, or coordinates.

**Confirmers write one thing.** There is no route here that touches a farm, crop,
location, weather record, risk assessment, or observation. A confirmer's only
write is what they found in the field.

**A farmer reads their own.** Not through this router: a farmer sees the
confirmation on their own screening through the existing `/screenings` routes,
which call `field_confirmation.confirmation_state`. Duplicating that read here
under a role gate would either lock farmers out of their own result or weaken the
gate.
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from field_confirmation import (
    AGREEMENT_BASIS,
    ALL_STATES,
    CONFIRMER_ROLES,
    METHOD_MEANING,
    METHODS,
    RECORDABLE_OUTCOMES,
    STATE_MEANING,
    confirmation_context,
    confirmation_for,
    confirmation_register,
    parse_outcome_filter,
    record_confirmation,
    require_confirmer,
    require_independent_confirmer,
    revise_confirmation,
    screening_agreement,
)
from models_db import DiseaseObservation, User

router = APIRouter(prefix='/confirmations', tags=['field confirmation'])

MAX_PAGE = 100


def _confirmer(current: User = Depends(get_current_user)) -> User:
    """Authenticate, then authorise on the stored role. Used by every route."""
    return require_confirmer(current)


def _observation(db: Session, observation_id: int) -> DiseaseObservation:
    observation = db.get(DiseaseObservation, observation_id)
    if observation is None:
        raise HTTPException(404, 'Screening not found')
    return observation


@router.get('')
def register(
    db: Session = Depends(get_db),
    confirmer: User = Depends(_confirmer),
    outcome: str | None = Query(
        default=None,
        description='Comma-separated states. PENDING selects screenings with no confirmation.',
    ),
    limit: int = Query(default=25, ge=1, le=MAX_PAGE),
    offset: int = Query(default=0, ge=0),
):
    """Screenings and the field confirmation each one holds, newest first.

    `counts_by_state` is over every screening rather than the page, so the
    proportion of screenings with no ground truth is visible without a second
    request. `model_agreement` is the only model-evaluation figure this platform
    computes, and it withholds a rate until the sample supports one.
    """
    states = parse_outcome_filter(outcome)
    items, total, counts = confirmation_register(db, states, limit, offset)
    return {
        'scope': 'confirmer',
        'filters': {'outcome': list(states)},
        'counts_by_state': counts,
        'state_meanings': {state: STATE_MEANING[state] for state in ALL_STATES},
        'methods': [{'value': m, 'meaning': METHOD_MEANING[m]} for m in METHODS],
        'confirmer_roles': list(CONFIRMER_ROLES),
        'your_role': confirmer.role,
        'recordable_outcomes': list(RECORDABLE_OUTCOMES),
        'total_matching': total,
        'limit': limit,
        'offset': offset,
        'items': items,
        # Stated at the top level as well as inside `model_agreement`, because the
        # rows themselves carry `agrees_with_screening` and no response that
        # exposes that comparison may leave what it licenses unsaid.
        'agreement_basis': AGREEMENT_BASIS,
        'model_agreement': screening_agreement(db),
        'note': (
            'A screening is a machine-learning prediction from a photograph. Only a '
            'confirmation with outcome CONFIRMED states what the crop actually had.'
        ),
    }


@router.get('/observation/{observation_id}')
def confirmation_detail(
    observation_id: int,
    db: Session = Depends(get_db),
    confirmer: User = Depends(_confirmer),
):
    """The confirmation on one screening, or the PENDING absence of one.

    There is no stored PENDING row. A screening nobody has checked returns state
    PENDING with every field null, which is the absence of ground truth rather
    than a finding about the crop -- and the `meaning` string says so.
    """
    observation = _observation(db, observation_id)
    return confirmation_context(observation, confirmation_for(db, observation_id))


@router.post('/observation/{observation_id}', status_code=201)
def create_confirmation(
    observation_id: int,
    db: Session = Depends(get_db),
    confirmer: User = Depends(_confirmer),
    outcome: str = Body(..., embed=True),
    method: str = Body(..., embed=True),
    evidence_notes: str | None = Body(default=None, embed=True),
    confirmed_condition: str | None = Body(default=None, embed=True),
    source_reference: str | None = Body(default=None, embed=True),
):
    """Record what was actually found on the ground for one screening.

    409 if a confirmation already exists -- ground truth about one screening is
    one fact, so a second confirmer must revise the existing finding rather than
    add a competing one, and the unique constraint means a race cannot produce
    two.

    `confirmed_by`, `confirmer_role`, `confirmed_at`, `case_id`, and
    `agrees_with_screening` are all derived server-side and are not parameters of
    this route, so sending them has no effect.
    """
    observation = _observation(db, observation_id)
    require_independent_confirmer(confirmer, observation)
    confirmation = record_confirmation(
        db, confirmer, observation, outcome, confirmed_condition, method,
        evidence_notes, source_reference,
    )
    return confirmation_context(observation, confirmation)


@router.patch('/observation/{observation_id}')
def revise(
    observation_id: int,
    db: Session = Depends(get_db),
    confirmer: User = Depends(_confirmer),
    outcome: str = Body(..., embed=True),
    method: str = Body(..., embed=True),
    evidence_notes: str | None = Body(default=None, embed=True),
    confirmed_condition: str | None = Body(default=None, embed=True),
    source_reference: str | None = Body(default=None, embed=True),
):
    """Revise the existing finding for one screening.

    404 if there is nothing to revise, so a PATCH cannot quietly become a create
    and bypass the 409 above.

    A full replacement, not a partial patch: `outcome`, `method`, and
    `evidence_notes` are all required again. Changing CONFIRMED to UNCERTAIN has
    to clear the condition, and a partial update that could leave the old
    condition behind would state the contradiction the outcome rules exist to
    prevent.
    """
    observation = _observation(db, observation_id)
    require_independent_confirmer(confirmer, observation)
    confirmation = confirmation_for(db, observation_id)
    if confirmation is None:
        raise HTTPException(
            404,
            'This screening has no field confirmation to revise. Use POST to record '
            'the first one.',
        )
    confirmation = revise_confirmation(
        db, confirmer, observation, confirmation, outcome, confirmed_condition,
        method, evidence_notes, source_reference,
    )
    return confirmation_context(observation, confirmation)
