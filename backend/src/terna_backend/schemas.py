from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DatasetName = Literal[
    "renewable_source_capacity",
    "generation_plants",
    "installed_capacity",
    "thermoelectric_capacity",
]

#: Single-column group-bys. Compound group-bys are expressed as a
#: comma-separated list (e.g. "year,source") and validated by
#: `storage.parse_group_by`, which also accepts the legacy "+" separator.
GroupBy = Literal[
    "year",
    "region",
    "province",
    "source",
    "capacity_type",
    "category",
    "subcategory",
    "type",
    "year,source",
    "year,type",
    "year,region",
    "year,province",
    "year,capacity_type",
]


class CredentialPayload(BaseModel):
    client_id: str = Field(min_length=1)
    client_secret: str = Field(min_length=1)


class CredentialStatus(BaseModel):
    configured: bool
    client_id_suffix: str | None = None


class SyncRequest(BaseModel):
    years: list[int] = Field(min_length=1)
    datasets: list[DatasetName] = Field(default_factory=lambda: ["renewable_source_capacity"])
    sources: list[str] = Field(default_factory=list)
    capacity_types: list[str] = Field(default_factory=lambda: ["Lorda", "Netta"])
    include_thermoelectric: bool = False


class SyncJobResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "completed", "failed"]


class SyncJobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "running", "completed", "failed"]
    total_steps: int
    completed_steps: int
    message: str
    error: str | None = None
    failed_steps: int = 0
    #: Steps that returned no rows (future years with no data yet, or
    #: source/dataset combinations the API has nothing for). Not failures:
    #: already downloaded data is safe.
    empty_steps: int = 0


class RecordFilters(BaseModel):
    dataset: DatasetName | None = None
    year_from: int | None = None
    year_to: int | None = None
    region: str | None = None
    province: str | None = None
    source: str | None = None
    capacity_type: str | None = None
    category: str | None = None
    subcategory: str | None = None
    type: str | None = None


class CapacityRecord(BaseModel):
    dataset: str
    year: int
    capacity_type: str | None = None
    region: str | None = None
    province: str | None = None
    source: str | None = None
    category: str | None = None
    subcategory: str | None = None
    type: str | None = None
    efficient_power_mw: float | None = None
    installed_capacity_gw: float | None = None
    fetched_at: str


class SummaryResponse(BaseModel):
    row_count: int
    total_efficient_power_mw: float | None
    total_installed_capacity_gw: float | None
    year_min: int | None
    year_max: int | None
    #: Stock semantics (no multi-year sums, single capacity index):
    #: totals refer to the latest year in the filtered selection.
    latest_year: int | None = None
    latest_total_efficient_power_mw: float | None = None
    latest_total_installed_capacity_gw: float | None = None
    previous_year: int | None = None
    previous_total_efficient_power_mw: float | None = None
    #: Year-on-year new additions (latest - previous) in the primary unit.
    yoy_new_mw: float | None = None
    yoy_new_gw: float | None = None
    yoy_pct: float | None = None
    #: Capacity type the latest MW totals were computed with ("Lorda" default
    #: when the caller did not pick one; None for the GW dataset).
    capacity_type_applied: str | None = None


class AggregatePoint(BaseModel):
    year: int | None = None
    region: str | None = None
    province: str | None = None
    source: str | None = None
    capacity_type: str | None = None
    category: str | None = None
    subcategory: str | None = None
    type: str | None = None
    efficient_power_mw: float | None = None
    installed_capacity_gw: float | None = None
