"""The follow-up monitoring API: a farmer's own cases, and what they saw.

Thin by design, like every other router here. Every rule that matters -- what
makes a screening eligible, how `FOLLOW_UP_DUE` is derived, which status moves
are legal, and the refusal to infer a status from what the farmer observed --
lives in `monitoring.py`. This file resolves identity, resolves ownership, and
hands over.

Ownership is `opened_by`, and a case belonging to somebody else is 404, exactly
as in `routers_screenings.py` and `routers_referrals.py`. There is deliberately
**no reviewer scope**: a monitoring case is the farmer's own account of their own
field, and unlike the review queue or the referral register it is not addressed
to anyone. An expert reads evidence through `/validation/observations`, which
strips identity; there is no path to a stranger's monitoring notes here.

Nothing in this router writes to `disease_observations`, `expert_validations`, or
`field_confirmations`. Opening a case does not confirm a prediction, and a
follow-up is not a field confirmation -- `/confirmations` is a separate route
with a separate role gate, and a farmer cannot reach it for their own screening.
"""
from fastapi import APIRouter, Body, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models_db import User
from translation import current_language, translate_fields
from monitoring import (
    MAX_FOLLOW_UP_DAYS,
    MIN_FOLLOW_UP_DAYS,
    MONITORING_NOTE,
    SYMPTOM_CHANGES,
    apply_transition,
    case_detail,
    followup_state,
    library_meta,
    monitorable_screenings,
    open_case,
    owned_case,
    parse_status_filter,
    record_followup,
    visible_cases,
)

router = APIRouter(prefix='/monitoring', tags=['follow-up monitoring'])

MAX_PAGE = 100
MAX_ELIGIBLE = 50


@router.get('/meta')
def monitoring_meta(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The statuses, transitions and symptom vocabulary this unit uses.

    Served so the UI renders the platform's own words for a status rather than
    composing its own, and so a client can build a form without hard-coding a
    list that the check constraints own.
    """
    return library_meta()


@router.get('/eligible')
def eligible_screenings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = Query(default=25, ge=1, le=MAX_ELIGIBLE),
):
    """The caller's screenings that a case could be opened on.

    A screening qualifies when the caller submitted it, it names a farm they
    still own, and it has no case yet. An empty list is a real answer and the UI
    shows an empty state for it -- nothing is generated to fill this.
    """
    items = monitorable_screenings(db, current_user, limit)
    return {
        'total': len(items),
        'limit': limit,
        'items': items,
        'eligibility_rule': (
            'A case opens only from an image screening you submitted, on a farm you '
            'own, that has no case yet. Screenings taken without farm context cannot '
            'be monitored, because a case has to belong to a farm.'
        ),
        'note': MONITORING_NOTE,
    }


@router.get('')
def list_cases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str | None = Query(
        default=None,
        description=(
            'Comma-separated effective statuses, including the derived '
            'FOLLOW_UP_DUE. Blank means all.'
        ),
    ),
    farm_id: int | None = Query(default=None, description='Restrict to one owned farm.'),
    limit: int = Query(default=25, ge=1, le=MAX_PAGE),
    offset: int = Query(default=0, ge=0),
):
    """The caller's own monitoring cases, most recently opened first."""
    statuses = parse_status_filter(status)
    items, total, counts, now = visible_cases(
        db, current_user, statuses, limit, offset, farm_id
    )
    return {
        'scope': 'farmer',
        'filters': {'status': list(statuses), 'farm_id': farm_id},
        'counts_by_status': counts,
        'total_matching': total,
        'limit': limit,
        'offset': offset,
        # The instant every effective_status in this response was derived at.
        # Stated because the derivation is time-dependent and a cached body would
        # otherwise be indistinguishable from a fresh one.
        'as_of': now.isoformat(),
        'items': items,
        'note': MONITORING_NOTE,
    }


@router.post('', status_code=201)
def open_monitoring_case(
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    observation_id: int = Body(..., embed=True, description='A screening you submitted.'),
    summary: str | None = Body(
        default=None, embed=True, description='Optional: what you are watching for.'
    ),
    follow_up_in_days: int | None = Body(
        default=None,
        embed=True,
        description=(
            f'Optional: days until the next check, {MIN_FOLLOW_UP_DAYS}-'
            f'{MAX_FOLLOW_UP_DAYS}. Omit for no due date.'
        ),
    ),
):
    """Open a case on one of the caller's screenings.

    201 for a new case. A second open on the same screening returns **200** with
    the revised existing case rather than a duplicate or a conflict:
    `observation_id` is UNIQUE, and `MonitoringCase` specifies that re-opening
    revises the existing thread instead of forking its history.

    The screening itself is not modified. Its prediction, confidence, and review
    state are exactly what they were -- a case is a decision to look again, and
    the platform does not treat it as agreement with the model.
    """
    case, created = open_case(
        db,
        current_user,
        observation_id,
        summary=summary,
        follow_up_in_days=follow_up_in_days,
    )
    if not created:
        # Revised rather than created, so 201 would be a lie about what happened.
        response.status_code = 200
    return {
        'created': created,
        'case': case_detail(db, case),
        'note': MONITORING_NOTE,
    }


@router.get('/{case_id}')
def get_case(
    request: Request,
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One of the caller's own cases, with its full follow-up history.

    404 for a case somebody else opened, so the existence of another farmer's
    case is never disclosed.
    """
    case = case_detail(db, owned_case(db, current_user, case_id))
    # A follow-up note is the farmer's own account of what they saw. It is
    # reported, not prescribed, so it is translatable; `symptom_change` codes
    # and timestamps are not.
    lang = current_language(request, current_user)
    for followup in case.get('followups', []):
        translate_fields(followup, 'en', lang, ('notes',))
    return {
        'case': case,
        'note': MONITORING_NOTE,
    }


@router.post('/{case_id}/followups', status_code=201)
def create_followup(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    symptom_change: str = Body(
        ..., embed=True, description=f'One of: {", ".join(SYMPTOM_CHANGES)}.'
    ),
    notes: str | None = Body(default=None, embed=True, description='Optional free text.'),
    observed_at: str | None = Body(
        default=None, embed=True, description='ISO 8601. Defaults to now; never future.'
    ),
    next_follow_up_in_days: int | None = Body(
        default=None, embed=True, description='Optional: days until the next check.'
    ),
):
    """Record one check on an owned, active case. Append-only.

    The case moves to FOLLOW_UP_SUBMITTED because a follow-up was submitted, and
    for no other reason. `symptom_change` never drives the status: WORSENED
    escalates nothing and SYMPTOMS_GONE resolves nothing, because deciding a
    problem no longer needs watching is the farmer's own act.

    This is not a field confirmation. It records what the farmer saw in their own
    field, in their own terms, and `evaluation.py` will not read it.
    """
    case = owned_case(db, current_user, case_id)
    followup = record_followup(
        db,
        current_user,
        case,
        symptom_change=symptom_change,
        notes=notes,
        observed_at=observed_at,
        next_follow_up_in_days=next_follow_up_in_days,
    )
    return {
        'followup': followup_state(followup),
        'case': case_detail(db, case),
        'note': MONITORING_NOTE,
    }


@router.patch('/{case_id}')
def change_status(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str = Body(..., embed=True, description='The status to move this case to.'),
):
    """Resolve, close, or reopen one of the caller's own cases.

    FOLLOW_UP_SUBMITTED cannot be set here -- it is what a case becomes when a
    follow-up is recorded, so setting it directly would assert that a field was
    checked with nothing saying what was seen. FOLLOW_UP_DUE cannot be set
    either: it is derived from `due_at` and never stored.

    RESOLVED records that the farmer stopped watching. It is not a claim that a
    treatment worked, and it does not confirm the prediction the case was opened
    on.
    """
    case = apply_transition(db, owned_case(db, current_user, case_id), status)
    return {
        'case': case_detail(db, case),
        'note': MONITORING_NOTE,
    }
