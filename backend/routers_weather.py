from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models_db import Farm, FarmLocation, User, WeatherRecord
import json
from datetime import datetime
from auth import get_current_user
from weather import fetch_weather
router = APIRouter(prefix="/weather", tags=["weather"])

def farm_location(farm_id, db, current):
    farm = db.get(Farm, farm_id)
    if not farm or farm.user_id != current.id: raise HTTPException(404, "Farm not found")
    loc = db.query(FarmLocation).filter(FarmLocation.farm_id == farm.id).order_by(FarmLocation.id.desc()).first()
    if not loc: raise HTTPException(422, "Farm has no location")
    return loc

@router.get("/farms/{farm_id}/current")
def current(farm_id:int, db:Session=Depends(get_db), current_user:User=Depends(get_current_user)):
    loc = farm_location(farm_id, db, current_user)
    try:
        data=fetch_weather(loc.latitude, loc.longitude); db.add(WeatherRecord(farm_id=farm_id,source=data['source'],data_type=data['data_type'],source_url=data['source_url'],latitude=loc.latitude,longitude=loc.longitude,model_time=datetime.fromisoformat(data['current']['time']),fetched_at=datetime.fromisoformat(data['fetched_at'].replace('Z','+00:00')).replace(tzinfo=None),payload=json.dumps({'current':data['current'],'hourly':data.get('hourly',{})}))); db.commit(); return data
    except RuntimeError as e: raise HTTPException(503, str(e))

@router.get("/farms/{farm_id}/forecast")
def forecast(farm_id:int, db:Session=Depends(get_db), current_user:User=Depends(get_current_user)):
    loc = farm_location(farm_id, db, current_user)
    try:
        data = fetch_weather(loc.latitude, loc.longitude); return {**data, "forecast": data["hourly"]}
    except RuntimeError as e: raise HTTPException(503, str(e))
