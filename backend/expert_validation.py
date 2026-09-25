"""Expert validation of image screenings (SIH #6).

The platform holds three different kinds of claim about a leaf, and this module
exists to keep the second one from being confused with the first:

* **ML screening** — what the model thinks the image resembles. Already stored as
  `DiseaseObservation`.
* **Expert validation** — whether an authorised human reviewed that evidence, and
  what they concluded. This module.
* **Field confirmation** — what was actually found on the ground. A later phase,
  and the only thing that would ever justify the word "confirmed".

`VALIDATED` therefore means exactly one thing: *an authorised reviewer looked at
the available evidence and recorded a conclusion.* It does not mean the model was
right, it is not a laboratory result, and it is not an official determination.
The API says so in words as well as in the status name.

Four lifecycle states, three of them stored
-------------------------------------------

`PENDING` is **the absence of a validation row**, never a stored value. That is
the smallest defensible model: it needs no backfill for the screenings that
already exist, it cannot drift out of sync with reality, and it makes "nobody has
looked yet" structurally different from "somebody looked and could not decide".

| State | Stored | Means |
| --- | --- | --- |
| `PENDING` | no row | No reviewer has recorded a conclusion |
| `VALIDATED` | row | A reviewer reviewed the evidence and states the condition is `validated_class` |
| `REJECTED` | row | A reviewer reviewed the evidence and states it supports no condition assessment |
| `NEEDS_REVIEW` | row | A reviewer looked and cannot conclude from the evidence available; more is needed |

`NEEDS_REVIEW` is deliberately distinct from `PENDING`. One is a reviewer's
finding — the evidence is insufficient — and the other is a queue position.

What a reviewer may see
-----------------------

Reviewing needs agronomic context, not the farmer's identity. `review_context`
is the whole of it, and it is built by allow-list rather than by removing fields
from a farmer-facing shape: name, email, phone, auth id, and farm name never
enter it, and neither do coordinates. District and state do, because the likely
pathogens for a crop depend on where it grows. See backend/docs/EXPERT_VALIDATION.md.

No expert confidence score
--------------------------

Deliberately absent. A reviewer's subjective certainty is not calibrated against
anything, so a number would invite arithmetic it cannot support — averaging it,
thresholding it, comparing it to the model's confidence. `review_notes` carries
the reviewer's reasoning in their own words instead.
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from image_store import image_accessible
from models_db import Crop, DiseaseObservation, ExpertValidation, Farm, FarmLocation, User

logger = logging.getLogger(__name__)

# ── Roles ──────────────────────────────────────────────────────────────────
# From backend/docs/PRODUCT_ARCHITECTURE.md section 4: only these two may write an
# ExpertValidation. `official` and `admin` may reach the official dashboard but
# are not reviewers -- reviewing is an agronomic act, not an administrative one.
#
# Roles live in the existing `users.role` column and are set server-side only.
# There is no endpoint through which a caller can change their own role.
REVIEWER_ROLES = ('expert', 'extension_officer')

# ── Statuses ───────────────────────────────────────────────────────────────
STATUS_PENDING = 'PENDING'          # derived from the absence of a row
STATUS_VALIDATED = 'VALIDATED'
STATUS_REJECTED = 'REJECTED'
STATUS_NEEDS_REVIEW = 'NEEDS_REVIEW'

# The statuses a reviewer may actually record.
RECORDABLE_STATUSES = (STATUS_VALIDATED, STATUS_REJECTED, STATUS_NEEDS_REVIEW)
ALL_STATUSES = (STATUS_PENDING,) + RECORDABLE_STATUSES

STATUS_MEANING = {
    STATUS_PENDING: (
        'No reviewer has recorded a conclusion. This is the absence of a review, '
        'not a finding about the crop.'
    ),
    STATUS_VALIDATED: (
        'An authorised reviewer examined the available evidence and recorded a '
        'condition. It is not a laboratory result and not an official '
        'determination.'
    ),
    STATUS_REJECTED: (
        'An authorised reviewer examined the available evidence and concluded it '
        'supports no condition assessment.'
    ),
    STATUS_NEEDS_REVIEW: (
        'An authorised reviewer looked and could not conclude from the evidence '
        'available. More evidence is needed.'
    ),
}

# A rejection or an escalation without a stated reason is not reviewable, and
# neither is a reclassification that departs from the model's prediction.
MIN_NOTE_LENGTH = 10
MAX_NOTE_LENGTH = 2000
MAX_CLASS_LENGTH = 160


# ── Authorisation ──────────────────────────────────────────────────────────

def is_reviewer(user: User) -> bool:
    return (user.role or 'farmer') in REVIEWER_ROLES


def require_reviewer(user: User) -> User:
    """Gate every reviewer route on the server-side role.

    403 rather than 404: unlike a farm, the review queue is not a resource whose
    existence is a secret. A farmer who reaches it should be told plainly that
    reviewing is not theirs to do, not misled into thinking the queue is missing.

    The role comes from `users.role`, which is written only by the server. It is
    never read from the request body or from a JWT claim the client controls.
    """
    if not is_reviewer(user):
        raise HTTPException(
            403,
            'Expert review is limited to reviewing accounts. '
            'Your account does not have reviewer access.',
        )
    return user


# ── The prediction/crop consistency signal ─────────────────────────────────
# The model's 38 classes are all `Crop___Condition`, and the screening may carry
# the crop the farmer actually recorded. When the two disagree, the prediction
# cannot be right whatever the image shows -- and that is visible from metadata
# alone, without the photograph. It remains useful for legacy screenings and any
# image that is unavailable because consent, retention, or storage did not permit it.
#
# Reported, never acted on: this module does not auto-reject anything.

def predicted_crop(predicted_class: str) -> str | None:
    """The crop the model's class belongs to, or None if the class is unprefixed."""
    if '___' not in predicted_class:
        return None
    return predicted_class.split('___', 1)[0].replace('_', ' ').strip()


def crop_consistency(predicted_class: str, crop_name: str | None) -> dict:
    """Whether the predicted class could apply to the recorded crop.

    Three outcomes, and `unknown` is an honest one: with no crop recorded there
    is nothing to compare, and with an unprefixed class there is no crop in the
    prediction.
    """
    model_crop = predicted_crop(predicted_class)
    if crop_name is None or model_crop is None:
        return {
            'state': 'unknown',
            'predicted_crop': model_crop,
            'recorded_crop': crop_name,
            'note': (
                'No recorded crop to compare against.' if crop_name is None
                else 'The predicted class names no crop.'
            ),
        }

    # Compared loosely: the model writes "Pepper,_bell" and "Corn_(maize)", and a
    # farmer types "Bell pepper" or "Maize". A shared word is enough to call it
    # consistent; anything stricter would produce false alarms.
    model_words = {w for w in model_crop.lower().replace(',', ' ').replace('(', ' ')
                   .replace(')', ' ').split() if len(w) > 2}
    crop_words = {w for w in crop_name.lower().replace(',', ' ').split() if len(w) > 2}
    if model_words & crop_words:
        return {
            'state': 'consistent',
            'predicted_crop': model_crop,
            'recorded_crop': crop_name,
            'note': 'The predicted class belongs to the recorded crop.',
        }
    return {
        'state': 'mismatch',
        'predicted_crop': model_crop,
        'recorded_crop': crop_name,
        'note': (
            f'The model predicted a {model_crop} condition, but the recorded crop is '
            f'{crop_name}. The model covers 14 crops and cannot identify a condition '
            'on a crop outside them, so this prediction is unreliable regardless of '
            'the image.'
        ),
    }


# ── What a reviewer is shown ───────────────────────────────────────────────

def review_context(
    db: Session,
    observation: DiseaseObservation,
    validation: ExpertValidation | None,
) -> dict:
    """The evidence a reviewer may see for one screening.

    Built by allow-list. Nothing about the submitting farmer is included: not
    their name, email, phone, or auth identifier, and not the farm's name.
    `farm_id` is an opaque integer, present only so a reviewer can tell two
    fields apart. District and state come from the farm's recorded location
    because the plausible pathogens for a crop depend on region; the coordinates
    themselves do not, and are withheld.
    """
    crop = db.get(Crop, observation.crop_id) if observation.crop_id else None
    location = None
    if observation.farm_id is not None:
        location = (
            db.query(FarmLocation)
            .filter(FarmLocation.farm_id == observation.farm_id)
            .order_by(FarmLocation.id.desc())
            .first()
        )

    return {
        'observation_id': observation.id,
        # ── The screening itself ──
        'screening': {
            'predicted_class': observation.predicted_class,
            'confidence': observation.confidence,
            'top_predictions': observation.top_predictions,
            'model_version': observation.model_version,
            'screened_at': observation.screened_at.isoformat(),
            'claim': (
                'A machine-learning prediction from a photograph. Not a diagnosis.'
            ),
        },
        # ── Agronomic context, without identity ──
        'context': {
            'farm_id': observation.farm_id,
            'crop_id': observation.crop_id,
            'crop_name': crop.crop_name if crop else None,
            'crop_variety': crop.variety if crop else None,
            'crop_stage': crop.current_stage if crop else None,
            'sowing_date': crop.sowing_date.isoformat() if crop and crop.sowing_date else None,
            'district': location.district if location else None,
            'state': location.state if location else None,
            'has_recorded_position': observation.latitude is not None,
        },
        'crop_consistency': crop_consistency(
            observation.predicted_class, crop.crop_name if crop else None
        ),
        # ── The image ──
        'image': {
            'available': image_accessible(observation),
            'sha256': observation.image_hash,
            'reason': (
                None if image_accessible(observation) else
                'No reviewable photograph is currently available for this screening. '
                'Review the metadata below, or record NEEDS_REVIEW if the image is '
                'essential to a conclusion.'
            ),
        },
        'validation': validation_state(validation),
        'privacy': (
            'Farmer identity is not included in this response by design: no name, '
            'email, phone, account identifier, farm name, or coordinates.'
        ),
    }


def validation_state(validation: ExpertValidation | None) -> dict:
    """The validation state of one screening, for a reviewer or its own farmer.

    Safe for both audiences: it carries the verdict and the reviewer's notes, and
    identifies the reviewer only by role. Which named agronomist reviewed a
    screening is not something a farmer needs, and exposing it invites pressure
    on the reviewer.
    """
    if validation is None:
        return {
            'status': STATUS_PENDING,
            'meaning': STATUS_MEANING[STATUS_PENDING],
            'validated_class': None,
            'review_notes': None,
            'reviewed_at': None,
            'reviewer_role': None,
            'agrees_with_model': None,
            'is_laboratory_confirmed': False,
            'is_field_confirmed': False,
        }
    return {
        'status': validation.status,
        'meaning': STATUS_MEANING[validation.status],
        'validated_class': validation.validated_class,
        'review_notes': validation.review_notes,
        'reviewed_at': validation.reviewed_at.isoformat(),
        'revised_at': (
            validation.updated_at.isoformat()
            if validation.updated_at and validation.updated_at != validation.created_at
            else None
        ),
        'reviewer_role': validation.reviewer_role,
        'agrees_with_model': validation.agrees_with_model,
        # Stated explicitly on every response, because "validated" is the word
        # most likely to be over-read.
        'is_laboratory_confirmed': False,
        'is_field_confirmed': False,
    }


# ── What a farmer is allowed to conclude ───────────────────────────────────

def farmer_claim(
    validation: ExpertValidation | None,
    predicted_class: str,
    confidence: float,
) -> dict:
    """The condition a farmer may be told about, and nothing more.

    A model prediction is not a finding. Until an authorised reviewer has recorded
    one, the farmer is shown that their screening was submitted and is awaiting
    review -- not the class, the confidence, or anything derived from them. This is
    the single place that decides that, so the predict response, the farmer's own
    screening list, and the single-screening view cannot drift apart and each
    decide for itself what to reveal.

    `VALIDATED` is the only status that carries a condition: `normalise_review`
    refuses a class on any other status, so this reads the stored data rather than
    re-deciding what a verdict means.

    `predicted_class` and `confidence` are intentionally withheld from this return
    value. The raw model output is an internal artefact; the reviewer reads it
    through `review_context`, which is a separate, reviewer-gated code path. A
    farmer-facing response must never carry `predicted_class` or `confidence`,
    regardless of validation status.
    """
    status = STATUS_PENDING if validation is None else validation.status
    if validation is None or status != STATUS_VALIDATED:
        return {
            'status': status,
            'meaning': STATUS_MEANING[status],
            'awaiting_review': True,
            'condition': None,
        }
    return {
        'status': STATUS_VALIDATED,
        'meaning': STATUS_MEANING[STATUS_VALIDATED],
        'awaiting_review': False,
        # The reviewer's conclusion, stated as free text. May be shown to the farmer.
        'condition': validation.validated_class,
    }


# ── Recording a review ─────────────────────────────────────────────────────

def normalise_review(
    status: str,
    validated_class: str | None,
    review_notes: str | None,
    predicted_class: str,
) -> tuple[str, str | None, str | None]:
    """Validate one review submission against the status semantics.

    The rules are the semantics, not paperwork:

    * `VALIDATED` states a condition, so `validated_class` is required.
    * `REJECTED` and `NEEDS_REVIEW` state that no condition was concluded, so a
      class would contradict the status and is refused rather than ignored.
    * Notes are required wherever the reviewer's conclusion is not self-evident:
      any rejection, any escalation, and any validation that *departs* from the
      model's prediction. Agreeing with the prediction needs no essay;
      overriding it does.

    `validated_class` is free text rather than a choice from the model's 38
    classes. A reviewer may recognise a condition the model has no class for --
    the model covers 14 crops, and this platform's farmers grow others -- and
    forcing their conclusion into the model's vocabulary would corrupt it.
    """
    status = (status or '').strip().upper()
    if status not in RECORDABLE_STATUSES:
        raise HTTPException(
            422,
            f'Status must be one of: {", ".join(RECORDABLE_STATUSES)}. '
            f'{STATUS_PENDING} is the absence of a review and cannot be recorded.',
        )

    validated_class = (validated_class or '').strip() or None
    review_notes = (review_notes or '').strip() or None

    if validated_class and len(validated_class) > MAX_CLASS_LENGTH:
        raise HTTPException(422, f'A validated class may be at most {MAX_CLASS_LENGTH} characters.')
    if review_notes and len(review_notes) > MAX_NOTE_LENGTH:
        raise HTTPException(422, f'Review notes may be at most {MAX_NOTE_LENGTH} characters.')

    if status == STATUS_VALIDATED:
        if not validated_class:
            raise HTTPException(
                422,
                'A validated screening must state the condition. Provide validated_class, '
                'or record NEEDS_REVIEW if the evidence does not support one.',
            )
        departs = validated_class.strip().lower() != predicted_class.strip().lower()
        if departs and (not review_notes or len(review_notes) < MIN_NOTE_LENGTH):
            raise HTTPException(
                422,
                'Validating a different condition from the one predicted requires review '
                f'notes of at least {MIN_NOTE_LENGTH} characters explaining the change.',
            )
    else:
        if validated_class:
            raise HTTPException(
                422,
                f'{status} states that no condition was concluded, so validated_class '
                'must be omitted.',
            )
        if not review_notes or len(review_notes) < MIN_NOTE_LENGTH:
            raise HTTPException(
                422,
                f'{status} requires review notes of at least {MIN_NOTE_LENGTH} characters '
                'stating the reason.',
            )

    return status, validated_class, review_notes


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _agrees(status: str, validated_class: str | None, predicted_class: str) -> bool | None:
    """Whether the reviewer's conclusion matches the model's prediction.

    Derived, never submitted: a client cannot assert that an expert agreed with
    the model. `None` where the question does not apply -- a rejection or an
    escalation concludes no condition, so there is nothing to agree with.
    """
    if status != STATUS_VALIDATED or validated_class is None:
        return None
    return validated_class.strip().lower() == predicted_class.strip().lower()


def record_validation(
    db: Session,
    reviewer: User,
    observation: DiseaseObservation,
    status: str,
    validated_class: str | None,
    review_notes: str | None,
) -> ExpertValidation:
    """Record a first review of one screening.

    The reviewer is taken from the authenticated user, never from the request:
    `reviewer_id` and `reviewer_role` are both derived here, so a client cannot
    attribute a review to somebody else or claim a role it does not hold.

    One review per screening, enforced by a unique constraint rather than by a
    prior read, so two reviewers submitting at the same moment cannot both
    succeed. The loser is told to revise the existing review instead.
    """
    status, validated_class, review_notes = normalise_review(
        status, validated_class, review_notes, observation.predicted_class
    )
    validation = ExpertValidation(
        observation_id=observation.id,
        reviewer_id=reviewer.id,
        reviewer_role=reviewer.role or 'farmer',
        status=status,
        validated_class=validated_class,
        review_notes=review_notes,
        agrees_with_model=_agrees(status, validated_class, observation.predicted_class),
        reviewed_at=_now(),
    )
    db.add(validation)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409,
            'This screening has already been reviewed. Use PATCH to revise the '
            'existing review.',
        )
    db.refresh(validation)
    logger.info(
        'Screening %s reviewed: status=%s reviewer=%s role=%s',
        observation.id, status, reviewer.id, validation.reviewer_role,
    )
    return validation


def revise_validation(
    db: Session,
    reviewer: User,
    observation: DiseaseObservation,
    validation: ExpertValidation,
    status: str,
    validated_class: str | None,
    review_notes: str | None,
) -> ExpertValidation:
    """Replace an existing review with a new conclusion.

    Any reviewer may revise any review -- a second opinion is a normal part of
    review, and restricting revision to the original reviewer would strand a
    screening whenever they were unavailable. The revising reviewer becomes the
    recorded one, and `updated_at` moves, so the response can show that the
    verdict was changed after first being recorded.

    Only the latest conclusion is kept. A full revision history is a different
    feature with its own retention question, and inventing an audit log nobody
    reads would be the wrong kind of thoroughness. Noted as a limitation in
    backend/docs/EXPERT_VALIDATION.md.
    """
    status, validated_class, review_notes = normalise_review(
        status, validated_class, review_notes, observation.predicted_class
    )
    validation.status = status
    validation.validated_class = validated_class
    validation.review_notes = review_notes
    validation.agrees_with_model = _agrees(status, validated_class, observation.predicted_class)
    validation.reviewer_id = reviewer.id
    validation.reviewer_role = reviewer.role or 'farmer'
    validation.reviewed_at = _now()
    db.commit()
    db.refresh(validation)
    logger.info(
        'Screening %s review revised: status=%s reviewer=%s',
        observation.id, status, reviewer.id,
    )
    return validation


# ── Reading ────────────────────────────────────────────────────────────────

def validation_for(db: Session, observation_id: int) -> ExpertValidation | None:
    return (
        db.query(ExpertValidation)
        .filter(ExpertValidation.observation_id == observation_id)
        .first()
    )


def validations_for(db: Session, observation_ids: list[int]) -> dict[int, ExpertValidation]:
    """Validations for many screenings at once, so a list view is one query."""
    if not observation_ids:
        return {}
    rows = (
        db.query(ExpertValidation)
        .filter(ExpertValidation.observation_id.in_(observation_ids))
        .all()
    )
    return {row.observation_id: row for row in rows}


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


def review_queue(
    db: Session,
    statuses: tuple[str, ...],
    crop_name: str | None,
    since: datetime | None,
    until: datetime | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int, dict[str, int]]:
    """Screenings awaiting or holding a review, newest first.

    Platform-wide, and that is the deliberate authorisation decision of this
    phase: a review queue that only showed a reviewer their own farms would show
    them nothing, since reviewers do not submit screenings. The scope is
    documented in backend/docs/EXPERT_VALIDATION.md, and it is bounded in two ways --
    reviewers see evidence without identity (`review_context`), and only accounts
    the server has marked as reviewers reach this function at all.

    Returns `(items, total_matching, counts_by_status)`. The counts are over
    every screening, not the filtered page, so the queue can show what is waiting
    without a second request.
    """
    base = db.query(DiseaseObservation)
    if since is not None:
        base = base.filter(DiseaseObservation.screened_at >= since)
    if until is not None:
        base = base.filter(DiseaseObservation.screened_at <= until)
    if crop_name:
        base = base.join(Crop, DiseaseObservation.crop_id == Crop.id).filter(
            Crop.crop_name.ilike(crop_name.strip())
        )

    rows = base.order_by(DiseaseObservation.screened_at.desc()).all()
    found = validations_for(db, [row.id for row in rows])

    counts = {status: 0 for status in ALL_STATUSES}
    selected = []
    for row in rows:
        validation = found.get(row.id)
        status = validation.status if validation else STATUS_PENDING
        counts[status] += 1
        if status in statuses:
            selected.append((row, validation))

    page = selected[offset:offset + limit]
    return (
        [_queue_item(db, row, validation) for row, validation in page],
        len(selected),
        counts,
    )


def _queue_item(db: Session, observation: DiseaseObservation, validation) -> dict:
    """A queue row: enough to triage, without loading the full review context."""
    crop = db.get(Crop, observation.crop_id) if observation.crop_id else None
    consistency = crop_consistency(
        observation.predicted_class, crop.crop_name if crop else None
    )
    return {
        'observation_id': observation.id,
        'predicted_class': observation.predicted_class,
        'confidence': observation.confidence,
        'model_version': observation.model_version,
        'screened_at': observation.screened_at.isoformat(),
        'crop_name': crop.crop_name if crop else None,
        'farm_id': observation.farm_id,
        'crop_consistency': consistency['state'],
        'image_available': image_accessible(observation),
        'status': validation.status if validation else STATUS_PENDING,
        'reviewed_at': validation.reviewed_at.isoformat() if validation else None,
    }


def farmer_screenings(
    db: Session,
    user: User,
    statuses: tuple[str, ...],
    limit: int,
    offset: int,
) -> tuple[list[dict], int, dict[str, int]]:
    """A farmer's own screenings with their review state, newest first.

    Scoped by `submitted_by`, which is the only ownership question that applies:
    a screening belongs to whoever submitted it, whether or not it names a farm.
    """
    rows = (
        db.query(DiseaseObservation)
        .filter(DiseaseObservation.submitted_by == user.id)
        .order_by(DiseaseObservation.screened_at.desc())
        .all()
    )
    found = validations_for(db, [row.id for row in rows])
    farms = {
        farm.id: farm
        for farm in db.query(Farm).filter(Farm.user_id == user.id).all()
    }
    crops = {
        crop.id: crop
        for crop in db.query(Crop).filter(Crop.farm_id.in_(farms)).all()
    } if farms else {}

    counts = {status: 0 for status in ALL_STATUSES}
    selected = []
    for row in rows:
        validation = found.get(row.id)
        status = validation.status if validation else STATUS_PENDING
        counts[status] += 1
        if status in statuses:
            selected.append((row, validation))

    page = selected[offset:offset + limit]
    items = []
    for row, validation in page:
        farm = farms.get(row.farm_id)
        crop = crops.get(row.crop_id)
        # The class and confidence the farmer may be told about, decided once in
        # `farmer_claim`. A PENDING screening reports neither, so this list cannot
        # re-expose what the review gate withholds.
        claim = farmer_claim(validation, row.predicted_class, row.confidence)
        items.append({
            'observation_id': row.id,
            'screened_at': row.screened_at.isoformat(),
            # The farmer's own data, so their own farm and crop names are theirs
            # to see -- unlike the reviewer view, which withholds both.
            'farm_id': row.farm_id,
            'farm_name': farm.farm_name if farm else None,
            'crop_id': row.crop_id,
            'crop_name': crop.crop_name if crop else None,
            'latitude': row.latitude,
            'longitude': row.longitude,
            'image_available': image_accessible(row),
            'validation': validation_state(validation),
            'claim': claim,
            # `predicted_class` / `confidence` are deliberately absent at the top
            # level: they were the review gate's leak. The class a farmer may be
            # told about is `claim.condition`.
        })
    return items, len(selected), counts
