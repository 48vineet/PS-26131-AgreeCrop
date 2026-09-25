# AgreeCrop — Crop Health & Pest Management System

> Farmer- and extension-worker-friendly crop-health platform for timely detection, forecasting, expert validation and multilingual advisories.

---

## 1. Problem Statement

Farmers often recognise crop diseases or pest infestations only after visible damage has spread. Extension staff may cover large areas, while laboratory diagnosis and expert advice may not be immediately available. Weather, crop stage, variety, soil condition and local pest history influence risk, but these inputs are rarely combined into actionable farm-level alerts.

Incorrect diagnosis may lead to:
- Delayed treatment
- Excessive or inappropriate pesticide use
- Increased cultivation cost
- Residue concerns
- Significant yield loss

The challenge is to provide timely, reliable and locally relevant detection, forecasting and management support.

---

## 2. Expected Solution / Outcome

A farmer- and extension-worker-friendly crop-health system that supports:

- **Image-based symptom identification** (pest / disease photos)
- **Pest-trap or sensor inputs** (monitoring data)
- **Weather-based risk forecasting** (predictive alerts)
- **Geospatial hotspot mapping** (field-level risk visualisation)
- **Expert validation** (human-in-the-loop confirmation)
- **Multilingual advisories** (Hindi, Marathi, English — extendable)

The system should recommend:
- Integrated pest and disease management actions
- Safe input usage guidance
- Referral to extension or laboratories
- Follow-up monitoring

Expected outcomes include:
- Earlier detection
- Reduced crop loss
- More targeted pesticide use
- Faster extension response
- Improved surveillance coverage
- Better planning of preventive interventions

The system should learn from field confirmations (feedback loop) and provide dashboards for agriculture officials.

---

## 3. Project Structure

```
.
├── backend/                  # FastAPI / Python API
│   ├── routers_*.py         # Endpoints (advisories, crop-health, pest, weather, etc.)
│   ├── auth.py              # Authentication / authorization
│   ├── database.py          # DB connection
│   ├── models/              # ML weights (.pt) — excluded from repo
│   ├── data/                # Seed / dataset files — excluded from repo
│   ├── alembic/             # DB migrations
│   ├── requirements.txt     # Python dependencies
│   └── .env.example         # Template for secrets (never commit .env)
│
├── frontend/                 # React / Vite web app
│   ├── src/
│   │   ├── components/      # UI components (cards, maps, panels, inputs)
│   │   ├── pages/           # Route-level pages (Dashboard, FarmDetail, Advisory)
│   │   ├── contexts/        # Auth / Language contexts
│   │   ├── services/        # API clients (supabase, api calls)
│   │   └── i18n/            # Translation files (en, hi, mr)
│   ├── index.html
│   ├── package.json
│   └── .env.example         # Frontend env template
│
├── .gitignore                 # Production exclusions (secrets, caches, ML files)
└── README.md                  # This file
```

---

## 4. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI |
| Database | PostgreSQL / SQLite (alembic migrations) |
| AI / ML | YOLO / custom pest-crop health models (`.pt` weights) |
| Frontend | React 18+, Vite, Tailwind CSS |
| Maps / Geo | Geospatial routing / map components |
| i18n | JSON locale files (en, hi, mr) |
| Auth | Token-based / session auth (`auth.py`) |

---

## 5. Quick Start

### Prerequisites
- Python 3.11+ and `pip`
- Node 18+ and `npm`
- (Optional) PostgreSQL running locally

### Backend
```bash
cd backend
cp .env.example .env       # Fill DB URL, API keys. NEVER commit .env
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py             # Or uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
cp .env.example .env       # API base URL, keys (never commit .env)
npm install
npm run dev                # http://localhost:5173
```

---

## 6. Configuration & Secrets

| File | Purpose | Commit? |
|---|---|---|
| `.env` | Real secrets (DB, API keys) | **NO** |
| `.env.example` | Template / dummy values | **Yes** |
| `backend/data/` | Seed datasets | **NO** (add to `.gitignore`) |
| `backend/models/*.pt` | Trained ML weights | **NO** (add to `.gitignore`) |
| `backend/__pycache__/`, `.venv/` | Cache / virtualenv | **NO** |

The repo `.gitignore` already excludes `.env`, `*.pt`, `*.db`, `__pycache__/`, `.venv/`, `node_modules/`, test caches and large media (`.webm`, `.mp4`).

---

## 7. Production / Deployment Notes

- **No secrets in git history.** Before any public push, rotate any exposed keys and verify with `git log --all -- .env`.
- **ML models** (`backend/models/*.pt`) are excluded; download or build them in CI / release pipeline.
- **Data seeds** (`backend/data/`) excluded; populate via migrations or secure import.
- **Tests / dev files** (`test_*.py`, `clear_user_data.py`, `wipe_user_data.py`, `demo_assets/`, `demo_storyboard.html`, `video_composition.html`) removed from repo; only `backend/` and `frontend/` source kept.
- **Commit attribution:** `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- **Pull request description:** Include `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## 8. Expected Outcomes

- Earlier detection of crop diseases / pests
- Reduced crop loss through targeted intervention
- More targeted pesticide / input usage
- Faster extension staff response via dashboards
- Improved surveillance coverage via geospatial mapping
- Better planning of preventive interventions using weather forecasts

---

## 9. License

MIT — or update with your organisation’s license. See `LICENSE` file (add if required).

---

## 10. Contact / Contributing

- Repo: https://github.com/48vineet/PS-26131-AgreeCrop
- For production deployment, replace `.env` with secure vault / Docker secrets.
- Report issues with reproduction steps, environment (`os`, `python --version`, `node --version`), and whether `.env` is configured.

---

*Built with lazy efficiency: deleted what wasn't needed, reused what existed, kept only production source.*
