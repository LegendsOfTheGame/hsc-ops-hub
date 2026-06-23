#!/usr/bin/env python3
"""
Hamilton Weather Post + Branded Image
Runs daily via Task Scheduler.
Fetches forecast, generates post with Gemini (model fallback chain),
creates branded image, sends to Buffer via GraphQL.
"""

import urllib.request
import urllib.error
import urllib.parse
import json
import logging
from datetime import datetime, date, timedelta
import os
import argparse
import time
import re
import base64
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont

# ========== CONFIGURATION ==========
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ICON_PATH = os.path.join(_SCRIPT_DIR, "icon.png")
OUTPUT_IMAGE = os.path.join(_SCRIPT_DIR, "HAMMER_4AM_FINAL.png")
EVENTS_JSON = os.path.join(_SCRIPT_DIR, "events.json")

# --- API Keys & Buffer ---
# Loaded from credentials.py (gitignored — never commit that file)
import sys as _sys, os as _os
_sys.path.insert(0, _SCRIPT_DIR)
from credentials import GEMINI_API_KEY, BUFFER_ACCESS_TOKEN, BUFFER_ORG_ID, IMGBB_API_KEY

# --- Gemini Model Fallback Chain ---
MODEL_CHAIN = [
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
]

# --- imgbb API for image hosting ---
# IMGBB_API_KEY loaded from credentials.py above
IMGBB_API_URL = "https://api.imgbb.com/1/upload"

# --- Buffer channels ---
# Account 1: Meta platforms
BUFFER_CHANNELS_1 = [
    {"id": "69e918b9031bfa423c30d15a", "name": "hammerstreetclean (Instagram)", "facebook": False},
    {"id": "6852897e0530b816c263bd41", "name": "Hamilton Street Clean (Facebook)", "facebook": True},
    {"id": "6a3936d35ab6d2f1065c41e6", "name": "Hamilton Street Clean (Threads)", "facebook": True},
]

# Account 2: Alt/Decentralized platforms
BUFFER_CHANNELS_2 = [
    {"id": "6a3936465ab6d2f1065c3f5b", "name": "HammerStrClean (X/Twitter)", "facebook": False},
    {"id": "6a39351e5ab6d2f1065c395c", "name": "Hammer Street Clean (Bluesky)", "facebook": False},
]

BUFFER_CHANNELS = BUFFER_CHANNELS_1 + BUFFER_CHANNELS_2

LAT, LON = 43.2501, -79.8496

# ========== ICAL FEEDS ==========
ICAL_FEEDS = [
    {
        "url": "https://shopottawastreet.com/?post_type=tribe_events&ical=1&eventDisplay=list",
        "name": "Ottawa Street BIA",
        # sponsor_slot events are handled via events.json — skip them here
        "skip_keywords": ["board meeting", "virtual meeting", "sew hungry", "halloween haunt"],
        # Per-event Instagram tags (matched on partial name, case-insensitive)
        "event_tags": {
            "Thrift Crawl": "@thriftcrawl.hamilton @thriftmitch @ottawastbia #ShopOttawaSt",
        },
        # Fallback tags for any Ottawa St event without a specific entry
        "default_tags": "@ottawastbia #ShopOttawaSt",
    },
]

# ========== WEATHER CODES ==========
WMO_ICON_MAP = {
    0: "001-sun.png", 1: "003-sun-1.png", 2: "003-sun-1.png", 3: "002-cloud.png",
    45: "007-fog.png", 48: "007-fog.png", 51: "008-raining.png", 53: "008-raining.png",
    55: "008-raining.png", 56: "008-raining.png", 57: "008-raining.png", 61: "006-rain.png",
    63: "006-rain.png", 65: "009-heavy-rain.png", 66: "009-heavy-rain.png",
    67: "009-heavy-rain.png", 71: "004-snow.png", 73: "004-snow.png", 75: "004-snow.png",
    77: "004-snow.png", 85: "004-snow.png", 86: "004-snow.png", 80: "008-raining.png",
    81: "006-rain.png", 82: "009-heavy-rain.png", 95: "010-weather.png",
    96: "010-weather.png", 99: "010-weather.png"
}

WMO_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Icy fog", 51: "Light drizzle", 53: "Moderate drizzle",
    55: "Heavy drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Slight showers", 81: "Moderate showers", 82: "Heavy showers",
    85: "Slight snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
    96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail"
}

# ========== SCHEDULE ==========
WORK_DAYS = {"Monday", "Wednesday", "Friday"}

# ========== TONE BY DAY ==========
TONE_BY_DAY = {
    "Monday": "Early Riser/Hustle", "Tuesday": "Community Guardian",
    "Wednesday": "Hamilton Wit", "Thursday": "Community Guardian",
    "Friday": "Hamilton Wit", "Saturday": "Community Guardian",
    "Sunday": "Tactical/Informative",
}

TONE_NOTES = {
    "Community Guardian": "Civic-minded and proud of Hamilton",
    "Early Riser/Hustle": "Energetic and hardworking — first on the street",
    "Hamilton Wit": "Clever and punchy with local personality",
    "Tactical/Informative": "Direct and helpful — what weather means for businesses",
}

# ========== PATHS ==========
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT   = os.path.dirname(_SCRIPT_DIR)
ALERT_STATE_PATH = os.path.join(_REPO_ROOT, "alert_state.json")

# ========== LOGGING ==========
log_file = os.path.join(_SCRIPT_DIR, "weather_post.log")
alert_log_file = os.path.join(_SCRIPT_DIR, "alert_audit.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(log_file, encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

# Separate logger for alert events
alert_log = logging.getLogger("alert_audit")
alert_log.setLevel(logging.INFO)
alert_handler = logging.FileHandler(alert_log_file, encoding="utf-8")
alert_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
alert_log.addHandler(alert_handler)

# ========== HELPERS ==========

def http_get(url, headers=None):
    if headers is None:
        headers = {"User-Agent": "HamiltonWeatherBot/1.0"}
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if attempt < 2:
                log.warning("http_get attempt %d failed: %s. Retrying in 5s...", attempt + 1, e)
                time.sleep(5)
            else:
                raise

def http_post(url, data, headers=None):
    if headers is None:
        headers = {"Content-Type": "application/json"}
    body = json.dumps(data).encode("utf-8")
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            error_str = str(e)
            if attempt < 2 and ("503" in error_str or "500" in error_str or "SSL" in error_str or "timeout" in error_str.lower()):
                log.warning("http_post attempt %d failed: %s. Retrying in 10s...", attempt + 1, e)
                time.sleep(10)
            else:
                raise

# ========== ALERT DETECTION ==========

def detect_alert_level(alert_text):
    """Detect alert level from EC alert text. Returns RED, ORANGE, YELLOW, or None."""
    if not alert_text or "No watches or warnings" in alert_text:
        return None
    if "red" in alert_text.lower():
        return "RED"
    elif "orange" in alert_text.lower():
        return "ORANGE"
    else:
        return "YELLOW"

# ========== EVENTS (from JSON file) ==========

def load_events():
    """Load events from events.json, falling back to empty if file missing."""
    if not os.path.exists(EVENTS_JSON):
        log.warning("events.json not found at %s — no event context available", EVENTS_JSON)
        return {}

    try:
        with open(EVENTS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)

        events = {}
        # Load public holidays
        for h in data.get("public_holidays_2026", []):
            events[h["date"]] = h["name"]

        # Load Hamilton events (use start_date)
        for e in data.get("hamilton_major_events_2026_projected", []):
            if "start_date" in e:
                events[e["start_date"]] = e["name"]
            elif "date" in e:
                events[e["date"]] = e["name"]

        log.info("Loaded %d events from events.json", len(events))
        return events
    except Exception as e:
        log.error("Failed to load events.json: %s", e)
        return {}

def get_upcoming_event(events, days_ahead=6):
    today = date.today()
    for i in range(0, days_ahead + 1):
        check = (today + timedelta(days=i)).strftime("%Y-%m-%d")
        if check in events:
            name = events[check]
            # iCal events (tagged with feed name in parens) are day-of only
            if i > 0 and "(" in name and ")" in name:
                continue
            return name, i
    return None, None

def get_slot_event(days_ahead=3):
    """Return (name, tagline, days_until, instagram_tags) for a sponsor-slot event within days_ahead, else (None, None, None, None)."""
    if not os.path.exists(EVENTS_JSON):
        return None, None, None, None
    try:
        with open(EVENTS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        today = date.today()
        candidates = []
        for e in data.get("hamilton_major_events_2026_projected", []):
            if not e.get("sponsor_slot"):
                continue
            event_date_str = e.get("date") or e.get("start_date")
            if not event_date_str or "TBD" in event_date_str:
                continue
            days_until = (date.fromisoformat(event_date_str) - today).days
            if 0 <= days_until <= days_ahead:
                candidates.append((days_until, e))
        if candidates:
            candidates.sort(key=lambda x: x[0])
            days_until, e = candidates[0]
            return (e["name"], e.get("tagline", ""), days_until, e.get("instagram_tags", ""))
    except Exception as ex:
        log.warning("get_slot_event failed: %s", ex)
    return None

# ========== ICAL CALENDAR FETCH ==========

def fetch_ical_events():
    """Fetch all configured iCal feeds and return {date_str: event_name} dict.
    Skips board meetings and any keywords in the feed's skip_keywords list.
    Results are merged into the main events dict to feed Gemini event_context.
    """
    merged = {}
    for feed in ICAL_FEEDS:
        try:
            req = urllib.request.Request(
                feed["url"], headers={"User-Agent": "HamiltonWeatherBot/1.0"}
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                raw = r.read().decode("utf-8", errors="replace")

            skip = [kw.lower() for kw in feed.get("skip_keywords", [])]
            count = 0
            for block in raw.split("BEGIN:VEVENT")[1:]:
                end = block.find("END:VEVENT")
                if end == -1:
                    continue
                block = block[:end]

                # SUMMARY — unfold iCal line continuations
                m = re.search(r'^SUMMARY[^:]*:(.*?)$', block, re.MULTILINE)
                if not m:
                    continue
                summary = re.sub(r'\r?\n[ \t]', '', m.group(1).strip())

                if any(kw in summary.lower() for kw in skip):
                    continue

                # DTSTART — handles datetime (20260620T120000) and date-only (20260620)
                m = re.search(r'^DTSTART[^:]*:(.*?)$', block, re.MULTILINE)
                if not m:
                    continue
                dp = m.group(1).strip()[:8]
                try:
                    event_date = date(int(dp[:4]), int(dp[4:6]), int(dp[6:8]))
                    date_str = event_date.strftime("%Y-%m-%d")
                    if date_str not in merged:
                        merged[date_str] = f"{summary} ({feed['name']})"
                        count += 1
                except (ValueError, IndexError):
                    continue

            log.info("iCal %s: loaded %d events", feed["name"], count)
        except Exception as e:
            log.warning("iCal fetch failed for %s: %s", feed["name"], e)

    return merged

def get_ical_event_tags(event_name):
    """Return Instagram tags for a day-of iCal event, using per-event or feed default."""
    base = event_name.split(" (")[0].strip()
    for feed in ICAL_FEEDS:
        if f"({feed['name']})" not in event_name:
            continue
        for pattern, tags in feed.get("event_tags", {}).items():
            if pattern.lower() in base.lower():
                return tags
        return feed.get("default_tags", "")
    return ""

def load_tasty_tuesdays():
    """Return ({date_str: True}, details_dict) for Tasty Tuesday dates and event details."""
    if not os.path.exists(EVENTS_JSON):
        return {}, {}
    try:
        with open(EVENTS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        dates = {e["date"]: True for e in data.get("tasty_tuesdays_2026", [])}
        details = data.get("tasty_tuesday_details", {})
        return dates, details
    except Exception as e:
        log.warning("load_tasty_tuesdays failed: %s", e)
        return {}, {}

# ========== WEATHER FETCHING ==========

def fetch_openmeteo():
    log.info("Fetching Open-Meteo forecast...")
    url = (f"https://api.open-meteo.com/v1/forecast"
           f"?latitude={LAT}&longitude={LON}"
           f"&daily=temperature_2m_max,temperature_2m_min,daylight_duration,"
           f"precipitation_probability_max,wind_speed_10m_max,weather_code"
           f"&timezone=America%2FNew_York&forecast_days=2")
    data = http_get(url)
    daily = data["daily"]
    daylight_seconds = daily["daylight_duration"][0]
    daylight_hrs = int(daylight_seconds // 3600)
    daylight_mins = int((daylight_seconds % 3600) // 60)
    tomorrow_precip = daily["precipitation_probability_max"][1] if len(daily["precipitation_probability_max"]) > 1 else None
    return {
        "desc": WMO_CODES.get(daily["weather_code"][0], "Variable conditions"),
        "weather_code": daily["weather_code"][0],
        "max_temp": round(daily["temperature_2m_max"][0], 1),
        "min_temp": round(daily["temperature_2m_min"][0], 1),
        "daylight": f"{daylight_hrs}h {daylight_mins}m",
        "precip_prob": daily["precipitation_probability_max"][0],
        "wind_kmh": round(daily["wind_speed_10m_max"][0], 1),
        "tomorrow_precip_prob": tomorrow_precip,
    }

def fetch_envcanada():
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    result = {"forecast": None, "alert": None}

    try:
        log.info("Fetching Environment Canada forecast...")
        req = urllib.request.Request(
            "https://weather.gc.ca/rss/weather/43.258_-79.869_e.xml",
            headers={"User-Agent": "HamiltonWeatherBot/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            tree = ET.parse(r)
            root = tree.getroot()
            for entry in root.findall("atom:entry", ns):
                cat = entry.find("atom:category", ns)
                if cat is not None and cat.get("term") == "Weather Forecasts":
                    title = entry.findtext("atom:title", default="", namespaces=ns)
                    summary = entry.findtext("atom:summary", default="", namespaces=ns)
                    summary = re.sub(r"<[^>]+>", "", summary).strip()
                    result["forecast"] = f"{title}. {summary}"
                    log.info("EC forecast: %s", result["forecast"][:90])
                    break
    except Exception as e:
        log.warning("Could not fetch EC forecast: %s", e)

    try:
        log.info("Fetching Environment Canada alerts...")
        req = urllib.request.Request(
            "https://weather.gc.ca/rss/alerts/43.258_-79.869_e.xml",
            headers={"User-Agent": "HamiltonWeatherBot/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            tree = ET.parse(r)
            root = tree.getroot()
            for entry in root.findall("atom:entry", ns):
                title = entry.findtext("atom:title", default="", namespaces=ns)
                if "No watches or warnings" not in title:
                    summary = entry.findtext("atom:summary", default="", namespaces=ns)
                    summary = re.sub(r"<[^>]+>", "", summary).strip()
                    result["alert"] = f"{title}. {summary}"
                    log.info("EC ALERT: %s", result["alert"])
                    break
            if not result["alert"]:
                log.info("EC alerts: No watches or warnings in effect")
    except Exception as e:
        log.warning("Could not fetch EC alerts: %s", e)

    return result

def fetch_weather():
    om = None
    try:
        om = fetch_openmeteo()
    except Exception as e:
        log.warning("Open-Meteo unavailable: %s — falling back to EC-only mode", e)

    ec = fetch_envcanada()

    if om is None and ec["forecast"] is None and ec["alert"] is None:
        raise Exception("Both Open-Meteo and Environment Canada are unavailable — skipping post")

    weather = {
        "desc": om["desc"] if om else "Variable conditions",
        "weather_code": om["weather_code"] if om else None,
        "max_temp": om["max_temp"] if om else None,
        "min_temp": om["min_temp"] if om else None,
        "daylight": om["daylight"] if om else None,
        "precip_prob": om["precip_prob"] if om else None,
        "wind_kmh": om["wind_kmh"] if om else None,
        "ec_forecast": ec["forecast"],
        "ec_alert": ec["alert"],
    }
    if om:
        log.info(
            "Weather combined | High %.1f°C Low %.1f°C | Rain %d%% | Wind %.1f km/h | Daylight %s%s",
            weather["max_temp"], weather["min_temp"],
            weather["precip_prob"], weather["wind_kmh"], weather["daylight"],
            " | ALERT: " + weather["ec_alert"] if weather["ec_alert"] else ""
        )
    else:
        log.info("Weather (EC only — Open-Meteo down)%s",
                 " | ALERT: " + weather["ec_alert"] if weather["ec_alert"] else "")
    return weather

# ========== POST GENERATION (with model fallback) ==========

def generate_post(weather, events, slot_event=None, tasty_tuesday=False, tasty_details=None, force_saturday=False):
    today_str = datetime.now().strftime("%A, %B %#d")
    today_name = "Saturday" if force_saturday else datetime.now().strftime("%A")
    tone = TONE_BY_DAY.get(today_name, "Community Guardian")
    is_work_day = today_name in WORK_DAYS
    schedule_context = (
        "Today IS a scheduled work day (Mon/Wed/Fri) — Jay is actively out cleaning Barton Village streets."
        if is_work_day else
        "Today is NOT a scheduled work day — Jay is not out cleaning. Do NOT say or imply he is actively cleaning today. Talk about the weather and its impact on the community instead."
    )

    event_name, days_until = get_upcoming_event(events, days_ahead=6)
    event_context = ""
    if event_name and event_name == "Tasty Tuesday" and tasty_details:
        loc  = tasty_details.get("location", "643 Barton St E at Earl")
        time = tasty_details.get("time", "2PM–6PM")
        if days_until == 0:
            event_context = f"Tasty Tuesday is TODAY at {loc}, {time} — hype it up, this is right on Barton St."
        else:
            event_context = f"Tasty Tuesday is TOMORROW at {loc}, {time} — give it a warm shoutout."
    elif event_name and days_until == 0:
        event_context = f"Today is {event_name} — mention it with energy."
    elif event_name and days_until == 1:
        event_context = f"Tomorrow is {event_name} — acknowledge it warmly."
    elif event_name:
        event_context = f"{event_name} is in {days_until} days — mention it briefly."

    # Sponsor / event context
    sponsor_context = ""
    slot_name, slot_tagline, slot_days, slot_tags = slot_event if slot_event is not None else (None, None, None, None)
    if slot_name:
        if slot_days == 0:
            sponsor_context = f"The {slot_name} is happening TODAY on Barton St — mention the excitement."
        elif slot_days == 1:
            sponsor_context = f"The {slot_name} is TOMORROW on Barton St — hype it up."
        else:
            sponsor_context = f"The {slot_name} is in {slot_days} days on Barton St — mention it with excitement."
    elif today_name == "Monday":
        sponsor_context = "This is a Monday — mention and tag @eldercamp.ca (our Instagram sponsor) in the post. Include their name naturally."
    elif today_name == "Saturday":
        sponsor_context = "This is a Saturday — mention and tag @scoop2poovement (our sponsor, scoop2.ca) in the post. Their tagline: 'when your dog poops, always #Scoop2' — meaning if you see another dog's waste, scoop it up too. Include #Scoop2 naturally."
    elif today_name == "Friday":
        sponsor_context = "This is Fizz Friday — make the post feel like a Friday and keep it energetic."

    # Alert level
    alert_text = weather.get("ec_alert") or ""
    if "red" in alert_text.lower():
        alert_level = "RED"
    elif "orange" in alert_text.lower():
        alert_level = "ORANGE"
    elif alert_text and "No watches or warnings" not in alert_text:
        alert_level = "YELLOW"
    else:
        alert_level = None

    temp_max = weather["max_temp"]
    below_threshold = temp_max is not None and temp_max < -5
    above_threshold = temp_max is not None and temp_max > 35
    if alert_level or below_threshold or above_threshold:
        tone = "Tactical/Informative"

    log.info("Generating post with Gemini (tone: %s | day: %s)...", tone, today_name)
    if alert_level:
        log.info("EC Alert level: %s", alert_level)
    if event_name:
        log.info("Upcoming event: %s in %d day(s)", event_name, days_until)

    om_available = temp_max is not None
    if om_available:
        prompt = f"""You are the voice of Hammer Street Clean, a solo-operated street cleaning business in Hamilton, Ontario.
Tone: {tone}. Weather: {weather['desc']}, High {weather['max_temp']}°C, Low {weather['min_temp']}°C, Rain {weather['precip_prob']}%, Wind {weather['wind_kmh']} km/h.
Schedule: {schedule_context}
Signature lines (use ONE if conditions match, drop it casually at the end):
- Rain at 100%: "who ordered the free car wash"
- Heavy snow (code 73/75/77): "who broke the snow globe"
- Wind over 30 km/h: "I thought only Alberta had those chinook winds"
Rules: Under 210 characters. Include temperature ({weather['max_temp']}°C). Connect weather to street cleaning. No puns outside signature lines. No markdown. End with #HamOnt and one more hashtag.
{sponsor_context}
{event_context}"""
    else:
        ec_text = weather.get("ec_forecast") or "Variable conditions expected in Hamilton today."
        prompt = f"""You are the voice of Hammer Street Clean, a solo-operated street cleaning business in Hamilton, Ontario.
Tone: {tone}. Environment Canada forecast: {ec_text}
Schedule: {schedule_context}
Rules: Under 210 characters. Connect weather to street cleaning. No puns. No markdown. End with #HamOnt and one more hashtag.
{sponsor_context}
{event_context}"""

    # Try each model in the chain
    for model in MODEL_CHAIN:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        for attempt in range(2):
            try:
                response = http_post(url,
                    {"contents": [{"parts": [{"text": prompt}]}],
                     "generationConfig": {"maxOutputTokens": 350, "temperature": 0.9}},
                    {"Content-Type": "application/json"})
                post_text = response["candidates"][0]["content"]["parts"][0]["text"].strip()
                # Clean markdown artifacts
                post_text = re.sub(r'[\*_]', '', post_text)
                # Ensure temperature is present (only when OM data available)
                if om_available and str(weather['max_temp']) not in post_text:
                    post_text = f"{weather['max_temp']}°C | {post_text}"
                    if len(post_text) > 210:
                        post_text = post_text[:207] + "..."
                # Event slot footer — overrides Fizz during major event week
                if slot_name and slot_tags:
                    post_text += f"\n\n{slot_tags}"
                elif today_name == "Friday":
                    post_text += "\n\n🔥 Fizz Mobile Fridays (fizz.ca) — get $40 off your phone plan\nUse code EW4HH"
                elif today_name == "Saturday":
                    post_text += "\n\n🐾 @scoop2poovement · scoop2.ca\nWhen your dog poops, always #Scoop2"
                elif today_name != "Monday":
                    post_text += "\n\n📣 Sponsor this post for $5/mo — DM us to get your brand here!"
                # Tasty Tuesday tags (T-1, weather-permitting)
                if tasty_tuesday:
                    post_text += "\n\n@barton_village #TastyTuesday"
                # Day-of iCal event tags (Thrift Crawl etc.)
                if days_until == 0 and event_name and "(" in event_name:
                    ical_tags = get_ical_event_tags(event_name)
                    if ical_tags:
                        post_text += f"\n\n{ical_tags}"
                log.info("Generated post (%d chars) via %s: %s", len(post_text), model, post_text)
                return post_text
            except Exception as e:
                error_str = str(e)
                if "503" in error_str or "500" in error_str:
                    log.warning("%s attempt %d: %s. Retrying...", model, attempt + 1, e)
                    time.sleep(15)
                else:
                    log.error("%s failed: %s", model, e)
                    break
        log.warning("%s exhausted. Trying next model...", model)

    # Template fallback — always posts something
    log.error("All Gemini models failed. Using template fallback.")
    if slot_name and slot_tags:
        footer = f"\n\n{slot_tags}"
    elif today_name == "Friday":
        footer = "\n\n🔥 Fizz Mobile Fridays (fizz.ca) — get $40 off your phone plan\nUse code EW4HH"
    elif today_name == "Saturday":
        footer = "\n\n🐾 @scoop2poovement · scoop2.ca\nWhen your dog poops, always #Scoop2"
    elif today_name != "Monday":
        footer = "\n\n📣 Sponsor this post for $5/mo — DM us to get your brand here!"
    else:
        footer = ""
    if tasty_tuesday:
        footer += "\n\n@barton_village #TastyTuesday"
    if days_until == 0 and event_name and "(" in event_name:
        ical_tags = get_ical_event_tags(event_name)
        if ical_tags:
            footer += f"\n\n{ical_tags}"
    if om_available:
        return f"{weather['desc']} in The Hammer today. High {weather['max_temp']}°C, {weather['precip_prob']}% chance of rain. Streets are getting cleaned regardless. #HamOnt #HammerStreetClean{footer}"
    else:
        ec_text = weather.get("ec_forecast") or "Variable conditions in Hamilton."
        return f"Hamilton weather: {ec_text[:120]} Streets are getting cleaned regardless. #HamOnt #HammerStreetClean{footer}"

def generate_short_forecast(weather, events):
    """Generate short forecast for branded image. Uses Gemini with fallback to template."""
    event_name, days_until = get_upcoming_event(events, days_ahead=4)
    event_ctx = ""
    if event_name and days_until == 0:
        event_ctx = f"Today is {event_name}. "
    elif event_name and days_until == 1:
        event_ctx = f"Tomorrow is {event_name}. "
    elif event_name:
        event_ctx = f"{event_name} in {days_until} days. "

    om_available = weather['max_temp'] is not None
    if om_available:
        prompt = (
            f"Write a one-sentence weather forecast for Hamilton, Ontario. "
            f"Include the high of {weather['max_temp']}°C. "
            f"Conditions: {weather['desc']}, {weather['precip_prob']}% chance of rain. "
            f"Keep it under 60 characters. No city prefix, no labels. Just the sentence."
        )
    else:
        ec_text = weather.get("ec_forecast") or weather['desc']
        prompt = (
            f"Write a one-sentence weather forecast for Hamilton in under 60 characters "
            f"based on: {ec_text[:120]}. No city prefix. Just the sentence."
        )

    for model in MODEL_CHAIN:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        try:
            response = http_post(url,
                {"contents": [{"parts": [{"text": prompt}]}],
                 "generationConfig": {"maxOutputTokens": 60, "temperature": 0.7}},
                {"Content-Type": "application/json"})
            forecast = response["candidates"][0]["content"]["parts"][0]["text"].strip()
            forecast = re.sub(r'[\*_]', '', forecast)
            # Strip any leading "Hamilton:" prefix Gemini might still add
            forecast = re.sub(r'^Hamilton\s*[:\-–]\s*', '', forecast, flags=re.IGNORECASE)
            words = forecast.split()
            if len(words) > 18:
                forecast = " ".join(words[:18]) + "."
            if om_available and str(weather['max_temp']) not in forecast:
                forecast = f"High {weather['max_temp']}°C — {forecast}"
            if len(forecast) > 80:
                forecast = f"{weather['desc']}, high {weather['max_temp']}°C." if om_available else f"{weather['desc']}."
            return forecast
        except Exception as e:
            log.warning("Short forecast via %s failed: %s", model, e)

    if om_available:
        return f"{weather['desc']}, high {weather['max_temp']}°C."
    else:
        return weather.get("ec_forecast") or f"{weather['desc']}."

# ========== IMAGE GENERATION ==========

def get_weather_icon(code, temp):
    """Selects icon from weather/icons based on WMO or Cold."""
    if temp <= -15:
        fname = "012-temperature.png"
    elif temp >= 30:
        fname = "011-heatwave.png"
    else:
        fname = WMO_ICON_MAP.get(code, "002-cloud.png")
    try:
        icon_path = os.path.join(_SCRIPT_DIR, "weather", "icons", fname)
        icon = Image.open(icon_path).convert("RGBA")
        return icon.resize((250, 250), Image.Resampling.LANCZOS)
    except:
        return Image.new("RGBA", (250, 250), (0, 0, 0, 0))

def draw_centered_text(draw, text, font, y, width, colour=(255, 255, 255)):
    """Centers text on the 1080px wide Canva template."""
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (bbox[2] - bbox[0])) / 2, y), text, font=font, fill=colour)

def create_branded_image(short_forecast, weather, force_monday=False, force_friday=False, force_saturday=False, slot_event=None):
    """
    Fully programmatic dark-card weather brief. 1080×1350 (Instagram 4:5).
    Layout: identity bar → day headline → icon/temp hero → stats band →
            forecast card → work-status pill → (Mon/Fri sponsor) → branding band.
    """
    W, H = 1080, 1350

    # --- Alert severity → accent colour ---
    alert_text = (weather.get("ec_alert") or "").lower()
    if "ended" in alert_text or "terminated" in alert_text:
        level = "Normal"
    elif any(w in alert_text for w in ["warning", "red", "orange", "extreme", "significant"]):
        level = "Red"
    elif any(w in alert_text for w in ["watch", "statement", "advisory", "special", "yellow"]):
        level = "Yellow"
    else:
        level = "Normal"

    ACCENT   = {"Normal": (248, 185, 42), "Yellow": (255, 220, 0), "Red": (239, 68, 68)}[level]
    BG_MAIN  = (13, 27, 42)
    BG_CARD  = (20, 40, 63)
    BG_DARK  = (7, 16, 27)
    TEXT_W   = (255, 255, 255)
    TEXT_S   = (148, 163, 184)
    STATUS_G = (52, 211, 153)

    is_monday   = force_monday   or (datetime.now().strftime("%A") == "Monday")
    is_friday   = force_friday   or (datetime.now().strftime("%A") == "Friday")
    is_saturday = force_saturday or (datetime.now().strftime("%A") == "Saturday")
    is_work     = datetime.now().strftime("%A") in WORK_DAYS

    # --- Canvas ---
    img  = Image.new("RGB", (W, H), BG_MAIN)
    draw = ImageDraw.Draw(img)

    # --- Fonts (scaled for 1350px) ---
    fd = os.path.join(_SCRIPT_DIR, "weather")
    try:
        f_day   = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),    110)
        f_hero  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     72)
        f_temp  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),    130)
        f_cond  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     38)
        f_stat  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     38)
        f_lbl   = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  20)
        f_body  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     36)
        f_sm    = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  22)
        f_xs    = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  18)
        f_brand = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     32)
        f_spon  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  24)
    except Exception as e:
        log.error("Font load failed: %s", e)
        return None

    def cx(text, font, y, fill=TEXT_W):
        bb = draw.textbbox((0, 0), text, font=font)
        draw.text(((W - (bb[2] - bb[0])) // 2, y), text, font=font, fill=fill)

    def hbar(y, color=None, x=0, width=W, h=4):
        draw.rectangle([(x, y), (x + width, y + h)], fill=color or ACCENT)

    # ── TOP STRIPE ──────────────────────────────────────────────────────────
    hbar(0, ACCENT, h=6)

    # ── IDENTITY BAR  (y 6–104) ─────────────────────────────────────────────
    try:
        logo = Image.open(ICON_PATH).convert("RGBA")
        lh = 52; lw = int(lh * logo.width / logo.height)
        logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
        img.paste(logo, (56, 26), logo)
        draw.text((56 + lw + 14, 39), "HAMMER STREET CLEAN", font=f_sm, fill=TEXT_S)
    except Exception:
        draw.text((56, 39), "HAMMER STREET CLEAN", font=f_sm, fill=TEXT_S)

    loc = "HAMILTON, ON"
    bb = draw.textbbox((0, 0), loc, font=f_sm)
    draw.text((W - 56 - (bb[2] - bb[0]), 39), loc, font=f_sm, fill=TEXT_S)

    hbar(100, (38, 58, 82), h=2)

    # ── DAY HEADLINE  (y 104–354) ───────────────────────────────────────────
    today_name = datetime.now().strftime("%A").upper()
    cx(today_name, f_day, 106, TEXT_W)
    cx("FORECAST", f_hero, 228, ACCENT)

    today_date = datetime.now().strftime("%A, %B %#d").upper()
    cx(today_date, f_sm, 314, TEXT_S)

    hbar(346, ACCENT, (W - 160) // 2, 160, 3)

    # ── WEATHER ICON  (y 354–500) ───────────────────────────────────────────
    max_t = weather.get("max_temp") or 0
    icon = get_weather_icon(weather.get("weather_code", 3), max_t)
    icon = icon.resize((140, 140), Image.Resampling.LANCZOS)
    ix = (W - 140) // 2
    img.paste(icon, (ix, 356), icon)

    # ── TEMPERATURE HERO  (y 504–644) ───────────────────────────────────────
    temp_str = f"{max_t}°C"
    bb = draw.textbbox((0, 0), temp_str, font=f_temp)
    draw.text(((W - (bb[2] - bb[0])) // 2, 504), temp_str, font=f_temp, fill=TEXT_W)

    # ── CONDITION  (y 648–692) ──────────────────────────────────────────────
    cond = (weather.get("desc") or "Variable conditions").upper()
    cx(cond, f_cond, 650, ACCENT)

    # ── STATS BAND  (y 698–840) ─────────────────────────────────────────────
    draw.rectangle([(0, 698), (W, 840)], fill=BG_DARK)
    hbar(698, ACCENT, h=3)

    stats = [
        ("LOW",      f"{weather.get('min_temp', '—')}°C"),
        ("RAIN",     f"{weather.get('precip_prob', 0)}%"),
        ("WIND",     f"{weather.get('wind_kmh', 0)} km/h"),
        ("DAYLIGHT", str(weather.get("daylight") or "—")),
    ]
    col_w = W // 4
    for i, (label, value) in enumerate(stats):
        mid = col_w * i + col_w // 2
        bb_v = draw.textbbox((0, 0), value, font=f_stat)
        draw.text((mid - (bb_v[2] - bb_v[0]) // 2, 714), value, font=f_stat, fill=TEXT_W)
        bb_l = draw.textbbox((0, 0), label, font=f_lbl)
        draw.text((mid - (bb_l[2] - bb_l[0]) // 2, 772), label, font=f_lbl, fill=ACCENT)

    for i in range(1, 4):
        draw.rectangle([(col_w * i, 714), (col_w * i + 1, 826)], fill=(30, 52, 76))

    # ── FORECAST CARD  (y 848–1044) ─────────────────────────────────────────
    draw.rounded_rectangle([(56, 848), (W - 56, 1044)], radius=16, fill=BG_CARD)

    sec_lbl = "TODAY'S CONDITIONS"
    bb_l = draw.textbbox((0, 0), sec_lbl, font=f_xs)
    draw.text(((W - (bb_l[2] - bb_l[0])) // 2, 866), sec_lbl, font=f_xs, fill=ACCENT)
    hbar(892, ACCENT, (W - 140) // 2, 140, 2)

    # Wrap forecast text
    words = short_forecast.split()
    lines_f, cur = [], ""
    for wd in words:
        test = (cur + wd + " ").strip()
        bb = draw.textbbox((0, 0), test, font=f_body)
        if bb[2] - bb[0] < W - 160:
            cur += wd + " "
        else:
            if cur.strip():
                lines_f.append(cur.strip())
            cur = wd + " "
    if cur.strip():
        lines_f.append(cur.strip())

    line_h = 50
    block_h = len(lines_f) * line_h
    card_text_zone = 130  # px available for text inside card
    text_y = 904 + max(0, (card_text_zone - block_h) // 2)
    for i, ln in enumerate(lines_f[:3]):
        cx(ln, f_body, text_y + i * line_h, TEXT_W)

    # ── WORK-STATUS PILL  (y 1056–1104) ─────────────────────────────────────
    if is_work:
        pill_label = "ON THE STREET TODAY"
        pill_fill  = (12, 36, 26)
        pill_out   = STATUS_G
        pill_tc    = STATUS_G
    else:
        pill_label = "COMMUNITY DAY"
        pill_fill  = BG_CARD
        pill_out   = TEXT_S
        pill_tc    = TEXT_S

    bb_p = draw.textbbox((0, 0), pill_label, font=f_sm)
    pw = bb_p[2] - bb_p[0] + 64
    ph = 40
    px = (W - pw) // 2
    draw.rounded_rectangle([(px, 1058), (px + pw, 1058 + ph)], radius=20,
                            fill=pill_fill, outline=pill_out, width=2)
    draw.text(((W - (bb_p[2] - bb_p[0])) // 2, 1067), pill_label, font=f_sm, fill=pill_tc)

    # ── SPONSOR / EVENT SLOT  (y 1108–1188) ─────────────────────────────────
    # Major upcoming event overrides day sponsors when within 3 days
    if slot_event:
        event_name, event_tagline, days_until, _event_tags = slot_event if slot_event is not None else (None, None, None, None)
        if days_until == 0:
            countdown = "TODAY on Barton St!"
        elif days_until == 1:
            countdown = "TOMORROW on Barton St!"
        else:
            countdown = f"THIS SATURDAY · Barton Village"
        cx(event_name, f_spon, 1120, ACCENT)
        cx(countdown,  f_spon, 1150, TEXT_W)

    elif is_monday:
        try:
            sl = Image.open(os.path.join(_SCRIPT_DIR, "weather", "ElderCamp.png")).convert("RGBA")
            sh = 58; sw = int(sh * sl.width / sl.height)
            sl = sl.resize((sw, sh), Image.Resampling.LANCZOS)

            sup  = "Supported by"
            ec   = "ElderCamp · 340 Barton St E"
            bb_s = draw.textbbox((0, 0), sup, font=f_spon)
            bb_e = draw.textbbox((0, 0), ec,  font=f_spon)
            max_tw = max(bb_s[2] - bb_s[0], bb_e[2] - bb_e[0])
            total_w = sw + 16 + max_tw
            sx = (W - total_w) // 2

            img.paste(sl, (sx, 1118), sl)
            draw.text((sx + sw + 16, 1120), sup, font=f_spon, fill=TEXT_S)
            draw.text((sx + sw + 16, 1150), ec,  font=f_spon, fill=TEXT_W)
        except Exception as e:
            log.warning("ElderCamp logo failed: %s", e)

    elif is_saturday:
        try:
            sl = Image.open(os.path.join(_SCRIPT_DIR, "weather", "scoop2.jpg")).convert("RGBA")
            sh = 58; sw = int(sh * sl.width / sl.height)
            sl = sl.resize((sw, sh), Image.Resampling.LANCZOS)
            sup  = "Supported by"
            sc   = "Scoop2Poovement · scoop2.ca"
            bb_s = draw.textbbox((0, 0), sup, font=f_spon)
            bb_e = draw.textbbox((0, 0), sc,  font=f_spon)
            max_tw = max(bb_s[2] - bb_s[0], bb_e[2] - bb_e[0])
            total_w = sw + 16 + max_tw
            sx = (W - total_w) // 2
            img.paste(sl, (sx, 1118), sl)
            draw.text((sx + sw + 16, 1120), sup, font=f_spon, fill=TEXT_S)
            draw.text((sx + sw + 16, 1150), sc,  font=f_spon, fill=TEXT_W)
        except Exception as e:
            log.warning("Scoop2 logo failed: %s", e)
            cx("Supported by Scoop2Poovement", f_spon, 1120, TEXT_S)
            cx("scoop2.ca · #Scoop2", f_spon, 1150, TEXT_W)

    elif is_friday:
        FIZZ_GREEN = (0, 215, 114)    # #00D772 Caribbean Green
        FIZZ_BLUE  = (186, 233, 249)  # #BAE9F9 Charlotte
        line1 = "Fizz Mobile Fridays (fizz.ca)"
        line2 = "Get $40 off · Code: EW4HH"
        try:
            sl = Image.open(os.path.join(_SCRIPT_DIR, "weather", "Fizz.png")).convert("RGBA")
            sh = 58; sw = int(sh * sl.width / sl.height)
            sl = sl.resize((sw, sh), Image.Resampling.LANCZOS)

            bb_1 = draw.textbbox((0, 0), line1, font=f_spon)
            bb_2 = draw.textbbox((0, 0), line2, font=f_spon)
            max_tw = max(bb_1[2] - bb_1[0], bb_2[2] - bb_2[0])
            total_w = sw + 16 + max_tw
            sx = (W - total_w) // 2

            img.paste(sl, (sx, 1118), sl)
            draw.text((sx + sw + 16, 1120), line1, font=f_spon, fill=FIZZ_GREEN)
            draw.text((sx + sw + 16, 1150), line2, font=f_spon, fill=FIZZ_BLUE)
        except Exception:
            cx(line1, f_spon, 1120, FIZZ_GREEN)
            cx(line2, f_spon, 1150, FIZZ_BLUE)

    elif not slot_event:
        cx("Sponsor this post", f_spon, 1120, TEXT_S)
        cx("$5/mo · DM us to get your brand here", f_spon, 1150, ACCENT)

    # ── BOTTOM BRANDING BAND  (y 1198–1350) ─────────────────────────────────
    draw.rectangle([(0, 1198), (W, H)], fill=BG_DARK)
    hbar(1198, ACCENT, h=4)

    try:
        bl = Image.open(ICON_PATH).convert("RGBA")
        bh = 65; bw = int(bh * bl.width / bl.height)
        bl = bl.resize((bw, bh), Image.Resampling.LANCZOS)

        brand = "HAMMER STREET CLEAN"
        bb_b  = draw.textbbox((0, 0), brand, font=f_brand)
        total_b = bw + 18 + (bb_b[2] - bb_b[0])
        bx = (W - total_b) // 2
        img.paste(bl, (bx, 1222), bl)
        draw.text((bx + bw + 18, 1238), brand, font=f_brand, fill=TEXT_W)
    except Exception:
        cx("HAMMER STREET CLEAN", f_brand, 1238, TEXT_W)

    cx("Keeping Barton Village clean", f_xs, 1308, TEXT_S)

    # ── SAVE ────────────────────────────────────────────────────────────────
    img.save(OUTPUT_IMAGE, "PNG")
    log.info("Branded image saved to %s", OUTPUT_IMAGE)
    return OUTPUT_IMAGE

# ========== imgbb IMAGE UPLOAD ==========

def upload_image_to_imgbb(image_path):
    """Upload image to imgbb and return public URL"""
    try:
        if not os.path.exists(image_path):
            log.error("Image file not found: %s", image_path)
            return None
        
        with open(image_path, "rb") as f:
            image_data = f.read()
        
        image_base64 = base64.b64encode(image_data).decode('utf-8')
        
        # Build form data (imgbb needs form-encoded, not JSON)
        payload = urllib.parse.urlencode({
            "key": IMGBB_API_KEY,
            "image": image_base64
        }).encode('utf-8')
        
        req = urllib.request.Request(
            IMGBB_API_URL,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode())
        
        if result.get("success"):
            image_url = result["data"]["url"]
            log.info("Image uploaded to imgbb: %s", image_url)
            return image_url
        else:
            log.error("imgbb upload failed: %s", result)
            return None
            
    except Exception as e:
        log.error("Failed to upload image to imgbb: %s", e)
        return None

# ========== BUFFER ==========

def send_to_buffer(post_text, image_url=None, immediate=False):
    mode = "shareNow" if immediate else "addToQueue"
    log.info("Sending to Buffer %s...", mode)
    if image_url:
        log.info("Including image: %s", image_url)

    # image: singular object — Buffer renamed from images:[...] to image:{...}
    mutation_with_image = f"""
    mutation CreatePost($channelId: ChannelId!, $text: String!, $imageUrl: String!) {{
        createPost(input: {{ channelId: $channelId text: $text schedulingType: automatic mode: {mode} assets: {{ image: {{url: $imageUrl}} }} }}) {{
            ... on PostActionSuccess {{ post {{ id text }} }}
            ... on MutationError {{ message }}
        }}
    }}"""

    mutation_standard = f"""
    mutation CreatePost($channelId: ChannelId!, $text: String!) {{
        createPost(input: {{ channelId: $channelId text: $text schedulingType: automatic mode: {mode} }}) {{
            ... on PostActionSuccess {{ post {{ id text }} }}
            ... on MutationError {{ message }}
        }}
    }}"""

    mutation_facebook_image = f"""
    mutation CreatePost($channelId: ChannelId!, $text: String!, $imageUrl: String!) {{
        createPost(input: {{ channelId: $channelId text: $text schedulingType: automatic mode: {mode} metadata: {{ facebook: {{ type: post }} }} assets: {{ image: {{url: $imageUrl}} }} }}) {{
            ... on PostActionSuccess {{ post {{ id text }} }}
            ... on MutationError {{ message }}
        }}
    }}"""

    mutation_facebook = f"""
    mutation CreatePost($channelId: ChannelId!, $text: String!) {{
        createPost(input: {{ channelId: $channelId text: $text schedulingType: automatic mode: {mode} metadata: {{ facebook: {{ type: post }} }} }}) {{
            ... on PostActionSuccess {{ post {{ id text }} }}
            ... on MutationError {{ message }}
        }}
    }}"""

    mutation_instagram_image = f"""
    mutation CreatePost($channelId: ChannelId!, $text: String!, $imageUrl: String!) {{
        createPost(input: {{ channelId: $channelId text: $text schedulingType: automatic mode: {mode} metadata: {{ instagram: {{ type: post shouldShareToFeed: true }} }} assets: {{ image: {{url: $imageUrl}} }} }}) {{
            ... on PostActionSuccess {{ post {{ id text }} }}
            ... on MutationError {{ message }}
        }}
    }}"""

    mutation_instagram = f"""
    mutation CreatePost($channelId: ChannelId!, $text: String!) {{
        createPost(input: {{ channelId: $channelId text: $text schedulingType: automatic mode: {mode} metadata: {{ instagram: {{ type: post shouldShareToFeed: true }} }} }}) {{
            ... on PostActionSuccess {{ post {{ id text }} }}
            ... on MutationError {{ message }}
        }}
    }}"""

    def pick_mutations(channel, with_image):
        is_instagram = "instagram" in channel["name"].lower()
        if with_image:
            if is_instagram:
                return mutation_instagram_image, {"channelId": channel["id"], "text": post_text, "imageUrl": image_url}
            elif channel["facebook"]:
                return mutation_facebook_image, {"channelId": channel["id"], "text": post_text, "imageUrl": image_url}
            else:
                return mutation_with_image, {"channelId": channel["id"], "text": post_text, "imageUrl": image_url}
        else:
            if is_instagram:
                return mutation_instagram, {"channelId": channel["id"], "text": post_text}
            elif channel["facebook"]:
                return mutation_facebook, {"channelId": channel["id"], "text": post_text}
            else:
                return mutation_standard, {"channelId": channel["id"], "text": post_text}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {BUFFER_ACCESS_TOKEN}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }

    posted_ids = []
    for channel in BUFFER_CHANNELS:
        mutation, variables = pick_mutations(channel, with_image=bool(image_url))
        posted = False

        for attempt_with_image in ([True, False] if image_url else [False]):
            if not attempt_with_image and image_url:
                log.warning("%s: image mutation failed — retrying text-only", channel["name"])
                mutation, variables = pick_mutations(channel, with_image=False)

            try:
                response = http_post("https://api.buffer.com",
                                     {"query": mutation, "variables": variables}, headers)
                if "errors" in response and response["errors"]:
                    err_msg = response["errors"][0].get("message", "")
                    log.error("Buffer error for %s: %s", channel["name"], err_msg)
                    break  # GraphQL errors won't improve on retry
                result = response.get("data", {}).get("createPost", {})
                post_obj = result.get("post")
                if post_obj and post_obj.get("id"):
                    suffix = "" if attempt_with_image else " (text-only fallback)"
                    log.info("Posted to %s%s — ID: %s", channel["name"], suffix, post_obj["id"])
                    posted_ids.append(post_obj["id"])
                    posted = True
                    break
                elif result.get("message"):
                    log.error("Buffer rejected %s: %s", channel["name"], result["message"])
                    break
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                log.error("Failed to post to %s: HTTP %s — %s", channel["name"], e.code, body)
                if e.code == 400 and attempt_with_image:
                    continue  # schema/validation error — try text-only
                break
            except Exception as e:
                log.error("Failed to post to %s: %s", channel["name"], e)
                break

        if not posted:
            log.error("Could not post to %s (all attempts failed)", channel["name"])

    if not posted_ids:
        raise RuntimeError("Failed to post to any Buffer channel")
    return posted_ids

# ========== SPONSOR CARD ==========

def create_sponsor_card():
    """Generate a static sponsor recruitment card using the branded template."""
    W, H = 1080, 1350
    ACCENT   = (248, 185, 42)
    BG_MAIN  = (13, 27, 42)
    BG_CARD  = (20, 40, 63)
    BG_DARK  = (7, 16, 27)
    TEXT_W   = (255, 255, 255)
    TEXT_S   = (148, 163, 184)
    STATUS_G = (52, 211, 153)

    img  = Image.new("RGB", (W, H), BG_MAIN)
    draw = ImageDraw.Draw(img)

    fd = r"G:\Hammer Street\weather"
    try:
        f_day   = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),    110)
        f_hero  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     72)
        f_temp  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),    130)
        f_cond  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     38)
        f_stat  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     38)
        f_lbl   = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  20)
        f_body  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     36)
        f_sm    = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  22)
        f_xs    = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  18)
        f_brand = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Bold.ttf"),     32)
        f_spon  = ImageFont.truetype(os.path.join(fd, "AtkinsonHyperlegible-Regular.ttf"),  24)
    except Exception as e:
        log.error("Font load failed: %s", e)
        return None

    def cx(text, font, y, fill=TEXT_W):
        bb = draw.textbbox((0, 0), text, font=font)
        draw.text(((W - (bb[2] - bb[0])) // 2, y), text, font=font, fill=fill)

    def hbar(y, color=None, x=0, width=W, h=4):
        draw.rectangle([(x, y), (x + width, y + h)], fill=color or ACCENT)

    # ── TOP STRIPE ──────────────────────────────────────────────────────────
    hbar(0, ACCENT, h=6)

    # ── IDENTITY BAR (y 6–104) ──────────────────────────────────────────────
    try:
        logo = Image.open(ICON_PATH).convert("RGBA")
        lh = 52; lw = int(lh * logo.width / logo.height)
        logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
        img.paste(logo, (56, 26), logo)
        draw.text((56 + lw + 14, 39), "HAMMER STREET CLEAN", font=f_sm, fill=TEXT_S)
    except Exception:
        draw.text((56, 39), "HAMMER STREET CLEAN", font=f_sm, fill=TEXT_S)

    loc = "HAMILTON, ON"
    bb = draw.textbbox((0, 0), loc, font=f_sm)
    draw.text((W - 56 - (bb[2] - bb[0]), 39), loc, font=f_sm, fill=TEXT_S)

    hbar(100, (38, 58, 82), h=2)

    # ── HEADLINE (y 104–354) ─────────────────────────────────────────────────
    cx("SPONSOR", f_day, 106, TEXT_W)
    cx("OUR WEATHER", f_hero, 228, ACCENT)
    cx("Daily weather · Local reach · No contract", f_sm, 314, TEXT_S)

    hbar(346, ACCENT, (W - 160) // 2, 160, 3)

    # ── PRICE HERO (y 356–650) ───────────────────────────────────────────────
    cx("$5", f_temp, 370, TEXT_W)
    cx("PER MONTH", f_cond, 514, ACCENT)

    # ── STATS BAND (y 698–840) ───────────────────────────────────────────────
    draw.rectangle([(0, 698), (W, 840)], fill=BG_DARK)
    hbar(698, ACCENT, h=3)

    stats = [
        ("REACH",   "Local"),
        ("CADENCE", "Daily"),
        ("TERM",    "None"),
        ("CANCEL",  "Anytime"),
    ]
    col_w = W // 4
    for i, (label, value) in enumerate(stats):
        mid = col_w * i + col_w // 2
        bb_v = draw.textbbox((0, 0), value, font=f_stat)
        draw.text((mid - (bb_v[2] - bb_v[0]) // 2, 714), value, font=f_stat, fill=TEXT_W)
        bb_l = draw.textbbox((0, 0), label, font=f_lbl)
        draw.text((mid - (bb_l[2] - bb_l[0]) // 2, 772), label, font=f_lbl, fill=ACCENT)

    for i in range(1, 4):
        draw.rectangle([(col_w * i, 714), (col_w * i + 1, 826)], fill=(30, 52, 76))

    # ── REACH CARD (y 848–1044) ──────────────────────────────────────────────
    draw.rounded_rectangle([(56, 848), (W - 56, 1044)], radius=16, fill=BG_CARD)

    sec_lbl = "WHERE WE REACH"
    bb_l = draw.textbbox((0, 0), sec_lbl, font=f_xs)
    draw.text(((W - (bb_l[2] - bb_l[0])) // 2, 866), sec_lbl, font=f_xs, fill=ACCENT)
    hbar(892, ACCENT, (W - 140) // 2, 140, 2)

    reach_lines = [
        "Hamilton · Burlington",
        "Brantford · Paris · Niagara",
    ]
    line_h = 50
    block_h = len(reach_lines) * line_h
    text_y = 904 + max(0, (130 - block_h) // 2)
    for i, ln in enumerate(reach_lines):
        cx(ln, f_body, text_y + i * line_h, TEXT_W)

    # ── CTA PILL (y 1056–1104) ───────────────────────────────────────────────
    pill_label = "DM TO GET STARTED"
    bb_p = draw.textbbox((0, 0), pill_label, font=f_sm)
    pw = bb_p[2] - bb_p[0] + 64
    ph = 40
    px = (W - pw) // 2
    draw.rounded_rectangle([(px, 1058), (px + pw, 1058 + ph)], radius=20,
                            fill=(12, 36, 26), outline=STATUS_G, width=2)
    draw.text(((W - (bb_p[2] - bb_p[0])) // 2, 1067), pill_label, font=f_sm, fill=STATUS_G)

    # ── CONTACT (y 1108–1188) ────────────────────────────────────────────────
    cx("hammerstreetclean.org", f_spon, 1120, TEXT_S)
    cx("@hammerstreetclean on Instagram", f_spon, 1150, ACCENT)

    # ── BOTTOM BRANDING BAND (y 1198–1350) ──────────────────────────────────
    draw.rectangle([(0, 1198), (W, H)], fill=BG_DARK)
    hbar(1198, ACCENT, h=4)

    try:
        bl = Image.open(ICON_PATH).convert("RGBA")
        bh = 65; bw = int(bh * bl.width / bl.height)
        bl = bl.resize((bw, bh), Image.Resampling.LANCZOS)
        brand = "HAMMER STREET CLEAN"
        bb_b  = draw.textbbox((0, 0), brand, font=f_brand)
        total_b = bw + 18 + (bb_b[2] - bb_b[0])
        bx = (W - total_b) // 2
        img.paste(bl, (bx, 1222), bl)
        draw.text((bx + bw + 18, 1238), brand, font=f_brand, fill=TEXT_W)
    except Exception:
        cx("HAMMER STREET CLEAN", f_brand, 1238, TEXT_W)

    cx("Keeping Barton Village clean", f_xs, 1308, TEXT_S)

    out = r"G:\Hammer Street\HAMMER_SPONSOR_CARD.png"
    img.save(out, "PNG")
    log.info("Sponsor card saved to %s", out)
    return out

# ========== MAIN ==========

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true", help="Test mode: skip Buffer posting")
    parser.add_argument("--alert-watch", action="store_true", help="Alert monitor: post immediately if a new EC alert is detected")
    parser.add_argument("--fake-alert", type=str, help="Test alert-watch with a fake alert (e.g., 'ORANGE WARNING - High winds')")
    parser.add_argument("--force-monday", action="store_true", help="Force Monday sponsor branding for testing")
    parser.add_argument("--force-friday", action="store_true", help="Force Friday Fizz branding for testing")
    parser.add_argument("--force-saturday", action="store_true", help="Force Saturday Scoop2 branding for testing")
    parser.add_argument("--force-slot-event", action="store_true", help="Force Barton BASH slot event for testing")
    parser.add_argument("--instagram-only", action="store_true", help="Post to Instagram only (for testing)")
    parser.add_argument("--force-post", action="store_true", help="Force live posting outside 04:00-06:00 window (for testing)")
    parser.add_argument("--skip-gemini", action="store_true", help="Skip Gemini API call, use placeholder post")
    parser.add_argument("--sponsor-card", action="store_true", help="Generate static sponsor recruitment card and exit")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("Hamilton Weather Post + Image — %s", datetime.now().strftime("%Y-%m-%d %H:%M"))
    log.info("=" * 60)

    if args.sponsor_card:
        out = create_sponsor_card()
        if out:
            log.info("Sponsor card generated: %s", out)
        return

    # Filter channels if testing Instagram only
    global BUFFER_CHANNELS
    if args.instagram_only:
        BUFFER_CHANNELS = [ch for ch in BUFFER_CHANNELS if "instagram" in ch["name"].lower()]
        log.info("Instagram-only mode: posting to %d channel(s)", len(BUFFER_CHANNELS))

    if args.alert_watch:
        log.info("Mode: ALERT WATCH — checking EC alerts feed")
        try:
            events = load_events()
            events.update(fetch_ical_events())
            weather = fetch_weather()

            tasty_tuesdays, tasty_details = load_tasty_tuesdays()
            today_str_tt  = date.today().strftime("%Y-%m-%d")
            tomorrow_str  = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
            tasty_tuesday_today    = today_str_tt in tasty_tuesdays and (weather.get("precip_prob") or 0) <= 50
            tasty_tuesday_tomorrow = tomorrow_str in tasty_tuesdays and (weather.get("tomorrow_precip_prob") or 0) <= 50
            tasty_tuesday_active   = tasty_tuesday_today or tasty_tuesday_tomorrow
            if tasty_tuesday_today:
                events[today_str_tt] = "Tasty Tuesday"
            if tasty_tuesday_tomorrow:
                events[tomorrow_str] = "Tasty Tuesday"

            if args.fake_alert:
                log.info("TEST MODE: Using fake alert: %s", args.fake_alert)
                weather["ec_alert"] = args.fake_alert
                current_alert = args.fake_alert
            else:
                current_alert = weather.get("ec_alert") or ""

            state = {}
            if os.path.exists(ALERT_STATE_PATH):
                with open(ALERT_STATE_PATH, "r") as f:
                    state = json.load(f)

            if not current_alert or "No watches or warnings" in current_alert:
                if state.get("alert_text"):
                    log.info("Alert cleared — resetting alert state")
                    alert_log.info("CLEARED | Previous alert: %s", state.get("alert_text")[:80])
                    with open(ALERT_STATE_PATH, "w") as f:
                        json.dump({}, f)
                else:
                    log.info("No active alert — nothing to post")
                return

            if current_alert == state.get("alert_text") and state.get("posted"):
                posted_at_str = state.get("posted_at")
                if posted_at_str:
                    posted_at = datetime.fromisoformat(posted_at_str)
                    time_since_post = datetime.now() - posted_at
                    hours_since_post = time_since_post.total_seconds() / 3600

                    if hours_since_post < 4:
                        log.info("Alert already posted %.1f hours ago — skipping (%s...)", hours_since_post, current_alert[:60])
                        alert_log.info("SKIPPED | Posted %.1f hours ago | Alert: %s", hours_since_post, current_alert[:80])
                        return
                    else:
                        log.info("Same alert persists after %.1f hours — reposting (%s...)", hours_since_post, current_alert[:60])
                        alert_log.info("REPOST (4h+) | %.1f hours since last post | Alert: %s", hours_since_post, current_alert[:80])
                else:
                    log.info("Alert already posted — skipping (%s...)", current_alert[:60])
                    alert_log.info("SKIPPED | No timestamp | Alert: %s", current_alert[:80])
                    return

            log.info("Alert detected — posting immediately (%s...)", current_alert[:60])
            alert_log.info("POSTED | Alert: %s", current_alert[:80])
            slot_event = (("Barton BASH", "Barton Village Block Party", 1, "@barton_village @bartonfestival") if args.force_slot_event else get_slot_event())
            post = generate_post(weather, events, slot_event=slot_event, tasty_tuesday=tasty_tuesday_active, tasty_details=tasty_details, force_saturday=args.force_saturday)
            short_forecast = generate_short_forecast(weather, events)
            image_path = create_branded_image(short_forecast, weather, force_monday=args.force_monday, force_friday=args.force_friday, force_saturday=args.force_saturday, slot_event=slot_event)
            image_url = upload_image_to_imgbb(image_path) if image_path else None

            if args.test or args.fake_alert:
                log.info("[TEST MODE] Would post to Buffer %d channel(s)", len(BUFFER_CHANNELS))
                posted_ids = [f"test-{i}" for i in range(len(BUFFER_CHANNELS))]
            else:
                posted_ids = send_to_buffer(post, image_url, immediate=True)

            with open(ALERT_STATE_PATH, "w") as f:
                json.dump({
                    "alert_text": current_alert,
                    "posted_at": datetime.now().isoformat(),
                    "posted": True,
                    "buffer_ids": posted_ids,
                }, f, indent=2)
            log.info("Alert post sent to %d channel(s) — state saved", len(posted_ids))
            alert_log.info("SUCCESS | Posted to %d channel(s) | IDs: %s", len(posted_ids), ", ".join(posted_ids))

        except Exception as e:
            log.error("Alert watch failed: %s", e, exc_info=True)
        return

    current_hour = datetime.now().hour
    live_mode = not args.test and (args.force_post or (current_hour == 3 and datetime.now().minute >= 50) or (4 <= current_hour < 6))
    if live_mode:
        if args.force_post:
            log.info("Mode: LIVE (forced) — posting outside window for testing")
        else:
            log.info("Mode: LIVE — within posting window (04:00-06:00)")
    else:
        log.info("Mode: TEST — Buffer will be skipped")

    try:
        events = load_events()
        events.update(fetch_ical_events())
        weather = fetch_weather()

        # Inject Tasty Tuesday (today or tomorrow) if weather permits (≤50% precip)
        tasty_tuesdays, tasty_details = load_tasty_tuesdays()
        today_str_tt  = date.today().strftime("%Y-%m-%d")
        tomorrow_str  = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
        today_precip    = weather.get("precip_prob") or 0
        tomorrow_precip = weather.get("tomorrow_precip_prob") or 0

        tasty_tuesday_today    = today_str_tt in tasty_tuesdays and today_precip <= 50
        tasty_tuesday_tomorrow = tomorrow_str in tasty_tuesdays and tomorrow_precip <= 50
        tasty_tuesday_active   = tasty_tuesday_today or tasty_tuesday_tomorrow

        if tasty_tuesday_today:
            events[today_str_tt] = "Tasty Tuesday"
            log.info("Tasty Tuesday TODAY (%s) — precip %d%% ✓", today_str_tt, today_precip)
        elif today_str_tt in tasty_tuesdays:
            log.info("Tasty Tuesday TODAY (%s) — precip %d%% > 50%% — suppressed", today_str_tt, today_precip)

        if tasty_tuesday_tomorrow:
            events[tomorrow_str] = "Tasty Tuesday"
            log.info("Tasty Tuesday tomorrow (%s) — precip %d%% ✓", tomorrow_str, tomorrow_precip)
        elif tomorrow_str in tasty_tuesdays:
            log.info("Tasty Tuesday tomorrow (%s) — precip %d%% > 50%% — suppressed", tomorrow_str, tomorrow_precip)

        slot_event = (("Barton BASH", "Barton Village Block Party", 1, "@barton_village @bartonfestival") if args.force_slot_event else get_slot_event())
        if args.skip_gemini:
            om_available = weather.get('desc') is not None
            if om_available:
                post = f"{weather['desc']} in The Hammer today. High {weather['max_temp']}°C, {weather['precip_prob']}% chance of rain. Streets are getting cleaned regardless. #HamOnt #HammerStreetClean"
            else:
                ec_text = weather.get("ec_forecast") or "Variable conditions in Hamilton."
                post = f"Hamilton weather: {ec_text[:120]} Streets are getting cleaned regardless. #HamOnt #HammerStreetClean"
            log.info("Skipping Gemini API — using template fallback")
        else:
            post = generate_post(weather, events, slot_event=slot_event, tasty_tuesday=tasty_tuesday_active, tasty_details=tasty_details, force_saturday=args.force_saturday)
        short_forecast = generate_short_forecast(weather, events)
        log.info("Short forecast: %s", short_forecast)

        alert_text = weather.get("ec_alert") or ""
        alert_level = detect_alert_level(alert_text)
        immediate_post = alert_level is not None

        if immediate_post:
            log.info("Alert detected (%s) — posting immediately", alert_level)

        slot_event = (("Barton BASH", "Barton Village Block Party", 1, "@barton_village @bartonfestival") if args.force_slot_event else get_slot_event())
        image_path = create_branded_image(short_forecast, weather, force_monday=args.force_monday, force_friday=args.force_friday, force_saturday=args.force_saturday, slot_event=slot_event)

        if live_mode:
            # Upload image to imgbb if it was created
            image_url = None
            if image_path:
                image_url = upload_image_to_imgbb(image_path)

            posted_ids = send_to_buffer(post, image_url, immediate=immediate_post)
            log.info("Done! Posted to %d channel(s)", len(posted_ids))
        else:
            log.info("[TEST MODE] Generated post: %s", post)
            log.info("[TEST MODE] Short forecast: %s", short_forecast)
            if image_path:
                log.info("[TEST MODE] Image created at %s", image_path)
                # Test the imgbb upload
                test_url = upload_image_to_imgbb(image_path)
                if test_url:
                    log.info("[TEST MODE] Image would upload to: %s", test_url)
            log.info("[TEST MODE] Buffer send skipped — run between 04:00-06:00 to post live")

    except Exception as e:
        log.error("Failed: %s", e, exc_info=True)
        raise

if __name__ == "__main__":
    main()