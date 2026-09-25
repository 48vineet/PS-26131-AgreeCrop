from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from database import get_db
from models_db import Crop, Farm, User, WeatherRecord, RiskAssessment, DiseaseObservation, PestObservation
from auth import get_current_user
from risk_engine import assess, assess_forecast
from weather import fetch_weather
from translation import current_language, translate_fields
import json
from datetime import datetime, timezone

# Risk prose is explanatory, not prescriptive: no dose, rate or PHI lives in
# `explanation`, so it is machine-translated. `recommended_action` only points
# at the Advisory Center and is translated for the same reason.
RISK_TEXT_FIELDS = ("explanation", "recommended_action")


def _localise(payload, lang, current_user, request):
    return translate_fields(payload, 'en', lang, RISK_TEXT_FIELDS)


def persist(result, farm_id, crop_id, db):
    assessment_type = result.get('assessment_type', 'current')
    rule_version = result.get('rule_version')
    weather_timestamp = datetime.fromisoformat(result['weather_timestamp']) if result.get('weather_timestamp') else None
    existing_query = db.query(RiskAssessment).filter(
        RiskAssessment.farm_id == farm_id,
        RiskAssessment.crop_id == crop_id,
        RiskAssessment.assessment_type == assessment_type,
        RiskAssessment.rule_version == rule_version,
    )
    if weather_timestamp is None:
        existing_query = existing_query.filter(RiskAssessment.weather_timestamp.is_(None))
    else:
        existing_query = existing_query.filter(RiskAssessment.weather_timestamp == weather_timestamp)
    if existing_query.order_by(RiskAssessment.calculated_at.desc()).first():
        return

    db.add(RiskAssessment(
        farm_id=farm_id,
        crop_id=crop_id,
        risk_level=result.get('risk_level', 'INSUFFICIENT_DATA'),
        assessment_type=assessment_type,
        disease=result.get('disease'),
        weather_period=result.get('weather_period'),
        weather_timestamp=weather_timestamp,
        weather_source=result.get('weather_source'),
        rule_version=rule_version,
        factors=result.get('factors', []),
        explanation=result.get('explanation', ''),
        calculated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    db.commit()
router=APIRouter(prefix="/risk",tags=["crop health risk"])
def owned(crop_id, farm_id, db, current):
    farm=db.get(Farm,farm_id); crop=db.get(Crop,crop_id)
    if not farm or farm.user_id!=current.id or not crop or crop.farm_id!=farm_id or crop.archived_at: raise HTTPException(404,"Crop not found")
    return crop

def farm_crop_context(db, crop):
    disease_count = db.query(DiseaseObservation).filter(
        DiseaseObservation.farm_id == crop.farm_id,
        DiseaseObservation.crop_id == crop.id,
    ).count()
    pest_count = db.query(PestObservation).filter(
        PestObservation.farm_id == crop.farm_id,
        PestObservation.crop_id == crop.id,
    ).count()
    return {
        "crop": crop.crop_name,
        "variety": crop.variety,
        "crop_stage": crop.current_stage,
        "soil_condition": None,
        "soil_condition_available": False,
        "local_history": {
            "image_screenings": disease_count,
            "pest_observations": pest_count,
        },
    }
@router.get("/farms/{farm_id}/crops/{crop_id}/current")
def current(
    request: Request,
    farm_id: int,
    crop_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    save: bool = Query(True, alias="persist", description="Persist this explicit assessment in history."),
):
    crop=owned(crop_id,farm_id,db,current_user); record=db.query(WeatherRecord).filter(WeatherRecord.farm_id==farm_id).order_by(WeatherRecord.id.desc()).first()
    raw=json.loads(record.payload) if record else None; weather=raw.get('current',raw) if isinstance(raw,dict) else None
    now=datetime.now(timezone.utc).replace(tzinfo=None)
    # Weather availability is a separate axis from whether a rule exists for the
    # crop. Compute it here so the response can say which of the two is missing.
    weather_available=bool(record) and (now-record.fetched_at).total_seconds()<=6*3600
    if not weather_available: weather=None
    result=assess(crop.crop_name,weather); result.update({"farm_id":farm_id,"crop_id":crop_id,"crop":crop.crop_name,"crop_stage":crop.current_stage,"context":farm_crop_context(db,crop),"assessment_type":"current","calculated_at":datetime.now(timezone.utc).isoformat(),"weather_available":weather_available,"weather_period":record.model_time.isoformat() if record else None,"weather_timestamp":record.model_time.isoformat() if record else None,"weather_source":record.source if record else None,"recommended_action":"Open the Advisory Center for published crop-specific guidance."});
    if save:
        persist(result,farm_id,crop_id,db)
    return _localise(result, current_language(request, current_user), current_user, request)

@router.get("/farms/{farm_id}/crops/{crop_id}/forecast")
def forecast(
    request: Request,
    farm_id: int,
    crop_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    save: bool = Query(True, alias="persist", description="Persist this explicit assessment in history."),
):
    crop=owned(crop_id,farm_id,db,current_user); record=db.query(WeatherRecord).filter(WeatherRecord.farm_id==farm_id).order_by(WeatherRecord.id.desc()).first()
    if not record or (datetime.now(timezone.utc).replace(tzinfo=None)-record.fetched_at).total_seconds()>6*3600: return _localise({"risk_level":"INSUFFICIENT_DATA","reason":"weather_unavailable","weather_available":False,"crop":crop.crop_name,"crop_stage":crop.current_stage,"context":farm_crop_context(db,crop),"crop_id":crop_id,"farm_id":farm_id,"assessment_type":"forecast","explanation":"Fresh forecast weather data is unavailable or too old for this assessment.","factors":[]}, current_language(request, current_user), current_user, request)
    raw=json.loads(record.payload); hourly=raw.get('hourly',{}) if isinstance(raw,dict) else {}; result=assess_forecast(crop.crop_name,hourly); result.update({"farm_id":farm_id,"crop_id":crop_id,"crop":crop.crop_name,"crop_stage":crop.current_stage,"context":farm_crop_context(db,crop),"assessment_type":"forecast","calculated_at":datetime.now(timezone.utc).isoformat(),"weather_available":True,"weather_period":"next 24 hours from Open-Meteo hourly forecast","weather_timestamp":record.model_time.isoformat(),"weather_source":"Open-Meteo","forecast_available":bool(hourly),"recommended_action":"Open the Advisory Center for published crop-specific guidance."});
    if save:
        persist(result,farm_id,crop_id,db)
    return _localise(result, current_language(request, current_user), current_user, request)

@router.get("/farms/{farm_id}/crops/{crop_id}/history")
def history(request:Request,farm_id:int,crop_id:int,db:Session=Depends(get_db),current_user:User=Depends(get_current_user)):
    owned(crop_id,farm_id,db,current_user)
    rows=db.query(RiskAssessment).filter(RiskAssessment.farm_id==farm_id,RiskAssessment.crop_id==crop_id).order_by(RiskAssessment.calculated_at.desc()).all()
    lang=current_language(request,current_user)
    return [dict(_localise({"id":r.id,"risk_level":r.risk_level,"assessment_type":r.assessment_type,"disease":r.disease,"weather_period":r.weather_period,"weather_timestamp":r.weather_timestamp.isoformat() if r.weather_timestamp else None,"weather_source":r.weather_source,"rule_version":r.rule_version,"factors":r.factors,"explanation":r.explanation,"calculated_at":r.calculated_at.isoformat()},lang,current_user,request)) for r in rows]
