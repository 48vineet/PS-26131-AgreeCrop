from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from evaluation import OFFICIAL_ROLES, require_official
from geospatial import (
    EVIDENCE_IMAGE,
    EVIDENCE_PEST,
    EVIDENCE_RISK,
    assess_clusters,
    farm_positions,
    parse_evidence_types,
    resolve_window,
)
from models_db import Crop, DiseaseObservation, ExpertValidation, Farm, FarmLocation, MonitoringCase, PestObservation, Referral, RiskAssessment, User

router = APIRouter(prefix="/official", tags=["official intelligence"])

# Risk level -> share of the map's weight, and the severity vocabulary the
# official bubbles are drawn in. Reused from the extension risk scale so one
# district cannot read as high on one screen and moderate on another.
RISK_SHARE = {"CRITICAL": 1.0, "HIGH": 0.75, "MODERATE": 0.45, "LOW": 0.2}
RISK_SEVERITY = {"CRITICAL": "critical", "HIGH": "high", "MODERATE": "moderate", "LOW": "low"}
DISTRICT_MIN_FARMS = 2  # a "district" of one farm would name that farm


@router.get("/summary")
def summary(
    state: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_official(current_user)
    farm_query = db.query(Farm)
    if state:
        farm_query = farm_query.join(FarmLocation, FarmLocation.farm_id == Farm.id).filter(FarmLocation.state == state).distinct()
    farms = farm_query.all()
    farm_ids = [farm.id for farm in farms]
    if not farm_ids:
        return {
            "scope": {"state": state, "roles": list(OFFICIAL_ROLES), "your_role": current_user.role},
            "counts": {
                "farms": 0,
                "observations": 0,
                "image_screenings": 0,
                "pest_observations": 0,
                "high_risk_cases": 0,
                "pending_validations": 0,
                "open_referrals": 0,
                "follow_up_workload": 0,
            },
            "disease_trends": [],
            "pest_trends": [],
            "crop_statistics": [],
            "risk_levels": {},
            "states": [],
            "privacy": {"farmer_identity_disclosed": False, "exact_coordinates_disclosed": False},
        }

    crops = db.query(Crop).filter(Crop.farm_id.in_(farm_ids), Crop.archived_at.is_(None)).all()
    crop_by_id = {crop.id: crop for crop in crops}
    screenings = db.query(DiseaseObservation).filter(DiseaseObservation.farm_id.in_(farm_ids)).all()
    pests = db.query(PestObservation).filter(PestObservation.farm_id.in_(farm_ids)).all()
    risks = db.query(RiskAssessment).filter(RiskAssessment.farm_id.in_(farm_ids)).all()
    cases = db.query(MonitoringCase).filter(MonitoringCase.farm_id.in_(farm_ids)).all()
    screening_ids = [row.id for row in screenings]
    validations = (
        db.query(ExpertValidation)
        .filter(ExpertValidation.observation_id.in_(screening_ids), ExpertValidation.status == "PENDING")
        .all()
        if screening_ids
        else []
    )
    case_ids = [case.id for case in cases]
    referrals = db.query(Referral).filter(Referral.case_id.in_(case_ids)).all() if case_ids else []

    disease_trends, pest_trends, crop_statistics, risk_levels = {}, {}, {}, {}
    latest_risks: dict[tuple[int, int], RiskAssessment] = {}
    for row in screenings:
        disease_trends[row.predicted_class] = disease_trends.get(row.predicted_class, 0) + 1
        crop = crop_by_id.get(row.crop_id)
        if crop:
            crop_statistics[crop.crop_name] = crop_statistics.get(crop.crop_name, 0) + 1
    for row in pests:
        pest_trends[row.pest_name] = pest_trends.get(row.pest_name, 0) + 1
    for row in risks:
        key = (row.farm_id, row.crop_id)
        incumbent = latest_risks.get(key)
        if incumbent is None or (row.calculated_at or datetime.min) > (incumbent.calculated_at or datetime.min):
            latest_risks[key] = row
    for row in latest_risks.values():
        risk_levels[row.risk_level] = risk_levels.get(row.risk_level, 0) + 1
    states = [row[0] for row in db.query(FarmLocation.state).filter(FarmLocation.state.isnot(None)).distinct().order_by(FarmLocation.state).all()]

    return {
        "scope": {"state": state, "roles": list(OFFICIAL_ROLES), "your_role": current_user.role},
        "counts": {
            "farms": len(farms),
            "observations": len(screenings) + len(pests),
            "image_screenings": len(screenings),
            "pest_observations": len(pests),
            "high_risk_cases": sum(row.risk_level == "HIGH" for row in latest_risks.values()),
            "pending_validations": len(validations),
            "open_referrals": sum(row.status in ("RECOMMENDED", "REQUESTED", "REFERRED", "IN_PROGRESS") for row in referrals),
            "follow_up_workload": sum(row.status in ("OPEN", "FOLLOW_UP_SUBMITTED") for row in cases),
        },
        "disease_trends": [{"condition": key, "count": value} for key, value in sorted(disease_trends.items(), key=lambda pair: (-pair[1], pair[0]))],
        "pest_trends": [{"pest": key, "count": value} for key, value in sorted(pest_trends.items(), key=lambda pair: (-pair[1], pair[0]))],
        "crop_statistics": [{"crop": key, "image_screenings": value} for key, value in sorted(crop_statistics.items(), key=lambda pair: (-pair[1], pair[0]))],
        "risk_levels": risk_levels,
        "states": states,
        "privacy": {"farmer_identity_disclosed": False, "exact_coordinates_disclosed": False},
    }


@router.get("/analytics")
def analytics(
    state: str | None = Query(default=None),
    district: str | None = Query(default=None),
    days: int | None = Query(default=90, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deep regional agricultural intelligence & analytics for officials."""
    require_official(current_user)
    window_start, window_end, window_days = resolve_window(days, None, None)

    farm_query = db.query(Farm).join(User, User.id == Farm.user_id).filter(User.role == "farmer")
    if state or district:
        loc_filter = farm_query.join(FarmLocation, FarmLocation.farm_id == Farm.id)
        if state:
            loc_filter = loc_filter.filter(FarmLocation.state == state)
        if district:
            loc_filter = loc_filter.filter(FarmLocation.district == district)
        farm_query = loc_filter.distinct()

    farms = farm_query.all()
    farm_ids = [farm.id for farm in farms]

    all_states = [r[0] for r in db.query(FarmLocation.state).filter(FarmLocation.state.isnot(None)).distinct().order_by(FarmLocation.state).all()]
    all_districts = [r[0] for r in db.query(FarmLocation.district).filter(FarmLocation.district.isnot(None)).distinct().order_by(FarmLocation.district).all()]

    if not farm_ids:
        return {
            "scope": {"state": state, "district": district, "days": window_days},
            "counts": {
                "farms": 0, "observations": 0, "image_screenings": 0, "pest_observations": 0,
                "high_risk_cases": 0, "critical_cases": 0, "pending_validations": 0,
                "open_referrals": 0, "follow_up_workload": 0,
            },
            "time_series": [],
            "disease_trends": [],
            "pest_trends": [],
            "crop_statistics": [],
            "risk_levels": {"CRITICAL": 0, "HIGH": 0, "MODERATE": 0, "LOW": 0},
            "district_rankings": [],
            "states": all_states,
            "districts": all_districts,
            "validation_stats": {"total_reviewed": 0, "agreement_rate": None, "avg_confidence": None},
        }

    crops = db.query(Crop).filter(Crop.farm_id.in_(farm_ids), Crop.archived_at.is_(None)).all()
    crop_by_id = {c.id: c for c in crops}
    positions = farm_positions(db, farms)

    screenings = (
        db.query(DiseaseObservation)
        .filter(
            DiseaseObservation.farm_id.in_(farm_ids),
            DiseaseObservation.screened_at.between(window_start, window_end),
        )
        .all()
    )
    pests = (
        db.query(PestObservation)
        .filter(
            PestObservation.farm_id.in_(farm_ids),
            PestObservation.observed_at.between(window_start, window_end),
        )
        .all()
    )
    risks = (
        db.query(RiskAssessment)
        .filter(
            RiskAssessment.farm_id.in_(farm_ids),
            RiskAssessment.calculated_at.between(window_start, window_end),
        )
        .all()
    )
    cases = db.query(MonitoringCase).filter(MonitoringCase.farm_id.in_(farm_ids)).all()
    screening_ids = [s.id for s in screenings]
    validations = (
        db.query(ExpertValidation)
        .filter(ExpertValidation.observation_id.in_(screening_ids))
        .all()
        if screening_ids else []
    )
    case_ids = [c.id for c in cases]
    referrals = db.query(Referral).filter(Referral.case_id.in_(case_ids)).all() if case_ids else []

    # Disease trends & confidence
    disease_counts: dict[str, int] = Counter()
    disease_conf: dict[str, list[float]] = defaultdict(list)
    crop_screenings: dict[str, int] = Counter()
    for row in screenings:
        if row.predicted_class:
            disease_counts[row.predicted_class] += 1
            disease_conf[row.predicted_class].append(float(row.confidence or 0))
        crop = crop_by_id.get(row.crop_id)
        if crop:
            crop_screenings[crop.crop_name] += 1

    # Pest trends
    pest_counts: dict[str, int] = Counter()
    for row in pests:
        if row.pest_name:
            pest_counts[row.pest_name] += 1

    # Risks breakdown
    latest_risks: dict[tuple[int, int], RiskAssessment] = {}
    risk_levels: dict[str, int] = {"CRITICAL": 0, "HIGH": 0, "MODERATE": 0, "LOW": 0}
    for row in risks:
        key = (row.farm_id, row.crop_id)
        incumbent = latest_risks.get(key)
        if incumbent is None or (row.calculated_at or datetime.min) > (incumbent.calculated_at or datetime.min):
            latest_risks[key] = row
    for row in latest_risks.values():
        lvl = (row.risk_level or "LOW").upper()
        risk_levels[lvl] = risk_levels.get(lvl, 0) + 1

    # Time series
    time_bins: dict[str, dict[str, int]] = defaultdict(lambda: {"screenings": 0, "pests": 0, "risks": 0})
    for row in screenings:
        if row.screened_at:
            day_str = row.screened_at.strftime("%Y-%m-%d")
            time_bins[day_str]["screenings"] += 1
    for row in pests:
        if row.observed_at:
            day_str = row.observed_at.strftime("%Y-%m-%d")
            time_bins[day_str]["pests"] += 1
    for row in risks:
        if row.calculated_at:
            day_str = row.calculated_at.strftime("%Y-%m-%d")
            time_bins[day_str]["risks"] += 1

    time_series = [
        {"date": date_key, "screenings": counts["screenings"], "pests": counts["pests"], "risks": counts["risks"], "total": counts["screenings"] + counts["pests"]}
        for date_key, counts in sorted(time_bins.items())
    ]
    if len(time_series) > 16:
        weekly_bins: dict[str, dict[str, int]] = defaultdict(lambda: {"screenings": 0, "pests": 0, "risks": 0})
        for entry in time_series:
            dt = datetime.strptime(entry["date"], "%Y-%m-%d")
            week_label = f"W{dt.strftime('%U')} ({dt.strftime('%b %d')})"
            weekly_bins[week_label]["screenings"] += entry["screenings"]
            weekly_bins[week_label]["pests"] += entry["pests"]
            weekly_bins[week_label]["risks"] += entry["risks"]
        time_series = [
            {"date": w, "screenings": c["screenings"], "pests": c["pests"], "risks": c["risks"], "total": c["screenings"] + c["pests"]}
            for w, c in weekly_bins.items()
        ]

    # District ranking
    district_obs: dict[str, dict] = defaultdict(lambda: {"screenings": 0, "pests": 0, "high_risks": 0, "farms": 0})
    for farm in farms:
        loc = positions.get(farm.id)
        dist = loc.district if loc and loc.district else "Other"
        district_obs[dist]["farms"] += 1
    for row in screenings:
        loc = positions.get(row.farm_id)
        dist = loc.district if loc and loc.district else "Other"
        district_obs[dist]["screenings"] += 1
    for row in pests:
        loc = positions.get(row.farm_id)
        dist = loc.district if loc and loc.district else "Other"
        district_obs[dist]["pests"] += 1
    for row in latest_risks.values():
        if row.risk_level in ("HIGH", "CRITICAL"):
            loc = positions.get(row.farm_id)
            dist = loc.district if loc and loc.district else "Other"
            district_obs[dist]["high_risks"] += 1

    district_rankings = [
        {
            "district": dist,
            "total_observations": d_data["screenings"] + d_data["pests"],
            "screenings": d_data["screenings"],
            "pests": d_data["pests"],
            "high_risks": d_data["high_risks"],
            "farms": d_data["farms"],
        }
        for dist, d_data in sorted(district_obs.items(), key=lambda x: (-(x[1]["high_risks"]), -(x[1]["screenings"] + x[1]["pests"])))
    ]

    reviewed = [v for v in validations if v.status != "PENDING"]
    agreed = sum(1 for v in reviewed if v.status == "VALIDATED")
    # None, not 0 or 100: with no reviews on record the true agreement rate is
    # unknown, and a fabricated number reads as a real benchmark.
    agreement_rate = round((agreed / len(reviewed)) * 100, 1) if reviewed else None
    all_confs = [float(s.confidence or 0) for s in screenings if s.confidence is not None]
    avg_conf = round(sum(all_confs) / len(all_confs), 1) if all_confs else None

    return {
        "scope": {"state": state, "district": district, "days": window_days},
        "counts": {
            "farms": len(farms),
            "observations": len(screenings) + len(pests),
            "image_screenings": len(screenings),
            "pest_observations": len(pests),
            "high_risk_cases": sum(row.risk_level == "HIGH" for row in latest_risks.values()),
            "critical_cases": sum(row.risk_level == "CRITICAL" for row in latest_risks.values()),
            "pending_validations": sum(v.status == "PENDING" for v in validations),
            "open_referrals": sum(row.status in ("RECOMMENDED", "REQUESTED", "REFERRED", "IN_PROGRESS") for row in referrals),
            "follow_up_workload": sum(row.status in ("OPEN", "FOLLOW_UP_SUBMITTED") for row in cases),
        },
        "time_series": time_series,
        "disease_trends": [
            {
                "condition": k,
                "count": v,
                "confidence_avg": round(sum(disease_conf[k]) / len(disease_conf[k]), 1) if disease_conf[k] else 0,
            }
            for k, v in disease_counts.most_common(12)
        ],
        "pest_trends": [
            {"pest": k, "count": v}
            for k, v in pest_counts.most_common(12)
        ],
        "crop_statistics": [
            {"crop": k, "image_screenings": v}
            for k, v in crop_screenings.most_common(12)
        ],
        "risk_levels": risk_levels,
        "district_rankings": district_rankings[:10],
        "states": all_states,
        "districts": all_districts,
        "validation_stats": {
            "total_reviewed": len(reviewed),
            "agreement_rate": agreement_rate,
            "avg_confidence": avg_conf,
        },
    }


@router.get("/districts")
def districts(
    state: str | None = Query(default=None),
    days: int | None = Query(default=90, ge=1, le=365),
    evidence: str | None = Query(default=None, description="Comma-separated: image_screening,pest_observation,environmental_risk"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """District-level surveillance aggregates for the official planning view.

    Returns one bubble per district: how many farms are mapped, how much
    evidence landed inside the window, which crops are affected, and a risk
    score. This is the planning view the problem statement asks for -- where to
    send the next team -- and it is aggregated on purpose.

    Privacy: a district below `DISTRICT_MIN_FARMS` is withheld entirely, and no
    response here contains a farm id, a farmer name, or an exact coordinate. A
    marker is placed at the district's *mean* farm position and rounded to two
    decimals (~1 km), which is an area summary and not a locator. This matches
    the notice on /official/analytics rather than contradicting it.
    """
    require_official(current_user)
    evidence_types = parse_evidence_types(evidence)
    window_start, window_end, window_days = resolve_window(days, None, None)

    empty = {
        "districts": [],
        "states": [],
        "counts": {"districts": 0, "farms_mapped": 0, "farms_withheld": 0, "observations": 0},
        "risk_index": 0,
        "privacy": {
            "farmer_identity_disclosed": False,
            "exact_coordinates_disclosed": False,
            "aggregation_unit": "district",
            "min_farms_per_district": DISTRICT_MIN_FARMS,
            "coordinate_precision": "district mean, rounded to 2 decimals (~1 km); not a farm location",
        },
        "window": {"start": window_start.isoformat(), "end": window_end.isoformat(), "days": window_days},
    }

    farm_query = db.query(Farm)
    if state:
        farm_query = (
            farm_query.join(FarmLocation, FarmLocation.farm_id == Farm.id)
            .filter(FarmLocation.state == state)
            .distinct()
        )
    farms = farm_query.all()
    positions = farm_positions(db, farms)
    if not positions:
        return empty

    # Group farms by district. A farm with no location, or no district recorded,
    # cannot be placed on a district map and is not counted anywhere.
    grouped: dict[tuple[str, str], list[tuple[Farm, FarmLocation]]] = defaultdict(list)
    for farm in farms:
        location = positions.get(farm.id)
        if location is None or not location.district:
            continue
        grouped[((location.state or "Unknown"), location.district)].append((farm, location))

    withheld = 0
    rows: list[dict] = []
    for (row_state, district), members in grouped.items():
        if len(members) < DISTRICT_MIN_FARMS:
            withheld += 1
            continue
        farm_ids = [farm.id for farm, _ in members]
        rows.append(_district_row(db, row_state, district, members, farm_ids, evidence_types, window_start, window_end))

    rows.sort(key=lambda r: (-r["risk_score"], -r["observations"]["total"], r["district"]))

    # Regional clusters reuse the farmer/extension cluster engine, which takes
    # `farms` as a parameter and is therefore not ownership-locked. The response
    # keeps its own honest three-state status and significance block.
    cluster_report = assess_clusters(
        db, farms, evidence_types, None, window_start, window_end, window_days
    )
    # A regional grouping of one or two farms is the same disclosure a district
    # bubble avoids, so it is withheld on the same floor.
    cluster_report["clusters"] = [
        _official_cluster(c)
        for c in cluster_report["clusters"]
        if len(c.get("farm_ids", [])) >= DISTRICT_MIN_FARMS
    ]
    cluster_report["scope"] = "regional"
    cluster_report["min_farms_per_reported_cluster"] = DISTRICT_MIN_FARMS
    cluster_report["privacy"] = {
        "exact_coordinates_disclosed": False,
        "note": "Clusters are counts and a radius. Member farms, member observations and their coordinates are not included.",
    }

    total_farms = sum(r["farms"] for r in rows)
    weighted = sum(r["risk_score"] * r["farms"] for r in rows)
    states = sorted({r["state"] for r in rows})

    return {
        "districts": rows,
        "states": states,
        "counts": {
            "districts": len(rows),
            "farms_mapped": total_farms,
            "districts_withheld": withheld,
            "observations": sum(r["observations"]["total"] for r in rows),
            "farms_with_evidence": sum(r["farms_with_evidence"] for r in rows),
        },
        # Farm-weighted mean of the district scores, so a district of many farms
        # counts for more than a district of few, and the empty case is 0
        # rather than undefined.
        "risk_index": round(weighted / total_farms, 1) if total_farms else 0,
        "clusters": cluster_report,
        "privacy": empty["privacy"],
        "window": empty["window"],
    }


def _official_cluster(cluster: dict) -> dict:
    """The public shape of one cluster, with the identifying parts removed.

    `assess_clusters` is built for a caller who owns every record it reports, so
    each cluster carries `farm_ids`, `crop_ids` and a `members` list of the
    individual observations with their exact coordinates. An official sees farms
    they do not own and the page promises coordinates are not disclosed, so those
    keys are dropped here rather than trusted to the UI not to read them.
    """
    c = dict(cluster)
    c.pop("farm_ids", None)
    c.pop("crop_ids", None)
    c.pop("members", None)
    if isinstance(c.get("centroid"), dict):
        c["centroid"] = {
            "latitude": c["centroid"]["latitude"],
            "longitude": c["centroid"]["longitude"],
        }
    return c


def _district_row(db, row_state, district, members, farm_ids, evidence_types, window_start, window_end) -> dict:
    """One district's aggregate. No farm id or exact coordinate leaves here."""
    screenings = (
        db.query(DiseaseObservation)
        .filter(
            DiseaseObservation.farm_id.in_(farm_ids),
            DiseaseObservation.screened_at.between(window_start, window_end),
        )
        .all()
        if EVIDENCE_IMAGE in evidence_types
        else []
    )
    pests = (
        db.query(PestObservation)
        .filter(
            PestObservation.farm_id.in_(farm_ids),
            PestObservation.observed_at.between(window_start, window_end),
        )
        .all()
        if EVIDENCE_PEST in evidence_types
        else []
    )

    latest_risks: dict[tuple[int, int], RiskAssessment] = {}
    if EVIDENCE_RISK in evidence_types:
        for row in (
            db.query(RiskAssessment)
            .filter(
                RiskAssessment.farm_id.in_(farm_ids),
                RiskAssessment.calculated_at.between(window_start, window_end),
            )
            .all()
        ):
            key = (row.farm_id, row.crop_id)
            incumbent = latest_risks.get(key)
            if incumbent is None or (row.calculated_at or datetime.min) > (incumbent.calculated_at or datetime.min):
                latest_risks[key] = row

    crops = db.query(Crop).filter(Crop.farm_id.in_(farm_ids), Crop.archived_at.is_(None)).all()
    crop_names = Counter(c.crop_name for c in crops)
    crop_by_id = {c.id: c for c in crops}

    # Which crops are actually implicated by evidence, not merely planted here.
    # Counted per holding, not per signal: a farm with a screening, a trap read and
    # a high-risk assessment on the same crop is one affected holding, and three
    # is the number an official would misread as three farms needing a visit.
    affected: set[tuple[str, int]] = set()
    for row in list(screenings) + list(pests) + [
        r for r in latest_risks.values() if r.risk_level in ("HIGH", "CRITICAL")
    ]:
        crop = crop_by_id.get(row.crop_id)
        if crop:
            affected.add((crop.crop_name, row.farm_id))
    affected_counts = Counter(name for name, _ in affected)

    risk_values = [RISK_SHARE.get(r.risk_level, 0.0) for r in latest_risks.values()]
    mean_risk = sum(risk_values) / len(risk_values) if risk_values else 0.0
    top_level = (
        max(latest_risks.values(), key=lambda r: RISK_SHARE.get(r.risk_level, 0.0)).risk_level
        if latest_risks
        else None
    )

    # Evidence density, capped at 1: enough evidence per mapped farm to read as
    # full, and never let one busy district run off the scale on volume alone.
    farms = len(farm_ids)
    total_obs = len(screenings) + len(pests)
    density = min(1.0, total_obs / max(farms, 1) / 2.0)
    score = round(100 * (0.65 * mean_risk + 0.35 * density), 1)

    severity = "info"
    for level in ("CRITICAL", "HIGH", "MODERATE", "LOW"):
        if level in (r.risk_level for r in latest_risks.values()):
            severity = RISK_SEVERITY[level]
            break

    evidence_farms = (
        {r.farm_id for r in screenings}
        | {r.farm_id for r in pests}
        | {r.farm_id for r in latest_risks.values()}
    )
    conditions = Counter(r.predicted_class for r in screenings if r.predicted_class)
    pests_seen = Counter(r.pest_name for r in pests if r.pest_name)

    return {
        "district": district,
        "state": row_state,
        "severity": severity,
        "risk_score": score,
        "risk_level": top_level,
        "farms": farms,
        "farms_with_evidence": len(evidence_farms & set(farm_ids)),
        # Mean position of the district's farms, rounded to ~1 km. An area
        # summary for placing a marker, never a farm locator.
        "centroid": {
            "latitude": round(sum(loc.latitude for _, loc in members) / farms, 2),
            "longitude": round(sum(loc.longitude for _, loc in members) / farms, 2),
        },
        "observations": {
            "disease": len(screenings),
            "pest": len(pests),
            "risk": len(latest_risks),
            "total": total_obs,
        },
        "crops_planted": len(crop_names),
        "affected_crops": [
            {"crop": name, "farms": count}
            for name, count in affected_counts.most_common(5)
        ],
        "top_conditions": [{"condition": k, "count": v} for k, v in conditions.most_common(5)],
        "top_pests": [{"pest": k, "count": v} for k, v in pests_seen.most_common(5)],
    }


@router.get("/surveillance")
def surveillance(
    state: str | None = Query(default=None),
    district: str | None = Query(default=None),
    days: int | None = Query(default=90, ge=1, le=365),
    evidence: str | None = Query(default=None, description="Comma-separated evidence types"),
    farm_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Detailed farmer-level surveillance for official dashboard and field mapping.

    Returns each and every farmer's issues (disease screenings, pest observations,
    environmental risks, farm risks) with coordinates, farmer names, crop details,
    individual severity, cluster groupings, and heat points for visualization.
    """
    require_official(current_user)
    evidence_types = parse_evidence_types(evidence)
    window_start, window_end, window_days = resolve_window(days, None, None)

    farm_query = db.query(Farm).join(User, User.id == Farm.user_id).filter(User.role == "farmer")
    if farm_id:
        farm_query = farm_query.filter(Farm.id == farm_id)
    if state or district:
        loc_filter = farm_query.join(FarmLocation, FarmLocation.farm_id == Farm.id)
        if state:
            loc_filter = loc_filter.filter(FarmLocation.state == state)
        if district:
            loc_filter = loc_filter.filter(FarmLocation.district == district)
        farm_query = loc_filter.distinct()

    farms = farm_query.all()
    if not farms:
        return {
            "features": [],
            "heat_points": [],
            "clusters": {"status": "INSUFFICIENT_DATA", "clusters": []},
            "farmers": [],
            "counts": {"total_issues": 0, "screenings": 0, "pests": 0, "risks": 0, "critical_count": 0, "high_count": 0, "farms_reporting": 0, "total_farms": 0},
            "states": [],
            "districts": [],
            "window": {"start": window_start.isoformat(), "end": window_end.isoformat(), "days": window_days},
        }

    farm_ids = [farm.id for farm in farms]
    farmers = {
        user.id: user
        for user in db.query(User).filter(User.id.in_({f.user_id for f in farms})).all()
    }
    positions = farm_positions(db, farms)
    crops = db.query(Crop).filter(Crop.farm_id.in_(farm_ids), Crop.archived_at.is_(None)).all()
    crop_by_farm: dict[int, list[Crop]] = {}
    crop_by_id = {c.id: c for c in crops}
    for c in crops:
        crop_by_farm.setdefault(c.farm_id, []).append(c)

    features = []
    heat_points = []

    # 1. Disease Screenings
    if EVIDENCE_IMAGE in evidence_types:
        screenings = (
            db.query(DiseaseObservation)
            .filter(
                DiseaseObservation.farm_id.in_(farm_ids),
                DiseaseObservation.screened_at.between(window_start, window_end),
            )
            .order_by(DiseaseObservation.screened_at.desc())
            .all()
        )
        for row in screenings:
            farm = next((f for f in farms if f.id == row.farm_id), None)
            loc = positions.get(row.farm_id) if row.farm_id else None
            lat = row.latitude if row.latitude is not None else (loc.latitude if loc else None)
            lng = row.longitude if row.longitude is not None else (loc.longitude if loc else None)
            if lat is None or lng is None:
                continue

            farmer = farmers.get(farm.user_id) if farm else None
            crop = crop_by_id.get(row.crop_id)
            conf = float(row.confidence or 0)
            severity = "critical" if conf >= 85 else ("high" if conf >= 65 else ("moderate" if conf >= 45 else "low"))
            feat = {
                "id": f"screening_{row.id}",
                "evidence_type": "image_screening",
                "label": row.predicted_class or "Disease Observed",
                "condition": row.predicted_class,
                "confidence": conf,
                "severity": severity,
                "latitude": float(lat),
                "longitude": float(lng),
                "farmer_name": farmer.name if farmer else "Farmer",
                "farmer_phone": farmer.phone if farmer else None,
                "farm_id": farm.id if farm else None,
                "farm_name": farm.farm_name if farm else "Farm",
                "crop_name": crop.crop_name if crop else "General Crop",
                "detail": f"Screening: {row.predicted_class} ({conf:.0f}% confidence)",
                "observed_at": row.screened_at.isoformat() if row.screened_at else None,
                "district": loc.district if loc else None,
                "state": loc.state if loc else None,
                "village": loc.village if loc else None,
            }
            features.append(feat)
            intensity = 0.95 if severity == "critical" else (0.80 if severity == "high" else 0.55)
            heat_points.append([float(lat), float(lng), intensity])

    # 2. Pest Observations
    if EVIDENCE_PEST in evidence_types:
        pests = (
            db.query(PestObservation)
            .filter(
                PestObservation.farm_id.in_(farm_ids),
                PestObservation.observed_at.between(window_start, window_end),
            )
            .order_by(PestObservation.observed_at.desc())
            .all()
        )
        for row in pests:
            farm = next((f for f in farms if f.id == row.farm_id), None)
            loc = positions.get(row.farm_id) if row.farm_id else None
            lat = row.latitude if row.latitude is not None else (loc.latitude if loc else None)
            lng = row.longitude if row.longitude is not None else (loc.longitude if loc else None)
            if lat is None or lng is None:
                continue

            farmer = farmers.get(farm.user_id) if farm else None
            crop = crop_by_id.get(row.crop_id)
            cnt = int(row.count or 1)
            severity = "critical" if cnt >= 25 else ("high" if cnt >= 12 else ("moderate" if cnt >= 4 else "low"))
            feat = {
                "id": f"pest_{row.id}",
                "evidence_type": "pest_observation",
                "label": f"{row.pest_name or 'Pest'} ({cnt} {row.unit or 'count'})",
                "pest_name": row.pest_name,
                "count": cnt,
                "unit": row.unit,
                "severity": severity,
                "latitude": float(lat),
                "longitude": float(lng),
                "farmer_name": farmer.name if farmer else "Farmer",
                "farmer_phone": farmer.phone if farmer else None,
                "farm_id": farm.id if farm else None,
                "farm_name": farm.farm_name if farm else "Farm",
                "crop_name": crop.crop_name if crop else "General Crop",
                "detail": f"Pest Trap: {row.pest_name} - {cnt} {row.unit or 'pests'}",
                "observed_at": row.observed_at.isoformat() if row.observed_at else None,
                "district": loc.district if loc else None,
                "state": loc.state if loc else None,
                "village": loc.village if loc else None,
            }
            features.append(feat)
            intensity = 0.90 if severity == "critical" else (0.75 if severity == "high" else 0.50)
            heat_points.append([float(lat), float(lng), intensity])

    # 3. Environmental Risks
    if EVIDENCE_RISK in evidence_types:
        risks = (
            db.query(RiskAssessment)
            .filter(
                RiskAssessment.farm_id.in_(farm_ids),
                RiskAssessment.calculated_at.between(window_start, window_end),
            )
            .order_by(RiskAssessment.calculated_at.desc())
            .all()
        )
        for row in risks:
            loc = positions.get(row.farm_id)
            if not loc or loc.latitude is None or loc.longitude is None:
                continue
            farm = next((f for f in farms if f.id == row.farm_id), None)
            farmer = farmers.get(farm.user_id) if farm else None
            crop = crop_by_id.get(row.crop_id)
            lvl = row.risk_level or "LOW"
            severity = "critical" if lvl == "CRITICAL" else ("high" if lvl == "HIGH" else ("moderate" if lvl == "MODERATE" else "low"))
            feat = {
                "id": f"risk_{row.id}",
                "evidence_type": "environmental_risk",
                "label": f"{row.disease or 'Disease'} Weather Risk ({lvl})",
                "disease": row.disease,
                "risk_level": lvl,
                "severity": severity,
                "latitude": float(loc.latitude),
                "longitude": float(loc.longitude),
                "farmer_name": farmer.name if farmer else "Farmer",
                "farmer_phone": farmer.phone if farmer else None,
                "farm_id": farm.id if farm else None,
                "farm_name": farm.farm_name if farm else "Farm",
                "crop_name": crop.crop_name if crop else "General Crop",
                "detail": f"Weather Risk: {row.disease or 'Pathogen'} - {lvl}",
                "observed_at": row.calculated_at.isoformat() if row.calculated_at else None,
                "district": loc.district,
                "state": loc.state,
                "village": loc.village,
            }
            features.append(feat)
            intensity = 0.85 if severity == "critical" else (0.70 if severity == "high" else 0.45)
            heat_points.append([float(loc.latitude), float(loc.longitude), intensity])

    # If no features found within window, also add mapped farms as farm_risk points so map is never empty
    if not features:
        for farm in farms:
            loc = positions.get(farm.id)
            if not loc or loc.latitude is None or loc.longitude is None:
                continue
            farmer = farmers.get(farm.user_id)
            cur_crop = crop_by_farm.get(farm.id, [None])[0]
            features.append({
                "id": f"farm_{farm.id}",
                "evidence_type": "farm_risk",
                "label": f"{farm.farm_name} (Mapped Holding)",
                "severity": "low",
                "latitude": float(loc.latitude),
                "longitude": float(loc.longitude),
                "farmer_name": farmer.name if farmer else "Farmer",
                "farmer_phone": farmer.phone if farmer else None,
                "farm_id": farm.id,
                "farm_name": farm.farm_name,
                "crop_name": cur_crop.crop_name if cur_crop else "Field Crops",
                "detail": f"Active farm holding in {loc.district or loc.state or 'region'}",
                "observed_at": datetime.now(timezone.utc).isoformat(),
                "district": loc.district,
                "state": loc.state,
                "village": loc.village,
            })
            heat_points.append([float(loc.latitude), float(loc.longitude), 0.45])

    # Clusters
    cluster_report = assess_clusters(
        db, farms, evidence_types, None, window_start, window_end, window_days
    )

    all_states = sorted({loc.state for loc in positions.values() if loc and loc.state})
    all_districts = sorted({loc.district for loc in positions.values() if loc and loc.district})

    farmer_items = []
    for farm in farms:
        loc = positions.get(farm.id)
        farmer = farmers.get(farm.user_id)
        farm_feats = [f for f in features if f.get("farm_id") == farm.id]
        cur_crop = crop_by_farm.get(farm.id, [None])[0]
        farmer_items.append({
            "farm_id": farm.id,
            "farm_name": farm.farm_name,
            "farmer_name": farmer.name if farmer else "Farmer",
            "farmer_phone": farmer.phone if farmer else None,
            "crop_name": cur_crop.crop_name if cur_crop else None,
            "area": farm.area,
            "area_unit": farm.area_unit,
            "district": loc.district if loc else None,
            "state": loc.state if loc else None,
            "village": loc.village if loc else None,
            "latitude": float(loc.latitude) if loc and loc.latitude is not None else None,
            "longitude": float(loc.longitude) if loc and loc.longitude is not None else None,
            "issue_count": len(farm_feats),
            "highest_severity": "critical" if any(f["severity"] == "critical" for f in farm_feats) else (
                "high" if any(f["severity"] == "high" for f in farm_feats) else (
                    "moderate" if any(f["severity"] == "moderate" for f in farm_feats) else (
                        "low" if farm_feats else "none"
                    )
                )
            ),
        })

    features.sort(key=lambda f: f.get("observed_at") or "", reverse=True)

    return {
        "features": features,
        "heat_points": heat_points,
        "clusters": cluster_report,
        "farmers": farmer_items,
        "counts": {
            "total_issues": len(features),
            "screenings": sum(1 for f in features if f["evidence_type"] == "image_screening"),
            "pests": sum(1 for f in features if f["evidence_type"] == "pest_observation"),
            "risks": sum(1 for f in features if f["evidence_type"] == "environmental_risk"),
            "critical_count": sum(1 for f in features if f["severity"] == "critical"),
            "high_count": sum(1 for f in features if f["severity"] == "high"),
            "farms_reporting": len({f["farm_id"] for f in features if f.get("farm_id")}),
            "total_farms": len(farms),
        },
        "states": all_states,
        "districts": all_districts,
        "window": {"start": window_start.isoformat(), "end": window_end.isoformat(), "days": window_days},
    }

