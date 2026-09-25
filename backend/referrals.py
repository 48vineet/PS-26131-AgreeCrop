"""Extension and laboratory referrals (SIH: referral workflow).

A referral is a *request for help* on an open monitoring case. It is never
evidence about the crop. Nothing in this module records what a crop has, and no
referral status -- not REFERRED, not COMPLETED -- says anything about the plant.
A referred case is not a confirmed case: the only ground truth in this platform
is a `field_confirmations` row whose outcome is CONFIRMED, and a referral cannot
produce one. `REFERRAL_NOTE` states that on every response, and every status
carries a `meaning` string so no interface has to phrase it.

Two sides, one row
------------------

The workflow has a requesting side and a receiving side, and they are different
people with different powers:

* the **farmer who opened the case** records a referral (`RECOMMENDED`), asks for
  it (`REQUESTED`), and may withdraw it at any point before it closes;
* a **reviewing account** (`expert` / `extension_officer`) is the receiving side:
  it passes the request on (`REFERRED`), starts work (`IN_PROGRESS`), finishes
  (`COMPLETED`), and is the only side that may write `outcome_notes`.

A farmer reaching for a receiving-side transition gets 403 with a plain reason
rather than a silent no-op, because the button they pressed is somebody else's.

Why the status machine is a constant
------------------------------------

`TRANSITIONS` is the whole of the legality rule and it is exported, so the tests
and any interface read the same map the writer enforces. Anything not in it is
refused with 422 naming the states that *are* legal from where the referral
stands -- a farmer told only "invalid" learns nothing.

`RECOMMENDED` appears as no target: nothing moves back into it. A referral starts
there and only ever leaves.

Timestamps
----------

`referrals` carries four timestamp columns -- requested_at, referred_at,
completed_at, cancelled_at -- and `TRANSITION_STAMP` maps each arrival to the one
it stamps. `IN_PROGRESS` maps to None because the table has no column for it;
adding one is not this unit's call, and `updated_at` already records when the row
last moved. The map says so explicitly rather than leaving a reader to wonder
whether a stamp was forgotten.

The facility directory
----------------------

`facilities` holds only officially-listed offices, laboratories and institutes,
each citing the page that lists it, and several rows are national *directories*
rather than single offices because that is all that can be verified. This module
reads that table and never writes it. `facility_id` is optional because a farmer
may be referred before a destination is picked, and because the directory is
deliberately incomplete -- `facility_note` carries a destination the directory
does not list.
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from expert_validation import REVIEWER_ROLES, is_reviewer
from models_db import Facility, MonitoringCase, Referral, User

logger = logging.getLogger(__name__)

# --- Statuses -------------------------------------------------------------
STATUS_RECOMMENDED = 'RECOMMENDED'
STATUS_REQUESTED = 'REQUESTED'
STATUS_REFERRED = 'REFERRED'
STATUS_IN_PROGRESS = 'IN_PROGRESS'
STATUS_COMPLETED = 'COMPLETED'
STATUS_CANCELLED = 'CANCELLED'

ALL_STATUSES = (
    STATUS_RECOMMENDED,
    STATUS_REQUESTED,
    STATUS_REFERRED,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
    STATUS_CANCELLED,
)

# The only legal moves. A referral may always be abandoned before it closes,
# which is why CANCELLED is reachable from every open state; the two closed
# states are terminal, because a closed request that could be reopened would let
# the receiving side's record be rewritten after the fact.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    STATUS_RECOMMENDED: (STATUS_REQUESTED, STATUS_CANCELLED),
    STATUS_REQUESTED: (STATUS_REFERRED, STATUS_CANCELLED),
    STATUS_REFERRED: (STATUS_IN_PROGRESS, STATUS_CANCELLED),
    STATUS_IN_PROGRESS: (STATUS_COMPLETED, STATUS_CANCELLED),
    STATUS_COMPLETED: (),
    STATUS_CANCELLED: (),
}

TERMINAL_STATUSES = tuple(s for s, nexts in TRANSITIONS.items() if not nexts)

# Which timestamp column each arrival stamps. IN_PROGRESS has no column in the
# table (see the module docstring) and is mapped to None so this map stays
# complete and the absence reads as deliberate rather than as an oversight.
TRANSITION_STAMP: dict[str, str | None] = {
    STATUS_REQUESTED: 'requested_at',
    STATUS_REFERRED: 'referred_at',
    STATUS_IN_PROGRESS: None,
    STATUS_COMPLETED: 'completed_at',
    STATUS_CANCELLED: 'cancelled_at',
}

# Who may drive the row to a given status. Split by side of the workflow, not by
# convenience: asking for help is the farmer's act and can only be theirs, and
# accepting, starting and finishing the work belongs to whoever received it.
# Both sides may close a request that is going nowhere -- a farmer withdraws, and
# a receiving office that cannot take the case declines. Leaving a referral stuck
# open would have the interface imply somebody is working when nobody is.
FARMER_TARGETS = (STATUS_REQUESTED, STATUS_CANCELLED)
REVIEWER_TARGETS = (
    STATUS_REFERRED,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
    STATUS_CANCELLED,
)

STATUS_MEANING = {
    STATUS_RECOMMENDED: (
        'Recorded as worth asking about. Nobody has been asked yet, and this says '
        'nothing about what the crop has.'
    ),
    STATUS_REQUESTED: (
        'The farmer has asked for help on this case. No office or laboratory has '
        'taken it up yet.'
    ),
    STATUS_REFERRED: (
        'The request has been passed to the destination named on it. Work there has '
        'not started, and being passed on is not a finding about the crop.'
    ),
    STATUS_IN_PROGRESS: (
        'Someone on the receiving side has started looking at this case. What they '
        'find, if anything, is theirs to state -- this platform does not hold it.'
    ),
    STATUS_COMPLETED: (
        'The receiving side has finished with this request. Any outcome_notes are '
        'their own words about their own work; the case they looked at is still an '
        'unconfirmed case in this platform.'
    ),
    STATUS_CANCELLED: (
        'The request was withdrawn by the farmer or declined by the receiving side '
        'before it was finished. No work is expected on it.'
    ),
}

# --- Kinds ----------------------------------------------------------------
# Matches the ck_referral_kind check constraint on the table.
KIND_EXTENSION = 'extension'
KIND_LABORATORY = 'laboratory'
KINDS = (KIND_EXTENSION, KIND_LABORATORY)

KIND_MEANING = {
    KIND_EXTENSION: (
        'A request to an agricultural extension office -- a KVK, a CIPMC, or a state '
        'department office -- for a field visit or advice.'
    ),
    KIND_LABORATORY: (
        'A request to a laboratory to test a sample the farmer sends or hands over.'
    ),
}

# The facility table's own kinds (ck_facility_kind). Listed here only so the
# directory endpoint can validate a filter and explain what a row is.
FACILITY_KINDS = ('extension', 'laboratory', 'research_institute', 'directory')

FACILITY_KIND_MEANING = {
    'extension': 'An officially listed extension office or extension programme.',
    'laboratory': 'An officially listed testing laboratory or plant health clinic.',
    'research_institute': 'A national or state agricultural research institute.',
    'directory': (
        'An official directory page rather than a single office. Where only the '
        'national or state listing could be verified, the listing itself is the '
        'entry: the district office behind it is real, but this platform will not '
        'invent its name, address, or telephone number.'
    ),
}

# Stated at the top level of every response this unit produces.
REFERRAL_NOTE = (
    'A referral is a request for help, not evidence about the crop. A referred case '
    'is not a confirmed case: only a field confirmation recorded as CONFIRMED states '
    'what a crop actually had, and no referral status -- including COMPLETED -- '
    'changes that.'
)

MIN_REASON_LENGTH = 10          # matches ck_referral_reason_required
MAX_REASON_LENGTH = 2000
MAX_FACILITY_NOTE_LENGTH = 250  # matches the column width
MAX_OUTCOME_NOTES_LENGTH = 2000


def _now() -> datetime:
    """Naive UTC, matching every DateTime column in this schema."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --- Ownership ------------------------------------------------------------

def owned_case(db: Session, user: User, case_id: int) -> MonitoringCase:
    """The caller's own monitoring case, or 404.

    The ownership check is duplicated here rather than imported from the
    monitoring module, deliberately: the two units are written in parallel, and
    referrals must not be blocked by -- or silently re-scoped by -- a helper this
    unit does not own. The rule is one column: a case belongs to whoever opened
    it. If monitoring later grows a sharing model, this is the second place that
    has to change, and that cost is accepted in exchange for the two units being
    independently testable.

    404 rather than 403 for a case belonging to somebody else, matching every
    other router: a record the caller does not own is a record that does not
    exist.
    """
    case = db.get(MonitoringCase, case_id)
    if case is None or case.opened_by != user.id:
        raise HTTPException(
            404,
            'Monitoring case not found. A referral can only be raised on a case you '
            'opened.',
        )
    return case


def load_referral(db: Session, user: User, referral_id: int) -> Referral:
    """One referral the caller is entitled to act on, or 404.

    A reviewing account reaches any referral, because it is the receiving side of
    this workflow and the request is addressed to it. A farmer reaches only
    referrals on cases they opened; anything else is 404, so the existence of
    another farmer's referral is never disclosed.
    """
    referral = db.get(Referral, referral_id)
    if referral is None:
        raise HTTPException(404, 'Referral not found')
    if is_reviewer(user):
        return referral
    case = db.get(MonitoringCase, referral.case_id)
    # `raised_by` is checked as well as case ownership even though creation
    # requires both, so a future writer that loosens one cannot silently loosen
    # the other.
    if case is None or case.opened_by != user.id or referral.raised_by != user.id:
        raise HTTPException(404, 'Referral not found')
    return referral


# --- Validation -----------------------------------------------------------

def normalise_kind(kind: str | None) -> str:
    kind = (kind or '').strip().lower()
    if kind not in KINDS:
        raise HTTPException(
            422,
            f'kind must be one of: {", ".join(KINDS)}. Use extension for a field '
            'visit or advice, laboratory for sample testing.',
        )
    return kind


def normalise_reason(reason: str | None) -> str:
    """A referral with no stated reason wastes the time of whoever receives it."""
    reason = (reason or '').strip()
    if len(reason) < MIN_REASON_LENGTH:
        raise HTTPException(
            422,
            f'reason must be at least {MIN_REASON_LENGTH} characters. Say what you '
            'need help with, so whoever receives this knows what to look at.',
        )
    if len(reason) > MAX_REASON_LENGTH:
        raise HTTPException(422, f'reason may be at most {MAX_REASON_LENGTH} characters.')
    return reason


def normalise_facility_note(facility_note: str | None) -> str | None:
    facility_note = (facility_note or '').strip() or None
    if facility_note and len(facility_note) > MAX_FACILITY_NOTE_LENGTH:
        raise HTTPException(
            422, f'facility_note may be at most {MAX_FACILITY_NOTE_LENGTH} characters.'
        )
    return facility_note


def normalise_outcome_notes(outcome_notes: str | None) -> str | None:
    outcome_notes = (outcome_notes or '').strip() or None
    if outcome_notes and len(outcome_notes) > MAX_OUTCOME_NOTES_LENGTH:
        raise HTTPException(
            422, f'outcome_notes may be at most {MAX_OUTCOME_NOTES_LENGTH} characters.'
        )
    return outcome_notes


def resolve_facility(db: Session, facility_id: int | None) -> Facility | None:
    """The named facility, or None when no destination was chosen.

    An inactive row is 404 rather than accepted with a warning: sending a farmer
    to an office this platform has stopped listing is worse than admitting the
    directory has no entry, and `facility_note` carries the destination instead.
    """
    if facility_id is None:
        return None
    facility = db.get(Facility, facility_id)
    if facility is None or not facility.active:
        raise HTTPException(
            404,
            'That facility is not in the active directory. Leave facility_id out and '
            'name the destination in facility_note instead.',
        )
    return facility


# --- Transitions ----------------------------------------------------------

def require_known_status(target: str | None) -> str:
    target = (target or '').strip().upper()
    if target not in ALL_STATUSES:
        raise HTTPException(422, f'status must be one of: {", ".join(ALL_STATUSES)}.')
    return target


def require_transition(current: str, target: str) -> str:
    """Legality of one move, by the exported map and nothing else.

    422 rather than 409: the caller sent a value that is not valid for this row,
    and the message names what would be -- including when the answer is "nothing",
    because the referral is already closed.
    """
    target = require_known_status(target)
    allowed = TRANSITIONS.get(current, ())
    if target not in allowed:
        if not allowed:
            raise HTTPException(
                422,
                f'This referral is {current}, which is final. No further status change '
                'is possible; raise a new referral if help is needed again.',
            )
        raise HTTPException(
            422,
            f'A {current} referral cannot become {target}. From {current} the only '
            f'legal next statuses are: {", ".join(allowed)}.',
        )
    return target


def require_actor(user: User, target: str) -> None:
    """Whether this caller's side of the workflow owns the requested move.

    403 with the reason, not 404: the referral is theirs to see, the transition is
    not theirs to make, and a farmer told "not found" about their own referral
    would learn the wrong thing.
    """
    if is_reviewer(user):
        if target not in REVIEWER_TARGETS:
            raise HTTPException(
                403,
                f"Moving a referral to {target} is the farmer's own step -- asking for "
                'help is theirs to do. A reviewing account handles the receiving side: '
                f'{", ".join(REVIEWER_TARGETS)}.',
            )
        return
    if target not in FARMER_TARGETS:
        raise HTTPException(
            403,
            f'Only an extension officer or expert account can move a referral to '
            f'{target}; that is the side receiving the request. You can ask for a '
            f'referral ({STATUS_REQUESTED}) or withdraw it ({STATUS_CANCELLED}).',
        )


def require_notes_author(user: User, outcome_notes: str | None) -> None:
    """`outcome_notes` records what the receiving side did, so only it may write.

    Refused rather than dropped: a farmer whose text silently vanished would
    believe the office had recorded it.
    """
    if outcome_notes is not None and not is_reviewer(user):
        raise HTTPException(
            403,
            'outcome_notes is the record of the office or laboratory that handled the '
            'referral, so only an account with one of these roles may write it: '
            f'{", ".join(REVIEWER_ROLES)}.',
        )


# --- Writing --------------------------------------------------------------

def create_referral(
    db: Session,
    user: User,
    case_id: int,
    kind: str,
    reason: str,
    facility_id: int | None,
    facility_note: str | None,
) -> tuple[Referral, Facility | None]:
    """Record a referral on the caller's own case, in RECOMMENDED.

    A new referral is always RECOMMENDED and never REQUESTED, so the two acts stay
    distinct: writing down that help may be worth asking for is not the same as
    asking for it. The farmer makes the second move explicitly, and `requested_at`
    then marks when they did.

    `raised_by` comes from the session. `status`, the timestamps, and every other
    server-side field are derived here, so a body carrying them has no effect.
    """
    case = owned_case(db, user, case_id)
    kind = normalise_kind(kind)
    reason = normalise_reason(reason)
    facility_note = normalise_facility_note(facility_note)
    facility = resolve_facility(db, facility_id)

    referral = Referral(
        case_id=case.id,
        facility_id=facility.id if facility else None,
        facility_note=facility_note,
        raised_by=user.id,
        kind=kind,
        reason=reason,
        status=STATUS_RECOMMENDED,
    )
    db.add(referral)
    db.commit()
    db.refresh(referral)
    logger.info(
        'Referral %s recorded on case %s: kind=%s facility=%s',
        referral.id, case.id, kind, referral.facility_id,
    )
    return referral, facility


def apply_transition(
    db: Session,
    user: User,
    referral: Referral,
    target: str,
    outcome_notes: str | None,
) -> Referral:
    """Move one referral, stamping the timestamp that belongs to the new status.

    Order matters: legality is checked before authorisation, so a caller is never
    told they lack a role for a move nobody could have made anyway.
    """
    target = require_transition(referral.status, target)
    require_actor(user, target)
    outcome_notes = normalise_outcome_notes(outcome_notes)
    require_notes_author(user, outcome_notes)

    referral.status = target
    column = TRANSITION_STAMP.get(target)
    if column is not None:
        setattr(referral, column, _now())
    if outcome_notes is not None:
        # Overwritten rather than appended: this column holds the receiving side's
        # current record of its own work, a referral has one handler at a time,
        # and `updated_at` shows when it last changed.
        referral.outcome_notes = outcome_notes
    db.commit()
    db.refresh(referral)
    logger.info(
        'Referral %s moved to %s by user %s (role=%s)',
        referral.id, target, user.id, user.role,
    )
    return referral


# --- Reading --------------------------------------------------------------

def facility_state(facility: Facility | None) -> dict | None:
    """One directory row, including the page that lists it.

    `source_url` is always present because a farmer being sent somewhere is
    entitled to see who says the place exists. There is no telephone number or
    street address in this shape because there is none in the table -- the
    directory carries only what an official page states.
    """
    if facility is None:
        return None
    return {
        'facility_id': facility.id,
        'name': facility.name,
        'kind': facility.kind,
        'kind_meaning': FACILITY_KIND_MEANING.get(facility.kind),
        'organisation': facility.organisation,
        'state': facility.state,
        'district': facility.district,
        'website': facility.website,
        'source_url': facility.source_url,
        'note': facility.note,
        'active': bool(facility.active),
    }


def facility_of(db: Session, referral: Referral) -> Facility | None:
    """The facility already recorded on a referral, read without the active gate.

    Deliberately not `resolve_facility`: that one refuses an inactive row because
    it guards a *choice* of destination. Reading back a referral is not a choice,
    and a directory row that stops being listed later must not turn an existing
    referral into a 404. `facility_state` reports `active` so the state is visible.
    """
    if referral.facility_id is None:
        return None
    return db.get(Facility, referral.facility_id)


def referral_state(referral: Referral, facility: Facility | None = None) -> dict:
    """One referral, with the meaning of the status it holds.

    `is_evidence_about_the_crop` is False on every referral in every state. It is
    a field rather than prose so an interface reading this shape cannot render a
    referral as a finding without ignoring an explicit False.
    """
    return {
        'referral_id': referral.id,
        'case_id': referral.case_id,
        'kind': referral.kind,
        'kind_meaning': KIND_MEANING.get(referral.kind),
        'reason': referral.reason,
        'status': referral.status,
        'meaning': STATUS_MEANING.get(referral.status),
        'next_statuses': list(TRANSITIONS.get(referral.status, ())),
        'is_final': referral.status in TERMINAL_STATUSES,
        'facility': facility_state(facility),
        'facility_id': referral.facility_id,
        'facility_note': referral.facility_note,
        'outcome_notes': referral.outcome_notes,
        'requested_at': referral.requested_at.isoformat() if referral.requested_at else None,
        'referred_at': referral.referred_at.isoformat() if referral.referred_at else None,
        'completed_at': referral.completed_at.isoformat() if referral.completed_at else None,
        'cancelled_at': referral.cancelled_at.isoformat() if referral.cancelled_at else None,
        'created_at': referral.created_at.isoformat() if referral.created_at else None,
        'is_evidence_about_the_crop': False,
    }


def parse_status_filter(raw: str | None) -> tuple[str, ...]:
    """Validate a comma-separated status filter, defaulting to everything."""
    if not raw or not raw.strip():
        return ALL_STATUSES
    requested = tuple(part.strip().upper() for part in raw.split(',') if part.strip())
    unknown = [part for part in requested if part not in ALL_STATUSES]
    if unknown:
        raise HTTPException(
            422,
            f'Unknown status {unknown[0]!r}. Use one or more of: {", ".join(ALL_STATUSES)}.',
        )
    return tuple(s for s in ALL_STATUSES if s in requested)


def visible_referrals(
    db: Session,
    user: User,
    statuses: tuple[str, ...],
    limit: int,
    offset: int,
) -> tuple[list[dict], int, dict[str, int], str]:
    """Referrals the caller may see, newest first.

    A farmer sees referrals on the cases they opened. A reviewing account sees
    every referral, because it is the receiving side and a queue restricted to its
    own cases would always be empty -- reviewers do not open monitoring cases.
    That is the same scope decision the review queue and the confirmation register
    already make.

    `counts_by_status` covers everything visible to the caller rather than the
    filtered page, so a farmer can see one request is still waiting without a
    second call.

    Returns `(items, total_matching, counts_by_status, scope)`.
    """
    scope = 'reviewer' if is_reviewer(user) else 'farmer'
    query = db.query(Referral)
    if scope == 'farmer':
        owned = select(MonitoringCase.id).where(MonitoringCase.opened_by == user.id)
        query = query.filter(Referral.case_id.in_(owned))
    rows = query.order_by(Referral.id.desc()).all()

    counts = {status: 0 for status in ALL_STATUSES}
    selected = []
    for row in rows:
        # A status outside ALL_STATUSES cannot exist -- the check constraint
        # refuses it -- so an unknown key here would mean schema drift, not data.
        if row.status in counts:
            counts[row.status] += 1
        if row.status in statuses:
            selected.append(row)

    page = selected[offset:offset + limit]
    facilities = _facilities_by_id(db, [row.facility_id for row in page])
    items = [referral_state(row, facilities.get(row.facility_id)) for row in page]
    return items, len(selected), counts, scope


def _facilities_by_id(db: Session, facility_ids: list[int | None]) -> dict[int, Facility]:
    """Facilities for a page of referrals in one query, so a list is not N+1."""
    wanted = {fid for fid in facility_ids if fid is not None}
    if not wanted:
        return {}
    rows = db.query(Facility).filter(Facility.id.in_(wanted)).all()
    return {row.id: row for row in rows}


def facility_directory(
    db: Session,
    kind: str | None,
    state: str | None,
) -> tuple[list[dict], bool]:
    """The active facility directory, optionally filtered.

    Returns `(items, state_filtered)`. The flag exists because the national
    directory rows carry no state -- they are the whole country's listing -- so a
    state filter necessarily hides the rows most likely to be a farmer's correct
    first stop. The router says that in words when the flag is set, instead of
    quietly returning a shorter list.
    """
    if kind is not None and kind.strip():
        kind = kind.strip().lower()
        if kind not in FACILITY_KINDS:
            raise HTTPException(422, f'kind must be one of: {", ".join(FACILITY_KINDS)}.')
    else:
        kind = None

    state = (state or '').strip() or None

    query = db.query(Facility).filter(Facility.active.is_(True))
    if kind:
        query = query.filter(Facility.kind == kind)
    if state:
        query = query.filter(Facility.state.ilike(state))
    rows = query.order_by(Facility.kind, Facility.name).all()
    return [facility_state(row) for row in rows], state is not None
