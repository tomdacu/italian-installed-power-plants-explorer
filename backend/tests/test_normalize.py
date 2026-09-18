from backend.src.terna_backend.normalize import (
    installed_capacity_rows,
    parse_terna_decimal,
    renewable_source_capacity_rows,
)


def test_parse_terna_decimal_supports_comma_decimal() -> None:
    assert parse_terna_decimal("14,243") == 14.243


def test_parse_terna_decimal_supports_thousands_separator() -> None:
    assert parse_terna_decimal("1.234,50") == 1234.5


def test_parse_terna_decimal_treats_single_dot_as_decimal_separator() -> None:
    # /installed-capacity returns dot-decimal strings; a dot is not grouping.
    assert parse_terna_decimal("59.7902") == 59.7902
    assert parse_terna_decimal("22.8") == 22.8


def test_parse_terna_decimal_supports_grouped_thousands_without_comma() -> None:
    assert parse_terna_decimal("1.234.567") == 1234567.0


def test_installed_capacity_rows_keep_dot_decimal_payload_scale() -> None:
    payload = {
        "installed_capacity": [
            {"year": "2022", "type": "Hydro", "installed_capacity_GWh": "22.8"},
            {"year": "2021", "type": "Thermal", "installed_capacity_GWh": "59.7902"},
        ]
    }

    rows = installed_capacity_rows(payload, fetched_at="2026-01-01T00:00:00+00:00")

    assert [row["installed_capacity_gw"] for row in rows] == [22.8, 59.7902]


def test_renewable_source_capacity_rows_normalizes_payload() -> None:
    payload = {
        "renewable_sources": [
            {
                "year": "2023",
                "capacity_type": "Lorda",
                "region": "Abruzzo",
                "province": "Chieti",
                "source": "Bioenergie",
                "efficient_power_MW": "14,243",
            }
        ]
    }

    rows = renewable_source_capacity_rows(payload, fetched_at="2026-01-01T00:00:00+00:00")

    assert rows == [
        {
            "dataset": "renewable_source_capacity",
            "year": 2023,
            "capacity_type": "Lorda",
            "region": "Abruzzo",
            "province": "Chieti",
            "source": "Bioenergie",
            "category": None,
            "subcategory": None,
            "type": None,
            "efficient_power_mw": 14.243,
            "installed_capacity_gw": None,
            "fetched_at": "2026-01-01T00:00:00+00:00",
        }
    ]

