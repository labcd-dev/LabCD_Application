# LabCD

AI-assisted **control-system design** platform. Upload MATLAB (`.m`) or Python (`.py`) plant dynamics, regularize the code, then run either a **single-loop (SILO)** or **multi-loop (MULO)** design pipeline.

**Current stack:** FastAPI + React + PostgreSQL (Docker Compose).  
**Legacy stack:** Streamlit UI under `frontend_streamlit/` (still runnable; not the primary path).

---

## Quick start (Docker)

Requires Docker Desktop (or Docker Engine + Compose) and API keys for the LLM providers you use.

```bash
cp .env.example .env
# Edit .env — set at least one provider key and change JWT_SECRET / ADMIN_PASSWORD

docker compose up --build
```

| Service   | URL                         |
|-----------|-----------------------------|
| Frontend  | http://localhost:5173       |
| API docs  | http://localhost:8000/docs  |
| Postgres  | localhost:5432 (from `.env`)|

Default admin (from `.env`): `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Stop:

```bash
docker compose down
```

---

## Local development

### 1. Environment

```bash
cp .env.example .env
# Fill API keys + JWT_SECRET
```

### 2. Database

Start Postgres only (recommended):

```bash
docker compose up db -d
```

`DATABASE_URL` in `.env` should point at `localhost` when the API runs on the host.

### 3. Python API

Python **3.11+** recommended.

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn backend_api.http.main:app --reload --host 0.0.0.0 --port 8000
```

API: http://localhost:8000  
OpenAPI: http://localhost:8000/docs

### 4. React frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Dev server: http://localhost:5173  
Vite proxies `/api` → `http://localhost:8000` (long timeouts for SSE design jobs).

---

## Project layout

```
LabCD-Phase-1-31/
├── backend_api/           # ★ Primary backend (FastAPI + pipeline code used by API)
│   ├── http/              # HTTP layer only — thin routers, schemas, services
│   │   ├── routers/       # Route handlers (no heavy business logic)
│   │   ├── schemas/       # Pydantic request/response models
│   │   ├── services/      # Orchestration: jobs, auth, projects, calls into pipelines
│   │   ├── config.py      # Env-based settings
│   │   └── main.py        # FastAPI app entry
│   ├── db/                # SQLAlchemy models + session
│   ├── Regularizer/       # MATLAB→Python, syntax fix, standardize
│   ├── Recommender/       # Multi-loop architecture recommendation (LangGraph)
│   ├── Trimmer/           # Equilibrium / trim + HITL
│   ├── SiloDesigner/      # Single-loop controller design
│   ├── MuloDesigner/      # Multi-loop cascade + GA
│   └── common/            # Shared helpers (e.g. serialization)
├── backend_core/          # Original pipeline modules (Streamlit-era reference)
├── frontend/              # ★ React + Vite + Tailwind UI
│   └── src/
│       ├── api/           # HTTP client, endpoints, types, SSE
│       ├── pages/         # Route screens
│       ├── components/    # Presentational UI
│       ├── context/       # Auth, theme, pipeline session state
│       ├── hooks/         # Job streaming / polling
│       └── lib/           # Pure helpers / parsers (no server calls for business rules)
├── frontend_streamlit/    # Legacy Streamlit UI
├── case_studies/          # Reference plant models (m/ + py/)
├── Test/                  # Pytest (mainly Regularizer)
├── assets/                # Static assets (logo)
├── uploads/               # Runtime uploads (gitignored; .gitkeep only)
├── results/               # Runtime artifacts (gitignored; .gitkeep only)
├── docker-compose.yml     # db + api + frontend
├── Dockerfile.api         # FastAPI image
├── Dockerfile             # Legacy Streamlit image
├── requirements.txt       # Python dependencies
├── .env.example           # Template for secrets / ports
└── AGENTS.md              # Coding rules for contributors / agents
```

---

## Where business logic lives

**Rule:** never put design/optimization/LLM orchestration logic in React. The UI calls the API; the API owns behavior.

| Concern | Location | Notes |
|---------|----------|--------|
| HTTP routes | `backend_api/http/routers/` | Validate input, call a service, return schema |
| Request/response shapes | `backend_api/http/schemas/` | Pydantic models |
| Job orchestration, auth, projects | `backend_api/http/services/` | Starts workers, HITL resume, DB updates |
| Persistence | `backend_api/db/` | Users, projects, permissions |
| Regularize / recommend / trim / SILO / MULO | `backend_api/{Regularizer,Recommender,Trimmer,SiloDesigner,MuloDesigner}/` | Core algorithms, LangGraph graphs, GA, simulation |
| Shared serialization | `backend_api/common/` | Cross-module helpers |
| UI only | `frontend/src/` | Rendering, forms, streaming display |
| Legacy reference | `backend_core/`, `frontend_streamlit/` | Prefer `backend_api` + `frontend` for new work |

### Pipelines

**Shared preprocess**

```
Upload → Regularizer (syntax / MATLAB→Python / standardize)
```

**SILO (single loop)**

```
Regularizer → SiloDesigner
```

**MULO (multi loop)**

```
Regularizer → Recommender → Trimmer → MuloDesigner (GA)
```

Frontend routes map roughly to stages: `/` (upload + pipeline choice), `/recommender`, `/trimmer`, `/silo`, `/mulo`, plus `/projects`, `/profile`, and `/admin/*`.

---

## Development guide

### Adding or changing an API feature

1. Put domain logic in the relevant `backend_api/<Module>/` package (or extend an existing service).
2. Expose it from `backend_api/http/services/<name>_service.py`.
3. Add/adjust Pydantic models in `schemas/`.
4. Wire a thin handler in `routers/` and register it in `http/main.py` if new.
5. Update `frontend/src/api/endpoints.ts` + `types.ts`, then the page/component.

### Frontend conventions

- Use `frontend/src/api/` for all network I/O.
- Keep pages/components free of design math, LLM prompts, and GA config defaults that belong on the server.
- Long-running jobs use SSE (`hooks/useJobStream.ts` + API job endpoints).

### Environment variables

See `.env.example`. Important ones:

| Variable | Purpose |
|----------|---------|
| `*_API_KEY` | LLM / search providers |
| `DATABASE_URL` | Postgres connection |
| `JWT_SECRET` | Auth signing key |
| `CORS_ORIGINS` | Allowed frontend origins |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | SQLAlchemy pool (defaults 10 / 20) |
| `API_THREAD_LIMIT` | Sync route threadpool size (default 64) |
| `RESULTS_DIR` / `UPLOADS_DIR` | Artifact paths |
| `VITE_API_BASE_URL` | Frontend API base (`frontend/.env`) |

Never commit `.env` (ignored). Commit only `.env.example`.

### Tests

```bash
# from repo root, with venv active
pytest Test/
```

### Coding rules

See [AGENTS.md](./AGENTS.md): keep functions small, avoid duplication, use env vars, preserve original pipeline behavior when migrating.

---

## Legacy Streamlit

```bash
# with venv + deps installed
streamlit run frontend_streamlit/home_page.py

# or Docker (legacy single-container image)
docker build -t labcd-streamlit -f Dockerfile .
docker run --env-file .env -p 8501:8501 labcd-streamlit
```

The GitHub Action under `.github/workflows/deploy.yml` still targets this Streamlit image. Prefer `docker compose` for the FastAPI + React stack until that workflow is updated.

---

## Team checklist before push

- [ ] No secrets in the diff (`.env`, keys, passwords)
- [ ] No user uploads / results / avatars committed
- [ ] New runtime dirs use `.gitkeep` if needed
- [ ] API changes reflected in OpenAPI (`/docs`) and frontend types
- [ ] Business logic stays in `backend_api`, not React

---

## License

See [LICENSE](./LICENSE).
