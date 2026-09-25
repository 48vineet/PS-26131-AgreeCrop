from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from geospatial import (
    DEFAULT_WINDOW_DAYS,
    EVIDENCE_LABELS,
    MAX_WINDOW_DAYS,
    assess_clusters,
    collect_features,
    farm_positions,
    owned_farms,
    parse_evidence_types,
    resolve_crop,
    resolve_window,
)
from models_db import User

router = APIRouter(prefix='/geo', tags=['geospatial surveillance'])


def _scope(
    db: Session,
    user: User,
    farm_id: int | None,
    crop_id: int | None,
    evidence: str | None,
    days: int | None,
    start_date: datetime | None,
    end_date: datetime | None,
):
    """Ownership-enforced request scope, shared by both endpoints.

    Ownership is resolved from the authenticated user and nothing else. A farm or
    crop the caller does not own raises 404 here, before any observation is read,
    so neither endpoint can leak the existence of another farmer's records.
    """
    farms = owned_farms(db, user, farm_id)
    crop = resolve_crop(db, farms, crop_id)
    evidence_types = parse_evidence_types(evidence)
    window_start, window_end, window_days = resolve_window(days, start_date, end_date)
    return farms, crop, evidence_types, window_start, window_end, window_days


@router.get('/observations')
def observations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    farm_id: int | None = Query(default=None),
    crop_id: int | None = Query(default=None),
    evidence: str | None = Query(default=None, description='Comma-separated evidence types.'),
    days: int | None = Query(default=None, ge=1, le=MAX_WINDOW_DAYS),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
):
    """Mappable evidence for the caller's own farms.

    Scoped to the authenticated user throughout: another farmer's observations
    and coordinates are never returned. Exact positions are given because the
    caller owns every record in the response.

    `not_mappable` is reported per evidence type rather than dropped, so the map
    never overstates how much is known.
    """
    farms, crop, evidence_types, window_start, window_end, window_days = _scope(
        db, current_user, farm_id, crop_id, evidence, days, start_date, end_date
    )
    positions = farm_positions(db, farms)
    features, accounting = collect_features(
        db, farms, positions, evidence_types, crop.id if crop else None,
        window_start, window_end,
    )

    counts: dict[str, int] = {t: 0 for t in evidence_types}
    for feature in features:
        counts[feature['evidence_type']] = counts.get(feature['evidence_type'], 0) + 1

    return {
        'scope': 'farmer',
        'window': {
            'start': window_start.isoformat(),
            'end': window_end.isoformat(),
            'days': window_days,
            'default_days': DEFAULT_WINDOW_DAYS,
            'note': 'Operational reporting window, not a validated epidemiological constant.',
        },
        'evidence_types': [
            {'value': t, 'label': EVIDENCE_LABELS[t]} for t in evidence_types
        ],
        'farms': [
            {
                'farm_id': farm.id,
                'farm_name': farm.farm_name,
                'latitude': positions[farm.id].latitude if farm.id in positions else None,
                'longitude': positions[farm.id].longitude if farm.id in positions else None,
                'district': positions[farm.id].district if farm.id in positions else None,
                'state': positions[farm.id].state if farm.id in positions else None,
                'has_location': farm.id in positions,
            }
            for farm in farms
        ],
        'features': features,
        'counts': counts,
        'mapped_total': len(features),
        'accounting': accounting,
    }


@router.get('/clusters')
def clusters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    farm_id: int | None = Query(default=None),
    crop_id: int | None = Query(default=None),
    evidence: str | None = Query(default=None),
    days: int | None = Query(default=None, ge=1, le=MAX_WINDOW_DAYS),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
):
    """Whether the caller's located field evidence groups together in space.

    Answers one of three ways, and the distinction is the point of the endpoint:
    `INSUFFICIENT_DATA` with the itemised shortfall, `NO_CLUSTER_DETECTED` when
    there was enough evidence to look and nothing grouped, or
    `POTENTIAL_CLUSTERS_IDENTIFIED` with each grouping and the exact parameters
    that produced it.

    What it never returns: a severity grade, the word hotspot, or a claim that a
    grouping exceeds chance expectation. The clustering is geometric; the method
    that would license a statistical claim is named in `significance` and is not
    implemented.

    Reads only observations that carry their own coordinates, which is why
    environmental risk cannot appear: it sits at one point per farm, so
    clustering it would map where farms are rather than where a problem is.
    """
    farms, crop, evidence_types, window_start, window_end, window_days = _scope(
        db, current_user, farm_id, crop_id, evidence, days, start_date, end_date
    )
    return assess_clusters(
        db, farms, evidence_types, crop.id if crop else None,
        window_start, window_end, window_days,
    )
