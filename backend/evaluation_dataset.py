"""Leakage-safe preparation of confirmed field evidence.

This module exports metadata only. It does not download images, create a training
dataset, train a model, or write to the database.

One observation is retained per immutable ``collection_group_id``. Exact image
duplicates and repeated observation rows are also removed before splitting. The
split is deterministic: groups are ordered by SHA-256 of a fixed integer seed and
their group identifier, then assigned 70/15/15 to TRAIN/VALIDATION/TEST.
"""
from __future__ import annotations

import hashlib
import math
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from models_db import DiseaseObservation, FieldConfirmation


CONFIRMED_OUTCOME = 'CONFIRMED'
SPLIT_TRAIN = 'TRAIN'
SPLIT_VALIDATION = 'VALIDATION'
SPLIT_TEST = 'TEST'
SPLIT_NAMES = (SPLIT_TRAIN, SPLIT_VALIDATION, SPLIT_TEST)
SPLIT_SEED = 11011
TRAIN_RATIO = 0.70
VALIDATION_RATIO = 0.15
TEST_RATIO = 0.15

STATUS_READY = 'READY'
STATUS_INSUFFICIENT = 'INSUFFICIENT_DATA'


def required_group_count(min_test_size: int) -> int:
    """Groups needed for the TEST share to reach ``min_test_size``."""
    return math.ceil(min_test_size / TEST_RATIO)


def candidate_statement(method: str | None = None):
    """Allow-listed joined evidence; no expert-validation table is consulted."""
    statement = (
        select(
            DiseaseObservation.id,
            DiseaseObservation.collection_group_id,
            DiseaseObservation.image_ref,
            DiseaseObservation.image_hash,
            DiseaseObservation.image_consent_review,
            DiseaseObservation.image_consent_training,
            DiseaseObservation.image_retention_until,
            DiseaseObservation.image_deleted_at,
            DiseaseObservation.model_version,
            DiseaseObservation.predicted_class,
            DiseaseObservation.confidence,
            DiseaseObservation.top_predictions,
            DiseaseObservation.screened_at,
            FieldConfirmation.outcome,
            FieldConfirmation.confirmed_condition,
            FieldConfirmation.confirmed_at,
            FieldConfirmation.method,
        )
        .join(FieldConfirmation, FieldConfirmation.observation_id == DiseaseObservation.id)
        .order_by(DiseaseObservation.id)
    )
    if method is not None:
        statement = statement.where(FieldConfirmation.method == method)
    return statement


def _get(row: Mapping[str, Any] | Any, key: str) -> Any:
    if isinstance(row, Mapping):
        return row.get(key)
    try:
        return row[key]
    except (KeyError, TypeError):
        return getattr(row, key, None)


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ''


def _candidate_exclusion(row: Mapping[str, Any] | Any, now: datetime) -> str | None:
    if _get(row, 'id') is None:
        return 'missing_observation'
    if _get(row, 'outcome') != CONFIRMED_OUTCOME or not _text(
        _get(row, 'confirmed_condition')
    ):
        return 'not_confirmed_ground_truth'
    if not _text(_get(row, 'image_ref')):
        return 'missing_image'
    if _get(row, 'image_consent_training') is not True:
        return 'missing_training_consent'
    retention_until = _get(row, 'image_retention_until')
    if (
        _get(row, 'image_consent_review') is not True
        or _get(row, 'image_deleted_at') is not None
        or (retention_until is not None and retention_until <= now)
    ):
        return 'image_not_accessible'
    if not _text(_get(row, 'collection_group_id')):
        return 'missing_collection_group_id'
    if not _text(_get(row, 'image_hash')):
        return 'missing_image_hash'
    if (
        not _text(_get(row, 'model_version'))
        or not _text(_get(row, 'predicted_class'))
        or _get(row, 'confidence') is None
        or _get(row, 'top_predictions') is None
        or _get(row, 'screened_at') is None
    ):
        return 'missing_prediction_metadata'
    return None


def prepare_eligible_records(
    rows: Iterable[Mapping[str, Any] | Any],
    now: datetime | None = None,
) -> dict:
    """Filter and deterministically de-duplicate joined confirmation records."""
    cutoff = now or datetime.now(timezone.utc).replace(tzinfo=None)
    materialised = list(rows)
    ordered = sorted(
        materialised,
        key=lambda row: (
            _get(row, 'id') is None,
            _get(row, 'id') if _get(row, 'id') is not None else 0,
        ),
    )
    excluded = Counter()
    seen_observations: set[int] = set()
    seen_groups: set[str] = set()
    seen_images: set[str] = set()
    pairs: list[dict] = []

    for row in ordered:
        reason = _candidate_exclusion(row, cutoff)
        if reason is not None:
            excluded[reason] += 1
            continue

        observation_id = int(_get(row, 'id'))
        group_id = _text(_get(row, 'collection_group_id'))
        image_hash = _text(_get(row, 'image_hash')).lower()
        if observation_id in seen_observations:
            excluded['duplicate_observation'] += 1
            continue
        if group_id in seen_groups:
            excluded['duplicate_collection_group'] += 1
            continue
        if image_hash in seen_images:
            excluded['duplicate_image_hash'] += 1
            continue

        seen_observations.add(observation_id)
        seen_groups.add(group_id)
        seen_images.add(image_hash)
        confirmed_at = _get(row, 'confirmed_at')
        pairs.append({
            'observation_id': observation_id,
            'collection_group_id': group_id,
            'image_hash': image_hash,
            'model_version': _text(_get(row, 'model_version')),
            'predicted_class': _text(_get(row, 'predicted_class')),
            'confirmed_condition': _text(_get(row, 'confirmed_condition')),
            'confirmed_at': confirmed_at.isoformat() if confirmed_at else None,
            'method': _get(row, 'method'),
        })

    return {
        'candidate_observation_count': len(materialised),
        'eligible_observation_count': len(pairs),
        'eligible_group_count': len(seen_groups),
        'excluded_observation_count': sum(excluded.values()),
        'excluded_by_reason': dict(sorted(excluded.items())),
        'pairs': pairs,
    }


def eligibility_snapshot(
    db: Session,
    method: str | None = None,
    now: datetime | None = None,
) -> dict:
    rows = db.execute(candidate_statement(method)).mappings().all()
    return prepare_eligible_records(rows, now=now)


def _group_order(group_id: str, seed: int) -> str:
    return hashlib.sha256(f'{seed}:{group_id}'.encode('utf-8')).hexdigest()


def grouped_split(
    pairs: Iterable[dict],
    min_test_size: int,
    seed: int = SPLIT_SEED,
) -> dict:
    """Split unique collection groups without allowing provenance leakage."""
    records = sorted(list(pairs), key=lambda pair: pair['observation_id'])
    groups = sorted({pair['collection_group_id'] for pair in records})
    required = required_group_count(min_test_size)
    empty = {name: [] for name in SPLIT_NAMES}
    if len(groups) < required:
        return {
            'status': STATUS_INSUFFICIENT,
            'reason': (
                f'{len(groups)} eligible collection group(s) exist; {required} are '
                f'required for a {int(TEST_RATIO * 100)}% TEST split to contain at '
                f'least {min_test_size} independent group(s). No split was created.'
            ),
            'seed': seed,
            'ratios': {
                SPLIT_TRAIN: TRAIN_RATIO,
                SPLIT_VALIDATION: VALIDATION_RATIO,
                SPLIT_TEST: TEST_RATIO,
            },
            'required_group_count': required,
            'eligible_group_count': len(groups),
            'counts_by_split': {name: 0 for name in SPLIT_NAMES},
            'partitions': empty,
        }

    ordered_groups = sorted(groups, key=lambda group: (_group_order(group, seed), group))
    train_count = int(len(ordered_groups) * TRAIN_RATIO)
    validation_count = int(len(ordered_groups) * VALIDATION_RATIO)
    group_split = {
        group: (
            SPLIT_TRAIN
            if index < train_count
            else SPLIT_VALIDATION
            if index < train_count + validation_count
            else SPLIT_TEST
        )
        for index, group in enumerate(ordered_groups)
    }
    partitions = {name: [] for name in SPLIT_NAMES}
    for pair in records:
        split_name = group_split[pair['collection_group_id']]
        partitions[split_name].append({**pair, 'split': split_name})

    return {
        'status': STATUS_READY,
        'reason': None,
        'seed': seed,
        'ratios': {
            SPLIT_TRAIN: TRAIN_RATIO,
            SPLIT_VALIDATION: VALIDATION_RATIO,
            SPLIT_TEST: TEST_RATIO,
        },
        'required_group_count': required,
        'eligible_group_count': len(groups),
        'counts_by_split': {name: len(partitions[name]) for name in SPLIT_NAMES},
        'partitions': partitions,
    }


def split_summary(split: dict) -> dict:
    """Public split metadata without internal partition lists."""
    return {key: value for key, value in split.items() if key != 'partitions'}
