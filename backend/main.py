import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from advisories import seed_curated_advisories
from auth import get_optional_user
from collection_sessions import resolve_collection_token
from database import SessionLocal, engine, get_db
from disease_observations import (image_digest, record_screening, resolve_context,
                                  resolve_position)
from expert_validation import STATUS_MEANING, STATUS_PENDING, validations_for
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from image_store import attach_screening_image
from image_validation import validate_image
from models_db import Crop, DiseaseObservation, User
from predict import MODEL_VERSION, model_status, predict_image
from retention_job import retention_purge_worker
from routers_advisories import router as advisories_router
from routers_collections import router as collections_router
from routers_confirmation import router as confirmation_router
from routers_crop_health import router as crop_health_router
from routers_evaluation import router as evaluation_router
from routers_extension import router as extension_router
from routers_geo import router as geo_router
from routers_images import router as images_router
from routers_monitoring import router as monitoring_router
from routers_notifications import router as notifications_router
from routers_official import router as official_router
from routers_pest import router as pest_router
from routers_pest_identify import router as pest_identify_router
from routers_profile import router as profile_router
from routers_referrals import router as referrals_router
from routers_risk import router as risk_router
from routers_screenings import router as screenings_router
from routers_validation import router as validation_router
from routers_weather import router as weather_router
from sqlalchemy.orm import Session
from translation import current_language, translate_fields

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)
origins = [x.strip() for x in os.getenv("CORS_ORIGINS",
                                        "http://localhost:3000,http://127.0.0.1:3000").split(",") if x.strip()]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop_event = asyncio.Event()
    retention_task = asyncio.create_task(
        retention_purge_worker(stop_event),
        name='screening-image-retention-purge',
    )
    try:
        with SessionLocal() as db:
            added_advisories = seed_curated_advisories(db)
            if added_advisories:
                logger.info(
                    'Loaded %s curated advisories from seed.', added_advisories)
        yield
    finally:
        stop_event.set()
        await retention_task


app = FastAPI(title="Plant Disease Detection API", lifespan=lifespan)

# ── Screening abuse controls ─────────────────────────────────────────

# A farmer may have this many unreviewed screenings pending at once. Every
# further scan in the same rolling 24h is refused with 429 so one account
# cannot fill the review queue with images no reviewer asked for. The cap
# counts *unreviewed* scans only: a farmer whose screening has already been
# looked at is being served, and is not throttled for that.
MAX_PENDING_SCREENINGS_PER_DAY = 3

# Duplicate-hash lookback: images older than this window are not checked for
# duplicate hashes. A re-shoot of the same leaf within a week is plausible;
# years-old hashes would block genuine re-examination after the retention window.
_DUPLICATE_LOOKBACK_DAYS = 7

# Daily pending cap lookback: only the last 24 h counts for the daily limit.
_PENDING_CAP_HOURS = 24


def _recent_unreviewed_count(db: Session, user_id: int) -> int:
    """Count unreviewed screenings submitted by `user_id` in the last 24 h."""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        hours=_PENDING_CAP_HOURS
    )
    rows = (
        db.query(DiseaseObservation)
        .filter(
            DiseaseObservation.submitted_by == user_id,
            DiseaseObservation.screened_at >= cutoff,
        )
        .all()
    )
    pending = 0
    for row in rows:
        if validations_for(db, [row.id]).get(row.id) is None:
            pending += 1
    return pending


def _duplicate_screening(db: Session, image_bytes: bytes) -> DiseaseObservation | None:
    """Return an earlier screening with the same image, if one exists."""
    digest = image_digest(image_bytes)
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        days=_DUPLICATE_LOOKBACK_DAYS
    )
    return (
        db.query(DiseaseObservation)
        .filter(
            DiseaseObservation.image_hash == digest,
            DiseaseObservation.screened_at >= cutoff,
        )
        .order_by(DiseaseObservation.screened_at.desc())
        .first()
    )


def _abuse_checks(db: Session, user: User | None, image_bytes: bytes) -> None:
    """Raise if this upload should not become a screening.

    Checks are ordered cheapest-first and all return before any inference
    runs, so a rejected upload neither stores a row nor spends model time.
    """
    if user is None:
        return
    duplicate = _duplicate_screening(db, image_bytes)
    if duplicate is not None:
        raise HTTPException(
            409,
            f"This image was already submitted as screening "
            f"#{duplicate.id}. If the crop or field changed, "
            f"upload a new photograph.",
        )
    pending = _recent_unreviewed_count(db, user.id)
    if pending >= MAX_PENDING_SCREENINGS_PER_DAY:
        raise HTTPException(
            429,
            f"You have {pending} screening{'s' if pending != 1 else ''} "
            f"awaiting review. Please wait until an extension officer "
            f"has reviewed them before submitting more.",
        )
app.include_router(extension_router)

# CORS MUST be added before routers for proper header injection
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(profile_router)
app.include_router(weather_router)
app.include_router(risk_router)
app.include_router(pest_router)
app.include_router(pest_identify_router)
app.include_router(geo_router)
app.include_router(validation_router)
app.include_router(screenings_router)
app.include_router(advisories_router)
app.include_router(confirmation_router)
app.include_router(evaluation_router)
app.include_router(images_router)
app.include_router(referrals_router)
app.include_router(monitoring_router)
app.include_router(collections_router)
app.include_router(crop_health_router)
app.include_router(notifications_router)
app.include_router(official_router)


@app.get("/")
def root():
    return {"message": "Plant Disease Detection API"}


@app.get("/health")
def health():
    database = "disconnected"
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        database = "connected"
    except Exception:
        pass
    return {"status": "healthy" if database == "connected" else "degraded", "database": database, "model_loaded": model_status()["loaded"], "model_version": model_status()["version"]}


@app.post("/predict")
async def predict(
    request: Request,
    file: UploadFile = File(...),
    # Optional screening context. Screening is an independent evidence stream:
    # it works with no farm, no crop, and no position, so every field here may
    # be omitted. Supplied context is validated against the caller's ownership
    # rather than trusted.
    farm_id: int | None = Form(default=None),
    crop_id: int | None = Form(default=None),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    image_consent_review: str | None = Form(default=None),
    image_consent_training: str | None = Form(default=None),
    collection_id: str | None = Form(default=None),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Screen a leaf image for a signed-in caller, queuing it for officer review.

    **Anonymous callers** receive the full model result immediately — they have no
    identity to queue under, so nothing is stored for review.

    **Signed-in callers** receive the same model result and management guidance
    immediately, plus an `observation_id` and `awaiting_officer_review` so the
    screening stays in the extension officer queue for human confirmation. Raw
    predictions are labelled as such in advisories; officer validation remains
    the authoritative record in `/screenings`.

    Two abuse controls run before inference, so junk images never spend model time
    and never touch the officer queue:

    * **Duplicate hash (409):** the same image bytes already submitted within the
      lookback window — names the earlier reference number.
    * **Daily pending cap (429):** too many unreviewed screenings in the last 24 h —
      names the count, asks the farmer to wait for the officer to review first.
    """
    try:
        image_bytes = await file.read()
        image, actual_content_type = validate_image(
            image_bytes, file.content_type)

        # Validate context before spending inference on an image that cannot be
        # attributed. A caller who names a farm they do not own should get 404,
        # not a screening that is silently dropped or misfiled.
        observation_farm_id = observation_crop_id = None
        capture_latitude = capture_longitude = None
        collection_group_id = None
        if current_user is not None:
            observation_farm_id, observation_crop_id = resolve_context(
                db, current_user, farm_id, crop_id
            )
            capture_latitude, capture_longitude = resolve_position(
                latitude, longitude)
            if collection_id is not None:
                collection_group_id = resolve_collection_token(
                    collection_id,
                    current_user,
                    observation_farm_id,
                    observation_crop_id,
                )
            # Abuse checks run after context is resolved but before inference,
            # so a rejected upload never spends model time or creates a DB row.
            _abuse_checks(db, current_user, image_bytes)
        elif any(value is not None for value in (farm_id, crop_id, latitude, longitude)):
            # Anonymous screening still returns a result, but context cannot be
            # attributed to anyone, so accepting it silently would be a lie.
            raise HTTPException(
                401, "Sign in to attach farm, crop, or location context.")
        elif collection_id is not None:
            raise HTTPException(
                401, 'Sign in to attach collection provenance.')

        # Get crop context for validation if crop_id was provided
        crop_name = None
        if observation_crop_id is not None:
            crop_record = db.query(Crop).filter(
                Crop.id == observation_crop_id).first()
            if crop_record:
                crop_name = crop_record.crop_name

        result = predict_image(image, crop_context=crop_name)

        # Handle unsupported crop response
        if result.get("unsupported_crop"):
            return {
                "success": False,
                **result
            }

        if current_user is not None:
            observation_id = record_screening(
                db,
                current_user,
                result,
                image_bytes,
                MODEL_VERSION,
                farm_id=observation_farm_id,
                crop_id=observation_crop_id,
                latitude=capture_latitude,
                longitude=capture_longitude,
                collection_group_id=collection_group_id,
            )
            attach_screening_image(
                db,
                observation_id,
                image_bytes,
                actual_content_type,
                consent_review=image_consent_review,
                consent_training=image_consent_training,
            )
            lang = current_language(request, current_user)
            return {
                "success": True,
                "observation_id": observation_id,
                "status": STATUS_PENDING,
                "status_meaning": STATUS_MEANING[STATUS_PENDING],
                "awaiting_officer_review": True,
                "filename": file.filename or "upload",
                **translate_fields(result, "en", lang, ("message",)),
            }

        # Anonymous path: full result, unchanged. Anonymous screenings are not
        # stored and never reach the officer queue, so gating them is not useful.
        return {
            "success": True,
            "filename": file.filename or "upload",
            # `disease` is a model class name and is deliberately NOT translated:
            # the frontend matches it against advisory conditions, so a
            # translated value would break the lookup. Only the human-readable
            # `message` is prose.
            **translate_fields(result, "en", current_language(request, current_user), ("message",)),
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Prediction processing failed")
        raise HTTPException(
            status_code=500, detail="Unable to process this image right now.")
