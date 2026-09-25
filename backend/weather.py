import json
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

BASE_URL = "https://api.open-meteo.com/v1/forecast"
VARS = "temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover"

def fetch_weather(lat: float, lon: float):
    url = f"{BASE_URL}?latitude={lat}&longitude={lon}&current={VARS}&hourly={VARS}&forecast_days=7&timezone=Asia%2FKolkata"
    try:
        with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=12) as r:
            payload = json.loads(r.read().decode())
        if not isinstance(payload, dict) or "current" not in payload: raise ValueError("invalid response")
        return {"available": True, "source": "Open-Meteo", "data_type": "numerical_weather_model", "latitude": lat, "longitude": lon, "current": payload["current"], "hourly": payload.get("hourly", {}), "fetched_at": datetime.now(timezone.utc).isoformat(), "source_url": BASE_URL}
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as e:
        raise RuntimeError("Weather data is currently unavailable.") from e
