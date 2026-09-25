"""
Pest Identification Router - Using Gemini Vision API
"""

from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
import io

from database import get_db
from auth import get_current_user, get_optional_user
from models_db import User
from pest_identification import identify_pest_from_image, validate_pest_result

router = APIRouter(prefix="/api/pest", tags=["Pest Identification"])


@router.post("/identify")
async def identify_pest(
    file: UploadFile = File(...),
    crop: str = Form(...),
    language: str = Form("en"),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """
    Identify pest from uploaded image using Gemini Vision API

    - Converts image to base64
    - Sends to Gemini Vision for AI identification
    - Returns pest name, damage type, severity, and control methods
    - Saves to database if user is authenticated
    """

    # Validate file type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Validate file size (max 5MB)
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image size must be less than 5MB")

    # Identify pest using Gemini
    result = identify_pest_from_image(
        image_bytes=contents,
        crop_name=crop,
        language=language
    )

    # Check for errors
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    # Validate result structure
    if not validate_pest_result(result):
        raise HTTPException(status_code=500, detail="Invalid pest identification result")

    # TODO: Save to database if user is authenticated and pest was found
    # For now, skip database storage until we create a proper pest_reports table
    # pest_reports table would have: id, user_id, crop, pest_name, pest_english,
    # damage_type, severity, confidence, image_ref, created_at

    return result


@router.get("/my-reports")
async def get_my_pest_reports(
    language: str = "en",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get farmer's previous pest identification reports
    TODO: Return real data from pest_reports table once created
    """

    # Return empty for now
    return []
