"""Extension-worker farmer and farm directory.

The extension workflow needs operational context: which farmers and farms are
on the platform, what is growing, and what needs attention. This router is
deliberately read-only. It does not change the ownership rules used by farmer
profile endpoints, and it does not expose farmer identity through the review
queue. The directory itself is the authorized context where those names belong.
"""

from datetime import datetime

from auth import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, HTTPException, Query
from models_db import (Crop, DiseaseObservation, Farm, FarmLocation,
                       MonitoringCase, PestObservation, RiskAssessment, User)
from monitoring import effective_status
from risk_engine import assess
from sqlalchemy.orm import Session
from weather import fetch_weather

router = APIRouter(prefix='/extension', tags=['extension worker'])

EXTENSION_ROLES = ('extension_officer', 'official', 'admin')


def require_extension(user: User) -> None:
    if user.role not in EXTENSION_ROLES:
        raise HTTPException(403, 'Extension access is required.')


def _location(location: FarmLocation | None) -> dict | None:
    if location is None:
        return None

    return {
        'latitude': location.latitude,
        'longitude': location.longitude,
        'address': location.address,
        'village': location.village,
        'district': location.district,
        'state': location.state,
    }


RISK_INTENSITY = {
    'LOW': 0.20,
    'MODERATE': 0.50,
    'HIGH': 0.80,
    'CRITICAL': 1.00,
}


def _risk_intensity(risk: RiskAssessment | None) -> float | None:
    if risk is None:
        return None

    return RISK_INTENSITY.get(risk.risk_level)


def _latest(rows: list, timestamp_key: str):
    return max(rows, key=lambda row: getattr(row, timestamp_key) or datetime.min) if rows else None


@router.get('/farmers')
def farmers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_extension(current_user)

    farms = (
        db.query(Farm)
        .join(User, User.id == Farm.user_id)
        .filter(User.role == 'farmer')
        .order_by(User.name, Farm.id)
        .all()
    )
    if not farms:
        return {'scope': 'extension', 'items': [], 'total': 0}

    farm_ids = [farm.id for farm in farms]
    farmers = {
        user.id: user
        for user in db.query(User).filter(User.id.in_({farm.user_id for farm in farms})).all()
    }
    locations = {
        location.farm_id: location
        for location in (
            db.query(FarmLocation)
            .filter(FarmLocation.farm_id.in_(farm_ids))
            .order_by(FarmLocation.farm_id, FarmLocation.id.desc())
            .all()
        )
    }
    crops = (
        db.query(Crop)
        .filter(Crop.farm_id.in_(farm_ids), Crop.archived_at.is_(None))
        .order_by(Crop.id.desc())
        .all()
    )
    crop_by_farm: dict[int, list[Crop]] = {}
    for crop in crops:
        crop_by_farm.setdefault(crop.farm_id, []).append(crop)

    screenings = db.query(DiseaseObservation).filter(
        DiseaseObservation.farm_id.in_(farm_ids)).all()
    pests = db.query(PestObservation).filter(
        PestObservation.farm_id.in_(farm_ids)).all()
    risks = db.query(RiskAssessment).filter(
        RiskAssessment.farm_id.in_(farm_ids)).all()
    cases = db.query(MonitoringCase).filter(
        MonitoringCase.farm_id.in_(farm_ids)).all()

    evidence_by_farm: dict[int, dict[str, list]] = {
        farm_id: {'screenings': [], 'pests': [], 'risks': [], 'cases': []}
        for farm_id in farm_ids
    }
    for screening in screenings:
        if screening.farm_id is not None:
            evidence_by_farm[screening.farm_id]['screenings'].append(screening)
    for observation in pests:
        evidence_by_farm[observation.farm_id]['pests'].append(observation)
    for risk in risks:
        evidence_by_farm[risk.farm_id]['risks'].append(risk)
    for case in cases:
        evidence_by_farm[case.farm_id]['cases'].append(case)

    items = []
    for farm in farms:
        farmer = farmers[farm.user_id]
        evidence = evidence_by_farm[farm.id]
        latest_screening = _latest(evidence['screenings'], 'screened_at')
        latest_pest = _latest(evidence['pests'], 'observed_at')
        latest_risk = _latest(evidence['risks'], 'calculated_at')
        latest_case = _latest(evidence['cases'], 'updated_at')
        current_crop = crop_by_farm.get(farm.id, [None])[0]
        activity_rows = [
            (latest_screening, latest_screening.screened_at if latest_screening else None),
            (latest_pest, latest_pest.observed_at if latest_pest else None),
            (latest_risk, latest_risk.calculated_at if latest_risk else None),
            (latest_case, latest_case.updated_at if latest_case and latest_case.updated_at else None),
        ]
        _activity_row, last_activity_at = max(
            ((row, timestamp)
             for row, timestamp in activity_rows if timestamp is not None),
            key=lambda pair: pair[1],
            default=(None, None),
        )
        items.append({
            'farmer_id': farmer.id,
            'farmer_name': farmer.name,
            'phone': farmer.phone,
            'farm_id': farm.id,
            'farm_name': farm.farm_name,
            'area': farm.area,
            'area_unit': farm.area_unit,
            'location': _location(locations.get(farm.id)),
            'crops': [
                {
                    'crop_id': crop.id,
                    'crop_name': crop.crop_name,
                    'variety': crop.variety,
                    'current_stage': crop.current_stage,
                    'sowing_date': crop.sowing_date.isoformat() if crop.sowing_date else None,
                }
                for crop in crop_by_farm.get(farm.id, [])
            ],
            'current_crop': (
                {
                    'crop_id': current_crop.id,
                    'crop_name': current_crop.crop_name,
                    'variety': current_crop.variety,
                    'current_stage': current_crop.current_stage,
                }
                if current_crop
                else None
            ),
            'health': {
                'latest_screening': (
                    {
                        'observation_id': latest_screening.id,
                        'condition': latest_screening.predicted_class,
                        'confidence': latest_screening.confidence,
                        'screened_at': latest_screening.screened_at.isoformat(),
                    }
                    if latest_screening
                    else None
                ),
                'latest_pest': (
                    {
                        'observation_id': latest_pest.id,
                        'pest_name': latest_pest.pest_name,
                        'count': latest_pest.count,
                        'observed_at': latest_pest.observed_at.isoformat(),
                    }
                    if latest_pest
                    else None
                ),
                'risk_level': latest_risk.risk_level if latest_risk else None,
                'risk_intensity': _risk_intensity(latest_risk),
                'latest_status': (
                    latest_screening.predicted_class
                    if latest_screening
                    else latest_pest.pest_name
                    if latest_pest
                    else None
                ),
            },
            'monitoring': {
                'case_id': latest_case.id if latest_case else None,
                'status': latest_case.status if latest_case else None,
                'follow_up': (
                    latest_case.status in ('OPEN', 'FOLLOW_UP_SUBMITTED')
                    if latest_case
                    else False
                ),
                'updated_at': latest_case.updated_at.isoformat() if latest_case and latest_case.updated_at else None,
            },
            'last_activity': last_activity_at.isoformat() if last_activity_at else None,
        })

    return {
        'scope': 'extension',
        'items': items,
        'total': len(items),
        'summary': {
            'farmers': len({item['farmer_id'] for item in items}),
            'farms': len(items),
            'mapped_farms': sum(bool(item['location']) for item in items),
        },
    }


@router.get('/monitoring')
def monitoring_cases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: str | None = Query(default=None),
):
    """Monitoring register across farmer farms for extension workers."""
    require_extension(current_user)
    rows = (
        db.query(MonitoringCase, Farm, User, Crop, DiseaseObservation)
        .join(Farm, Farm.id == MonitoringCase.farm_id)
        .join(User, User.id == Farm.user_id)
        .outerjoin(Crop, Crop.id == MonitoringCase.crop_id)
        .join(DiseaseObservation, DiseaseObservation.id == MonitoringCase.observation_id)
        .filter(User.role == 'farmer')
        .order_by(MonitoringCase.updated_at.desc(), MonitoringCase.id.desc())
        .all()
    )
    items = []
    for case, farm, farmer, crop, observation in rows:
        effective = effective_status(case)
        if status and effective != status.upper():
            continue
        items.append({
            'case_id': case.id,
            'farmer_id': farmer.id,
            'farmer_name': farmer.name,
            'farm_id': farm.id,
            'farm_name': farm.farm_name,
            'crop_id': crop.id if crop else None,
            'crop_name': crop.crop_name if crop else None,
            'observation_id': observation.id,
            'condition': observation.predicted_class,
            'confidence': observation.confidence,
            'status': case.status,
            'effective_status': effective,
            'summary': case.summary,
            'opened_at': case.opened_at.isoformat() if case.opened_at else None,
            'due_at': case.due_at.isoformat() if case.due_at else None,
            'updated_at': case.updated_at.isoformat() if case.updated_at else None,
        })
    counts = {}
    for item in items:
        counts[item['effective_status']] = counts.get(
            item['effective_status'], 0) + 1
    return {
        'scope': 'extension',
        'items': items,
        'total': len(items),
        'counts_by_status': counts,
    }


def _owned_extension_farm(db: Session, current_user: User, farm_id: int) -> tuple[Farm, FarmLocation]:
    require_extension(current_user)
    farm = db.get(Farm, farm_id)
    if farm is None or db.get(User, farm.user_id).role != 'farmer':
        raise HTTPException(404, 'Farm not found')
    location = (
        db.query(FarmLocation)
        .filter(FarmLocation.farm_id == farm.id)
        .order_by(FarmLocation.id.desc())
        .first()
    )
    if location is None:
        raise HTTPException(422, 'This farm has no recorded coordinates.')
    return farm, location


@router.get('/weather/farms/{farm_id}/current')
def extension_weather(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Current weather for a farmer farm selected by an extension officer."""
    farm, location = _owned_extension_farm(db, current_user, farm_id)
    try:
        data = fetch_weather(location.latitude, location.longitude)
        return data
    except RuntimeError as error:
        raise HTTPException(503, str(error))


@router.get('/risk/farms/{farm_id}/crops/{crop_id}/current')
def extension_risk(
    farm_id: int,
    crop_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Current crop risk for a farmer farm selected by an extension officer."""
    farm, _location = _owned_extension_farm(db, current_user, farm_id)
    crop = db.query(Crop).filter(
        Crop.id == crop_id,
        Crop.farm_id == farm.id,
        Crop.archived_at.is_(None),
    ).first()
    if crop is None:
        raise HTTPException(404, 'Crop not found')

    try:
        weather_data = fetch_weather(_location.latitude, _location.longitude)
        weather = weather_data.get('current')
    except RuntimeError:
        weather_data = None
        weather = None

    result = assess(crop.crop_name, weather)
    result.update({
        'farm_id': farm.id,
        'crop_id': crop.id,
        'crop': crop.crop_name,
        'crop_stage': crop.current_stage,
        'weather_available': weather is not None,
        'weather_source': weather_data.get('source') if weather_data else None,
    })
    return result
