"""Field confirmation of image screenings — the ground-truth half of SIH #6.

The platform holds three kinds of claim about the same leaf, and this module
exists to keep the third one from being diluted by the first two:

* **ML screening** — what the model thinks the image resembles. `DiseaseObservation`.
* **Expert validation** — whether a qualified human reviewed that evidence and
  what they concluded, usually without visiting the field. `expert_validation.py`.
* **Field confirmation** — what somebody found by looking at the crop, or what a
  laboratory reported. This module, and the only stream that is ground truth.

Why the distinction is load-bearing
-----------------------------------

A reviewer judging a prediction is looking at the *same image the model looked
at*. Their agreement is not independent evidence that the prediction was right —
it is a second opinion on one photograph. Feeding expert validations into model
evaluation would measure how well the model imitates reviewers of images and
report it as accuracy. Only a field confirmation with ``outcome = 'CONFIRMED'``
breaks out of the image and says what the crop actually had, so only that may
enter evaluation. `agreement_summary` is the only place in this codebase that
computes such a figure, and it reads nothing else.

Four states, three of them stored
---------------------------------

There is no stored ``PENDING``, for the same reasons as in expert validation: it
would need a backfill for every screening that already exists, and a stored
"nobody has checked yet" can disagree with reality while a derived one cannot.

| State | Stored | Means |
| --- | --- | --- |
| `PENDING` | no row | Nobody has checked the crop. No ground truth exists. |
| `CONFIRMED` | row | A confirmer established the condition named in `confirmed_condition`. |
| `NOT_CONFIRMED` | row | A confirmer checked and the screened condition was not found. |
| `UNCERTAIN` | row | A confirmer checked and could not establish any condition. |

``NOT_CONFIRMED`` deliberately does not say what *was* there. A confirmer who
recognises a different condition records ``CONFIRMED`` with that condition; one
who only rules the screened condition out records ``NOT_CONFIRMED``. Because it
names no condition it takes no part in the agreement comparison — see
`agrees_with_screening`.

Who may confirm
---------------

`CONFIRMER_ROLES` adds ``lab`` to the two reviewing roles. Confirming is a field
or bench act rather than a desk review, so a laboratory account belongs here even
though it is not a reviewer. A farmer does not: self-confirmation would make the
model's own suggestion its own ground truth, and every accuracy figure derived
from it would be circular. The database enforces the same list.

Deliberately absent: any confirmer confidence score, and any free-text outcome.
The three outcomes are the whole vocabulary, and every response carries a
`meaning` string for the state it reports so no interface has to phrase it.
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models_db import DiseaseObservation, FieldConfirmation, MonitoringCase, User

logger = logging.getLogger(__name__)

# ── Roles ──────────────────────────────────────────────────────────────────
# The two reviewing roles plus `lab`. Confirming is a field or bench act, so a
# laboratory account may record a result it produced even though it reviews
# nothing and never reaches the review queue.
#
# A farmer is absent on purpose and not as an oversight: self-confirmation would
# make the model's own suggestion its own ground truth, so every accuracy figure
# computed from these rows would be measuring the model against itself.
#
# Roles live in `users.role`, are written server-side only, and are never read
# from a request body or from a client-controlled JWT claim.
CONFIRMER_ROLES = ('expert', 'extension_officer', 'lab')

# ── States ─────────────────────────────────────────────────────────────────
STATE_PENDING = 'PENDING'            # derived from the absence of a row
OUTCOME_CONFIRMED = 'CONFIRMED'
OUTCOME_NOT_CONFIRMED = 'NOT_CONFIRMED'
OUTCOME_UNCERTAIN = 'UNCERTAIN'

# The outcomes a confirmer may actually record.
RECORDABLE_OUTCOMES = (OUTCOME_CONFIRMED, OUTCOME_NOT_CONFIRMED, OUTCOME_UNCERTAIN)
ALL_STATES = (STATE_PENDING,) + RECORDABLE_OUTCOMES

METHODS = ('VISUAL_FIELD_VISIT', 'LABORATORY', 'EXPERT_VISIT')

STATE_MEANING = {
    STATE_PENDING: (
        'Nobody has checked this crop in the field, so no ground truth exists for '
        'this screening. This is the absence of a confirmation, not a finding '
        'about the crop.'
    ),
    OUTCOME_CONFIRMED: (
        'A qualified confirmer examined the crop, or reported a laboratory result, '
        'and states the condition present is confirmed_condition. This is the only '
        'kind of record on this platform that is ground truth. It does not assert '
        'that any treatment was applied, nor that one worked.'
    ),
    OUTCOME_NOT_CONFIRMED: (
        'A qualified confirmer checked and states the screened condition was not '
        'found. It does not state what was found instead, and it is not a finding '
        'that the crop is healthy.'
    ),
    OUTCOME_UNCERTAIN: (
        'A qualified confirmer checked and could not establish any condition. This '
        'is neither ground truth nor a negative result; it records that the '
        'question is still open.'
    ),
}

METHOD_MEANING = {
    'VISUAL_FIELD_VISIT': 'Somebody looked at the crop in the field.',
    'LABORATORY': 'A laboratory tested a sample and reported a result.',
    'EXPERT_VISIT': 'A subject expert examined the crop in person.',
}

# Ground truth without stated evidence is not ground truth. The database enforces
# the same minimum; this constant exists so Python refuses first, with a sentence
# a client can display, instead of surfacing a constraint name.
MIN_EVIDENCE_LENGTH = 10
MAX_EVIDENCE_LENGTH = 2000
MAX_CONDITION_LENGTH = 160         # field_confirmations.confirmed_condition
MAX_SOURCE_REFERENCE_LENGTH = 200  # field_confirmations.source_reference

# The smallest number of confirmed screenings from which an agreement percentage
# is worth printing at all. Below twenty, one result moves the figure by five
# points or more, which is not a measurement of anything -- so the count is
# reported and the percentage is withheld. Mirrors the INSUFFICIENT_DATA contract
# in risk_engine.py and geospatial.py.
MIN_EVALUATION_SAMPLE = 20

STATUS_MEASURED = 'MEASURED'
STATUS_INSUFFICIENT_DATA = 'INSUFFICIENT_DATA'

# Printed on every response that exposes `agrees_with_screening`, because this is
# the sentence the whole module exists to protect.
AGREEMENT_BASIS = (
    "Derived server-side by comparing confirmed_condition with the screening's "
    'predicted_class; never submitted. A field confirmation with outcome CONFIRMED '
    'is the only legitimate input to model evaluation. An expert validation is '
    'not: a reviewer judging a prediction from the same photograph the model saw '
    'is a second opinion on that photograph, not independent evidence that the '
    'prediction was correct.'
)


# ── Authorisation ──────────────────────────────────────────────────────────

def is_confirmer(user: User) -> bool:
    return (user.role or 'farmer') in CONFIRMER_ROLES


def require_confirmer(user: User) -> User:
    """Gate every confirmation route on the server-side role.

    403 rather than 404. The codebase's ownership rule -- a farm you do not own is
    a farm that does not exist -- covers resources whose existence is a secret,
    and the confirmation register is not one. A farmer who reaches it should be
    told plainly why writing here is not theirs to do, and told the reason,
    because the reason is the whole point: self-confirmation would make the
    model's own suggestion its own ground truth.

    The role comes from `users.role`, which is written only by the server.
    """
    if not is_confirmer(user):
        raise HTTPException(
            403,
            'Recording a field confirmation is limited to confirming accounts '
            '(expert, extension officer, laboratory). A farmer cannot confirm a '
            "screening of their own crop: self-confirmation would make the model's "
            'own suggestion its own ground truth. Ask an extension officer or a '
            'laboratory to record what was found.',
        )
    return user


def require_independent_confirmer(
    confirmer: User, observation: DiseaseObservation
) -> User:
    """Refuse a confirmer who is confirming a screening they submitted themselves.

    The role gate above is necessary and not sufficient. It keeps *farmers* out,
    on the stated grounds that self-confirmation would make the model's own
    suggestion its own ground truth -- but a confirming account can submit a
    screening too (`POST /predict` is open to every signed-in role and stamps
    `submitted_by` from the session). Without this check an expert, extension
    officer, or laboratory could photograph a leaf, receive the model's guess,
    and then record that same guess as the confirmed condition. That row is
    `is_ground_truth: True`, it is the only stream `evaluation.py` and
    `agreement_summary` will measure the model against, and it is precisely the
    circularity the whole module claims to prevent -- reached by a different door.

    403 rather than 404, consistently with `require_confirmer`: the screening
    plainly exists, the caller submitted it, and the reason is the point.

    Independence is judged on `submitted_by`, which is the same column every
    other router treats as the whole of the ownership question for a screening,
    and it is written server-side from the authenticated session.
    """
    if observation.submitted_by == confirmer.id:
        raise HTTPException(
            403,
            'You submitted this screening, so you cannot record its field '
            'confirmation. A confirmation is ground truth only because it is '
            "independent of the screening it judges: confirming your own would "
            "make the model's own suggestion its own ground truth and would make "
            'every agreement figure derived from it circular. Ask another '
            'confirmer -- an extension officer, an expert, or a laboratory -- to '
            'record what was found.',
        )
    return confirmer


# ── Validation ─────────────────────────────────────────────────────────────

def normalise_confirmation(
    outcome: str,
    confirmed_condition: str | None,
    method: str,
    evidence_notes: str | None,
    source_reference: str | None,
) -> tuple[str, str | None, str, str, str | None]:
    """Validate one submission against the outcome semantics.

    Every rule here is a meaning rather than paperwork:

    * ``CONFIRMED`` names what was found, so `confirmed_condition` is required.
    * ``NOT_CONFIRMED`` and ``UNCERTAIN`` state that no condition was
      established, so a condition alongside them contradicts the outcome. It is
      refused with 422 rather than silently dropped -- a caller who sent one
      believes something this row will not say, and quietly discarding it would
      leave them believing it.
    * `evidence_notes` is required for all three, at ten characters or more.
      Ground truth is only as good as the account of how it was reached, and this
      is the record a future model would be trained against.
    * `method` is required for all three. How a condition was established is part
      of the evidence: a laboratory result and a glance across a field are not
      interchangeable, and a reader must be able to tell them apart.

    `confirmed_condition` is free text, not one of the model's 38 classes. A
    confirmer may find a condition the model has no class for -- it covers 14
    crops and this platform's farmers grow others -- and a confirmation squeezed
    into the model's vocabulary would no longer be ground truth about the field,
    only about the model.

    Returns the cleaned values in write order, so a caller cannot use the raw
    ones by accident.
    """
    outcome = (outcome or '').strip().upper()
    if outcome not in RECORDABLE_OUTCOMES:
        raise HTTPException(
            422,
            f'Outcome must be one of: {", ".join(RECORDABLE_OUTCOMES)}. '
            f'{STATE_PENDING} is the absence of a confirmation and cannot be recorded.',
        )

    method = (method or '').strip().upper()
    if method not in METHODS:
        raise HTTPException(
            422,
            f'Method must be one of: {", ".join(METHODS)}. How the condition was '
            'established is part of the evidence, so it cannot be omitted.',
        )

    confirmed_condition = (confirmed_condition or '').strip() or None
    evidence_notes = (evidence_notes or '').strip() or None
    source_reference = (source_reference or '').strip() or None

    if confirmed_condition and len(confirmed_condition) > MAX_CONDITION_LENGTH:
        raise HTTPException(
            422, f'A confirmed condition may be at most {MAX_CONDITION_LENGTH} characters.'
        )
    if source_reference and len(source_reference) > MAX_SOURCE_REFERENCE_LENGTH:
        raise HTTPException(
            422,
            f'A source reference may be at most {MAX_SOURCE_REFERENCE_LENGTH} '
            'characters. It is a report or visit number, not a narrative.',
        )
    if evidence_notes and len(evidence_notes) > MAX_EVIDENCE_LENGTH:
        raise HTTPException(
            422, f'Evidence notes may be at most {MAX_EVIDENCE_LENGTH} characters.'
        )

    if not evidence_notes or len(evidence_notes) < MIN_EVIDENCE_LENGTH:
        raise HTTPException(
            422,
            f'Evidence notes of at least {MIN_EVIDENCE_LENGTH} characters are '
            'required, stating what was seen or tested. A confirmation without '
            'stated evidence is not ground truth.',
        )

    if outcome == OUTCOME_CONFIRMED:
        if not confirmed_condition:
            raise HTTPException(
                422,
                'A CONFIRMED outcome must name the condition found. Provide '
                'confirmed_condition, or record NOT_CONFIRMED if the screened '
                'condition was ruled out, or UNCERTAIN if the check established '
                'nothing.',
            )
    elif confirmed_condition:
        raise HTTPException(
            422,
            f'{outcome} states that no condition was established, so '
            'confirmed_condition must be omitted -- naming one would contradict '
            'the outcome. Record CONFIRMED if a condition was in fact established.',
        )

    return outcome, confirmed_condition, method, evidence_notes, source_reference


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _revised_at(confirmation: FieldConfirmation) -> str | None:
    """When this finding was changed after first being recorded, or None.

    Read from `confirmed_at` against `created_at`, and deliberately **not** from
    `updated_at` against `created_at`. Both column defaults fire on the same
    INSERT but are two separate clock reads, so on a freshly written row they
    differ by a few microseconds -- comparing them reports a revision on a row
    nobody has revised. That is a small fabrication, and this module exists to
    refuse exactly those.

    `confirmed_at` is derived in `record_confirmation` *before* the INSERT, so on
    a new row it is never later than `created_at`; only `revise_confirmation`
    moves it past that point, and it cannot do so in under the round trip that
    carried the revision. Where the two are indistinguishable the answer is
    "not revised", which under-claims rather than over-claims.
    """
    if confirmation.created_at is None or confirmation.confirmed_at is None:
        return None
    if confirmation.confirmed_at <= confirmation.created_at:
        return None
    return (confirmation.updated_at or confirmation.confirmed_at).isoformat()


def agrees_with_screening(
    outcome: str | None,
    confirmed_condition: str | None,
    predicted_class: str | None,
) -> bool | None:
    """Whether what was found in the field is what the model predicted.

    Derived, never submitted, and `None` wherever the comparison has no meaning:

    * no confirmation, so there is nothing to compare;
    * ``UNCERTAIN``, which established nothing;
    * ``NOT_CONFIRMED``, which rules the screened condition out without naming
      what was there. It is tempting to score that as a disagreement, and it is
      deliberately not scored at all: "not this" and "something else instead" are
      different claims, and only a row that names a condition can support a
      comparison of classes;
    * no `predicted_class` supplied, which is a missing input rather than a
      negative answer.

    Compared case-insensitively on the trimmed strings, exactly as
    `expert_validation._agrees` does, so the two figures stay comparable.
    """
    if outcome != OUTCOME_CONFIRMED or not confirmed_condition or not predicted_class:
        return None
    return confirmed_condition.strip().lower() == predicted_class.strip().lower()


# ── Reading one confirmation ───────────────────────────────────────────────

def confirmation_state(
    confirmation: FieldConfirmation | None,
    predicted_class: str | None = None,
) -> dict:
    """The confirmation state of one screening, for a confirmer or its own farmer.

    Exported for the existing `/screenings` router: a farmer must be able to see
    the confirmation recorded on their own screening, and that read belongs here
    beside the semantics rather than duplicated there. Callable with the
    confirmation alone, which is why `predicted_class` has a default -- pass the
    screening's `predicted_class` to get `agrees_with_screening`, and it stays
    `None` if you do not, because a comparison that was not made must not report
    an answer.

    Safe for a farmer as well as a confirmer: it carries the outcome, the
    evidence, and the confirmer's *role*, never their name. Which named
    agronomist or laboratory recorded a finding is not something a farmer needs,
    and naming them invites pressure to change it.
    """
    if confirmation is None:
        return {
            'state': STATE_PENDING,
            'outcome': None,
            'meaning': STATE_MEANING[STATE_PENDING],
            'is_ground_truth': False,
            'confirmed_condition': None,
            'method': None,
            'method_meaning': None,
            'evidence_notes': None,
            'source_reference': None,
            'confirmer_role': None,
            'confirmed_at': None,
            'revised_at': None,
            'case_id': None,
            'agrees_with_screening': None,
            'agreement_basis': AGREEMENT_BASIS,
        }
    return {
        # `state` is the derived lifecycle position and `outcome` is what is
        # stored. They differ only in the PENDING case, and carrying both means no
        # reader has to know that PENDING is not a storable outcome.
        'state': confirmation.outcome,
        'outcome': confirmation.outcome,
        'meaning': STATE_MEANING[confirmation.outcome],
        # Stated as its own field rather than left for an interface to infer from
        # the outcome name, because "confirmed" is the word most likely to be
        # over-read.
        'is_ground_truth': confirmation.outcome == OUTCOME_CONFIRMED,
        'confirmed_condition': confirmation.confirmed_condition,
        'method': confirmation.method,
        'method_meaning': METHOD_MEANING.get(confirmation.method),
        'evidence_notes': confirmation.evidence_notes,
        'source_reference': confirmation.source_reference,
        'confirmer_role': confirmation.confirmer_role,
        'confirmed_at': confirmation.confirmed_at.isoformat(),
        'revised_at': _revised_at(confirmation),
        'case_id': confirmation.case_id,
        'agrees_with_screening': agrees_with_screening(
            confirmation.outcome, confirmation.confirmed_condition, predicted_class
        ),
        'agreement_basis': AGREEMENT_BASIS,
    }


def confirmation_context(
    observation: DiseaseObservation,
    confirmation: FieldConfirmation | None,
) -> dict:
    """What a confirmer sees about one screening, and the confirmation on it.

    Built by allow-list, like `expert_validation.review_context`: no farmer name,
    email, phone, account identifier, farm name, or coordinates. A confirmer
    recording what was found does not need the farmer's identity from this
    endpoint, and arranging an actual visit runs through referrals rather than
    here.
    """
    return {
        'observation_id': observation.id,
        'screening': {
            'predicted_class': observation.predicted_class,
            'confidence': observation.confidence,
            'top_predictions': observation.top_predictions,
            'model_version': observation.model_version,
            'screened_at': observation.screened_at.isoformat(),
            'claim': (
                'A machine-learning prediction from a photograph. Not a diagnosis, '
                'and not evidence of what the crop has.'
            ),
        },
        'confirmation': confirmation_state(confirmation, observation.predicted_class),
        'expert_validation_note': (
            'An expert validation, if one exists, is recorded separately under '
            '/validation and is not ground truth. Only this confirmation is.'
        ),
        'privacy': (
            'Farmer identity is not included in this response by design: no name, '
            'email, phone, account identifier, farm name, or coordinates.'
        ),
    }


def confirmation_for(db: Session, observation_id: int) -> FieldConfirmation | None:
    return (
        db.query(FieldConfirmation)
        .filter(FieldConfirmation.observation_id == observation_id)
        .first()
    )


def confirmations_for(db: Session, observation_ids: list[int]) -> dict[int, FieldConfirmation]:
    """Confirmations for many screenings at once, so a list view is one query."""
    if not observation_ids:
        return {}
    rows = (
        db.query(FieldConfirmation)
        .filter(FieldConfirmation.observation_id.in_(observation_ids))
        .all()
    )
    return {row.observation_id: row for row in rows}


def _case_id_for(db: Session, observation_id: int) -> int | None:
    """The monitoring case on this screening, if one was opened.

    Derived, never taken from the request: `case_id` is a claim about which
    monitoring thread this ground truth belongs to, and a client able to set it
    could attach a confirmation to somebody else's case. `monitoring_cases` has a
    UNIQUE `observation_id`, so the lookup is unambiguous, and NULL when no case
    exists -- a confirmation stands on the screening and does not need a case to
    be valid.
    """
    case = (
        db.query(MonitoringCase)
        .filter(MonitoringCase.observation_id == observation_id)
        .first()
    )
    return case.id if case else None


# ── Writing ────────────────────────────────────────────────────────────────

# The UNIQUE index behind the one-confirmation-per-screening rule. Postgres names
# it `<table>_<column>_key`; the fallback substring check keeps this working if a
# migration ever renames it, and the driver's `diag` is preferred because it is
# exact rather than a scan of an error message.
DUPLICATE_CONSTRAINT = 'field_confirmations_observation_id_key'


def _is_duplicate_observation(exc: IntegrityError) -> bool:
    """Whether this IntegrityError is the duplicate-confirmation one, not another."""
    diagnostic = getattr(getattr(exc, 'orig', None), 'diag', None)
    name = getattr(diagnostic, 'constraint_name', None)
    if name:
        return name == DUPLICATE_CONSTRAINT
    # No structured diagnostic (a non-psycopg driver, or a wrapped error): fall
    # back to the text, and require both the constraint's subject and the fact
    # that it was a uniqueness failure.
    text = str(exc).lower()
    return DUPLICATE_CONSTRAINT in text or (
        'unique' in text and 'observation_id' in text
    )


def record_confirmation(
    db: Session,
    confirmer: User,
    observation: DiseaseObservation,
    outcome: str,
    confirmed_condition: str | None,
    method: str,
    evidence_notes: str | None,
    source_reference: str | None = None,
) -> FieldConfirmation:
    """Record the first ground truth for one screening.

    `confirmed_by`, `confirmer_role`, and `confirmed_at` are all derived here from
    the authenticated session, so a client cannot attribute a confirmation to
    somebody else, claim a confirming role it does not hold, or backdate a field
    visit. `confirmer_role` is stored as it was at this moment because roles
    change and a finding must stay interpretable afterwards.

    One confirmation per screening, enforced by the unique constraint rather than
    by a prior read, so two confirmers submitting at the same instant cannot both
    succeed -- ground truth about one screening is one fact, and two competing
    rows would make any evaluation arbitrary. The loser is told to revise.

    Only that unique violation becomes a 409. A check-constraint or foreign-key
    failure is a different fault, and answering it with "already confirmed" would
    state a confirmation exists when none does.
    """
    outcome, confirmed_condition, method, evidence_notes, source_reference = (
        normalise_confirmation(
            outcome, confirmed_condition, method, evidence_notes, source_reference
        )
    )
    confirmation = FieldConfirmation(
        observation_id=observation.id,
        case_id=_case_id_for(db, observation.id),
        confirmed_by=confirmer.id,
        confirmer_role=confirmer.role or 'farmer',
        outcome=outcome,
        confirmed_condition=confirmed_condition,
        method=method,
        evidence_notes=evidence_notes,
        source_reference=source_reference,
        confirmed_at=_now(),
    )
    db.add(confirmation)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Only the UNIQUE violation on `observation_id` is a duplicate. Any other
        # IntegrityError -- a check constraint, a foreign key -- is a different
        # failure, and reporting it as 409 "already confirmed" would tell the
        # caller a confirmation exists when none does, and point them at a PATCH
        # that will then 404. Anything unrecognised is surfaced as a 500 rather
        # than described wrongly.
        if not _is_duplicate_observation(exc):
            logger.exception(
                'Confirmation of screening %s failed on an unexpected constraint',
                observation.id,
            )
            raise HTTPException(
                500, 'Unable to record this field confirmation right now.'
            )
        raise HTTPException(
            409,
            'This screening already has a field confirmation. Use PATCH to revise '
            'the existing one; a second confirmation would make the ground truth '
            'ambiguous.',
        )
    db.refresh(confirmation)
    logger.info(
        'Screening %s confirmed: outcome=%s method=%s confirmer=%s role=%s',
        observation.id, outcome, method, confirmer.id, confirmation.confirmer_role,
    )
    return confirmation


def revise_confirmation(
    db: Session,
    confirmer: User,
    observation: DiseaseObservation,
    confirmation: FieldConfirmation,
    outcome: str,
    confirmed_condition: str | None,
    method: str,
    evidence_notes: str | None,
    source_reference: str | None = None,
) -> FieldConfirmation:
    """Replace the existing confirmation with a new finding.

    A full replacement rather than a partial patch: changing the outcome from
    CONFIRMED to UNCERTAIN must clear `confirmed_condition`, and a partial update
    in which the condition could be left behind would produce exactly the
    contradiction the check constraint exists to prevent.

    Any confirmer may revise -- a laboratory result properly supersedes a visual
    field check, and restricting revision to the original confirmer would strand
    a screening whenever they were unavailable. The revising confirmer becomes
    the recorded one and `updated_at` moves, so a reader can see the finding was
    changed after first being recorded.

    Only the latest finding is kept. A full revision history is a separate
    feature with its own retention question; the honest thing is to name that as
    a limitation rather than invent an audit table nobody reads.
    """
    outcome, confirmed_condition, method, evidence_notes, source_reference = (
        normalise_confirmation(
            outcome, confirmed_condition, method, evidence_notes, source_reference
        )
    )
    confirmation.outcome = outcome
    confirmation.confirmed_condition = confirmed_condition
    confirmation.method = method
    confirmation.evidence_notes = evidence_notes
    confirmation.source_reference = source_reference
    confirmation.confirmed_by = confirmer.id
    confirmation.confirmer_role = confirmer.role or 'farmer'
    confirmation.confirmed_at = _now()
    # Re-derived rather than left as it was: a monitoring case may have been
    # opened between the first confirmation and this revision.
    confirmation.case_id = _case_id_for(db, observation.id)
    db.commit()
    db.refresh(confirmation)
    logger.info(
        'Screening %s confirmation revised: outcome=%s confirmer=%s',
        observation.id, outcome, confirmer.id,
    )
    return confirmation


# ── The register ───────────────────────────────────────────────────────────

def parse_outcome_filter(raw: str | None) -> tuple[str, ...]:
    """Validate a comma-separated state filter, defaulting to everything.

    Accepts `PENDING` even though it is never stored: "which screenings still
    have no ground truth" is the most useful question a confirmer can ask, and it
    is answered by the absence of a row.
    """
    if not raw or not raw.strip():
        return ALL_STATES
    requested = tuple(part.strip().upper() for part in raw.split(',') if part.strip())
    unknown = [part for part in requested if part not in ALL_STATES]
    if unknown:
        raise HTTPException(
            422,
            f'Unknown outcome {unknown[0]!r}. Use one or more of: '
            f'{", ".join(ALL_STATES)}.',
        )
    return tuple(state for state in ALL_STATES if state in requested)


def confirmation_register(
    db: Session,
    states: tuple[str, ...],
    limit: int,
    offset: int,
) -> tuple[list[dict], int, dict[str, int]]:
    """Screenings and the confirmation each one holds, newest first.

    Platform-wide, the same deliberate authorisation decision as the review
    queue: confirmers do not submit screenings, so a register scoped to their own
    farms would always be empty and the capability would not exist. What bounds
    the exposure is what each row shows -- no farmer identity, no farm name, no
    coordinates.

    Returns `(items, total_matching, counts_by_state)`. The counts are over every
    screening rather than the filtered page, so a client can see how much ground
    truth exists without a second request.
    """
    rows = (
        db.query(DiseaseObservation)
        .order_by(DiseaseObservation.screened_at.desc())
        .all()
    )
    found = confirmations_for(db, [row.id for row in rows])

    counts = {state: 0 for state in ALL_STATES}
    selected = []
    for row in rows:
        confirmation = found.get(row.id)
        state = confirmation.outcome if confirmation else STATE_PENDING
        counts[state] += 1
        if state in states:
            selected.append((row, confirmation))

    page = selected[offset:offset + limit]
    return [_register_item(row, c) for row, c in page], len(selected), counts


def _register_item(observation: DiseaseObservation, confirmation) -> dict:
    """One register row: enough to triage, without the full evidence text."""
    outcome = confirmation.outcome if confirmation else None
    return {
        'observation_id': observation.id,
        'predicted_class': observation.predicted_class,
        'confidence': observation.confidence,
        'model_version': observation.model_version,
        'screened_at': observation.screened_at.isoformat(),
        'farm_id': observation.farm_id,
        'state': outcome or STATE_PENDING,
        'outcome': outcome,
        'is_ground_truth': outcome == OUTCOME_CONFIRMED,
        'confirmed_condition': confirmation.confirmed_condition if confirmation else None,
        'method': confirmation.method if confirmation else None,
        'confirmer_role': confirmation.confirmer_role if confirmation else None,
        'confirmed_at': confirmation.confirmed_at.isoformat() if confirmation else None,
        'agrees_with_screening': agrees_with_screening(
            outcome,
            confirmation.confirmed_condition if confirmation else None,
            observation.predicted_class,
        ),
    }


# ── Model evaluation, or the honest refusal to report one ───────────────────

def agreement_summary(rows: list[tuple[str, str, str]]) -> dict:
    """How often confirmed ground truth matched the screening, per model version.

    `rows` are `(model_version, predicted_class, confirmed_condition)` for
    CONFIRMED confirmations only. Pure, so the arithmetic is testable without a
    database.

    Grouped by `model_version` and never pooled across versions. A pooled figure
    would attribute one model's mistakes to another and would drift every time a
    model is replaced; a version with a small sample stays visibly small rather
    than being hidden inside a larger total.

    A row whose comparison cannot be made -- no `predicted_class`, or no
    `confirmed_condition` -- is counted in `not_comparable` and excluded from both
    the rate and the sample. Scoring it as a disagreement would invent a model
    error from absent data and would let unscoreable rows push a version over
    `MIN_EVALUATION_SAMPLE`, publishing a percentage no confirmation supports.

    Below `MIN_EVALUATION_SAMPLE` comparable confirmations a version reports
    `INSUFFICIENT_DATA` with the shortfall itemised and **no percentage at all**.
    A rate with a caveat attached gets quoted without the caveat. The counts are
    still reported, because a count of what exists is a fact rather than a
    statistic.
    """
    groups: dict[str, dict] = {}
    not_comparable = 0
    for model_version, predicted_class, confirmed_condition in rows:
        agrees = agrees_with_screening(
            OUTCOME_CONFIRMED, confirmed_condition, predicted_class
        )
        # `None` means the comparison could not be made -- a missing
        # `predicted_class` or a missing `confirmed_condition`. It is NOT a
        # disagreement, and scoring it as one would invent a model error out of
        # absent data and, worse, count toward MIN_EVALUATION_SAMPLE so that
        # unscoreable rows could carry a version over the gate and produce a
        # published percentage no confirmation supports. Counted separately and
        # excluded from both the numerator and the denominator.
        if agrees is None:
            not_comparable += 1
            groups.setdefault(model_version, {'agreed': 0, 'disagreed': 0, 'not_comparable': 0})
            groups[model_version]['not_comparable'] += 1
            continue
        group = groups.setdefault(
            model_version, {'agreed': 0, 'disagreed': 0, 'not_comparable': 0}
        )
        if agrees:
            group['agreed'] += 1
        else:
            group['disagreed'] += 1

    versions = []
    for model_version in sorted(groups):
        agreed = groups[model_version]['agreed']
        disagreed = groups[model_version]['disagreed']
        unscoreable = groups[model_version]['not_comparable']
        total = agreed + disagreed
        entry = {
            'model_version': model_version,
            'confirmed_ground_truth': total,
            'agreed_with_screening': agreed,
            'disagreed_with_screening': disagreed,
            # Reported rather than dropped: a row that exists but cannot be
            # scored is a fact about the data, and hiding it would make the
            # denominator unexplainable.
            'not_comparable': unscoreable,
        }
        if total < MIN_EVALUATION_SAMPLE:
            entry['status'] = STATUS_INSUFFICIENT_DATA
            entry['shortfall'] = {
                'confirmed_ground_truth_required': MIN_EVALUATION_SAMPLE,
                'confirmed_ground_truth_available': total,
                'short_by': MIN_EVALUATION_SAMPLE - total,
            }
            entry['meaning'] = (
                f'{total} confirmed field result(s) for {model_version}. '
                f'{MIN_EVALUATION_SAMPLE} are needed before an agreement rate means '
                'anything, because below that one result moves the figure by more '
                'than five points. No rate is reported.'
            )
        else:
            entry['status'] = STATUS_MEASURED
            entry['agreement_percent'] = round(100.0 * agreed / total, 1)
            entry['meaning'] = (
                f'Of {total} screenings whose condition was confirmed in the field '
                f'under {model_version}, the model had predicted the confirmed '
                f'condition {agreed} time(s).'
            )
        versions.append(entry)

    measured = [v for v in versions if v['status'] == STATUS_MEASURED]
    return {
        'status': STATUS_MEASURED if measured else STATUS_INSUFFICIENT_DATA,
        'minimum_sample_per_model_version': MIN_EVALUATION_SAMPLE,
        # The comparable rows only. `len(rows)` would include rows whose
        # comparison could not be made, which is not an amount of ground truth
        # any figure here rests on.
        'total_confirmed_ground_truth': len(rows) - not_comparable,
        'not_comparable': not_comparable,
        'by_model_version': versions,
        'meaning': (
            'Agreement between the model and confirmed field results, reported per '
            'model version.' if measured else
            'No model version yet has enough confirmed field results to support an '
            'agreement rate. The counts below are what exists; nothing is estimated.'
        ),
        'basis': AGREEMENT_BASIS,
        'excluded': (
            'Expert validations are excluded, as are NOT_CONFIRMED and UNCERTAIN '
            'confirmations. NOT_CONFIRMED rules the screened condition out without '
            'naming what was present, so it cannot be compared class to class.'
        ),
    }


def screening_agreement(db: Session) -> dict:
    """`agreement_summary` over every CONFIRMED row in the database."""
    rows = (
        db.query(
            DiseaseObservation.model_version,
            DiseaseObservation.predicted_class,
            FieldConfirmation.confirmed_condition,
        )
        .join(FieldConfirmation, FieldConfirmation.observation_id == DiseaseObservation.id)
        .filter(FieldConfirmation.outcome == OUTCOME_CONFIRMED)
        .all()
    )
    return agreement_summary([tuple(row) for row in rows])
