import os
import json
import logging
import numpy as np
import tensorflow as tf
from PIL import Image
from typing import Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logger = logging.getLogger(__name__)
MODEL_VERSION = "plant-disease-efficientnetb0-v1-reconstructed"

# Crops supported by the disease classification model
# Extracted from the 38 model classes
SUPPORTED_CROPS = [
    'Apple', 'Blueberry', 'Cherry', 'Corn', 'Grape',
    'Orange', 'Peach', 'Pepper', 'Potato', 'Raspberry',
    'Soybean', 'Squash', 'Strawberry', 'Tomato'
]

# Normalize crop names for comparison (case-insensitive, handle variations)
CROP_ALIASES = {
    'corn': 'Corn',
    'maize': 'Corn',
    'corn_(maize)': 'Corn',
    'pepper': 'Pepper',
    'bell_pepper': 'Pepper',
    'pepper,_bell': 'Pepper',
    'cherry': 'Cherry',
    'cherry_(including_sour)': 'Cherry',
}

MODEL_PATH = os.path.join(
    BASE_DIR,
    "models",
    "best_plant_disease_model.keras"
)

CLASS_NAMES_PATH = os.path.join(
    BASE_DIR,
    "models",
    "class_names.json"
)

model = tf.keras.models.load_model(
    MODEL_PATH,
    compile=False
)

with open(CLASS_NAMES_PATH, "r") as f:
    class_names = json.load(f)


def model_status():
    return {"loaded": model is not None, "classes": len(class_names), "version": MODEL_VERSION}

def normalize_crop_name(crop_name: str) -> str:
    """Normalize a crop name for comparison."""
    if not crop_name:
        return ""

    # Convert to lowercase and strip whitespace
    normalized = crop_name.lower().strip()

    # Check aliases
    if normalized in CROP_ALIASES:
        return CROP_ALIASES[normalized]

    # Title case for direct comparison
    return crop_name.strip().title()

def extract_crop_from_class(disease_class: str) -> str:
    """Extract crop name from a disease class like 'Tomato___Early_blight'."""
    if '___' in disease_class:
        return disease_class.split('___')[0]
    return disease_class

def is_crop_supported(crop_name: Optional[str]) -> tuple[bool, str]:
    """Check if a crop is supported by the disease model.

    Returns:
        (is_supported, normalized_crop_name)
    """
    if not crop_name:
        return True, ""  # No crop specified, allow prediction

    normalized = normalize_crop_name(crop_name)

    # Check if normalized name matches any supported crop
    for supported in SUPPORTED_CROPS:
        if normalized.lower() == supported.lower():
            return True, supported

    return False, normalized

def predict_image(image: Image.Image, crop_context: Optional[str] = None):
    """Predict disease from plant image with optional crop validation.

    Args:
        image: PIL Image to classify
        crop_context: Optional crop name for validation

    Returns:
        dict with prediction results or unsupported crop error
    """
    logger.info(f"predict_image called with crop_context={crop_context}")
    # Validate crop support BEFORE inference
    if crop_context:
        is_supported, normalized_crop = is_crop_supported(crop_context)
        logger.info(f"Crop '{crop_context}' supported={is_supported}")
        if not is_supported:
            logger.info("Unsupported crop requested: %s", crop_context)
            return {
                "success": False,
                "unsupported_crop": True,
                "message": f"Disease screening is not currently available for {crop_context}",
                "requested_crop": crop_context,
                "supported_crops": SUPPORTED_CROPS,
                "reason": "CROP_NOT_IN_MODEL"
            }

    # Perform inference
    image = image.convert("RGB")
    image = image.resize((224, 224))

    image_array = np.array(
        image,
        dtype=np.float32
    )

    image_array = np.expand_dims(
        image_array,
        axis=0
    )

    predictions = model.predict(
        image_array,
        verbose=0
    )[0]

    top_indices = np.argsort(
        predictions
    )[-3:][::-1]

    top_predictions = []

    for index in top_indices:
        top_predictions.append({
            "disease": class_names[index],
            "confidence": round(
                float(predictions[index]) * 100,
                2
            )
        })

    predicted_index = top_indices[0]
    predicted_class = class_names[predicted_index]
    predicted_crop = extract_crop_from_class(predicted_class)
    confidence = top_predictions[0]["confidence"]

    # Validate crop match if crop context was provided
    crop_mismatch_warning = False
    if crop_context:
        normalized_context = normalize_crop_name(crop_context)
        normalized_predicted = normalize_crop_name(predicted_crop)

        if normalized_context.lower() != normalized_predicted.lower():
            crop_mismatch_warning = True
            logger.warning(
                "Crop mismatch: user=%s predicted=%s confidence=%.2f",
                crop_context, predicted_crop, confidence
            )

    logger.info("Prediction completed: class=%s confidence=%.2f crop_context=%s", predicted_class, confidence, crop_context)

    result = {
        "disease": predicted_class,
        "confidence": round(
            float(predictions[predicted_index]) * 100,
            2
        ),
        "top_predictions": top_predictions,
        "confidence_warning": confidence < float(os.getenv("LOW_CONFIDENCE_THRESHOLD", "70")),
    }

    # Add crop mismatch warning if detected
    if crop_mismatch_warning:
        result["crop_mismatch_warning"] = True
        result["submitted_crop"] = crop_context
        result["predicted_crop"] = predicted_crop
        result["message"] = f"Image classified as {predicted_crop}, but you selected {crop_context}. Please verify the crop selection."

    return result
