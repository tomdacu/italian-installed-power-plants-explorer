from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable

from .constants import (
    CAPACITY_TYPES,
    DATASET_SOURCES,
    DEFAULT_CAPACITY_TYPE,
    INSTALLED_CAPACITY_TYPES,
    SYNCABLE_DATASETS,
)
from .normalize import (
    generation_plants_rows,
    installed_capacity_rows,
    renewable_source_capacity_rows,
    thermoelectric_capacity_rows,
)
from .schemas import SyncJobStatus, SyncRequest
from .storage import CapacityStore
from .terna_client import TernaClient

MAX_REPORTED_ERRORS = 3


@dataclass
class SyncStep:
    """One fetch+store unit. Unused slots stay None depending on the dataset."""

    label: str
    dataset: str
    year: int
    source: str | None = None
    capacity_type: str | None = None
    installed_type: str | None = None


@dataclass
class JobState:
    job_id: str
    status: str
    total_steps: int
    completed_steps: int
    message: str
    error: str | None = None
    failed_steps: int = 0
    empty_steps: int = 0
    step_errors: list[str] = field(default_factory=list)


def _effective_combos(
    requested_sources: list[str], requested_captypes: list[str], valid_sources: list[str]
) -> tuple[list[str], list[str], int]:
    """Intersect a request with what the API accepts.

    Terna answers invalid values with an empty body (no error), so querying
    them would only produce noise. Returns (sources, captypes, dropped) where
    `dropped` counts the requested combinations no dataset accepts — reported
    as `empty_steps`, never as failures.
    """
    req_src = requested_sources or valid_sources
    req_cap = requested_captypes or CAPACITY_TYPES
    kept_src = [s for s in req_src if s in valid_sources]
    kept_cap = [c for c in req_cap if c in CAPACITY_TYPES]
    dropped = len(req_src) * len(req_cap) - len(kept_src) * len(kept_cap)
    return kept_src, kept_cap, dropped


def build_plan(request: SyncRequest) -> tuple[list[SyncStep], int]:
    """Expand a sync request into executable steps.

    Building the plan first guarantees the progress total always matches the
    executed steps. Returns (steps, dropped).
    """
    steps: list[SyncStep] = []
    dropped = 0
    datasets = [d for d in request.datasets if d in SYNCABLE_DATASETS]

    for year in request.years:
        if "renewable_source_capacity" in datasets:
            sources, captypes, skip = _effective_combos(
                request.sources, request.capacity_types, DATASET_SOURCES["renewable_source_capacity"]
            )
            dropped += skip
            for source in sources:
                for capacity_type in captypes:
                    steps.append(
                        SyncStep(
                            label=f"Renewable capacity {year} {source} {capacity_type}",
                            dataset="renewable_source_capacity",
                            year=year,
                            source=source,
                            capacity_type=capacity_type,
                        )
                    )

        if "generation_plants" in datasets:
            sources, captypes, skip = _effective_combos(
                request.sources, request.capacity_types, DATASET_SOURCES["generation_plants"]
            )
            dropped += skip
            for source in sources:
                for capacity_type in captypes:
                    steps.append(
                        SyncStep(
                            label=f"Generation plants {year} {source} {capacity_type}",
                            dataset="generation_plants",
                            year=year,
                            source=source,
                            capacity_type=capacity_type,
                        )
                    )

        if "installed_capacity" in datasets:
            for installed_type in INSTALLED_CAPACITY_TYPES:
                steps.append(
                    SyncStep(
                        label=f"Installed capacity {year} {installed_type}",
                        dataset="installed_capacity",
                        year=year,
                        installed_type=installed_type,
                    )
                )

        if "thermoelectric_capacity" in datasets or request.include_thermoelectric:
            # Sources are meaningless for thermoelectric: only the capacity
            # types matter, invalid ones count as dropped.
            req_cap = request.capacity_types or CAPACITY_TYPES
            captypes = [c for c in req_cap if c in CAPACITY_TYPES]
            dropped += len(req_cap) - len(captypes)
            for capacity_type in captypes:
                steps.append(
                    SyncStep(
                        label=f"Thermoelectric capacity {year} {capacity_type}",
                        dataset="thermoelectric_capacity",
                        year=year,
                        capacity_type=capacity_type,
                    )
                )

    return steps, dropped


class SyncManager:
    def __init__(self, store: CapacityStore, client_factory) -> None:
        self.store = store
        self.client_factory = client_factory
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.jobs: dict[str, JobState] = {}
        self.lock = Lock()

    def start(self, request: SyncRequest) -> str:
        job_id = str(uuid.uuid4())
        steps, dropped = build_plan(request)
        with self.lock:
            self.jobs[job_id] = JobState(job_id, "queued", len(steps), 0, "Queued", empty_steps=dropped)
        self.executor.submit(self._run, job_id, request, steps)
        return job_id

    def status(self, job_id: str) -> SyncJobStatus | None:
        with self.lock:
            state = self.jobs.get(job_id)
            if not state:
                return None
            return SyncJobStatus(**{k: v for k, v in state.__dict__.items() if k != "step_errors"})

    def _run(self, job_id: str, request: SyncRequest, steps: list[SyncStep]) -> None:
        self._update(job_id, status="running", message="Connecting to Terna")
        try:
            client: TernaClient = self.client_factory()
            for step in steps:
                self._update(job_id, message=step.label)
                self._run_step(job_id, client, step)
            self._finalize(job_id)
        except Exception as exc:  # unexpected, fail the job outright
            self._update(job_id, status="failed", message="Sync failed", error=str(exc))

    def _run_step(self, job_id: str, client: TernaClient, step: SyncStep) -> None:
        """Run one fetch+store step; failures and empty payloads are recorded
        and the sync continues with the next step."""
        fetch, normalize = self._step_call(client, step)
        try:
            payload = fetch()
            stored = self.store.upsert_records(normalize(payload))
            with self.lock:
                state = self.jobs[job_id]
                state.completed_steps += 1
                if stored == 0:
                    state.empty_steps += 1
        except Exception as exc:
            self._record_step_failure(job_id, f"{step.label}: {exc}")

    def _step_call(
        self, client: TernaClient, step: SyncStep
    ) -> tuple[Callable[[], dict[str, Any]], Callable[[dict[str, Any]], list[dict[str, Any]]]]:
        if step.dataset == "renewable_source_capacity":
            return (
                lambda: client.renewable_source_capacity(
                    year=step.year, source=step.source, capacity_type=step.capacity_type
                ),
                renewable_source_capacity_rows,
            )
        if step.dataset == "generation_plants":
            return (
                lambda: client.generation_plants(
                    year=step.year, source=step.source, capacity_type=step.capacity_type
                ),
                generation_plants_rows,
            )
        if step.dataset == "installed_capacity":
            return (
                lambda: client.installed_capacity(year=step.year, type=step.installed_type),
                installed_capacity_rows,
            )
        return (
            lambda: client.thermoelectric_capacity(year=step.year, capacity_type=step.capacity_type),
            thermoelectric_capacity_rows,
        )

    def _finalize(self, job_id: str) -> None:
        with self.lock:
            state = self.jobs[job_id]
            failed = state.failed_steps
            total = state.total_steps
            errors = list(state.step_errors)
        if failed == 0:
            self._update(job_id, status="completed", message="Sync completed", error=None)
        elif failed >= total and total > 0:
            self._update(
                job_id,
                status="failed",
                message="Sync failed",
                error="; ".join(errors) if errors else "Every step failed",
            )
        else:
            summary = f"Completed with {failed} skipped step{'s' if failed != 1 else ''}"
            if errors:
                summary = f"{summary} — {'; '.join(errors)}"
            self._update(
                job_id,
                status="completed",
                message=summary,
                error="; ".join(errors) if errors else None,
            )

    def _update(self, job_id: str, **changes) -> None:
        with self.lock:
            state = self.jobs[job_id]
            for key, value in changes.items():
                setattr(state, key, value)

    def _record_step_failure(self, job_id: str, error: str) -> None:
        with self.lock:
            state = self.jobs[job_id]
            state.failed_steps += 1
            # Count the step as "done" for progress purposes: it will not be retried.
            state.completed_steps += 1
            if len(state.step_errors) < MAX_REPORTED_ERRORS:
                state.step_errors.append(error)

    @staticmethod
    def default_capacity_type() -> str:
        return DEFAULT_CAPACITY_TYPE
