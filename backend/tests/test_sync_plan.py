"""Tests for the sync planner: per-dataset source mapping and step counts."""

from backend.src.terna_backend.constants import (
    GENERATION_PLANT_SOURCES,
    INSTALLED_CAPACITY_TYPES,
    RENEWABLE_SOURCES,
)
from backend.src.terna_backend.schemas import SyncRequest
from backend.src.terna_backend.sync import build_plan


def test_plan_counts_match_execution() -> None:
    req = SyncRequest(
        years=[2023, 2024],
        datasets=["renewable_source_capacity"],
        sources=["Fotovoltaico", "Eolico"],
        capacity_types=["Lorda", "Netta"],
    )
    steps, dropped = build_plan(req)
    assert dropped == 0
    assert len(steps) == 2 * 2 * 2  # years * sources * captypes


def test_generation_plants_drops_bioenergie() -> None:
    req = SyncRequest(
        years=[2024],
        datasets=["generation_plants"],
        sources=["Fotovoltaico", "Bioenergie"],
        capacity_types=["Lorda"],
    )
    steps, dropped = build_plan(req)
    assert {s.source for s in steps} <= set(GENERATION_PLANT_SOURCES)
    assert "Bioenergie" not in {s.source for s in steps}
    assert dropped == 1  # one invalid combination, not a failure


def test_full_download_plan_size_is_small() -> None:
    req = SyncRequest(
        years=list(range(2018, 2025)),
        datasets=[
            "renewable_source_capacity",
            "generation_plants",
            "installed_capacity",
            "thermoelectric_capacity",
        ],
        sources=list(dict.fromkeys(RENEWABLE_SOURCES + ["Termoelettrico"])),
        capacity_types=["Lorda", "Netta"],
    )
    steps, _ = build_plan(req)
    n_years = 7
    expected = (
        n_years * len(RENEWABLE_SOURCES) * 2
        + n_years * len(GENERATION_PLANT_SOURCES) * 2
        + n_years * len(INSTALLED_CAPACITY_TYPES)
        + n_years * 2
    )
    assert len(steps) == expected
    assert len(steps) < 300  # a few minutes at ~1s pacing
