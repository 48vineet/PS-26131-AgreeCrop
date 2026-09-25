"""Model evaluation against field confirmations (SIH: learning from the field).

This is the *measurement* half of "learning from field confirmations". It trains
nothing, it touches no model file, and it never writes. Its entire value is
knowing when a number would mislead and refusing to emit it.

What may be measured against, and what may not
----------------------------------------------

Exactly one stream may supply a ground-truth label: a `field_confirmations` row
with ``outcome = 'CONFIRMED'``. It becomes eligible only when the original image
is still available, training consent is explicitly true, prediction metadata is
complete, and an immutable collection group identifies the real-world specimen
or collection event.

`expert_validations` is **never** ground truth, and this is the load-bearing
decision in the module. A reviewer judging a screening is reading the same
evidence the model read -- usually only metadata, since the platform has no image
store -- and forming an opinion *about the prediction*. Scoring the model against
that opinion measures agreement between two readings of one artefact, not
correctness. Worse, `agrees_with_model` is derived from the prediction itself, so
"accuracy" computed that way would be partly circular. `NOT_CONFIRMED` and
`UNCERTAIN` confirmations are excluded too: they establish that no condition was
established, which is not a label.

Leakage-safe splitting and reporting gates
-------------------------------------------

Eligible observations are de-duplicated by observation id, collection group, and
exact image hash. Collection groups are then assigned deterministically to
TRAIN/VALIDATION/TEST. Only TEST may be measured, and no split is created until
its 15% share can contain at least ``MIN_EVAL_SAMPLES`` independent groups.

* ``MIN_EVAL_SAMPLES`` (30) before any headline ``accuracy`` figure exists at all.
* ``MIN_CLASS_SUPPORT`` (10) before a class gets precision, recall or F1.

Neither is a power calculation, and neither is derived from a published standard.
They are floors chosen so that a figure has some chance of being stable, and the
response says exactly that rather than dressing them up. Below a gate the answer
is ``INSUFFICIENT_DATA`` with the shortfall itemised -- the same idiom as
`geospatial.assess_clusters` -- never a number with a caveat attached.

What is always safe to report
-----------------------------

Counts. The eligible sample size, how many predictions matched the confirmed
condition, how many did not, and the raw per-class confusion counts are facts
about rows that exist. They are correct at n = 1 and are therefore reported at
any size. What is withheld is only the *derived rates*, because a rate implies a
population the sample cannot speak for.

Model versions are never pooled
-------------------------------

Every figure is also broken down by ``disease_observations.model_version``. One
accuracy number spanning two model versions describes neither of them, and the
per-version breakdown is gated independently -- a version with four confirmations
gets counts and an ``INSUFFICIENT_DATA`` status of its own.

The *headline* figure obeys the same rule rather than merely sitting next to it.
``accuracy_percent`` in ``overall`` requires both ``MIN_EVAL_SAMPLES`` eligible
pairs **and** one single ``model_version`` that clears that floor by itself. Two
versions with 20 and 15 confirmations therefore produce no headline number: the
35 exist, but no deployed model earned a rate, and a consumer reading only
``overall`` must not be handed one.

Selection bias
--------------

Confirmation is voluntary and effortful. Someone chose to walk into a field, or
to send a sample to a laboratory, and that choice is very unlikely to be
independent of the screening: a surprising or severe prediction gets checked, a
routine one does not. So the eligible set is not a random sample of screenings,
and a rate computed on it does not generalise to the ones nobody confirmed. No
weighting can fix this, because the platform does not record why a confirmation
was sought. The response says so in `limitations` rather than leaving a consumer
to assume otherwise.
"""
import logging
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from evaluation_dataset import (
    SPLIT_TEST,
    eligibility_snapshot,
    grouped_split,
    required_group_count,
    split_summary,
)
from models_db import User

logger = logging.getLogger(__name__)

# ── Roles ──────────────────────────────────────────────────────────────────
# Evaluation is an oversight capability, not an agronomic one, so the gate is
# wider than expert_validation.REVIEWER_ROLES: `official` and `admin` need to see
# how the model performs even though they may not review a screening.
#
# A farmer is excluded because a platform-wide accuracy figure is not their
# record -- it is aggregated over other people's screenings and other people's
# confirmations. Their own screening's review status is already on /screenings.
#
# The same set as pest_surveillance.EXTENSION_ROLES, kept as an ordered tuple
# here so responses list it deterministically. A test asserts the two agree.
OFFICIAL_ROLES = ('extension_officer', 'expert', 'official', 'admin')

# ── Statuses ───────────────────────────────────────────────────────────────
STATUS_INSUFFICIENT = 'INSUFFICIENT_DATA'
STATUS_REPORTED = 'REPORTED'

STATUS_MEANING = {
    STATUS_INSUFFICIENT: (
        'Too few leakage-safe confirmed field groups exist to create an independent '
        'TEST split that supports an accuracy figure. The provenance counts in this '
        'response are real and complete; no rate has been calculated. This asserts '
        'nothing about whether the model is accurate or inaccurate.'
    ),
    STATUS_REPORTED: (
        'Enough leakage-safe confirmed field groups exist to report an accuracy '
        'figure over the held-out TEST partition. The figure describes only the '
        'consented, image-backed, field-confirmed subset. It is not a validated '
        'accuracy for the model in general and not a benchmark result.'
    ),
}

# ── Gates ──────────────────────────────────────────────────────────────────
# Operational floors, not power calculations. Below either one the honest answer
# is that we do not know yet.
#
# 30: the point below which one additional confirmation moves a headline
# percentage by more than about three points. Chosen for stability of the
# reported figure, nothing more.
MIN_EVAL_SAMPLES = 30
# 10: per class. Precision on a support of 2 can only ever be 0%, 50% or 100%,
# and each of those reads as a finding when it is arithmetic on two rows.
MIN_CLASS_SUPPORT = 10
MIN_GROUPS_FOR_SPLIT = required_group_count(MIN_EVAL_SAMPLES)

# The one eligible outcome. The other two are conclusions that no condition was
# established, which is not a label to score against.
ELIGIBLE_OUTCOME = 'CONFIRMED'
INELIGIBLE_OUTCOMES = ('NOT_CONFIRMED', 'UNCERTAIN')

# How the confirmation was obtained, from ck_confirmation_method. Reported on
# every pair, never ranked and never weighted: this module has no evidence about
# how much more reliable a laboratory result is than a careful field visit, so
# assigning weights would be inventing one.
CONFIRMATION_METHODS = ('VISUAL_FIELD_VISIT', 'LABORATORY', 'EXPERT_VISIT')


# ── Authorisation ──────────────────────────────────────────────────────────

def is_official(user: User) -> bool:
    return (user.role or 'farmer') in OFFICIAL_ROLES


def require_official(user: User) -> User:
    """Gate every evaluation route on the server-side role.

    403, not 404: the existence of a model evaluation report is not a secret, and
    a farmer who reaches it should be told plainly that it is not theirs to read
    rather than misled into thinking the endpoint is missing. The 404 convention
    is for *owned resources*, where existence itself is the private fact.

    The role comes from `users.role`, which only the server writes. It is never
    read from a request body, a query parameter, or a client-controlled claim.
    """
    if not is_official(user):
        raise HTTPException(
            403,
            'Model evaluation is limited to extension, expert, official and admin '
            'accounts. Your account does not have access to platform-wide model '
            'performance. Your own screenings and their review status are '
            'available on /screenings.',
        )
    return user


# ── The gate, as data ──────────────────────────────────────────────────────

@dataclass(frozen=True)
class Requirement:
    """The gate as data, so the thresholds are testable without a database.

    Deliberately the same shape as `geospatial.Requirement`; the two modules
    answer 'why is there no number here' in the same words.
    """

    name: str
    required: int
    actual: int
    note: str

    @property
    def met(self) -> bool:
        return self.actual >= self.required


# ── Label comparison ───────────────────────────────────────────────────────
# The same rule expert_validation._agrees uses: trimmed, case-insensitive, exact
# string equality. No fuzzy matching, no synonym table, no substring match. A
# looser rule would silently score 'Tomato___Late_blight' as correct against
# 'Tomato___Early_blight', and there is no curated synonym list in this codebase
# that would make a looser rule defensible.

def normalise_label(label: str | None) -> str:
    return (label or '').strip().lower()


def labels_match(predicted: str | None, confirmed: str | None) -> bool:
    """Whether a prediction matches a confirmed condition.

    A missing or blank label on either side is never a match. Unknown is not
    correct, and treating it as correct would turn absent data into a success.
    """
    left, right = normalise_label(predicted), normalise_label(confirmed)
    if not left or not right:
        return False
    return left == right


# ── Input validation ───────────────────────────────────────────────────────

def parse_method(raw: str | None) -> str | None:
    """Validate an optional confirmation-method filter for the export.

    Raises 422 before any query runs, listing the accepted values, so a
    misspelled method is a clear rejection rather than a silently empty export
    that reads as 'no laboratory confirmations exist'.

    The database's `ck_confirmation_method` constraint holds the same three
    values. This check exists so the caller gets an explanation; the constraint
    exists so nothing can write a fourth.
    """
    if raw is None or not raw.strip():
        return None
    method = raw.strip().upper()
    if method not in CONFIRMATION_METHODS:
        raise HTTPException(
            422,
            f"Unknown confirmation method '{raw.strip()}'. Accepted values: "
            f"{', '.join(CONFIRMATION_METHODS)}.",
        )
    return method


# ── The eligible set ───────────────────────────────────────────────────────

def eligible_pairs(db: Session, method: str | None = None) -> list[dict]:
    """Leakage-safe, consented, image-backed pairs, one per collection group."""
    snapshot = eligibility_snapshot(db, method)
    return [
        {
            **pair,
            'match': labels_match(pair['predicted_class'], pair['confirmed_condition']),
        }
        for pair in snapshot['pairs']
    ]


# ── Confusion counts ───────────────────────────────────────────────────────

def confusion_counts(pairs: list[dict]) -> list[dict]:
    """Raw per-class counts over the eligible pairs. Facts, safe at n = 1.

    Classes are keyed on the *normalised* label so that a prediction and a
    confirmation differing only in case or whitespace land in one class rather
    than two. The label displayed is the first spelling encountered, so a reader
    sees a real value from the data rather than a lower-cased invention.

    `support` is the number of pairs whose *confirmed* condition is this class --
    the true count. `predicted` is how often the model said this class. Both are
    reported because they answer different questions: support says how much
    ground truth exists for the class, predicted says how readily the model
    reaches for it.
    """
    classes: dict[str, dict] = {}

    def slot(label: str | None) -> dict:
        key = normalise_label(label)
        if key not in classes:
            classes[key] = {
                'class': (label or '').strip(),
                'support': 0,          # confirmed as this class: TP + FN
                'predicted': 0,        # model said this class: TP + FP
                'true_positive': 0,
                'false_positive': 0,   # model said this class, field found another
                'false_negative': 0,   # field found this class, model said another
            }
        return classes[key]

    for pair in pairs:
        confirmed = slot(pair['confirmed_condition'])
        predicted = slot(pair['predicted_class'])
        confirmed['support'] += 1
        predicted['predicted'] += 1
        if pair['match']:
            confirmed['true_positive'] += 1
        else:
            predicted['false_positive'] += 1
            confirmed['false_negative'] += 1

    # Descending support, then label, so the response order is deterministic and
    # the classes carrying the most ground truth read first.
    return sorted(classes.values(), key=lambda c: (-c['support'], c['class'].lower()))


def _rate(numerator: int, denominator: int) -> float | None:
    """A proportion as a percentage, or None when the denominator is zero.

    None rather than 0.0. Zero would read as 'the model got none of them right';
    None is 'the question does not apply', which is what a class the model never
    predicted actually means for precision.
    """
    if denominator <= 0:
        return None
    return round(100.0 * numerator / denominator, 1)


def class_metrics(pairs: list[dict]) -> list[dict]:
    """Per-class counts always, and each rate only where *its own* denominator
    clears the floor.

    The gate is per rate, not per class, because precision and recall do not
    divide by the same thing:

    * recall is ``true_positive / support`` -- how much of the ground truth for
      this class the model found. Its denominator is `support`.
    * precision is ``true_positive / predicted`` -- how often the model was right
      when it reached for this class. Its denominator is `predicted`.

    Gating both on `support` alone let a class with support 10 and a single
    prediction report precision 100%, which is arithmetic on one row and is
    exactly what `MIN_CLASS_SUPPORT` exists to suppress. A thin denominator is
    thin whichever rate rests on it, so each rate is withheld on its own count
    and `reason` names which one was withheld and why.

    F1 requires both parts. It is never computed from a rate that was itself
    withheld: a harmonic mean of one real number and one absent one is not a
    measurement of anything.
    """
    metrics = []
    for counts in confusion_counts(pairs):
        entry = dict(counts)
        recall_short = MIN_CLASS_SUPPORT - counts['support']
        precision_short = MIN_CLASS_SUPPORT - counts['predicted']

        recall = (
            _rate(counts['true_positive'], counts['support'])
            if recall_short <= 0 else None
        )
        precision = (
            _rate(counts['true_positive'], counts['predicted'])
            if precision_short <= 0 else None
        )

        # Harmonic mean, and only when both parts were actually reported.
        # Substituting zero for a withheld or undefined precision would
        # manufacture an F1 for a class that has no measured precision.
        if precision is None or recall is None:
            f1 = None
        elif precision + recall == 0:
            f1 = 0.0
        else:
            f1 = round(2 * precision * recall / (precision + recall), 1)

        withheld = []
        if precision_short > 0:
            withheld.append(
                f'Short by {precision_short} prediction(s), so precision is '
                f"withheld: the model named this condition {counts['predicted']} "
                f'time(s) and {MIN_CLASS_SUPPORT} are required before a '
                'proportion of them is reported.'
            )
        if recall_short > 0:
            withheld.append(
                f'Short by {recall_short} confirmation(s), so recall is '
                f"withheld: {counts['support']} confirmed field observation(s) "
                f'name this condition and {MIN_CLASS_SUPPORT} are required '
                'before a proportion of them is reported.'
            )

        entry.update({
            # REPORTED when at least one rate cleared its own floor. A class with
            # neither is counts-only.
            'status': STATUS_INSUFFICIENT if len(withheld) == 2 else STATUS_REPORTED,
            'precision_percent': precision,
            'recall_percent': recall,
            'f1_percent': f1,
            'reason': (
                ' '.join(withheld)
                + ' The counts above are complete and are not estimates.'
            ) if withheld else None,
        })
        metrics.append(entry)
    return metrics


# ── The gate ───────────────────────────────────────────────────────────────

def sample_requirements(pairs: list[dict]) -> list[Requirement]:
    """The headline gate, as data. Pure, so the threshold is testable alone."""
    return [
        Requirement(
            'eligible_confirmed_observations', MIN_EVAL_SAMPLES, len(pairs),
            'Screenings carrying a field confirmation with outcome CONFIRMED. '
            'Expert validations are excluded: a reviewer judging a prediction is '
            'not independent evidence about it.',
        ),
    ]


def single_version_requirement(pairs: list[dict]) -> Requirement:
    """One deployed model version must clear the gate on its own evidence.

    Without this, the headline figure pools versions: 20 confirmations for v1 and
    15 for v2 clear a floor of 30 together while neither clears it alone, and the
    number that appears describes no model that was ever deployed. The module
    states that versions are never pooled, and this is what makes the headline
    obey it -- the per-version breakdown alone could not, because a consumer
    reading `overall.accuracy_percent` never has to look at it.

    `actual` is the largest single-version sample, so the shortfall reads against
    the best-evidenced version rather than against the pooled total.
    """
    versions: dict[str, int] = {}
    for pair in pairs:
        key = pair['model_version'] or 'unrecorded'
        versions[key] = versions.get(key, 0) + 1
    return Requirement(
        'largest_single_model_version_sample', MIN_EVAL_SAMPLES,
        max(versions.values(), default=0),
        'Confirmations for the single best-evidenced model_version. A headline '
        'figure pooled across versions would describe no model that was '
        'deployed, so one version must clear the sample floor by itself.',
    )


def accuracy_block(pairs: list[dict], extra: list[Requirement] = ()) -> dict:
    """Counts always; the rate only above the gate.

    One block, so there is exactly one place in the module where
    `accuracy_percent` can become a number, and that place is unreachable below
    the gate. Used for the overall figure and for each model version, which is
    why the gate applies per version without a second implementation.

    `extra` adds requirements that only some callers have. The overall block
    passes the single-version requirement; a per-version block does not, because
    it *is* one version by construction. Every requirement is reported whether or
    not it is met, so a reader sees the full basis for the figure existing.
    """
    correct = sum(1 for pair in pairs if pair['match'])
    incorrect = len(pairs) - correct
    requirements = sample_requirements(pairs) + list(extra)
    shortfall = [r for r in requirements if not r.met]

    block = {
        'eligible_sample_count': len(pairs),
        'correct': correct,
        'incorrect': incorrect,
        'requirements': [
            {
                'name': r.name, 'required': r.required, 'actual': r.actual,
                'met': r.met, 'note': r.note,
            }
            for r in requirements
        ],
    }
    if shortfall:
        missing = ', '.join(f'{r.name} {r.actual} of {r.required}' for r in shortfall)
        block.update({
            'status': STATUS_INSUFFICIENT,
            'meaning': STATUS_MEANING[STATUS_INSUFFICIENT],
            'accuracy_percent': None,
            'explanation': (
                f'No accuracy figure has been calculated. Short of: {missing}. '
                'The counts reported here are exact.'
            ),
        })
        return block

    block.update({
        'status': STATUS_REPORTED,
        'meaning': STATUS_MEANING[STATUS_REPORTED],
        'accuracy_percent': _rate(correct, len(pairs)),
        'explanation': (
            f'{correct} of {len(pairs)} screenings predicted the condition that was '
            'later confirmed in the field. This is the proportion correct on the '
            'confirmed subset only.'
        ),
    })
    return block


def version_breakdown(pairs: list[dict]) -> list[dict]:
    """Per `model_version`, gated independently.

    Pooling model versions into one accuracy figure describes no model that
    exists: if v1 was scored on 40 confirmations and v2 on 3, a combined number
    is mostly v1 wearing v2's name. Each version therefore gets its own gate, so
    a new release cannot borrow its predecessor's evidence.
    """
    versions: dict[str, list[dict]] = {}
    for pair in pairs:
        # model_version is NOT NULL, so 'unrecorded' cannot occur today. A pair is
        # still grouped under a stated placeholder rather than dropped if one ever
        # does, because dropping rows would make the version counts disagree with
        # the overall count and the discrepancy would be invisible.
        versions.setdefault(pair['model_version'] or 'unrecorded', []).append(pair)

    return [
        {
            'model_version': version,
            **accuracy_block(subset),
            'per_class': class_metrics(subset),
        }
        # Most-evidenced version first, then by name for determinism.
        for version, subset in sorted(
            versions.items(), key=lambda item: (-len(item[1]), item[0])
        )
    ]


# ── Fixed prose ────────────────────────────────────────────────────────────
# Stated in every response, at every sample size, so no consumer has to know it
# and no UI has to phrase it.

GROUND_TRUTH_POLICY = {
    'eligible': (
        "A field_confirmations row with outcome 'CONFIRMED', which names the "
        'condition someone found by examining the crop or that a laboratory '
        'reported, plus an accessible stored image, explicit training consent, '
        'complete prediction metadata, and an immutable collection_group_id. '
        'Only one observation per collection group and image hash is retained.'
    ),
    'excluded': {
        'expert_validations': (
            'Never ground truth. A reviewer judging a screening reads the same '
            'evidence the model read, without visiting the field, and records a '
            'conclusion about the prediction. Scoring against it would measure '
            'agreement between two readings of one image rather than '
            'correctness, and agrees_with_model is derived from the prediction '
            'itself, so the result would be partly circular. No expert '
            'validation contributes to any figure in this response.'
        ),
        'model_confidence': (
            'Not evidence about the outcome. It is the model reporting on itself.'
        ),
        'field_confirmations_not_confirmed_or_uncertain': (
            'Excluded. Both conclude that no condition was established, so '
            'neither provides a label to score a prediction against.'
        ),
        'missing_training_consent': (
            'Excluded. image_consent_training must be exactly true; false and NULL '
            'are not consent.'
        ),
        'missing_image_or_provenance': (
            'Excluded. The original stored image must still be accessible by '
            'policy and collection_group_id must identify the real collection '
            'event. Neither is inferred from timestamps, filenames, or predictions.'
        ),
    },
    'comparison': (
        'predicted_class is compared to confirmed_condition as trimmed, '
        'case-insensitive, exact strings -- the same rule expert validation '
        'uses. No synonym or partial matching, because no curated synonym list '
        'exists here and a loose rule would count a wrong condition as correct.'
    ),
}

LIMITATIONS = [
    'An expert validation is not ground truth. A reviewer who has not seen the '
    'crop, and in this platform usually not even the photograph, is offering a '
    'conclusion about the prediction rather than independent evidence about it. '
    'No expert_validations row contributes to any figure here.',
    'Field confirmation is voluntary. Someone chose to walk into the field or to '
    'send a sample, and that choice is unlikely to be independent of what the '
    'model predicted -- an alarming or unusual screening gets checked, a routine '
    'one often does not. The eligible set is therefore a self-selected subset of '
    'screenings and not a random sample of them.',
    'Because the sample is biased, an accuracy figure computed on it does not '
    'generalise to the screenings nobody confirmed, and it is not the accuracy '
    'of the model. The platform does not record why a confirmation was sought, '
    'so the bias cannot be measured or corrected by weighting.',
    'Repeated photographs or screenings from one specimen or collection event do '
    'not become independent samples. The preparation layer retains one observation '
    'per collection_group_id and exact image hash, and all split assignment is by '
    'collection group.',
    'The confirmed condition is what a person or a laboratory reported. A visual '
    'field visit can be wrong. The method of every pair is reported so a reader '
    'can weigh a laboratory result differently from a visual one; this module '
    'does not rank the methods and does not weight by them.',
    'Counts are cumulative over all time. No confidence interval, no '
    'significance test and no trend is computed, so a change between two '
    'readings of this endpoint is not evidence that the model improved or '
    'degraded.',
    'A class the model never predicts cannot produce a false positive, so its '
    'precision is reported as null rather than as a perfect score.',
]

DEFERRED = {
    'retraining': (
        'Nothing here trains, fine-tunes or selects a model. This endpoint '
        'measures; it does not act on the measurement.'
    ),
    'confidence_calibration': (
        "Whether the model's stated confidence tracks its correctness. Needs "
        'enough confirmations within each confidence band, which is a stricter '
        'requirement than the headline gate, so it is not attempted.'
    ),
    'confidence_intervals': (
        'A Wilson or exact binomial interval would be arithmetic on a '
        'self-selected sample. It would state precision about a biased estimate '
        'and read as rigour the sample does not have.'
    ),
    'per_region_or_per_crop_accuracy': (
        'Would need its own gate per stratum and would expose smaller cells. Not '
        'attempted until the overall gate is comfortably cleared.'
    ),
}


def evaluate_model(db: Session) -> dict:
    """The whole report. Read-only: writes nothing, trains nothing.

    Two statuses, and the difference between them is the point:

    * `INSUFFICIENT_DATA` -- too few independent collection groups exist to create
      a leakage-safe split whose TEST partition meets the reporting floor.
    * `REPORTED` -- the split exists and an accuracy figure over TEST is included,
      still carrying every limitation.

    An empty database produces a complete response with zero counts. That is a
    correct result, not an error, and nothing is invented to fill it.
    """
    snapshot = eligibility_snapshot(db)
    pairs = [
        {
            **pair,
            'match': labels_match(pair['predicted_class'], pair['confirmed_condition']),
        }
        for pair in snapshot['pairs']
    ]
    split = grouped_split(pairs, min_test_size=MIN_EVAL_SAMPLES)
    test_pairs = split['partitions'][SPLIT_TEST]
    # The overall block carries the extra requirement that one model version
    # clear the gate alone. A per-version block inside `version_breakdown` does
    # not: it is a single version by construction, so the requirement would be
    # its own sample count restated.
    overall = accuracy_block(test_pairs, [single_version_requirement(test_pairs)])
    status = overall['status']

    return {
        'status': status,
        'meaning': STATUS_MEANING[status],
        'scope': (
            'platform-wide leakage-safe TEST partition over consented, image-backed '
            'field confirmations; no farmer identity is returned'
        ),
        'overall': overall,
        'per_class': class_metrics(test_pairs),
        'by_model_version': version_breakdown(test_pairs),
        'dataset': {
            'candidate_observation_count': snapshot['candidate_observation_count'],
            'eligible_observation_count': snapshot['eligible_observation_count'],
            'eligible_group_count': snapshot['eligible_group_count'],
            'excluded_observation_count': snapshot['excluded_observation_count'],
            'excluded_by_reason': snapshot['excluded_by_reason'],
            'split': split_summary(split),
        },
        'thresholds': {
            'min_eligible_samples_for_accuracy': MIN_EVAL_SAMPLES,
            'min_class_support_for_rates': MIN_CLASS_SUPPORT,
            'min_eligible_groups_for_split': MIN_GROUPS_FOR_SPLIT,
            'basis': (
                'Operational floors for reporting a figure, not power '
                'calculations and not derived from a published standard. They are '
                'the points below which one additional confirmation would move '
                'the reported number enough to change how it reads.'
            ),
        },
        'ground_truth_policy': GROUND_TRUTH_POLICY,
        'limitations': LIMITATIONS,
        'deferred': DEFERRED,
    }


def eligible_export(db: Session, method: str | None = None) -> dict:
    """The eligible pairs themselves, so a figure can be checked against its rows.

    Built by allow-list and carries no identity or private image reference. The
    collection group and image hash are included only so leakage can be audited.

    `method` is a row filter, not a subgroup analysis: this function reports rows
    that exist and computes no rate, so narrowing it cannot produce a misleading
    figure. `count` is the number of rows returned under the filter, and the
    filter in force is stated alongside it so the two cannot be read apart.
    """
    snapshot = eligibility_snapshot(db, method)
    pairs = [
        {
            **pair,
            'match': labels_match(pair['predicted_class'], pair['confirmed_condition']),
        }
        for pair in snapshot['pairs']
    ]
    split = grouped_split(pairs, min_test_size=MIN_EVAL_SAMPLES)
    split_by_observation = {
        pair['observation_id']: name
        for name, partition in split['partitions'].items()
        for pair in partition
    }
    exported_pairs = [
        {**pair, 'split': split_by_observation.get(pair['observation_id'])}
        for pair in pairs
    ]
    return {
        'count': len(pairs),
        'candidate_observation_count': snapshot['candidate_observation_count'],
        'eligible_observation_count': snapshot['eligible_observation_count'],
        'eligible_group_count': snapshot['eligible_group_count'],
        'excluded_observation_count': snapshot['excluded_observation_count'],
        'excluded_by_reason': snapshot['excluded_by_reason'],
        'method_filter': method,
        'pairs': exported_pairs,
        'split': split_summary(split),
        'fields': [
            'observation_id', 'collection_group_id', 'image_hash', 'model_version',
            'predicted_class', 'confirmed_condition', 'confirmed_at', 'method',
            'match', 'split',
        ],
        'excluded_fields': (
            'No farmer name, email, phone, account identifier, farm name, farm '
            'identifier, crop identifier or coordinates. The evaluation question '
            'does not need them.'
        ),
        'eligibility': GROUND_TRUTH_POLICY,
        'note': (
            'One row per independent collection group after de-duplication by '
            'observation id and image hash. `split` stays null until enough groups '
            'exist for a leakage-safe 70/15/15 assignment. `match` is recomputed '
            'on read and never stored.'
        ),
        'limitations': LIMITATIONS,
    }
