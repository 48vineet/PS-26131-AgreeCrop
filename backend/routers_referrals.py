"""Referral routes: the farmer's request for help, and the receiving side's work.

Thin by design -- every rule lives in `referrals.py`, including who may make which
transition, so the HTTP layer cannot disagree with the domain layer about it.

Identity and role come only from `get_current_user`. `raised_by`, `status`, and
every timestamp are derived server-side, so a body that carries them has no
effect: they are not parameters of these routes.

Two scopes on one collection. A farmer sees referrals on cases they opened; a
reviewing account sees all of them, because it is the side receiving the requests.
Which one applied is reported as `scope` rather than left implicit.

Every response carries `note` (`REFERRAL_NOTE`) and every referral carries a
`meaning` for the status it holds. A referral is a request for help and never
evidence about the crop, and no interface built on this router has to invent the
words for that.
"""
from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from expert_validation import REVIEWER_ROLES, is_reviewer
from models_db import User
from translation import current_language, translate_fields
from referrals import (
    ALL_STATUSES,
    FACILITY_KIND_MEANING,
    FACILITY_KINDS,
    FARMER_TARGETS,
    KIND_MEANING,
    KINDS,
    MIN_REASON_LENGTH,
    REFERRAL_NOTE,
    REVIEWER_TARGETS,
    STATUS_MEANING,
    TRANSITIONS,
    apply_transition,
    create_referral,
    facility_directory,
    facility_of,
    load_referral,
    parse_status_filter,
    referral_state,
    visible_referrals,
)

router = APIRouter(prefix='/referrals', tags=['referrals'])

MAX_PAGE = 100


@router.get('/facilities')
def facilities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    kind: str | None = Query(default=None, description='extension, laboratory, research_institute or directory.'),
    state: str | None = Query(default=None, description='Exact state name as listed, e.g. Maharashtra.'),
):
    """The real facility directory, with the official page that lists each entry.

    Open to any signed-in caller: knowing which offices exist is not privileged,
    and a farmer choosing a destination needs to see the same list the receiving
    side does.

    Every entry cites `source_url`. None carries a telephone number or a street
    address, because the table holds none -- only what an official page states is
    in here, and an invented contact detail would send a farmer to a wrong door.
    Several entries are national directories rather than single offices for the
    same reason.
    """
    items, state_filtered = facility_directory(db, kind, state)
    notes = [
        'Each entry cites the official page that lists it in source_url. No telephone '
        'number or street address is stored, because none could be verified from those '
        'pages; entries of kind "directory" are official listings rather than single '
        'offices.',
        REFERRAL_NOTE,
    ]
    if state_filtered:
        # Said out loud: a state filter silently drops the national listings,
        # which are often a farmer's correct first stop.
        notes.insert(1, (
            'A state filter excludes the national directory entries, which carry no '
            'state because they list the whole country. Search without state to see '
            'them.'
        ))
    return {
        'filters': {'kind': kind, 'state': state},
        'total': len(items),
        'kinds': [
            {'value': value, 'meaning': FACILITY_KIND_MEANING[value]}
            for value in FACILITY_KINDS
        ],
        'items': items,
        'note': ' '.join(notes),
    }


@router.get('')
def list_referrals(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str | None = Query(default=None, description='Comma-separated statuses.'),
    limit: int = Query(default=25, ge=1, le=MAX_PAGE),
    offset: int = Query(default=0, ge=0),
):
    """Referrals visible to the caller, newest first, with counts by status.

    An empty list is a correct answer and the counts will all be zero. Nothing is
    invented to fill the view.
    """
    statuses = parse_status_filter(status)
    items, total, counts, scope = visible_referrals(
        db, current_user, statuses, limit, offset
    )
    reviewer = is_reviewer(current_user)
    return {
        'scope': scope,
        'scope_meaning': (
            'Every referral in the platform, because a reviewing account is the side '
            'that receives them.' if reviewer else
            'Referrals on the monitoring cases you opened.'
        ),
        'filters': {'status': list(statuses)},
        'counts_by_status': counts,
        'total_matching': total,
        'limit': limit,
        'offset': offset,
        # `outcome_notes` is the receiving party's own report, not an
        # instruction -- translatable. Statuses, counts and ids are not.
        'items': [translate_fields(dict(i), 'en', current_language(request, current_user), ('outcome_notes',)) for i in items],
        'status_meanings': {status: STATUS_MEANING[status] for status in ALL_STATUSES},
        'transitions': {status: list(nexts) for status, nexts in TRANSITIONS.items()},
        # What this caller may actually do, so an interface does not offer a
        # control that the server will refuse.
        'your_transitions': list(REVIEWER_TARGETS if reviewer else FARMER_TARGETS),
        'reviewer_roles': list(REVIEWER_ROLES),
        'note': REFERRAL_NOTE,
    }


@router.post('', status_code=201)
def raise_referral(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    case_id: int = Body(..., embed=True),
    kind: str = Body(..., embed=True),
    reason: str = Body(..., embed=True),
    facility_id: int | None = Body(default=None, embed=True),
    facility_note: str | None = Body(default=None, embed=True),
):
    """Record a referral on one of the caller's own monitoring cases.

    404 for a case opened by somebody else, and for a `facility_id` that is not in
    the active directory.

    The new referral is RECOMMENDED: it has been written down, and nobody has been
    asked yet. PATCH it to REQUESTED to ask.
    """
    referral, facility = create_referral(
        db, current_user, case_id, kind, reason, facility_id, facility_note
    )
    return {
        'referral': referral_state(referral, facility),
        'kinds': [{'value': value, 'meaning': KIND_MEANING[value]} for value in KINDS],
        'reason_minimum_characters': MIN_REASON_LENGTH,
        'note': REFERRAL_NOTE,
    }


@router.patch('/{referral_id}')
def change_status(
    request: Request,
    referral_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str = Body(..., embed=True),
    outcome_notes: str | None = Body(default=None, embed=True),
):
    """Move one referral along the workflow.

    404 for a referral the caller cannot act on. 422 for a move the status machine
    does not allow, naming the statuses that are legal from where the referral
    stands. 403 when the move belongs to the other side of the workflow -- a
    farmer asks and withdraws, a reviewing account refers, starts, and finishes --
    and 403 for `outcome_notes` written by anyone but the receiving side.
    """
    referral = load_referral(db, current_user, referral_id)
    referral = apply_transition(db, current_user, referral, status, outcome_notes)
    facility = facility_of(db, referral)
    state = referral_state(referral, facility)
    # Echo the just-written note back in the reader's language, without
    # persisting the translation: the database keeps the reviewer's own words.
    translate_fields(state, 'en', current_language(request, current_user), ('outcome_notes',))
    return {
        'referral': state,
        'note': REFERRAL_NOTE,
    }
