from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .constants import (
    CAPACITY_TYPES,
    DATASET_SOURCES,
    DEFAULT_CAPACITY_TYPE,
    GENERATION_PLANT_SOURCES,
    INSTALLED_CAPACITY_TYPES,
    INSTALLED_CAPACITY_YEAR_WINDOW,
    RENEWABLE_SOURCES,
)
from .schemas import (
    AggregatePoint,
    CredentialPayload,
    CredentialStatus,
    RecordFilters,
    SyncJobResponse,
    SyncJobStatus,
    SyncRequest,
)
from .settings import SettingsStore
from .storage import CapacityStore, parse_group_by
from .sync import SyncManager
from .terna_client import TernaApiError, TernaClient

settings_store = SettingsStore()
settings = settings_store.load()
store = CapacityStore(settings.database_path)
store.initialize()


def create_terna_client() -> TernaClient:
    current = settings_store.load()
    client_id = current.client_id
    client_secret = settings_store.get_client_secret(client_id)
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Terna credentials are not configured")
    return TernaClient(client_id=client_id, client_secret=client_secret)


sync_manager = SyncManager(store, create_terna_client)

app = FastAPI(title="Terna Installed Capacity Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def filters_from_query(
    dataset: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    region: str | None = None,
    province: str | None = None,
    source: str | None = None,
    capacity_type: str | None = None,
    category: str | None = None,
    subcategory: str | None = None,
    type: str | None = None,
) -> RecordFilters:
    return RecordFilters(
        dataset=dataset,
        year_from=year_from,
        year_to=year_to,
        region=region,
        province=province,
        source=source,
        capacity_type=capacity_type,
        category=category,
        subcategory=subcategory,
        type=type,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/settings/credentials/status", response_model=CredentialStatus)
def credential_status() -> CredentialStatus:
    current = settings_store.load()
    suffix = None
    if current.client_id:
        suffix = current.client_id[-4:].rjust(len(current.client_id), "*")
    return CredentialStatus(configured=settings_store.has_credentials(), client_id_suffix=suffix)


@app.post("/settings/credentials", response_model=CredentialStatus)
def save_credentials(payload: CredentialPayload) -> CredentialStatus:
    settings_store.save_credentials(payload.client_id, payload.client_secret)
    return credential_status()


@app.delete("/settings/credentials", response_model=CredentialStatus)
def delete_credentials() -> CredentialStatus:
    settings_store.delete_credentials()
    return credential_status()


@app.post("/settings/credentials/test")
def test_credentials() -> dict[str, bool]:
    try:
        client = create_terna_client()
        return {"ok": client.test_credentials()}
    except TernaApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/sync/jobs", response_model=SyncJobResponse)
def start_sync(request: SyncRequest) -> SyncJobResponse:
    job_id = sync_manager.start(request)
    return SyncJobResponse(job_id=job_id, status="queued")


@app.get("/sync/jobs/{job_id}", response_model=SyncJobStatus)
def get_sync_status(job_id: str) -> SyncJobStatus:
    status = sync_manager.status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Sync job not found")
    return status


@app.get("/metadata/options")
def metadata_options() -> dict[str, object]:
    db_options = store.options()
    return {
        "known_sources": RENEWABLE_SOURCES,
        "known_generation_plant_sources": GENERATION_PLANT_SOURCES,
        "known_installed_capacity_types": INSTALLED_CAPACITY_TYPES,
        "known_capacity_types": CAPACITY_TYPES,
        # Canonical lists so the frontend never hardcodes domain values:
        # valid sources per dataset, default single capacity index, and the
        # year window the /installed-capacity endpoint serves.
        "dataset_sources": DATASET_SOURCES,
        "default_capacity_type": DEFAULT_CAPACITY_TYPE,
        "installed_capacity_year_window": INSTALLED_CAPACITY_YEAR_WINDOW,
        "database": db_options,
    }


@app.get("/metadata/availability")
def metadata_availability() -> dict[str, object]:
    """What is actually stored, per dataset and year (row counts, sources and
    capacity types present). Powers the sync page and year pickers."""
    return store.availability()


@app.get("/records")
def records(
    filters: RecordFilters = Depends(filters_from_query),
    limit: int = Query(default=5000, ge=1, le=100000),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, object]]:
    return store.records(filters, limit=limit, offset=offset)


@app.get("/analytics/summary")
def summary(filters: RecordFilters = Depends(filters_from_query)) -> dict[str, object]:
    return store.summary(filters)


@app.get("/analytics/timeseries", response_model=list[AggregatePoint])
def timeseries(
    group_by: str = "year",
    latest_only: bool = False,
    filters: RecordFilters = Depends(filters_from_query),
) -> list[dict[str, object]]:
    """Aggregate sums grouped by one column ("source") or several
    ("year,source"). With `latest_only=true` rows are restricted to the
    latest year in the selection — for by-source / by-region stock charts so
    multi-year ranges never sum stocks of different years."""
    try:
        parse_group_by(group_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return store.aggregate(filters, group_by, latest_only=latest_only)


@app.get("/export/csv")
def export_csv(filters: RecordFilters = Depends(filters_from_query)) -> Response:
    csv_data = store.to_csv(filters)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="terna-installed-capacity.csv"'},
    )
