from dataclasses import dataclass
from datetime import datetime, timezone

SOURCE_URL = "https://extension.umn.edu/disease-management/late-blight-tomato-and-potato"

@dataclass(frozen=True)
class Rule:
    crop: str
    disease: str
    version: str = "1.0"
    source: str = "University of Minnesota Extension"
    source_url: str = SOURCE_URL
    max_age_hours: int = 6
    forecast_hours: int = 24

RULES = [Rule("tomato", "Late blight"), Rule("potato", "Late blight")]

# The crops the published rule set can actually assess. Named so a caller (and
# the UI) can state *why* an assessment was withheld rather than guess.
SUPPORTED_CROPS = tuple(r.crop for r in RULES)


def _insufficient(reason: str, explanation: str, rule: "Rule | None"):
    """An INSUFFICIENT_DATA result tagged with the specific reason it was
    withheld.

    ``risk_level`` stays ``INSUFFICIENT_DATA`` so existing clients are
    unaffected; the added ``reason`` lets an interface tell *weather is missing*
    apart from *no rule exists for this crop*. Those are different problems with
    different fixes, and collapsing them into one message is what made a farmer
    with perfectly good weather read "not enough weather information".
    """
    return {"risk_level":"INSUFFICIENT_DATA","reason":reason,"disease":rule.disease if rule else None,"factors":[],"explanation":explanation,"source":rule.source if rule else None,"source_url":rule.source_url if rule else None,"rule_version":rule.version if rule else None}


def assess(crop_name: str, weather: dict | None, forecast: bool = False):
    rule = next((r for r in RULES if r.crop == crop_name.strip().lower()), None)
    if not rule:
        return _insufficient("unsupported_crop", f"No evidence-based risk rule is published for {crop_name.strip() or 'this crop'}. Rule-based early warning currently covers tomato and potato (late blight); weather may be available, but there is no rule to apply to it.", None)
    if not weather:
        return _insufficient("weather_unavailable", "Fresh weather data for this farm is unavailable, so no risk level was assigned.", rule)
    temp = weather.get("temperature_2m"); humidity = weather.get("relative_humidity_2m"); rain = weather.get("rain")
    if temp is None or humidity is None or rain is None:
        return _insufficient("weather_incomplete", "Required weather fields (temperature, humidity, rainfall) are unavailable; no risk level was assigned.", rule)
    factors=[]
    if rain > 0: factors.append("Rain is present in the selected weather data.")
    if humidity >= 90: factors.append("Relative humidity is very high.")
    if 10 <= temp <= 25: factors.append("Temperature is within a cool-to-mild range relevant to late-blight development.")
    level = "HIGH" if len(factors) >= 3 else "MODERATE" if len(factors) >= 2 else "LOW"
    return {"risk_level":level,"reason":"assessed","disease":rule.disease,"factors":factors,"explanation":"These conditions may be favorable for increased late-blight risk; this is not a diagnosis.","source":rule.source,"source_url":rule.source_url,"rule_version":rule.version}

def assess_forecast(crop_name: str, hourly: dict | None):
    rule=next((r for r in RULES if r.crop==crop_name.strip().lower()),None)
    if not rule or not hourly: return assess(crop_name,None,True)
    times=hourly.get('time') or []; temps=hourly.get('temperature_2m') or []; humidity=hourly.get('relative_humidity_2m') or []; rain=hourly.get('rain') or []
    count=min(rule.forecast_hours,len(times),len(temps),len(humidity),len(rain))
    if count<rule.forecast_hours: return assess(crop_name,None,True)
    favorable_temp=sum(1 for v in temps[:count] if v is not None and 10<=v<=25); humid=sum(1 for v in humidity[:count] if v is not None and v>=90); total_rain=sum(v or 0 for v in rain[:count])
    factors=[]
    if total_rain>0: factors.append(f"Forecast rain total is {round(total_rain,2)} mm during the {count}-hour window.")
    if humid>0: factors.append(f"Relative humidity is at least 90% for {humid} forecast hours.")
    if favorable_temp>0: factors.append(f"Temperature is 10–25°C for {favorable_temp} forecast hours.")
    level='HIGH' if len(factors)==3 else 'MODERATE' if len(factors)==2 else 'LOW'
    return {"risk_level":level,"reason":"assessed","disease":rule.disease,"factors":factors,"explanation":"Forecast environmental conditions may become favorable for increased late-blight risk; this is not a diagnosis.","source":rule.source,"source_url":rule.source_url,"rule_version":rule.version,"relevant_hours":count}
