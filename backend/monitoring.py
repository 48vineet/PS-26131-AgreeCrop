"""Follow-up monitoring: an open thread of attention on one screened problem.

SIH requirement "follow-up monitoring". The tables were created by migration
`0010_evidence_lifecycle`; this module is the domain layer they were waiting for,
and `models_db.MonitoringCase` already names `monitoring.effective_status` as the
place the derived status lives.

Three rules shape everything here, and all three come from
backend/docs/EVIDENCE_LIFECYCLE.md rather than from this module's own preference.

**A case is follow-up on something.** It opens only from a `DiseaseObservation`
the caller submitted. `observation_id` is UNIQUE, so a second open on the same
screening revises the existing case instead of forking its history. There is no
way to open a case on nothing, and none on somebody else's screening.

**`FOLLOW_UP_DUE` is derived, never stored.** It is what `OPEN` or
`FOLLOW_UP_SUBMITTED` means once `due_at` has passed. Storing it would need a
scheduler to flip rows and would be silently wrong whenever that scheduler
failed. Every state this module emits carries both `status` (what is in the
column) and `effective_status` (what it means now).

**Monitoring is not evidence.** A case is not a diagnosis, a follow-up is not a
confirmation, and `RESOLVED` is the farmer saying the problem no longer needs
watching -- not a claim that a treatment worked. Nothing here writes to
`disease_observations`, `expert_validations`, or `field_confirmations`, and no
status is ever inferred from a `symptom_change` value.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from models_db import (
    Crop,
    DiseaseObservation,
    Farm,
    MonitoringCase,
    MonitoringFollowup,
    User,
)

# ── Statuses ───────────────────────────────────────────────────────────────
# The four the column may hold, matching ck_case_status exactly.
STATUS_OPEN = 'OPEN'
STATUS_FOLLOW_UP_SUBMITTED = 'FOLLOW_UP_SUBMITTED'
STATUS_RESOLVED = 'RESOLVED'
STATUS_CLOSED = 'CLOSED'

STORED_STATUSES = (
    STATUS_OPEN,
    STATUS_FOLLOW_UP_SUBMITTED,
    STATUS_RESOLVED,
    STATUS_CLOSED,
)

# Derived on read and never written. Kept out of STORED_STATUSES so a writer
# cannot reach it by accident: the check constraint would refuse it anyway, and
# this makes the refusal a deliberate design statement rather than a 500.
STATUS_FOLLOW_UP_DUE = 'FOLLOW_UP_DUE'

# What a caller may see in `effective_status`.
EFFECTIVE_STATUSES = STORED_STATUSES + (STATUS_FOLLOW_UP_DUE,)

# The statuses still expecting attention. Used for counts and for deciding
# whether a follow-up may still be appended.
ACTIVE_STATUSES = (STATUS_OPEN, STATUS_FOLLOW_UP_SUBMITTED)

STATUS_MEANING = {
    STATUS_OPEN: (
        'Being watched. A case was opened on one screening so it can be checked '
        'again later; it says nothing about what the crop has.'
    ),
    STATUS_FOLLOW_UP_SUBMITTED: (
        'At least one follow-up has been recorded on this case. What it says is '
        'the farmer\'s own observation of their own field, not a diagnosis.'
    ),
    STATUS_RESOLVED: (
        'The farmer has said this no longer needs watching. That is not a claim '
        'that any treatment worked, and it is not a confirmation of the '
        'prediction the case was opened on.'
    ),
    STATUS_CLOSED: (
        'Closed without being resolved -- the crop was harvested or removed, or '
        'the case was opened in error. Nothing is asserted about the problem.'
    ),
    STATUS_FOLLOW_UP_DUE: (
        'Derived, never stored: this case is OPEN or FOLLOW_UP_SUBMITTED and its '
        'due date has passed. A follow-up is owed.'
    ),
}

# Which moves a caller may drive through the status endpoint.
#
# FOLLOW_UP_SUBMITTED is deliberately absent from every target list. It is
# reached only by actually recording a follow-up, so no caller can assert that a
# field was checked without a row saying what was seen.
#
# RESOLVED and CLOSED both allow a return to OPEN, because symptoms coming back
# on the same screening is an ordinary thing and the UNIQUE constraint means this
# case is the only place that history can live.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    STATUS_OPEN: (STATUS_RESOLVED, STATUS_CLOSED),
    STATUS_FOLLOW_UP_SUBMITTED: (STATUS_RESOLVED, STATUS_CLOSED),
    STATUS_RESOLVED: (STATUS_OPEN, STATUS_CLOSED),
    STATUS_CLOSED: (STATUS_OPEN,),
}

# The timestamp column each arrival stamps. OPEN clears both instead of stamping
# one, handled in `apply_transition`.
TRANSITION_STAMP: dict[str, str | None] = {
    STATUS_OPEN: None,
    STATUS_RESOLVED: 'resolved_at',
    STATUS_CLOSED: 'closed_at',
}

# ── Symptom change ─────────────────────────────────────────────────────────
# Matches ck_followup_symptom_change exactly.
SYMPTOM_IMPROVED = 'IMPROVED'
SYMPTOM_UNCHANGED = 'UNCHANGED'
SYMPTOM_WORSENED = 'WORSENED'
SYMPTOM_SYMPTOMS_GONE = 'SYMPTOMS_GONE'
SYMPTOM_UNCERTAIN = 'UNCERTAIN'

SYMPTOM_CHANGES = (
    SYMPTOM_IMPROVED,
    SYMPTOM_UNCHANGED,
    SYMPTOM_WORSENED,
    SYMPTOM_SYMPTOMS_GONE,
    SYMPTOM_UNCERTAIN,
)

SYMPTOM_CHANGE_MEANING = {
    SYMPTOM_IMPROVED: 'Less of it than last time, in the farmer\'s own judgement.',
    SYMPTOM_UNCHANGED: 'About the same as last time.',
    SYMPTOM_WORSENED: 'More of it than last time.',
    SYMPTOM_SYMPTOMS_GONE: (
        'No symptoms visible now. Deliberately not called "recovered" or "cured": '
        'this records what was seen, and the platform has no basis for a claim '
        'about why.'
    ),
    SYMPTOM_UNCERTAIN: 'The farmer could not tell.',
}

MIN_FOLLOW_UP_DAYS = 1
MAX_FOLLOW_UP_DAYS = 90
MAX_SUMMARY_LENGTH = 2000
MAX_NOTES_LENGTH = 2000

# Stated at the top level of every response this unit produces.
MONITORING_NOTE = (
    'A monitoring case is a reminder to look again, not a diagnosis. Opening one '
    'does not confirm the prediction it was opened on, a follow-up is the '
    'farmer\'s own observation rather than evidence, and RESOLVED means only that '
    'the farmer stopped watching -- never that a treatment worked. Only a field '
    'confirmation recorded as CONFIRMED states what a crop actually had.'
)


def _now() -> datetime:
    """Naive UTC, matching every DateTime column in this schema."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Derived status ─────────────────────────────────────────────────────────

def effective_status(case: MonitoringCase, now: datetime | None = None) -> str:
    """What this case's status means at `now`.

    The one place `FOLLOW_UP_DUE` comes into existence. A case is due when it is
    still being watched and its `due_at` has passed; a case with no `due_at` is
    never due, because nobody said when to look again.

    Named by `models_db.MonitoringCase`, which points here rather than restating
    the rule, so the derivation has exactly one definition.
    """
    if case.status not in ACTIVE_STATUSES:
        return case.status
    if case.due_at is None:
        return case.status
    return STATUS_FOLLOW_UP_DUE if case.due_at <= (now or _now()) else case.status


def is_overdue(case: MonitoringCase, now: datetime | None = None) -> bool:
    return effective_status(case, now) == STATUS_FOLLOW_UP_DUE


# ── Ownership ──────────────────────────────────────────────────────────────

def owned_case(db: Session, user: User, case_id: int) -> MonitoringCase:
    """The caller's own monitoring case, or 404.

    A case belongs to whoever opened it -- one column, `opened_by`. This is the
    same rule `referrals.owned_case` applies, and the two are deliberately
    independent: referrals says so in its own docstring, and a referral must not
    be re-scoped by a change made here.

    404 rather than 403 for somebody else's case, matching every other router: a
    record the caller does not own is a record that does not exist. A reviewing
    account gets no blanket read here either -- monitoring is the farmer's own
    account of their own field, and a review queue over it would expose what a
    farmer wrote about their farm to accounts with no stake in it.
    """
    case = db.get(MonitoringCase, case_id)
    if case is None or case.opened_by != user.id:
        raise HTTPException(404, 'Monitoring case not found')
    return case


def eligible_observation(
    db: Session, user: User, observation_id: int
) -> tuple[DiseaseObservation, Farm, Crop | None]:
    """One screening this caller may open a case on, with its farm and crop.

    Four things have to hold, and each failure is reported as itself rather than
    as a generic rejection:

    * the screening exists and the caller submitted it -- 404 otherwise, so
      another farmer's screening is not disclosed by a different error;
    * it names a farm. `monitoring_cases.farm_id` is NOT NULL, so a screening
      taken with no farm context cannot be monitored. That is a 422 explaining
      what is missing, not a 500 from the constraint;
    * the farm still exists and is still the caller's. Checked again here rather
      than trusted from the screening, because a farm can be transferred or
      deleted after a screening is taken, and a case must never carry a farm the
      caller does not own;
    * the crop, when the screening names one, still belongs to that same farm.
      A crop that has moved or been removed is dropped to NULL rather than
      carried across farms -- `crop_id` is nullable precisely so a case can exist
      without one.
    """
    observation = db.get(DiseaseObservation, observation_id)
    if observation is None or observation.submitted_by != user.id:
        raise HTTPException(404, 'Screening not found')

    if observation.farm_id is None:
        raise HTTPException(
            422,
            'This screening was taken without farm context, so it cannot be '
            'monitored: a monitoring case has to belong to a farm. Screen the crop '
            'again with the farm selected, then open a case on that screening.',
        )

    farm = db.get(Farm, observation.farm_id)
    if farm is None or farm.user_id != user.id:
        # The screening is the caller's but its farm is not (or no longer
        # exists). Refused rather than silently re-homed: a case on a farm the
        # caller does not own would put their notes against somebody else's land.
        raise HTTPException(404, 'Farm not found')

    crop = None
    if observation.crop_id is not None:
        candidate = db.get(Crop, observation.crop_id)
        # A crop that no longer belongs to this farm is dropped, not carried:
        # `crop_id` is nullable, and a wrong crop is worse than no crop.
        if candidate is not None and candidate.farm_id == farm.id:
            crop = candidate
    return observation, farm, crop


# ── Validation ─────────────────────────────────────────────────────────────

def normalise_summary(summary: str | None) -> str | None:
    """Optional free text. Blank becomes NULL rather than an empty string."""
    summary = (summary or '').strip()
    if not summary:
        return None
    if len(summary) > MAX_SUMMARY_LENGTH:
        raise HTTPException(
            422, f'summary must be {MAX_SUMMARY_LENGTH} characters or fewer.'
        )
    return summary


def normalise_notes(notes: str | None) -> str | None:
    notes = (notes or '').strip()
    if not notes:
        return None
    if len(notes) > MAX_NOTES_LENGTH:
        raise HTTPException(
            422, f'notes must be {MAX_NOTES_LENGTH} characters or fewer.'
        )
    return notes


def resolve_due_at(follow_up_in_days: int | None, at: datetime) -> datetime | None:
    """When to look again, as a number of days from `at`.

    Days rather than a timestamp because that is the decision a farmer actually
    makes, and because it removes any client timezone from a naive-UTC column.

    ``None`` means no due date, and stays NULL. No interval is defaulted here:
    how long to wait before re-checking a crop problem is an agronomic judgement,
    and this platform does not hold one for every crop and condition. The UI
    proposes an editable number; it does not receive one from the server.
    """
    if follow_up_in_days is None:
        return None
    if not MIN_FOLLOW_UP_DAYS <= follow_up_in_days <= MAX_FOLLOW_UP_DAYS:
        raise HTTPException(
            422,
            f'follow_up_in_days must be between {MIN_FOLLOW_UP_DAYS} and '
            f'{MAX_FOLLOW_UP_DAYS}.',
        )
    return at + timedelta(days=follow_up_in_days)


def require_symptom_change(value: str | None) -> str:
    value = (value or '').strip().upper()
    if value not in SYMPTOM_CHANGES:
        raise HTTPException(
            422, f'symptom_change must be one of: {", ".join(SYMPTOM_CHANGES)}.'
        )
    return value


def resolve_observed_at(observed_at: str | None, now: datetime) -> datetime:
    """When the farmer looked. Defaults to now; never in the future.

    A future observation would be a record of something that has not happened.
    Backdating is allowed without limit -- a farmer entering last week's check is
    ordinary, and the case's own `opened_at` is not a floor because a farmer may
    legitimately record what they saw before they got around to opening the case.
    """
    if observed_at is None or not str(observed_at).strip():
        return now
    text = str(observed_at).strip().replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise HTTPException(
            422, 'observed_at must be an ISO 8601 datetime, or omitted for now.'
        )
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    if parsed > now:
        raise HTTPException(422, 'observed_at cannot be in the future.')
    return parsed


def require_known_status(target: str | None) -> str:
    target = (target or '').strip().upper()
    if target == STATUS_FOLLOW_UP_DUE:
        # Named separately from the generic rejection because a caller trying
        # this has misread the model, not fat-fingered a value.
        raise HTTPException(
            422,
            f'{STATUS_FOLLOW_UP_DUE} is derived from due_at and is never stored. '
            'Set a due date to make a case due, or record a follow-up.',
        )
    if target not in STORED_STATUSES:
        raise HTTPException(
            422, f'status must be one of: {", ".join(STORED_STATUSES)}.'
        )
    return target


def require_transition(current: str, target: str) -> str:
    """Legality of one move, by `TRANSITIONS` and nothing else.

    422 rather than 409, matching `referrals.require_transition`: the caller sent
    a value that is not valid for this row, and the message names what would be.
    """
    target = require_known_status(target)
    allowed = TRANSITIONS.get(current, ())
    if target not in allowed:
        if target == STATUS_FOLLOW_UP_SUBMITTED:
            raise HTTPException(
                422,
                f'{STATUS_FOLLOW_UP_SUBMITTED} is not something to be set: it is what '
                'a case becomes when a follow-up is recorded on it. Record the '
                'follow-up instead, so the case says what was seen.',
            )
        raise HTTPException(
            422,
            f'A {current} case cannot become {target}. From {current} the only legal '
            f'next statuses are: {", ".join(allowed)}.',
        )
    return target


# ── Writing ────────────────────────────────────────────────────────────────

def open_case(
    db: Session,
    user: User,
    observation_id: int,
    summary: str | None = None,
    follow_up_in_days: int | None = None,
) -> tuple[MonitoringCase, bool]:
    """Open a case on one of the caller's screenings, or revise the existing one.

    Returns `(case, created)`. `observation_id` is UNIQUE, so a second open on
    the same screening revises that case rather than failing or forking the
    history -- exactly what `MonitoringCase`'s docstring specifies. Revising
    updates only `summary` and `due_at`: the status is left alone, because
    re-sending an open request is not a statement that anything changed on the
    ground, and follow-ups already hold everything that did.

    Nothing about the screening is touched. The prediction, its confidence, and
    its review state are all left exactly as they were: opening a case is a
    decision to watch, not a conclusion about what was predicted.
    """
    observation, farm, crop = eligible_observation(db, user, observation_id)
    summary = normalise_summary(summary)
    now = _now()

    existing = db.scalar(
        select(MonitoringCase).where(MonitoringCase.observation_id == observation.id)
    )
    if existing is not None:
        # Ownership is re-checked rather than assumed from the screening: the two
        # columns are independent, and a case opened by someone else on a
        # screening this caller submitted is not theirs to revise.
        if existing.opened_by != user.id:
            raise HTTPException(404, 'Monitoring case not found')
        if summary is not None:
            existing.summary = summary
        if follow_up_in_days is not None:
            existing.due_at = resolve_due_at(follow_up_in_days, now)
        db.commit()
        db.refresh(existing)
        return existing, False

    case = MonitoringCase(
        observation_id=observation.id,
        farm_id=farm.id,
        crop_id=crop.id if crop is not None else None,
        opened_by=user.id,
        status=STATUS_OPEN,
        summary=summary,
        opened_at=now,
        due_at=resolve_due_at(follow_up_in_days, now),
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case, True


def record_followup(
    db: Session,
    user: User,
    case: MonitoringCase,
    symptom_change: str | None,
    notes: str | None = None,
    observed_at: str | None = None,
    next_follow_up_in_days: int | None = None,
) -> MonitoringFollowup:
    """Append one check to a case. Never edits, never deletes.

    A follow-up may only be added to a case still being watched. Appending to a
    RESOLVED or CLOSED case is refused rather than silently reopening it, because
    reopening is a decision the farmer should make explicitly -- and a follow-up
    landing on a case the farmer believes is finished would be invisible to them.

    The case moves to FOLLOW_UP_SUBMITTED because a follow-up was submitted, and
    for no other reason. **The `symptom_change` value never drives the status**:
    WORSENED does not escalate anything, and SYMPTOMS_GONE does not resolve the
    case. Deciding a problem no longer needs watching is the farmer's own act,
    and inferring it from one observation would put words in their mouth.

    `image_ref` and `image_hash` stay NULL. There is no upload path on this
    route, and writing a path for a file nobody stored would be a fabrication --
    the same contract `disease_observations.image_ref` keeps.
    """
    if case.status not in ACTIVE_STATUSES:
        raise HTTPException(
            422,
            f'This case is {case.status}, so a follow-up cannot be added to it. '
            f'Reopen it ({STATUS_OPEN}) if it needs watching again.',
        )

    now = _now()
    symptom_change = require_symptom_change(symptom_change)
    notes = normalise_notes(notes)
    observed = resolve_observed_at(observed_at, now)
    next_due = resolve_due_at(next_follow_up_in_days, now)

    followup = MonitoringFollowup(
        case_id=case.id,
        submitted_by=user.id,
        observed_at=observed,
        symptom_change=symptom_change,
        notes=notes,
        image_ref=None,
        image_hash=None,
        next_due_at=next_due,
    )
    db.add(followup)

    case.status = STATUS_FOLLOW_UP_SUBMITTED
    if next_due is not None:
        # The case's own due date follows the latest follow-up, so the derived
        # FOLLOW_UP_DUE keeps meaning something after a check is recorded.
        case.due_at = next_due
    db.commit()
    db.refresh(followup)
    return followup


def apply_transition(
    db: Session, case: MonitoringCase, target: str
) -> MonitoringCase:
    """Move one case, stamping the column that arrival owns.

    Returning to OPEN clears both terminal timestamps: a `resolved_at` on a case
    that is open again would contradict its own status. The follow-ups are
    untouched and append-only, so the history of what was actually seen survives
    every reopen.
    """
    target = require_transition(case.status, target)
    now = _now()
    if target == STATUS_OPEN:
        case.resolved_at = None
        case.closed_at = None
    else:
        column = TRANSITION_STAMP[target]
        if column is not None:
            setattr(case, column, now)
    case.status = target
    db.commit()
    db.refresh(case)
    return case


# ── Reading ────────────────────────────────────────────────────────────────

def followup_state(followup: MonitoringFollowup) -> dict:
    return {
        'id': followup.id,
        'case_id': followup.case_id,
        'observed_at': followup.observed_at.isoformat(),
        'symptom_change': followup.symptom_change,
        'symptom_change_meaning': SYMPTOM_CHANGE_MEANING[followup.symptom_change],
        'notes': followup.notes,
        'next_due_at': followup.next_due_at.isoformat() if followup.next_due_at else None,
        # Mirrors the screening contract: whether an image exists, never a path.
        'image_available': followup.image_ref is not None,
        'image_sha256': followup.image_hash,
        'created_at': followup.created_at.isoformat() if followup.created_at else None,
    }


def case_state(
    case: MonitoringCase,
    now: datetime | None = None,
    farm: Farm | None = None,
    crop: Crop | None = None,
    observation: DiseaseObservation | None = None,
    followups: list[MonitoringFollowup] | None = None,
) -> dict:
    """One case as the API states it.

    Both `status` and `effective_status` are always present, as
    backend/docs/EVIDENCE_LIFECYCLE.md requires: the column and what it means now are
    different facts, and a client that only ever saw one of them would either
    miss an overdue case or invent a status the database does not hold.

    The evidence block is what the case is *about* -- the prediction it was
    opened on, named as a prediction. `submitted_by` is not echoed: the caller
    submitted it, so repeating their own id adds nothing and every field here is
    already scoped to them.
    """
    now = now or _now()
    state = {
        'id': case.id,
        'observation_id': case.observation_id,
        'farm_id': case.farm_id,
        'farm_name': farm.farm_name if farm else None,
        'crop_id': case.crop_id,
        'crop_name': crop.crop_name if crop else None,
        'status': case.status,
        'effective_status': effective_status(case, now),
        'status_meaning': STATUS_MEANING[effective_status(case, now)],
        'overdue': is_overdue(case, now),
        'summary': case.summary,
        'opened_at': case.opened_at.isoformat(),
        'due_at': case.due_at.isoformat() if case.due_at else None,
        'resolved_at': case.resolved_at.isoformat() if case.resolved_at else None,
        'closed_at': case.closed_at.isoformat() if case.closed_at else None,
        'next_statuses': list(TRANSITIONS.get(case.status, ())),
        'updated_at': case.updated_at.isoformat() if case.updated_at else None,
    }
    if observation is not None:
        state['evidence'] = {
            'observation_id': observation.id,
            'kind': 'image_screening',
            'predicted_class': observation.predicted_class,
            'confidence': observation.confidence,
            'model_version': observation.model_version,
            'screened_at': observation.screened_at.isoformat(),
            'note': (
                'The model\'s prediction from a photograph. The case was opened on '
                'this evidence and does not confirm it.'
            ),
        }
    if followups is not None:
        state['followups'] = [followup_state(row) for row in followups]
        state['followup_count'] = len(followups)
    return state


def _context_for(
    db: Session, cases: list[MonitoringCase]
) -> tuple[dict[int, Farm], dict[int, Crop], dict[int, DiseaseObservation]]:
    """Farms, crops and screenings for a page of cases, in three queries."""
    farm_ids = {case.farm_id for case in cases}
    crop_ids = {case.crop_id for case in cases if case.crop_id is not None}
    observation_ids = {case.observation_id for case in cases}
    farms = {
        row.id: row
        for row in (db.query(Farm).filter(Farm.id.in_(farm_ids)).all() if farm_ids else [])
    }
    crops = {
        row.id: row
        for row in (db.query(Crop).filter(Crop.id.in_(crop_ids)).all() if crop_ids else [])
    }
    observations = {
        row.id: row
        for row in (
            db.query(DiseaseObservation)
            .filter(DiseaseObservation.id.in_(observation_ids))
            .all()
            if observation_ids
            else []
        )
    }
    return farms, crops, observations


def parse_status_filter(raw: str | None) -> tuple[str, ...]:
    """A comma-separated status filter, over effective statuses.

    Filtering on `FOLLOW_UP_DUE` is accepted and is the reason this filter is
    applied to the derived value rather than in SQL: "what is overdue" is the
    question a farmer actually asks, and it is not a column.

    An unrecognised status is refused rather than ignored -- a filter that reads
    back as an empty list would look like an empty case list.
    """
    if raw is None or not raw.strip():
        return EFFECTIVE_STATUSES
    requested = [part.strip().upper() for part in raw.split(',') if part.strip()]
    unknown = [part for part in requested if part not in EFFECTIVE_STATUSES]
    if unknown:
        raise HTTPException(
            422,
            f'Unknown status: {", ".join(unknown)}. Valid values are: '
            f'{", ".join(EFFECTIVE_STATUSES)}.',
        )
    return tuple(dict.fromkeys(requested))


def visible_cases(
    db: Session,
    user: User,
    statuses: tuple[str, ...],
    limit: int,
    offset: int,
    farm_id: int | None = None,
) -> tuple[list[dict], int, dict[str, int], datetime]:
    """The caller's own cases, most recently opened first.

    Scoped by `opened_by` in SQL, so another farmer's case cannot appear here
    even if a filter were wrong. There is no reviewer scope: monitoring is the
    farmer's own account of their own field.

    `counts_by_status` is over everything the caller owns rather than the
    filtered page, and is keyed by *effective* status -- so a farmer sees how
    many cases are overdue without a second call.

    Returns `(items, total_matching, counts_by_status, now)`. `now` is returned
    so the caller can state the instant every derived status was computed at.
    """
    now = _now()
    query = db.query(MonitoringCase).filter(MonitoringCase.opened_by == user.id)
    if farm_id is not None:
        farm = db.get(Farm, farm_id)
        if farm is None or farm.user_id != user.id:
            raise HTTPException(404, 'Farm not found')
        query = query.filter(MonitoringCase.farm_id == farm_id)
    rows = query.order_by(MonitoringCase.id.desc()).all()

    counts = {status: 0 for status in EFFECTIVE_STATUSES}
    selected = []
    for row in rows:
        derived = effective_status(row, now)
        counts[derived] += 1
        if derived in statuses:
            selected.append(row)

    page = selected[offset:offset + limit]
    farms, crops, observations = _context_for(db, page)
    items = [
        case_state(
            row,
            now,
            farm=farms.get(row.farm_id),
            crop=crops.get(row.crop_id) if row.crop_id else None,
            observation=observations.get(row.observation_id),
        )
        for row in page
    ]
    return items, len(selected), counts, now


def case_detail(db: Session, case: MonitoringCase) -> dict:
    """One owned case with its full follow-up history, oldest first.

    Oldest first because a monitoring history is read forwards -- what was seen,
    then what happened next. The list endpoint orders cases newest first for the
    opposite reason: the newest case is the one needing attention.
    """
    farm = db.get(Farm, case.farm_id)
    crop = db.get(Crop, case.crop_id) if case.crop_id else None
    observation = db.get(DiseaseObservation, case.observation_id)
    followups = (
        db.query(MonitoringFollowup)
        .filter(MonitoringFollowup.case_id == case.id)
        .order_by(MonitoringFollowup.observed_at.asc(), MonitoringFollowup.id.asc())
        .all()
    )
    return case_state(
        case,
        farm=farm,
        crop=crop,
        observation=observation,
        followups=followups,
    )


def monitorable_screenings(db: Session, user: User, limit: int) -> list[dict]:
    """The caller's screenings that could have a case opened on them.

    Eligibility is exactly what `eligible_observation` enforces, expressed as a
    query: submitted by this caller, naming a farm they still own, and without a
    case already. A screening with no farm is excluded rather than listed and
    then refused, so the UI never offers an action that cannot succeed.

    Returns `[]` when there is nothing eligible. Nothing is invented to populate
    it -- an empty list is the honest answer for an account with no screenings.
    """
    taken = select(MonitoringCase.observation_id)
    rows = (
        db.query(DiseaseObservation, Farm, Crop)
        .join(Farm, Farm.id == DiseaseObservation.farm_id)
        .outerjoin(Crop, Crop.id == DiseaseObservation.crop_id)
        .filter(
            DiseaseObservation.submitted_by == user.id,
            Farm.user_id == user.id,
            DiseaseObservation.id.notin_(taken),
        )
        .order_by(DiseaseObservation.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            'observation_id': observation.id,
            'predicted_class': observation.predicted_class,
            'confidence': observation.confidence,
            'model_version': observation.model_version,
            'screened_at': observation.screened_at.isoformat(),
            'farm_id': farm.id,
            'farm_name': farm.farm_name,
            'crop_id': crop.id if crop is not None else None,
            'crop_name': crop.crop_name if crop is not None else None,
        }
        for observation, farm, crop in rows
    ]


def library_meta() -> dict:
    """The vocabulary this unit uses, so the UI never invents a label."""
    return {
        'stored_statuses': list(STORED_STATUSES),
        'derived_status': STATUS_FOLLOW_UP_DUE,
        'effective_statuses': list(EFFECTIVE_STATUSES),
        'status_meanings': {status: STATUS_MEANING[status] for status in EFFECTIVE_STATUSES},
        'transitions': {status: list(nexts) for status, nexts in TRANSITIONS.items()},
        'symptom_changes': [
            {'value': value, 'meaning': SYMPTOM_CHANGE_MEANING[value]}
            for value in SYMPTOM_CHANGES
        ],
        'follow_up_days': {'min': MIN_FOLLOW_UP_DAYS, 'max': MAX_FOLLOW_UP_DAYS},
        'derivation_note': (
            f'{STATUS_FOLLOW_UP_DUE} is never stored. It is what OPEN or '
            'FOLLOW_UP_SUBMITTED means once due_at has passed, and is computed on '
            'every read.'
        ),
        'note': MONITORING_NOTE,
    }
