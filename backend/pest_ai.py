"""Local YOLO11s IP102 pest object detection.

The detector is deliberately lazy and optional: importing the backend does not
require PyTorch, and a missing runtime/model produces an honest unavailable
state while the V1 disease workflow continues to work.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable

from PIL import Image

logger = logging.getLogger(__name__)

MODEL_NAME = "yolo11s-pest-detection"
MODEL_SOURCE = "underdogquality/yolo11s-pest-detection"
MODEL_SOURCE_URL = "https://huggingface.co/underdogquality/yolo11s-pest-detection"
DATASET = "IP102"
SOYBEAN_MODEL_NAME = "crophealth-soybean-pest-pilot"
SOYBEAN_MODEL_SOURCE = "CropHealth local pilot"
SOYBEAN_MODEL_PATH = Path(__file__).resolve().parent / "models" / "pest_crophealth_soybean_pilot.pt"
FRAMEWORK = "Ultralytics YOLO11"
MODEL_PATH = Path(__file__).resolve().parent / "models" / "pest_yolo11s_ip102.pt"
MAX_IMAGE_BYTES = int(os.getenv("PEST_AI_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("PEST_AI_MAX_IMAGE_PIXELS", str(12_000_000)))
IMAGE_SIZE = int(os.getenv("PEST_AI_IMAGE_SIZE", "640"))
MIN_CONFIDENCE = float(os.getenv("PEST_AI_MIN_CONFIDENCE", "0.45"))
HIGH_CONFIDENCE = float(os.getenv("PEST_AI_HIGH_CONFIDENCE", "0.80"))
RAW_CONFIDENCE = float(os.getenv("PEST_AI_RAW_CONFIDENCE", "0.10"))
NMS_IOU = float(os.getenv("PEST_AI_NMS_IOU", "0.45"))


class PestAIUnavailable(RuntimeError):
    """The detector cannot run in this backend process."""


class PestAIInputError(ValueError):
    """The supplied image cannot be safely analyzed."""


class PestAIInferenceError(RuntimeError):
    """The detector failed after accepting a valid image."""


def _bucket(confidence: float | None) -> str:
    if confidence is None or confidence < MIN_CONFIDENCE:
        return "low"
    if confidence < HIGH_CONFIDENCE:
        return "medium"
    return "high"


def _number(value: Any) -> float | None:
    try:
        number = float(value.item() if hasattr(value, "item") else value)
    except (TypeError, ValueError, AttributeError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _class_name(names: Any, class_id: int) -> str:
    if isinstance(names, dict):
        value = names.get(class_id, names.get(str(class_id)))
    elif isinstance(names, (list, tuple)) and 0 <= class_id < len(names):
        value = names[class_id]
    else:
        value = None
    return str(value).strip() if value is not None and str(value).strip() else f"class_{class_id}"


def _sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


class PestAIService:
    """A process-local, single-load YOLO object detector."""

    name = "Local YOLO11s IP102"

    def __init__(
        self,
        model_path: Path | str = MODEL_PATH,
        model_loader: Callable[[str], Any] | None = None,
        *,
        model_name: str = MODEL_NAME,
        model_source: str = MODEL_SOURCE,
        dataset: str = DATASET,
    ):
        self.model_name = model_name
        self.model_source = model_source
        self.dataset = dataset
        self.model_path = Path(model_path)
        self._model_loader = model_loader
        self._model: Any | None = None
        self._device: str | None = None
        self._load_error: str | None = None
        self._lock = threading.Lock()

    @property
    def device(self) -> str | None:
        return self._device

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:
                return self._model
            if self._load_error:
                raise PestAIUnavailable(self._load_error)
            if self._model_loader is None and not self.model_path.is_file():
                self._load_error = "model_missing"
                raise PestAIUnavailable(self._load_error)
            try:
                if self._model_loader is not None:
                    loader = self._model_loader
                else:
                    from ultralytics import YOLO

                    loader = YOLO
                try:
                    import torch

                    self._device = "cuda:0" if torch.cuda.is_available() else "cpu"
                except ImportError:
                    self._device = "cpu"
                self._model = loader(str(self.model_path))
                logger.info(
                    "pest_ai_model_loaded model=%s device=%s", self.model_name, self._device
                )
                return self._model
            except ImportError as exc:
                self._load_error = "ultralytics_or_torch_unavailable"
                raise PestAIUnavailable(self._load_error) from exc
            except Exception as exc:
                self._load_error = "model_load_failed"
                raise PestAIUnavailable(self._load_error) from exc

    def metadata(self) -> dict[str, Any]:
        return {
            "provider": "local",
            "model": self.model_name,
            "model_source": self.model_source,
            "dataset": self.dataset,
            "framework": FRAMEWORK,
            "model_version_or_hash": _sha256(self.model_path),
            "device": self._device,
            "minimum_confidence": MIN_CONFIDENCE,
            "high_confidence": HIGH_CONFIDENCE,
            "nms_iou": NMS_IOU,
        }

    @staticmethod
    def validate_image(image: Image.Image | bytes, image_bytes: bytes | None = None) -> Image.Image:
        if isinstance(image, (bytes, bytearray)):
            raw = bytes(image)
            if image_bytes is None:
                image_bytes = raw
            if len(raw) > MAX_IMAGE_BYTES:
                raise PestAIInputError("image_too_large")
            try:
                image = Image.open(io.BytesIO(raw))
            except Exception as exc:
                raise PestAIInputError("invalid_image") from exc
        if image_bytes is not None and len(image_bytes) > MAX_IMAGE_BYTES:
            raise PestAIInputError("image_too_large")
        if not isinstance(image, Image.Image):
            raise PestAIInputError("invalid_image")
        try:
            image = image.convert("RGB")
        except Exception as exc:
            raise PestAIInputError("invalid_image") from exc
        width, height = image.size
        if min(width, height) < 32:
            raise PestAIInputError("image_resolution_too_low")
        if width * height > MAX_IMAGE_PIXELS:
            raise PestAIInputError("image_resolution_too_large")
        return image

    def analyze(self, image: Image.Image | bytes, image_bytes: bytes | None = None) -> dict[str, Any]:
        image = self.validate_image(image, image_bytes)
        model = self._load()
        started = time.monotonic()
        try:
            results = model.predict(
                source=image,
                imgsz=IMAGE_SIZE,
                conf=RAW_CONFIDENCE,
                iou=NMS_IOU,
                device=self._device or "cpu",
                verbose=False,
            )
        except Exception as exc:
            raise PestAIInferenceError("model_inference_failed") from exc
        latency_ms = round((time.monotonic() - started) * 1000)

        result = results[0] if isinstance(results, (list, tuple)) and results else results
        boxes = getattr(result, "boxes", None)
        names = getattr(result, "names", None) or getattr(model, "names", None)
        raw: list[dict[str, Any]] = []
        if boxes is not None:
            xyxy = getattr(boxes, "xyxy", None)
            confs = getattr(boxes, "conf", None)
            classes = getattr(boxes, "cls", None)
            total = len(xyxy) if xyxy is not None else 0
            for index in range(total):
                confidence = _number(confs[index] if confs is not None else None)
                class_number = _number(classes[index] if classes is not None else None)
                coords = xyxy[index] if xyxy is not None else None
                values = [_number(item) for item in coords] if coords is not None else []
                if confidence is None or class_number is None or len(values) != 4 or any(v is None for v in values):
                    continue
                class_id = int(class_number)
                raw.append(
                    {
                        "class_id": class_id,
                        "name": _class_name(names, class_id),
                        "confidence": max(0.0, min(1.0, confidence)),
                        "bbox": [round(float(v), 2) for v in values],
                    }
                )

        accepted = [item for item in raw if item["confidence"] >= MIN_CONFIDENCE]
        grouped: dict[str, list[dict[str, Any]]] = {}
        for item in accepted:
            grouped.setdefault(item["name"], []).append(item)
        candidates: list[dict[str, Any]] = []
        for name, detections in grouped.items():
            best = max(detections, key=lambda item: item["confidence"])
            candidates.append(
                {
                    "name": name,
                    "confidence": best["confidence"],
                    "count": len(detections),
                    "bounding_boxes": [item["bbox"] for item in detections],
                }
            )
        candidates.sort(key=lambda item: item["confidence"], reverse=True)
        status = "detected" if candidates else ("low_confidence" if raw else "no_reliable_detection")
        logger.info(
            "pest_ai_inference status=%s latency_ms=%s raw_detection_count=%s accepted_detection_count=%s",
            status,
            latency_ms,
            len(raw),
            len(accepted),
        )
        return {
            "status": status,
            "pest": candidates[0] if candidates else None,
            "pests": candidates,
            "detections": accepted,
            "raw_detection_count": len(raw),
            "detection_count": len(accepted),
            "model_metadata": self.metadata(),
        }


_SERVICE: PestAIService | None = None
_SERVICE_LOCK = threading.Lock()

_SERVICES: dict[str, PestAIService] = {}


def get_pest_ai_service(crop_name: str | None = None) -> PestAIService:
    """Return the detector selected by real crop context, when one is defined."""
    normalized = (crop_name or "").strip().lower()
    if normalized != "soybean":
        global _SERVICE
        if _SERVICE is None:
            with _SERVICE_LOCK:
                if _SERVICE is None:
                    _SERVICE = PestAIService()
        return _SERVICE

    with _SERVICE_LOCK:
        service = _SERVICES.get("soybean")
        if service is None:
            service = PestAIService(
                SOYBEAN_MODEL_PATH,
                model_name=SOYBEAN_MODEL_NAME,
                model_source=SOYBEAN_MODEL_SOURCE,
                dataset="CropHealth soybean pilot",
            )
            _SERVICES["soybean"] = service
        return service


__all__ = [
    "DATASET",
    "FRAMEWORK",
    "HIGH_CONFIDENCE",
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_PIXELS",
    "MIN_CONFIDENCE",
    "MODEL_NAME",
    "SOYBEAN_MODEL_NAME",
    "SOYBEAN_MODEL_PATH",
    "MODEL_PATH",
    "MODEL_SOURCE",
    "MODEL_SOURCE_URL",
    "PestAIInferenceError",
    "PestAIInputError",
    "PestAIService",
    "PestAIUnavailable",
    "get_pest_ai_service",
]
