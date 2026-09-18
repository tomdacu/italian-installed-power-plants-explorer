from backend.src.terna_backend.schemas import RecordFilters
from backend.src.terna_backend.storage import CapacityStore


def test_store_upserts_and_aggregates(tmp_path) -> None:
    store = CapacityStore(tmp_path / "cache.sqlite")
    store.initialize()
    store.upsert_records(
        [
            {
                "dataset": "renewable_source_capacity",
                "year": 2023,
                "capacity_type": "Lorda",
                "region": "Lombardia",
                "province": "Milano",
                "source": "Fotovoltaico",
                "category": None,
                "subcategory": None,
                "type": None,
                "efficient_power_mw": 10.0,
                "installed_capacity_gw": None,
                "fetched_at": "2026-01-01T00:00:00+00:00",
            },
            {
                "dataset": "renewable_source_capacity",
                "year": 2023,
                "capacity_type": "Lorda",
                "region": "Lombardia",
                "province": "Bergamo",
                "source": "Fotovoltaico",
                "category": None,
                "subcategory": None,
                "type": None,
                "efficient_power_mw": 5.0,
                "installed_capacity_gw": None,
                "fetched_at": "2026-01-01T00:00:00+00:00",
            },
        ]
    )

    summary = store.summary(RecordFilters(region="Lombardia", source="Fotovoltaico"))
    by_region = store.aggregate(RecordFilters(source="Fotovoltaico"), "region")

    assert summary["row_count"] == 2
    assert summary["total_efficient_power_mw"] == 15.0
    assert by_region == [{"region": "Lombardia", "efficient_power_mw": 15.0, "installed_capacity_gw": None}]

