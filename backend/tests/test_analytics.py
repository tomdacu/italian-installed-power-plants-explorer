"""Tests for compound aggregation, latest-only stock queries and the
single-index summary semantics."""

from backend.src.terna_backend.schemas import RecordFilters
from backend.src.terna_backend.storage import CapacityStore, parse_group_by


def _seed(store: CapacityStore) -> None:
    rows = []
    # Two years, two sources, both capacity types. Lorda 2023: FV 10 + EO 20.
    # Lorda 2024: FV 15 + EO 25. Netta mirrors Lorda (same values).
    for year, fv, eo in ((2023, 10.0, 20.0), (2024, 15.0, 25.0)):
        for source, mw in (("Fotovoltaico", fv), ("Eolico", eo)):
            for cap in ("Lorda", "Netta"):
                rows.append(
                    {
                        "dataset": "renewable_source_capacity",
                        "year": year,
                        "capacity_type": cap,
                        "region": "Lombardia",
                        "province": "Milano",
                        "source": source,
                        "category": None,
                        "subcategory": None,
                        "type": None,
                        "efficient_power_mw": mw,
                        "installed_capacity_gw": None,
                        "fetched_at": "2026-01-01T00:00:00+00:00",
                    }
                )
    store.upsert_records(rows)


def test_parse_group_by_compound_and_legacy_plus(tmp_path) -> None:
    assert parse_group_by("year,source") == ["year", "source"]
    assert parse_group_by("year+source") == ["year", "source"]
    assert parse_group_by("source") == ["source"]
    try:
        parse_group_by("year; DROP TABLE x")
    except ValueError:
        pass
    else:
        raise AssertionError("SQL injection attempt must be rejected")


def test_compound_aggregate_returns_named_sources(tmp_path) -> None:
    store = CapacityStore(tmp_path / "c.sqlite")
    store.initialize()
    _seed(store)
    rows = store.aggregate(RecordFilters(capacity_type="Lorda"), "year,source")
    by_key = {(r["year"], r["source"]): r["efficient_power_mw"] for r in rows}
    assert by_key == {
        (2023, "Eolico"): 20.0,
        (2023, "Fotovoltaico"): 10.0,
        (2024, "Eolico"): 25.0,
        (2024, "Fotovoltaico"): 15.0,
    }
    assert all(r["source"] != "Unknown" and r["source"] for r in rows)


def test_latest_only_never_sums_years(tmp_path) -> None:
    store = CapacityStore(tmp_path / "c.sqlite")
    store.initialize()
    _seed(store)
    rows = store.aggregate(RecordFilters(capacity_type="Lorda"), "source", latest_only=True)
    by_source = {r["source"]: r["efficient_power_mw"] for r in rows}
    # Only 2024 stock, single capacity index: no multi-year sum, no Lorda+Netta.
    assert by_source == {"Fotovoltaico": 15.0, "Eolico": 25.0}


def test_summary_stock_semantics_single_index(tmp_path) -> None:
    store = CapacityStore(tmp_path / "c.sqlite")
    store.initialize()
    _seed(store)
    # No capacity_type filter: latest totals must default to Lorda, not sum both.
    summary = store.summary(RecordFilters())
    assert summary["latest_year"] == 2024
    assert summary["latest_total_efficient_power_mw"] == 40.0
    assert summary["previous_year"] == 2023
    assert summary["previous_total_efficient_power_mw"] == 30.0
    assert summary["yoy_new_mw"] == 10.0
    assert summary["yoy_pct"] == 10.0 / 30.0 * 100.0
    assert summary["capacity_type_applied"] == "Lorda"
    # Explicit Netta selection is respected.
    netta = store.summary(RecordFilters(capacity_type="Netta"))
    assert netta["capacity_type_applied"] == "Netta"
    assert netta["latest_total_efficient_power_mw"] == 40.0


def test_availability_reports_per_year(tmp_path) -> None:
    store = CapacityStore(tmp_path / "c.sqlite")
    store.initialize()
    _seed(store)
    avail = store.availability()
    ds = avail["datasets"]["renewable_source_capacity"]
    assert ds["year_min"] == 2023 and ds["year_max"] == 2024
    assert ds["total_rows"] == 8
    assert {y["year"]: y["rows"] for y in ds["years"]} == {2023: 4, 2024: 4}
