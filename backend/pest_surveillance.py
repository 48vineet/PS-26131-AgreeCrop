"""Pest surveillance: recording real trap and scouting observations.

No public pest-trap API exists for India. The Open Government Data catalogue
carries no pest-trap, insect, or agricultural-surveillance resource; DPPQS
publishes documents rather than data; NPSS is a login-gated reporting system; and
CROPSAP, though a genuine surveillance programme, offers no API, export, or reuse
licence. Findings are recorded in backend/docs/PRODUCT_ARCHITECTURE.md section 4a.

The manual path in this module collects field evidence directly: a farmer or
extension worker records what they actually observed. The separate crop-health
orchestrator may create an AI row only after explicit farmer confirmation.

Manual collection remains available as a fallback. AI-assisted image
observations are only persisted after farmer confirmation and carry explicit
local model provenance; the disease model result is never converted into a pest.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models_db import Crop, Farm, PestObservation, User

logger = logging.getLogger(__name__)

# Standard IPM monitoring methods. Deliberately short: each is a well-established
# technique, and `other` exists so an unlisted method is recorded as what it
# actually was rather than forced into the nearest label.
METHODS = {
    'pheromone_trap': 'Pheromone trap',
    'sticky_trap': 'Sticky trap',
    'light_trap': 'Light trap',
    'scouting': 'Field scouting',
    'other': 'Other',
    'ai_image_analysis': 'AI image analysis',
}
METHOD_AI_IMAGE_ANALYSIS = 'ai_image_analysis'
UNIT_VISIBLE_DETECTIONS = 'visible_detections'

# What the number means. A bare integer is not comparable across methods -- 12
# moths in a pheromone trap and 12 aphids per plant are different measurements.
UNITS = {
    'insects_per_trap': 'insects per trap',
    'insects_per_plant': 'insects per plant',
    'percent_plants_infested': 'percent of plants infested',
    UNIT_VISIBLE_DETECTIONS: 'visible detections in image',
}

# Provenance. Derived from the submitter's role, never sent by the client. Only
# values that can actually occur are defined: there is no EXTERNAL_API member,
# because no external feed exists to produce one.
SOURCE_FARMER = 'FARMER_RECORDED'
SOURCE_EXTENSION = 'EXTENSION_RECORDED'
SOURCE_AI_IMAGE_ANALYSIS = 'AI_IMAGE_ANALYSIS'

# Roles whose observations are recorded as extension work rather than a farmer's
# own record. Mirrors OFFICIAL_ROLES in the frontend registry.
EXTENSION_ROLES = {'extension_officer', 'expert', 'official', 'admin'}

# Clock skew between a farmer's phone and the server is normal; a genuinely
# future observation is not.
FUTURE_TOLERANCE = timedelta(hours=1)
# Before this, a date is a typo rather than a record. The platform did not exist.
EARLIEST_OBSERVATION = datetime(2000, 1, 1)


def source_for(user: User) -> str:
    """Provenance from the submitter's role.

    A farmer's own record is never labelled as extension or government data.
    """
    return SOURCE_EXTENSION if (user.role or '') in EXTENSION_ROLES else SOURCE_FARMER


def resolve_owned_context(
    db: Session,
    user: User,
    farm_id: int,
    crop_id: int | None,
) -> tuple[Farm, Crop | None]:
    """Resolve farm and crop, enforcing ownership from the authenticated user.

    Ownership is derived from the JWT-resolved user, never from anything the
    client asserts. 404 rather than 403 for another user's farm, matching the
    existing routers: a farm you do not own is a farm that does not exist.
    """
    farm = db.get(Farm, farm_id)
    if not farm or farm.user_id != user.id:
        raise HTTPException(404, 'Farm not found')

    if crop_id is None:
        return farm, None

    crop = db.get(Crop, crop_id)
    if not crop or crop.farm_id != farm.id:
        raise HTTPException(404, 'Crop not found')
    if crop.archived_at is not None:
        raise HTTPException(422, 'That crop is archived. Record the observation against an active crop.')
    return farm, crop


def validate_observed_at(observed_at: datetime) -> datetime:
    """Normalise the observation time to naive UTC, rejecting impossible values.

    Accepts an aware or naive value. A naive value is read as UTC, matching how
    every other timestamp in this database is stored.
    """
    if observed_at.tzinfo is not None:
        observed_at = observed_at.astimezone(timezone.utc).replace(tzinfo=None)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if observed_at > now + FUTURE_TOLERANCE:
        raise HTTPException(422, 'The observation time is in the future.')
    if observed_at < EARLIEST_OBSERVATION:
        raise HTTPException(422, 'That observation date is too far in the past to be correct.')
    return observed_at


def validate_position(
    latitude: float | None,
    longitude: float | None,
) -> tuple[float | None, float | None]:
    """Validate an optional trap position.

    Invalid coordinates are rejected, never silently corrected or clamped. Absent
    coordinates stay absent: the farm's own location is available through
    ``farm_id``, and copying the farm centroid would invent a trap position.
    """
    if latitude is None and longitude is None:
        return None, None
    if latitude is None or longitude is None:
        raise HTTPException(422, 'Provide both latitude and longitude, or neither.')
    if not -90 <= latitude <= 90:
        raise HTTPException(422, 'Latitude must be between -90 and 90.')
    if not -180 <= longitude <= 180:
        raise HTTPException(422, 'Longitude must be between -180 and 180.')
    return latitude, longitude


def validate_method(method: str, method_detail: str | None) -> tuple[str, str | None]:
    """Validate the monitoring method, requiring a real value behind `other`."""
    if method not in METHODS:
        raise HTTPException(422, f'Unknown method. Use one of: {", ".join(METHODS)}.')
    detail = (method_detail or '').strip() or None
    if method == 'other' and not detail:
        raise HTTPException(422, 'Describe the method when choosing Other.')
    if method != 'other':
        # A detail on a named method would contradict the method itself.
        detail = None
    return method, detail


def validate_measurement(count: int | None, unit: str) -> tuple[int | None, str]:
    """Validate the measurement.

    A missing count is allowed -- presence without a tally is a real observation
    ("whitefly on the trap, not counted"). A negative count is not a low count,
    it is an error.
    """
    if unit not in UNITS:
        raise HTTPException(422, f'Unknown unit. Use one of: {", ".join(UNITS)}.')
    if count is not None and count < 0:
        raise HTTPException(422, 'Count cannot be negative.')
    return count, unit


def validate_pest_name(pest_name: str) -> str:
    """Require a pest name, recorded exactly as entered.

    There is no curated crop-to-pest vocabulary in this project, so this is not
    matched against a reference list. Recording what the observer wrote is honest;
    snapping it to a known species would turn an uncertain sighting into a
    confident identification.
    """
    name = (pest_name or '').strip()
    if not name:
        raise HTTPException(422, 'Enter the pest that was observed.')
    if len(name) > 160:
        raise HTTPException(422, 'That pest name is too long (maximum 160 characters).')
    return name


def serialize(observation: PestObservation, farm: Farm | None, crop: Crop | None) -> dict:
    """Shape one observation for the API, carrying its provenance."""
    return {
        'id': observation.id,
        'farm_id': observation.farm_id,
        'farm_name': farm.farm_name if farm else None,
        'crop_id': observation.crop_id,
        'crop_name': crop.crop_name if crop else None,
        'observed_at': observation.observed_at.isoformat(),
        'method': observation.method,
        'method_label': METHODS.get(observation.method, observation.method),
        'method_detail': observation.method_detail,
        'pest_name': observation.pest_name,
        'count': observation.count,
        'unit': observation.unit,
        'unit_label': UNITS.get(observation.unit, observation.unit),
        'trap_id': observation.trap_id,
        'latitude': observation.latitude,
        'longitude': observation.longitude,
        'notes': observation.notes,
        'source': observation.source,
        'ai_metadata': observation.ai_metadata,
        'created_at': observation.created_at.isoformat() if observation.created_at else None,
    }
