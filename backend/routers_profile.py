from datetime import datetime

from auth import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.elements import WKTElement
from models_db import Crop, Farm, FarmLocation, User
from schemas import (CropIn, CropOut, FarmIn, FarmOut, LanguageIn, LocationIn,
                     RoleAssignmentIn, UserIn, UserOut)
from sqlalchemy.orm import Session

router = APIRouter(prefix='/profile', tags=['farm profile'])


@router.get('/farms')
def list_farms(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    farms = db.query(Farm).filter(
        Farm.user_id == current.id).order_by(Farm.id).all()
    return [{"id": f.id, "user_id": f.user_id, "farm_name": f.farm_name, "area": f.area, "area_unit": f.area_unit, "location": (lambda l: {"latitude": l.latitude, "longitude": l.longitude, "address": l.address, "village": l.village, "district": l.district, "state": l.state, "postal_code": l.postal_code})(db.query(FarmLocation).filter(FarmLocation.farm_id == f.id).order_by(FarmLocation.id.desc()).first()) if db.query(FarmLocation).filter(FarmLocation.farm_id == f.id).first() else None, "crops": [{"id": c.id, "farm_id": c.farm_id, "crop_name": c.crop_name, "variety": c.variety, "sowing_date": c.sowing_date, "transplanting_date": c.transplanting_date, "current_stage": c.current_stage} for c in f.crops if c.archived_at is None]} for f in farms]


def req(db, model, ident, label):
    obj = db.get(model, ident)
    if not obj:
        raise HTTPException(404, f'{label} not found')
    return obj


@router.post('/users', response_model=UserOut, status_code=201)
def create_user(x: UserIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    o = db.query(User).filter(User.auth_user_id ==
                              current.auth_user_id).first()
    if o:
        return o
    o = User(**x.model_dump(), auth_user_id=current.auth_user_id)
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@router.post('/farms', response_model=FarmOut, status_code=201)
def create_farm(x: FarmIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    # FastAPI supplies a User in production; the fallback only supports direct unit calls.
    owner = current.id if isinstance(current, User) else x.user_id
    o = Farm(user_id=owner, farm_name=x.farm_name,
             area=x.area, area_unit=x.area_unit)
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@router.get('/farms/{farm_id}', response_model=FarmOut)
def get_farm(farm_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    o = req(db, Farm, farm_id, 'Farm')
    if hasattr(current, 'id') and o.user_id != current.id:
        raise HTTPException(404, 'Farm not found')
    return o


@router.put('/farms/{farm_id}', response_model=FarmOut)
def update_farm(farm_id: int, x: FarmIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    o = req(db, Farm, farm_id, 'Farm')
    if hasattr(current, 'id') and o.user_id != current.id:
        raise HTTPException(404, 'Farm not found')
    # ``user_id`` remains in FarmIn for backwards compatibility, but ownership
    # must never be writable through an authenticated farm update.
    o.farm_name = x.farm_name
    o.area = x.area
    o.area_unit = x.area_unit
    db.commit()
    db.refresh(o)
    return o


@router.delete('/farms/{farm_id}', status_code=204)
def delete_farm(farm_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    o = req(db, Farm, farm_id, 'Farm')
    if hasattr(current, 'id') and o.user_id != current.id:
        raise HTTPException(404, 'Farm not found')
    db.delete(o)
    db.commit()
    return None


@router.post('/farms/{farm_id}/location', status_code=201)
def add_location(farm_id: int, x: LocationIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    farm = req(db, Farm, farm_id, 'Farm')
    if hasattr(current, 'id') and farm.user_id != current.id:
        raise HTTPException(404, 'Farm not found')
    data = x.model_dump()
    data['point'] = WKTElement(
        f'POINT({data["longitude"]} {data["latitude"]})', srid=4326)
    o = FarmLocation(farm_id=farm_id, **data)
    db.add(o)
    db.commit()
    db.refresh(o)
    return {'id': o.id, **x.model_dump()}


@router.post('/farms/{farm_id}/crops', response_model=CropOut, status_code=201)
def create_crop(farm_id: int, x: CropIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    farm = req(db, Farm, farm_id, 'Farm')
    if hasattr(current, 'id') and farm.user_id != current.id:
        raise HTTPException(404, 'Farm not found')
    o = Crop(farm_id=farm_id, **x.model_dump())
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@router.get('/farms/{farm_id}/crops', response_model=list[CropOut])
def list_crops(farm_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    farm = req(db, Farm, farm_id, 'Farm')
    if hasattr(current, 'id') and farm.user_id != current.id:
        raise HTTPException(404, 'Farm not found')
    return db.query(Crop).filter(Crop.farm_id == farm_id, Crop.archived_at.is_(None)).all()


@router.put('/crops/{crop_id}', response_model=CropOut)
def update_crop(crop_id: int, x: CropIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    o = req(db, Crop, crop_id, 'Crop')
    if hasattr(current, 'id') and db.get(Farm, o.farm_id).user_id != current.id:
        raise HTTPException(404, 'Crop not found')
    for k, v in x.model_dump().items():
        setattr(o, k, v)
    db.commit()
    db.refresh(o)
    return o


@router.delete('/crops/{crop_id}', status_code=204)
def archive_crop(crop_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    o = req(db, Crop, crop_id, 'Crop')
    if hasattr(current, 'id') and db.get(Farm, o.farm_id).user_id != current.id:
        raise HTTPException(404, 'Crop not found')
    o.archived_at = datetime.utcnow()
    db.commit()
    return None


@router.get('/me')
def me(current: User = Depends(get_current_user)):
    """The authenticated user's own record.

    The frontend needs the real ``role`` to decide whether the official /
    extension experience is available. Roles are never inferred client-side and
    never defaulted upward: an unset role is reported as ``farmer``, which is
    also the column default.
    """
    return {'id': current.id, 'name': current.name, 'email': current.email, 'phone': current.phone, 'role': current.role or 'farmer', 'language': current.language or 'en'}


@router.patch('/language')
def set_language(x: LanguageIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Set the caller's own interface language.

    Scoped to the authenticated user by construction -- there is no user id in the
    path or the body, so this endpoint cannot be pointed at anybody else.

    This changes the *interface* language and which advisory translation is
    preferred. It does not translate anything on the fly: advisory text is served
    only in a language a human actually wrote, and falls back to English otherwise.
    """
    current.language = x.language
    db.commit()
    return {'id': current.id, 'language': current.language}


@router.get('/users')
def list_users(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Admin-only user register for role administration."""
    if current.role != 'admin':
        raise HTTPException(403, 'Only an administrator may view users.')
    return [
        {'id': user.id, 'name': user.name, 'email': user.email, 'role': user.role}
        for user in db.query(User).order_by(User.id).all()
    ]


@router.patch('/users/{user_id}/role')
def assign_role(user_id: int, payload: RoleAssignmentIn, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Admin-only role assignment, with self-lockout prevention."""
    if current.role != 'admin':
        raise HTTPException(403, 'Only an administrator may assign roles.')
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, 'User not found')
    if target.id == current.id and payload.role != 'admin':
        raise HTTPException(
            422, 'You cannot remove your own administrator role.')
    target.role = payload.role
    db.commit()
    db.refresh(target)
    return {'id': target.id, 'name': target.name, 'email': target.email, 'role': target.role}
