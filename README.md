# AgreeCrop — Crop Health & Pest Management

> Farmer- and extension-worker-friendly crop-health system for timely detection, forecasting and management support.

## Problem
Farmers recognise crop diseases / pest infestations only after visible damage spreads. Extension staff cover large areas; lab diagnosis and expert advice are not immediately available. Weather, crop stage, variety, soil condition and local pest history influence risk, but these inputs are rarely combined into actionable farm-level alerts. Incorrect diagnosis leads to delayed treatment, excessive pesticide use, increased cost, residue concerns and yield loss.

## Solution
Image-based symptom identification + pest-trap / sensor inputs + weather-based risk forecasting + geospatial hotspot mapping + expert validation + multilingual advisories. Integrated pest and disease management recommendations, safe input usage guidance, referrals to extension / labs, and follow-up monitoring. Learns from field confirmations; dashboards for agriculture officials.

## Expected Outcomes
Earlier detection, reduced crop loss, more targeted pesticide use, faster extension response, improved surveillance coverage, better planning of preventive interventions.

## Stack
- Backend: Python / FastAPI (advisories, crop-health, pest-id, weather-risk, geospatial, auth)
- Frontend: React / Vite (multilingual UI, dashboards, map views, advisory panels)
- Models: YOLO / ML weights excluded from repo (`backend/models/`)
- Data / seeds excluded (`backend/data/`); configure locally

## Quick Start
```bash
# Backend
cd backend
cp .env.example .env  # add your DB/API secrets (never commit)
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run dev
```

## Project Structure
```
backend/     API, models (pt files excluded), DB migrations, routers
frontend/    React src, i18n (hi/mr/en), components, pages
```

## Production Notes
- `.gitignore` excludes `.env`, `*.pt`, `__pycache__/`, `.venv/`, test files, large media, caches
- Commits include `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- PR descriptions include `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

## License
MIT (or your org license — update accordingly)
