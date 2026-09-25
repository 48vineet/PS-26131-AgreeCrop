"""Read-only model evaluation routes.

Two GETs and nothing else. This unit measures the model against field
confirmations; it does not write, does not train, and does not touch
`predict.py` or any model file. There is no POST here by design -- a caller
cannot submit ground truth through this router, because ground truth is written
by the confirmation flow where a confirmer's role and evidence notes are checked.

**Scope.** Platform-wide, and that is deliberate. An accuracy figure is
aggregated over many people's screenings and confirmations, so scoping it to the
caller's own farms would make it a sample of one farmer and would leak nothing
useful. What bounds the exposure is the role gate plus *what* is returned:
neither route carries a farmer name, email, phone, account identifier, farm name
or coordinates. `evaluation.eligible_pairs` selects six columns by allow-list
rather than removing fields from a farmer-facing shape, so a column added to
`disease_observations` later cannot appear here by accident.

**Role gate, not an ownership gate.** 403 rather than 404: the report is not an
owned resource whose existence is private, so a farmer is told plainly that
platform-wide model performance is not theirs to read.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from evaluation import (
    CONFIRMATION_METHODS,
    ELIGIBLE_OUTCOME,
    INELIGIBLE_OUTCOMES,
    MIN_CLASS_SUPPORT,
    MIN_EVAL_SAMPLES,
    MIN_GROUPS_FOR_SPLIT,
    OFFICIAL_ROLES,
    STATUS_MEANING,
    eligible_export,
    evaluate_model,
    parse_method,
    require_official,
)
from models_db import User

router = APIRouter(prefix='/evaluation', tags=['model evaluation'])


def _official(current: User = Depends(get_current_user)) -> User:
    """Authenticate, then authorise on the stored role. Used by every route.

    Identity comes only from `get_current_user`; the role comes only from
    `users.role`. Nothing in the query string or body influences either.
    """
    return require_official(current)


@router.get('/model')
def model_evaluation(
    db: Session = Depends(get_db),
    official: User = Depends(_official),
):
    """Model performance measured against confirmed field observations.

    Counts at any sample size. An `accuracy_percent` only above the gate, and
    per-class rates only for classes with enough support. Broken down by
    `model_version`, because one figure spanning two versions describes neither.
    """
    report = evaluate_model(db)
    # Echoed so a consumer can see the gate and the vocabulary without a second
    # request, and so the UI never has to invent wording for a status.
    report['status_meanings'] = STATUS_MEANING
    report['access'] = {
        'roles': list(OFFICIAL_ROLES),
        'your_role': official.role,
        'note': (
            'Platform-wide figures. Farmer accounts are excluded because this '
            'aggregates other people\'s screenings and confirmations.'
        ),
    }
    return report


@router.get('/eligible')
def eligible(
    method: str | None = Query(
        default=None,
        description=(
            'Optional filter on how the confirmation was obtained. One of '
            + ', '.join(CONFIRMATION_METHODS)
            + '. Filters rows only; no rate is computed here.'
        ),
    ),
    db: Session = Depends(get_db),
    official: User = Depends(_official),
):
    """The (prediction, confirmation) pairs behind the figures, as an export.

    The `method` filter is offered here and deliberately not on /evaluation/model.
    This route lists rows, so narrowing them cannot mislead; recomputing the
    accuracy figure on one method at a time would let a caller try subgroups
    until a favourable number appeared, which is what the sample gate exists to
    prevent.

    Unpaginated on purpose: the eligible set is the set of screenings somebody
    physically confirmed, which is small by nature, and a partial export would
    let a reader compute a different accuracy from the same endpoint. If it ever
    grows large enough to need paging, the gate has long since been cleared and
    paging can be added with the total already reported in `count`.
    """
    export = eligible_export(db, parse_method(method))
    export['eligibility_rule'] = {
        'included_outcome': ELIGIBLE_OUTCOME,
        'excluded_outcomes': list(INELIGIBLE_OUTCOMES),
        'expert_validations': 'never eligible, at any outcome',
        'image_consent_training': 'must be exactly true; false and null are excluded',
        'collection_group_id': (
            'required and never inferred from prediction, confidence, timestamp, '
            'filename, or image hash'
        ),
    }
    export['methods'] = list(CONFIRMATION_METHODS)
    export['thresholds'] = {
        'min_eligible_samples_for_accuracy': MIN_EVAL_SAMPLES,
        'min_class_support_for_rates': MIN_CLASS_SUPPORT,
        'min_eligible_groups_for_split': MIN_GROUPS_FOR_SPLIT,
        'note': (
            'The export lists eligible metadata at any count, but split remains '
            'INSUFFICIENT_DATA until the independent-group floor is met. Accuracy '
            'is calculated only from a sufficient TEST partition on /evaluation/model.'
        ),
    }
    export['access'] = {'roles': list(OFFICIAL_ROLES), 'your_role': official.role}
    return export
