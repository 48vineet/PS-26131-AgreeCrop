"""Geospatial surveillance: mapping real observations, and what may be claimed
about how they group.

Three things live here, and keeping them apart is the point of the module.

**Observation mapping** plots evidence that carries a real position, and
accounts explicitly for evidence that does not.

**Potential spatial clusters** are computed, by DBSCAN over PostGIS, but only
once minimum-data requirements are met. Below them `assess_clusters` reports
exactly which requirement is short rather than producing a cluster anyway. What
it returns when it does find something is a *geometric* grouping of like
observations, with the radius and point threshold that produced it stated in the
response.

**A hotspot is a different and stronger claim** — that a concentration exceeds
what chance would produce — and nothing here makes it. No severity grade is ever
returned, and `significance.tested` is `False` in every response.

Method research (2026-08-29). Sources are cited in
``backend/docs/GEOSPATIAL_METHODOLOGY.md``; the short version:

* *Fixed grid / hexagonal binning* — needs a cell size and an origin, and the
  result shifts with both (the modifiable areal unit problem). Rejected: the
  choice would be arbitrary and would change the finding.
* *Kernel density estimation* — needs a bandwidth, and produces a smooth,
  convincing-looking surface from any input at all. Rejected outright: with a
  handful of points it manufactures the appearance of a hotspot.
* *DBSCAN* (Ester et al. 1996) — needs ``eps`` and ``minPts``. The scikit-learn
  user guide calls ``eps`` "crucial to choose appropriately for the data set and
  distance function" and points at "a knee in the nearest neighbor distances
  plot" as the published way to choose it. **Selected**, with ``eps`` derived
  per request from that heuristic rather than from an invented dispersal
  distance. What it yields is a *geometric* statement — these observations of
  the same subject lie within this many metres of one another — not a
  statistical one.
* *Space-time permutation scan statistic* (Kulldorff et al. 2005) — the
  established method for asking whether a concentration exceeds chance
  expectation. It notably needs **no population-at-risk denominator**: expected
  counts come from the marginals of the location-by-day case table, and
  significance from Monte Carlo permutation of case times. It is therefore the
  right target for a *significance* claim, and it is blocked by case volume
  alone: the New York City deployment ran over 183 locations with 999
  permutations, and this platform currently has zero located field cases to
  permute. Deferred, and named in the response so the gap is visible.

**Decision.** Two tiers, kept explicitly apart.

*Tier 1, implemented here.* DBSCAN over PostGIS, gated behind minimum-data
requirements, reporting *potential spatial clusters* with every parameter used
echoed back. Never a severity, never a hotspot, never an assertion that a
concentration is more than geometry.

*Tier 2, deferred.* The scan statistic above, which is what would license
calling a cluster significant. ``significance.tested`` is ``False`` in every
response until it exists.

Below the gate the answer is ``INSUFFICIENT_DATA`` with the specific shortfall.
A transparent observation map plus an honest gate is worth more than a
fabricated hotspot.
"""
import logging
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from expert_validation import STATUS_PENDING, validations_for
from models_db import (
    Crop,
    DiseaseObservation,
    Farm,
    FarmLocation,
    PestObservation,
    RiskAssessment,
    User,
)

logger = logging.getLogger(__name__)

# ── Evidence types ─────────────────────────────────────────────────────────
# Kept distinct on purpose. An image screening, a trap count, and a weather-derived
# risk assessment are different kinds of claim and are never merged into one
# "disease hotspot" layer.
EVIDENCE_IMAGE = 'image_screening'
EVIDENCE_PEST = 'pest_observation'
EVIDENCE_RISK = 'environmental_risk'
EVIDENCE_TYPES = (EVIDENCE_IMAGE, EVIDENCE_PEST, EVIDENCE_RISK)

EVIDENCE_LABELS = {
    EVIDENCE_IMAGE: 'Image screening',
    EVIDENCE_PEST: 'Pest observation',
    EVIDENCE_RISK: 'Environmental risk',
}

# ── Where a point on the map is allowed to come from ───────────────────────
# `observation` — the record carried its own coordinates.
# `farm_location` — the record is farm-scoped *by construction*, so the farm's
#                   recorded location is its authoritative position.
LOCATION_FROM_OBSERVATION = 'observation'
LOCATION_FROM_FARM = 'farm_location'

# Which evidence types may inherit the farm's location, and why.
#
# Environmental risk may: it is computed from weather fetched for the farm's own
# coordinates, so those coordinates are where the assessment applies.
#
# Image screening may NOT: a photograph can be taken anywhere, including off the
# farm entirely. Placing it at the farm centroid would invent a position.
#
# Pest observation may NOT: a trap stands at a specific spot which may differ
# from the field centre, and PestObservation already treats absent coordinates as
# absent rather than defaulting them.
INHERITS_FARM_LOCATION = {EVIDENCE_RISK}

# ── Time window ────────────────────────────────────────────────────────────
# Thirty days is an operational surveillance reporting horizon, not a validated
# epidemiological constant for any particular pathogen. It has precedent: the
# space-time permutation scan statistic was deployed in New York City over a
# rolling 30-day window (Kulldorff et al. 2005). It is configurable per request,
# and the window used is always reported back so a reader knows what they are
# looking at.
DEFAULT_WINDOW_DAYS = 30
MAX_WINDOW_DAYS = 365

# ── The gate: minimum data before any cluster may be reported ──────────────
# Stated numerically so the gate is testable, and documented as an operational
# floor rather than a validated statistical threshold.
#
# Five located field observations, because the eps heuristic below reads the
# shape of a sorted distance curve and three or four points do not have one.
MIN_LOCATED_OBSERVATIONS = 5
# Three distinct locations, because two points define a line, not a cluster --
# and because twenty re-checks of one trap are repetition, not spatial spread.
MIN_DISTINCT_LOCATIONS = 3
# Coordinates are compared at 4 decimal places (~11 m) when counting distinct
# locations, so repeated visits to the same spot do not read as spread.
LOCATION_PRECISION = 4

# ── DBSCAN parameters ──────────────────────────────────────────────────────
# minPts counts the point itself (PostGIS and scikit-learn agree on this), so 3
# means "at least three observations within eps of each other".
CLUSTER_MIN_POINTS = 3
# PostGIS documents that border-point assignment can produce "a correct cluster
# ... with fewer than minpoints geometries", so membership is re-checked after
# the fact rather than trusted. A cluster must also span MIN_DISTINCT_LOCATIONS
# distinct positions: three records at one coordinate are one observation point
# visited three times.
CLUSTER_MIN_LOCATIONS = MIN_DISTINCT_LOCATIONS

# eps is derived per request from the data (see `derive_eps`), then clamped.
# Both guard rails are operational and are reported alongside the value.
#
# Lower: ~2x the ~11 m tolerance at which this module already treats two
# coordinates as one location. Below that, a "cluster" would be narrower than
# the module's own definition of a single spot.
MIN_EPS_METRES = 25.0
# Upper: beyond roughly two kilometres a farmer-scoped grouping stops describing
# a place and starts describing everywhere they farm. Capping the spatial scale
# is standard practice -- Kulldorff et al. capped scanning windows at a 5 km
# radius for urban syndromic surveillance -- but this number is chosen for
# field-to-village legibility here, not transferred from that study.
MAX_EPS_METRES = 2000.0

# ── Deferred: the cross-farm regional view ─────────────────────────────────
# Not applied to farmer scope, deliberately. The caller owns every row in a
# farmer-scoped response, so a k-anonymity floor protects nobody there, and
# applying one would mean a farmer with a single farm could never see a grouping
# on their own land. It is recorded here because it *is* required before any
# cross-farmer display, and it is reported in the response so the constraint is
# visible rather than forgotten.
REGIONAL_MIN_DISTINCT_FARMS = 3

# ── Cluster statuses ───────────────────────────────────────────────────────
STATUS_INSUFFICIENT = 'INSUFFICIENT_DATA'
STATUS_NO_CLUSTER = 'NO_CLUSTER_DETECTED'
STATUS_CLUSTERS = 'POTENTIAL_CLUSTERS_IDENTIFIED'

CLUSTER_TYPE = 'potential_spatial_cluster'

# What each evidence type contributes to clustering, and why.
CLUSTERABLE_EVIDENCE = (EVIDENCE_IMAGE, EVIDENCE_PEST)
CLUSTER_EXCLUSIONS = {
    EVIDENCE_RISK: (
        'Environmental risk sits at one point per farm, computed from weather '
        'fetched for those coordinates. Clustering it would measure where farms '
        'are, not where a problem is.'
    ),
}

# The subject an observation is *about*. Two records only cluster together when
# they concern the same subject: a whitefly count and a stem-borer count 80 m
# apart are two findings, not one cluster.
SUBJECT_KIND = {
    EVIDENCE_IMAGE: 'predicted_class',
    EVIDENCE_PEST: 'pest_name',
}


@dataclass(frozen=True)
class Requirement:
    name: str
    required: int
    actual: int
    note: str

    @property
    def met(self) -> bool:
        return self.actual >= self.required


def resolve_window(
    days: int | None,
    start: datetime | None,
    end: datetime | None,
) -> tuple[datetime, datetime, int | None]:
    """Resolve the observation window to naive UTC bounds.

    An explicit start/end wins over `days`, so a reader can pin an exact period.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def naive(value: datetime) -> datetime:
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value

    if start is not None or end is not None:
        window_end = naive(end) if end is not None else now
        window_start = naive(start) if start is not None else window_end - timedelta(days=DEFAULT_WINDOW_DAYS)
        if window_start > window_end:
            raise HTTPException(422, 'The start of the window is after its end.')
        return window_start, window_end, None

    span = DEFAULT_WINDOW_DAYS if days is None else days
    if span < 1 or span > MAX_WINDOW_DAYS:
        raise HTTPException(422, f'The window must be between 1 and {MAX_WINDOW_DAYS} days.')
    return now - timedelta(days=span), now, span


def parse_evidence_types(raw: str | None) -> tuple[str, ...]:
    """Validate a comma-separated evidence filter, defaulting to all types."""
    if not raw or not raw.strip():
        return EVIDENCE_TYPES
    requested = tuple(part.strip() for part in raw.split(',') if part.strip())
    unknown = [part for part in requested if part not in EVIDENCE_TYPES]
    if unknown:
        raise HTTPException(
            422,
            f'Unknown evidence type {unknown[0]!r}. Use one or more of: {", ".join(EVIDENCE_TYPES)}.',
        )
    # Preserve the canonical order so responses are stable.
    return tuple(t for t in EVIDENCE_TYPES if t in requested)


def owned_farms(db: Session, user: User, farm_id: int | None) -> list[Farm]:
    """The caller's farms, or the one they asked for after an ownership check.

    Ownership always comes from the authenticated user. A `farm_id` the caller
    does not own is 404, never an empty result — an empty list would confirm the
    farm exists.
    """
    if farm_id is not None:
        farm = db.get(Farm, farm_id)
        if not farm or farm.user_id != user.id:
            raise HTTPException(404, 'Farm not found')
        return [farm]
    return db.query(Farm).filter(Farm.user_id == user.id).order_by(Farm.id).all()


def resolve_crop(db: Session, farms: list[Farm], crop_id: int | None) -> Crop | None:
    """Validate a crop filter against the farms in scope."""
    if crop_id is None:
        return None
    crop = db.get(Crop, crop_id)
    farm_ids = {farm.id for farm in farms}
    if not crop or crop.farm_id not in farm_ids:
        raise HTTPException(404, 'Crop not found')
    return crop


def farm_positions(db: Session, farms: list[Farm]) -> dict[int, FarmLocation]:
    """Latest recorded location per farm.

    Reads the newest `FarmLocation` per farm, matching how the weather and risk
    routers already resolve a farm's coordinates.
    """
    positions: dict[int, FarmLocation] = {}
    for farm in farms:
        location = (
            db.query(FarmLocation)
            .filter(FarmLocation.farm_id == farm.id)
            .order_by(FarmLocation.id.desc())
            .first()
        )
        if location is not None:
            positions[farm.id] = location
    return positions


def _feature(
    evidence_type: str,
    identifier: int,
    farm: Farm | None,
    crop: Crop | None,
    latitude: float,
    longitude: float,
    location_source: str,
    observed_at: datetime,
    label: str,
    detail: str | None,
    provenance: list[str],
    validation_status: str | None = None,
) -> dict:
    return {
        'evidence_type': evidence_type,
        'evidence_label': EVIDENCE_LABELS[evidence_type],
        'id': identifier,
        'farm_id': farm.id if farm else None,
        'farm_name': farm.farm_name if farm else None,
        'crop_id': crop.id if crop else None,
        'crop_name': crop.crop_name if crop else None,
        'latitude': latitude,
        'longitude': longitude,
        # The reader must always be able to tell an observed position from an
        # inherited one.
        'location_source': location_source,
        'observed_at': observed_at.isoformat(),
        'label': label,
        'detail': detail,
        'provenance': provenance,
        # Additive metadata, present only where review applies. An image screening
        # carries its review state; a pest observation and a risk assessment are
        # not reviewable evidence, so theirs is None rather than a fake PENDING.
        'validation_status': validation_status,
    }


def collect_features(
    db: Session,
    farms: list[Farm],
    positions: dict[int, FarmLocation],
    evidence_types: tuple[str, ...],
    crop_id: int | None,
    window_start: datetime,
    window_end: datetime,
) -> tuple[list[dict], dict[str, dict]]:
    """Gather mappable evidence, and account for what could not be mapped.

    Returns `(features, accounting)`. The accounting is not decoration: a map
    that silently drops unlocatable evidence misrepresents how much is known.
    """
    farm_by_id = {farm.id: farm for farm in farms}
    farm_ids = list(farm_by_id)
    features: list[dict] = []
    accounting: dict[str, dict] = {}

    if not farm_ids:
        for evidence_type in evidence_types:
            accounting[evidence_type] = {
                'in_window': 0, 'mapped': 0, 'not_mappable': 0,
                'reason': 'No farms belong to this account.',
            }
        return features, accounting

    crops = {c.id: c for c in db.query(Crop).filter(Crop.farm_id.in_(farm_ids)).all()}

    # ── Image screenings ──────────────────────────────────────────────────
    if EVIDENCE_IMAGE in evidence_types:
        query = db.query(DiseaseObservation).filter(
            DiseaseObservation.farm_id.in_(farm_ids),
            DiseaseObservation.screened_at >= window_start,
            DiseaseObservation.screened_at <= window_end,
        )
        if crop_id is not None:
            query = query.filter(DiseaseObservation.crop_id == crop_id)
        rows = query.order_by(DiseaseObservation.screened_at.desc()).all()
        # The review state of each screening, read rather than assumed. This used
        # to be the hardcoded string 'not expert-validated', which was true only
        # until expert validation existed. Metadata only -- cluster logic does not
        # read it, and a validated screening clusters exactly like any other.
        reviews = validations_for(db, [row.id for row in rows])
        mapped = 0
        for row in rows:
            # Never inherits the farm location: a photograph may be taken anywhere.
            if row.latitude is None or row.longitude is None:
                continue
            mapped += 1
            review = reviews.get(row.id)
            features.append(_feature(
                EVIDENCE_IMAGE, row.id, farm_by_id.get(row.farm_id),
                crops.get(row.crop_id) if row.crop_id else None,
                row.latitude, row.longitude, LOCATION_FROM_OBSERVATION,
                row.screened_at,
                row.predicted_class,
                f'Predicted condition, {row.confidence}% confidence',
                [
                    f'model {row.model_version}',
                    'not yet expert-reviewed' if review is None
                    else f'expert review: {review.status}',
                ],
                validation_status=review.status if review else STATUS_PENDING,
            ))
        accounting[EVIDENCE_IMAGE] = {
            'in_window': len(rows), 'mapped': mapped, 'not_mappable': len(rows) - mapped,
            'reason': (
                'A screening is mapped only when the submission carried coordinates. '
                'A photograph can be taken anywhere, so the farm location is not '
                'substituted for a missing position.'
            ),
        }

    # ── Pest observations ─────────────────────────────────────────────────
    if EVIDENCE_PEST in evidence_types:
        query = db.query(PestObservation).filter(
            PestObservation.farm_id.in_(farm_ids),
            PestObservation.observed_at >= window_start,
            PestObservation.observed_at <= window_end,
        )
        if crop_id is not None:
            query = query.filter(PestObservation.crop_id == crop_id)
        rows = query.order_by(PestObservation.observed_at.desc()).all()
        mapped = 0
        for row in rows:
            # Also never inherited: a trap stands at a specific spot.
            if row.latitude is None or row.longitude is None:
                continue
            mapped += 1
            measurement = (
                f'{row.count} {row.unit.replace("_", " ")}' if row.count is not None
                else 'present, not counted'
            )
            features.append(_feature(
                EVIDENCE_PEST, row.id, farm_by_id.get(row.farm_id),
                crops.get(row.crop_id) if row.crop_id else None,
                row.latitude, row.longitude, LOCATION_FROM_OBSERVATION,
                row.observed_at,
                row.pest_name,
                measurement,
                [row.source, row.method] + ([row.trap_id] if row.trap_id else []),
            ))
        accounting[EVIDENCE_PEST] = {
            'in_window': len(rows), 'mapped': mapped, 'not_mappable': len(rows) - mapped,
            'reason': (
                'A pest observation is mapped only when trap coordinates were '
                'recorded. The farm location is not substituted, because a trap '
                'position may differ from the field centre.'
            ),
        }

    # ── Environmental risk ────────────────────────────────────────────────
    if EVIDENCE_RISK in evidence_types:
        query = db.query(RiskAssessment).filter(
            RiskAssessment.farm_id.in_(farm_ids),
            RiskAssessment.calculated_at >= window_start,
            RiskAssessment.calculated_at <= window_end,
        )
        if crop_id is not None:
            query = query.filter(RiskAssessment.crop_id == crop_id)
        rows = query.order_by(RiskAssessment.calculated_at.desc()).all()
        mapped = 0
        for row in rows:
            location = positions.get(row.farm_id)
            if location is None:
                continue
            mapped += 1
            features.append(_feature(
                EVIDENCE_RISK, row.id, farm_by_id.get(row.farm_id),
                crops.get(row.crop_id) if row.crop_id else None,
                location.latitude, location.longitude, LOCATION_FROM_FARM,
                row.calculated_at,
                row.risk_level,
                row.disease,
                [p for p in (
                    row.weather_source,
                    f'rule v{row.rule_version}' if row.rule_version else None,
                ) if p],
            ))
        accounting[EVIDENCE_RISK] = {
            'in_window': len(rows), 'mapped': mapped, 'not_mappable': len(rows) - mapped,
            'reason': (
                'An assessment is placed at its farm location, because it is '
                'computed from weather fetched for those coordinates. Unmapped '
                'assessments belong to a farm with no recorded location.'
            ),
        }

    features.sort(key=lambda f: f['observed_at'], reverse=True)
    return features, accounting


def distinct_locations(features: list[dict]) -> int:
    """Distinct positions, compared at ~11 m so repeat checks are not spread."""
    return len({
        (round(f['latitude'], LOCATION_PRECISION), round(f['longitude'], LOCATION_PRECISION))
        for f in features
    })


# ══════════════════════════════════════════════════════════════════════════
#  Cluster detection
#
#  Everything below answers one question: do the caller's located field
#  observations of the same subject group together in space, inside the
#  requested window? The spatial mathematics is done by PostGIS, on the
#  `point` geography column added in migration 0008 -- not by hand-rolled
#  trigonometry, and not on coordinates loaded into Python and compared as
#  plain numbers.
# ══════════════════════════════════════════════════════════════════════════

# The per-source SELECT for locatable field evidence. `point IS NOT NULL` is the
# spatial predicate the partial GiST index from 0008 is built for, and it is also
# the honest definition of mappable: no position, no place on a map.
_FIELD_SOURCES = {
    EVIDENCE_IMAGE: """
        SELECT
            'image_screening'               AS evidence_type,
            o.id                            AS id,
            o.farm_id                       AS farm_id,
            o.crop_id                       AS crop_id,
            o.screened_at                   AS observed_at,
            o.latitude                      AS latitude,
            o.longitude                     AS longitude,
            o.predicted_class               AS subject,
            lower(btrim(o.predicted_class)) AS subject_key
        FROM disease_observations o
        WHERE o.farm_id = ANY(CAST(:farm_ids AS int[]))
          AND o.point IS NOT NULL
          AND o.screened_at >= :window_start
          AND o.screened_at <= :window_end
          AND (CAST(:crop_id AS int) IS NULL OR o.crop_id = CAST(:crop_id AS int))
    """,
    EVIDENCE_PEST: """
        SELECT
            'pest_observation'              AS evidence_type,
            p.id                            AS id,
            p.farm_id                       AS farm_id,
            p.crop_id                       AS crop_id,
            p.observed_at                   AS observed_at,
            p.latitude                      AS latitude,
            p.longitude                     AS longitude,
            p.pest_name                     AS subject,
            lower(btrim(p.pest_name))       AS subject_key
        FROM pest_observations p
        WHERE p.farm_id = ANY(CAST(:farm_ids AS int[]))
          AND p.point IS NOT NULL
          AND p.observed_at >= :window_start
          AND p.observed_at <= :window_end
          AND (CAST(:crop_id AS int) IS NULL OR p.crop_id = CAST(:crop_id AS int))
    """,
}


def locate_field_evidence(
    db: Session,
    farm_ids: list[int],
    evidence_types: tuple[str, ...],
    crop_id: int | None,
    window_start: datetime,
    window_end: datetime,
) -> list[dict]:
    """Located, clusterable field evidence for these farms, filtered in Postgres.

    Only image screenings and pest observations: `CLUSTER_EXCLUSIONS` says why
    environmental risk is not here. Farm scope, time window, crop, and the
    presence of a position are all applied database-side, so no unlocatable or
    out-of-window row is loaded merely to be discarded in Python.

    `farm_ids` must already be ownership-checked by `owned_farms`. This function
    trusts its caller for authorisation and for nothing else.
    """
    parts = [_FIELD_SOURCES[t] for t in evidence_types if t in _FIELD_SOURCES]
    if not parts or not farm_ids:
        return []
    sql = ' UNION ALL '.join(parts) + ' ORDER BY observed_at DESC, id DESC'
    rows = db.execute(
        text(sql),
        {
            'farm_ids': farm_ids,
            'crop_id': crop_id,
            'window_start': window_start,
            'window_end': window_end,
        },
    ).mappings().all()
    return [dict(row) for row in rows]


def partition_key(row: dict) -> str:
    """Evidence type plus normalised subject: the unit within which we cluster."""
    return f"{row['evidence_type']}|{row['subject_key']}"


def row_key(row: dict) -> str:
    """A stable identity for one observation across the two source tables."""
    return f"{row['evidence_type']}:{row['id']}"


def knee_index(values: list[float]) -> int:
    """Index of the knee of an ascending curve, by maximum drop below its chord.

    The published heuristic for DBSCAN's `eps` is "a knee in the nearest
    neighbor distances plot". This is the standard parameter-free way to find
    one: normalise both axes to [0, 1], draw the chord from the first point to
    the last, and take the point that falls furthest below it.

    On a flat curve every point sits on the chord and index 0 is returned, which
    is the right answer -- a flat curve has no knee, so the smallest distance is
    as good a scale as any, and the floor will catch it.

    Deterministic, so the same observations always yield the same `eps`.
    """
    n = len(values)
    if n < 3:
        return 0
    low, high = values[0], values[-1]
    if high <= low:
        return 0
    best_index, best_drop = 0, 0.0
    for i, value in enumerate(values):
        # Chord height at this x, minus the curve. Positive means below the chord.
        drop = (i / (n - 1)) - ((value - low) / (high - low))
        if drop > best_drop:
            best_index, best_drop = i, drop
    return best_index


def projection_for(rows: list[dict]) -> str:
    """A PROJ definition for measuring metres around these observations.

    Azimuthal equidistant, centred on the mean of the points: distances from that
    centre are exact by construction, and unlike a UTM zone there is no boundary
    to straddle. Checked against `ST_Distance` on the geography type -- agreement
    to better than one part in ten million at these separations.

    Projecting is not optional. `ST_ClusterDBSCAN` takes planar geometry and an
    `eps` in that geometry's own units, so clustering in degrees would make one
    `eps` mean different distances at different latitudes.
    """
    latitude = sum(r['latitude'] for r in rows) / len(rows)
    longitude = sum(r['longitude'] for r in rows) / len(rows)
    return (
        f'+proj=aeqd +lat_0={latitude:.6f} +lon_0={longitude:.6f} '
        '+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
    )


_K_DISTANCE_SQL = text("""
    WITH input AS (
        SELECT * FROM unnest(CAST(:lats AS float8[]), CAST(:lons AS float8[]))
                 WITH ORDINALITY AS t(lat, lon, rid)
    ),
    p AS (
        SELECT rid, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography AS geog
        FROM input
    )
    SELECT (
        SELECT ST_Distance(a.geog, b.geog) FROM p b
        WHERE b.rid <> a.rid ORDER BY 1 OFFSET :k - 1 LIMIT 1
    ) AS d_k
    FROM p a
    ORDER BY 1
""")


def derive_eps(db: Session, rows: list[dict]) -> tuple[float, dict]:
    """Derive the DBSCAN search radius from the observations themselves.

    Returns `(eps_metres, derivation)`.

    The alternative would be to hard-code a distance, and the only honest
    hard-coded distance would be a pathogen or pest dispersal range for this crop
    and this organism, from a citable source. No such reference was found for the
    crops and organisms this platform covers, so a fixed number would be
    invented -- the exact fabrication the architecture forbids.

    Instead: for every point, the geodesic distance to its k-th nearest other
    point (k = minPts - 1, matching the parameter the radius is used with); sort
    ascending; take the knee. Distances come from PostGIS `ST_Distance` on the
    geography type, so they are true ellipsoidal metres.

    The value is then clamped, and the whole derivation -- k, the curve, the
    knee, and whether a guard rail bit -- is returned, so a reader can audit the
    number instead of taking it on trust.

    The heuristic assumes the classic convex curve: flat where points are dense,
    rising where they are not. Observations with little density contrast produce a
    concave or near-linear curve with no elbow, and the knee then lands near the
    low end. `eps` is small and clustering is conservative -- only the densest
    grouping qualifies. That is the right direction to fail in, and the returned
    curve makes it visible when it happens.
    """
    k = max(CLUSTER_MIN_POINTS - 1, 1)
    curve = [
        float(row[0])
        for row in db.execute(_K_DISTANCE_SQL, {
            'lats': [r['latitude'] for r in rows],
            'lons': [r['longitude'] for r in rows],
            'k': k,
        })
        if row[0] is not None
    ]
    index = knee_index(curve)
    raw = curve[index] if curve else 0.0
    eps = min(max(raw, MIN_EPS_METRES), MAX_EPS_METRES)
    return eps, {
        'heuristic': 'knee of the sorted k-nearest-neighbour distance curve',
        'k': k,
        'points': len(rows),
        'knee_index': index,
        'knee_metres': round(raw, 1),
        'curve_metres': [round(value, 1) for value in curve],
        'floor_metres': MIN_EPS_METRES,
        'ceiling_metres': MAX_EPS_METRES,
        'clamped_to': (
            'floor' if raw < MIN_EPS_METRES
            else 'ceiling' if raw > MAX_EPS_METRES
            else None
        ),
        'distance_basis': 'geodesic; PostGIS ST_Distance on geography(Point, 4326)',
    }


_DBSCAN_SQL = text("""
    WITH input AS (
        SELECT * FROM unnest(
            CAST(:keys AS text[]), CAST(:parts AS text[]),
            CAST(:lats AS float8[]), CAST(:lons AS float8[])
        ) AS t(row_key, part, lat, lon)
    ),
    located AS (
        SELECT row_key, part, lat, lon,
               ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography AS geog,
               ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), :proj) AS planar
        FROM input
    ),
    clustered AS (
        -- PARTITION BY stops evidence streams and subjects clustering into one
        -- another. ORDER BY makes border-point assignment deterministic, which
        -- the PostGIS documentation requires for reproducible output.
        SELECT row_key, part, lat, lon, geog,
               ST_ClusterDBSCAN(planar, eps => :eps, minpoints => :min_points)
                 OVER (PARTITION BY part ORDER BY row_key) AS cluster_index
        FROM located
    ),
    members AS (
        SELECT row_key, part, cluster_index, geog,
               avg(lat) OVER w AS centroid_lat,
               avg(lon) OVER w AS centroid_lon
        FROM clustered
        WHERE cluster_index IS NOT NULL
        WINDOW w AS (PARTITION BY part, cluster_index)
    )
    SELECT row_key, part, cluster_index, centroid_lat, centroid_lon,
           ST_Distance(
               geog,
               ST_SetSRID(ST_MakePoint(centroid_lon, centroid_lat), 4326)::geography
           ) AS metres_from_centroid
    FROM members
    ORDER BY part, cluster_index, row_key
""")


def assemble_clusters(rows: list[dict], assignments: list[dict], window: dict) -> list[dict]:
    """Turn per-row DBSCAN assignments into cluster records, rejecting artefacts.

    Two rejections happen here, and both matter more than the clustering itself:

    * fewer than `CLUSTER_MIN_POINTS` members -- PostGIS documents that border
      assignment can yield a cluster smaller than `minpoints`, and an undersized
      cluster is not the finding the parameters claim;
    * fewer than `CLUSTER_MIN_LOCATIONS` distinct positions -- three records at
      one coordinate are one place checked three times, which is repetition, not
      spatial spread.

    Pure: no database, no clock, no I/O. The arithmetic that decides what counts
    as a cluster is therefore directly testable.
    """
    by_key = {row_key(r): r for r in rows}
    grouped: dict[tuple[str, int], list[dict]] = {}
    shapes: dict[tuple[str, int], dict] = {}
    for assignment in assignments:
        member = by_key.get(assignment['row_key'])
        if member is None:
            continue
        bucket = (assignment['part'], assignment['cluster_index'])
        grouped.setdefault(bucket, []).append(member)
        shape = shapes.setdefault(bucket, {
            'latitude': float(assignment['centroid_lat']),
            'longitude': float(assignment['centroid_lon']),
            'radius_metres': 0.0,
        })
        shape['radius_metres'] = max(
            shape['radius_metres'], float(assignment['metres_from_centroid'])
        )

    clusters = []
    for bucket, members in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
        locations = distinct_locations(members)
        if len(members) < CLUSTER_MIN_POINTS or locations < CLUSTER_MIN_LOCATIONS:
            continue
        evidence_type = members[0]['evidence_type']
        # The partition key was normalised, so report the spelling that occurs most.
        subject = Counter(m['subject'] for m in members).most_common(1)[0][0]
        observed = sorted(m['observed_at'] for m in members)
        shape = shapes[bucket]
        radius = round(shape['radius_metres'], 1)
        clusters.append({
            # Never "hotspot", never a severity. What this says is exactly what was
            # computed: like observations, near each other, inside this window.
            'cluster_type': CLUSTER_TYPE,
            'cluster_label': 'Potential spatial cluster',
            'cluster_id': f'{bucket[0]}#{bucket[1]}',
            'evidence_type': evidence_type,
            'evidence_label': EVIDENCE_LABELS[evidence_type],
            'subject': subject,
            'subject_kind': SUBJECT_KIND[evidence_type],
            'observation_count': len(members),
            'distinct_locations': locations,
            'farm_ids': sorted({m['farm_id'] for m in members if m['farm_id'] is not None}),
            'crop_ids': sorted({m['crop_id'] for m in members if m['crop_id'] is not None}),
            'centroid': {
                'latitude': round(shape['latitude'], 6),
                'longitude': round(shape['longitude'], 6),
                'basis': 'arithmetic mean of member coordinates; not an observed position',
            },
            'radius_metres': radius,
            'first_observed_at': observed[0].isoformat(),
            'last_observed_at': observed[-1].isoformat(),
            'window': window,
            # Single-typed by construction, and reported anyway so that the
            # separation of evidence streams is visible rather than asserted.
            'evidence_composition': dict(Counter(m['evidence_type'] for m in members)),
            'members': [
                {
                    'evidence_type': m['evidence_type'],
                    'id': m['id'],
                    'farm_id': m['farm_id'],
                    'crop_id': m['crop_id'],
                    'latitude': m['latitude'],
                    'longitude': m['longitude'],
                    'observed_at': m['observed_at'].isoformat(),
                }
                for m in sorted(members, key=lambda m: m['observed_at'], reverse=True)
            ],
            'interpretation': (
                f'{len(members)} {EVIDENCE_LABELS[evidence_type].lower()} records of '
                f'{subject} lie within {round(radius)} m of their own centre inside this '
                'window, across '
                f'{locations} distinct positions. That is a geometric grouping of like '
                'records. It has not been tested for statistical significance, and no '
                'expert has reviewed it.'
            ),
            'significance_tested': False,
            'expert_validated': False,
        })
    return clusters


def cluster_requirements(rows: list[dict]) -> list[Requirement]:
    """The gate, as data. Pure, so the thresholds are testable on their own."""
    return [
        Requirement(
            'located_field_observations', MIN_LOCATED_OBSERVATIONS, len(rows),
            'Image screenings and pest observations carrying coordinates, inside the '
            'window. Environmental risk is excluded.',
        ),
        Requirement(
            'distinct_locations', MIN_DISTINCT_LOCATIONS, distinct_locations(rows),
            'Positions at least ~11 m apart. Two points define a line, not a cluster.',
        ),
    ]


def _method_block(
    window: dict,
    eps: float | None,
    derivation: dict | None,
    evidence_types: tuple[str, ...],
) -> dict:
    """The method, reported whether or not anything was clustered."""
    return {
        'name': 'DBSCAN - density-based spatial clustering of applications with noise',
        'reference': 'Ester, Kriegel, Sander and Xu (1996)',
        'implementation': 'PostGIS ST_ClusterDBSCAN',
        'applied': eps is not None,
        'claim': (
            'Geometric proximity of like observations within a time window. Not a test '
            'of whether the grouping exceeds chance expectation.'
        ),
        'spatial_parameters': {
            'eps_metres': None if eps is None else round(eps, 1),
            'eps_basis': (
                'derived per request from the observations, at the knee of the sorted '
                'k-nearest-neighbour distance curve; never a hard-coded dispersal distance'
            ),
            'eps_derivation': derivation,
            'min_points': CLUSTER_MIN_POINTS,
            'min_distinct_locations_per_cluster': CLUSTER_MIN_LOCATIONS,
            'stored_type': 'geography(Point, 4326)',
            'stored_srid': 4326,
            'clustering_projection': (
                'azimuthal equidistant centred on the observations, because '
                'ST_ClusterDBSCAN measures eps in the units of its input geometry'
            ),
        },
        'temporal_parameters': {
            **window,
            'model': (
                'Purely spatial clustering inside one time window. This is not a '
                'space-time scan: the window is a filter, not a scanned dimension.'
            ),
        },
        'partitioning': (
            'Clustered separately per evidence type and per subject - predicted class, '
            'or pest name compared case-insensitively. Two different findings near each '
            'other are two findings.'
        ),
        'evidence_considered': [t for t in evidence_types if t in CLUSTERABLE_EVIDENCE],
        'evidence_excluded': {
            key: reason for key, reason in CLUSTER_EXCLUSIONS.items()
            if key in evidence_types
        },
        'rejected_alternatives': {
            'kernel_density_estimation':
                'Produces a persuasive continuous surface from any input, including too '
                'little.',
            'grid_or_hex_binning':
                'Cell size and origin change the result and would be arbitrary '
                '(modifiable areal unit problem).',
            'k_means':
                'Needs the cluster count in advance and assigns every point to one, so it '
                'cannot report that there is no cluster.',
        },
    }


def _significance_block(clusters: list[dict]) -> dict:
    """What would be needed to call any of this significant. Never tested."""
    clustered = sum(c['observation_count'] for c in clusters)
    return {
        'tested': False,
        'target_method': 'space-time permutation scan statistic (Kulldorff et al. 2005)',
        'why_this_method': (
            'It needs no population-at-risk denominator: expected counts come from the '
            'marginals of the location-by-time case table, and significance from Monte '
            'Carlo permutation of case times. That suits a platform which has cases but '
            'no register of the fields at risk.'
        ),
        'why_not_applied': (
            'Case volume. The method needs enough located cases spread over enough '
            'space-time cells for a permutation distribution to mean anything; the '
            'published deployment scanned 183 locations with 999 permutations. This '
            f'request grouped {clustered} located field record(s).'
        ),
        'consequence': (
            'Every grouping reported here is geometric. None asserts that a '
            'concentration exceeds chance, and none is an expert diagnosis.'
        ),
    }


def assess_clusters(
    db: Session,
    farms: list[Farm],
    evidence_types: tuple[str, ...],
    crop_id: int | None,
    window_start: datetime,
    window_end: datetime,
    window_days: int | None,
) -> dict:
    """Potential spatial clusters among the caller's located field evidence.

    Three outcomes, and the difference between them is the whole point:

    * `INSUFFICIENT_DATA` -- the gate is not met. No clustering is attempted and
      the shortfall is itemised. This is the answer for a sparse database.
    * `NO_CLUSTER_DETECTED` -- there was enough evidence to look, and nothing
      grouped. A real, informative negative.
    * `POTENTIAL_CLUSTERS_IDENTIFIED` -- one or more geometric groupings survived
      the post-checks, each reported with the parameters that produced it.

    Never returns a severity grade, and never claims significance.
    """
    window = {
        'start': window_start.isoformat(),
        'end': window_end.isoformat(),
        'days': window_days,
        'basis': (
            'Operational surveillance horizon, not a validated epidemiological constant. '
            f'Default {DEFAULT_WINDOW_DAYS} days; configurable per request.'
        ),
    }
    rows = locate_field_evidence(
        db, [farm.id for farm in farms], evidence_types, crop_id, window_start, window_end
    )
    requirements = cluster_requirements(rows)
    shortfall = [r for r in requirements if not r.met]

    def response(status, explanation, clusters, eps=None, derivation=None):
        return {
            'status': status,
            'explanation': explanation,
            'scope': 'farmer',
            'window': window,
            'located_field_observations': len(rows),
            'distinct_locations': distinct_locations(rows),
            'distinct_farms': len({r['farm_id'] for r in rows if r['farm_id'] is not None}),
            'requirements': [
                {
                    'name': r.name, 'required': r.required, 'actual': r.actual,
                    'met': r.met, 'note': r.note,
                }
                for r in requirements
            ],
            'method': _method_block(window, eps, derivation, evidence_types),
            'significance': _significance_block(clusters),
            'clusters': clusters,
            'thresholds': {
                'min_located_field_observations': MIN_LOCATED_OBSERVATIONS,
                'min_distinct_locations': MIN_DISTINCT_LOCATIONS,
                'min_points_per_cluster': CLUSTER_MIN_POINTS,
                'min_distinct_locations_per_cluster': CLUSTER_MIN_LOCATIONS,
            },
            'deferred': {
                'statistical_significance':
                    'Space-time permutation scan statistic. Needs case volume.',
                'expert_validation':
                    'No reviewer verdict exists on any record here. A later phase.',
                'cross_farm_regional_view': (
                    'Aggregating across farmers needs a data-sharing policy first: at '
                    f'minimum {REGIONAL_MIN_DISTINCT_FARMS} distinct farms per reported '
                    'group, plus coordinate rounding, so that no single farm health '
                    'status can be inferred. Deliberately not applied to this '
                    'farmer-scoped response, where the caller owns every record.'
                ),
                'min_distinct_farms_for_cross_farm_display': REGIONAL_MIN_DISTINCT_FARMS,
            },
            'limitations': [
                'Geometric proximity only. No significance test has been applied.',
                'eps is derived from the data, not from a sourced dispersal distance for '
                'this crop and organism, so the radius describes these observations '
                'rather than how far the organism travels.',
                'DBSCAN assumes a single density threshold across the whole request, so '
                'a sparse grouping and a dense one cannot both be found with one eps.',
                'Only the caller own farms are considered, so a grouping that straddles '
                'a neighbouring holding cannot be seen here.',
                'Absent coordinates stay absent and are never imputed, so an unlocated '
                'observation can neither create nor prevent a grouping.',
            ],
        }

    if shortfall:
        missing = ', '.join(f'{r.name} {r.actual} of {r.required}' for r in shortfall)
        return response(
            STATUS_INSUFFICIENT,
            'Not enough geographically distributed observations to identify a reliable '
            f'spatial cluster. Short of: {missing}.',
            [],
        )

    eps, derivation = derive_eps(db, rows)
    assignments = db.execute(_DBSCAN_SQL, {
        'keys': [row_key(r) for r in rows],
        'parts': [partition_key(r) for r in rows],
        'lats': [r['latitude'] for r in rows],
        'lons': [r['longitude'] for r in rows],
        'proj': projection_for(rows),
        'eps': eps,
        'min_points': CLUSTER_MIN_POINTS,
    }).mappings().all()
    clusters = assemble_clusters(rows, [dict(a) for a in assignments], window)

    if not clusters:
        return response(
            STATUS_NO_CLUSTER,
            f'{len(rows)} located field observations were examined at a {round(eps)} m '
            f'search radius and none grouped: no {CLUSTER_MIN_POINTS} records of the same '
            'subject fall within that distance of one another across at least '
            f'{CLUSTER_MIN_LOCATIONS} distinct positions.',
            [],
            eps,
            derivation,
        )

    return response(
        STATUS_CLUSTERS,
        f'{len(clusters)} potential spatial cluster(s) identified by geometric proximity '
        f'at a {round(eps)} m search radius. Each is a grouping of like observations, not '
        'a tested finding and not an expert diagnosis.',
        clusters,
        eps,
        derivation,
    )
