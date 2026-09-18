from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


def parse_terna_decimal(value: Any) -> float | None:
    """Parse a numeric value returned by the Terna API.

    Terna is not consistent between endpoints: most payloads carry JSON
    numbers, but ``/installed-capacity`` returns decimal *strings* in dot
    notation (``"59.7902"``), while other endpoints used comma decimals
    (``"14,243"``). Treating every dot as a thousands separator inflated the
    national installed-capacity values by 10^decimals (59.7902 -> 597902), so
    the separator role is now decided per value:

    * both separators present -> the right-most one is the decimal separator,
      the other one groups thousands (``1.234,50`` -> 1234.5);
    * a single comma -> decimal separator (``14,243`` -> 14.243);
    * a single dot -> decimal separator (``59.7902`` -> 59.7902);
    * several dots, no comma -> grouping (``1.234.567`` -> 1234567.0).
    """
    if value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    text = str(value).strip().replace("\u00a0", "")
    if not text:
        return None
    last_dot = text.rfind(".")
    last_comma = text.rfind(",")
    if last_dot >= 0 and last_comma >= 0:
        decimal_sep = "." if last_dot > last_comma else ","
        text = text.replace("," if decimal_sep == "." else ".", "")
    elif last_comma >= 0:
        decimal_sep = ","
    elif text.count(".") > 1:
        decimal_sep = None
        text = text.replace(".", "")
    else:
        decimal_sep = "."
    if decimal_sep:
        text = text.replace(decimal_sep, ".")
    text = text.replace(" ", "")
    try:
        return float(Decimal(text))
    except (InvalidOperation, ValueError):
        return None


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def renewable_source_capacity_rows(payload: dict[str, Any], fetched_at: str | None = None) -> list[dict[str, Any]]:
    timestamp = fetched_at or utc_now_iso()
    rows = []
    for item in payload.get("renewable_sources") or []:
        rows.append(
            {
                "dataset": "renewable_source_capacity",
                "year": int(item["year"]),
                "capacity_type": item.get("capacity_type"),
                "region": item.get("region"),
                "province": item.get("province"),
                "source": item.get("source"),
                "category": None,
                "subcategory": None,
                "type": None,
                "efficient_power_mw": parse_terna_decimal(item.get("efficient_power_MW")),
                "installed_capacity_gw": None,
                "fetched_at": timestamp,
            }
        )
    return rows


def generation_plants_rows(payload: dict[str, Any], fetched_at: str | None = None) -> list[dict[str, Any]]:
    timestamp = fetched_at or utc_now_iso()
    rows = []
    for item in payload.get("generation_plants") or []:
        rows.append(
            {
                "dataset": "generation_plants",
                "year": int(item["year"]),
                "capacity_type": item.get("capacity_type"),
                "region": item.get("region"),
                "province": item.get("province"),
                "source": item.get("source"),
                "category": None,
                "subcategory": None,
                "type": None,
                "efficient_power_mw": parse_terna_decimal(item.get("efficient_power_MW")),
                "installed_capacity_gw": None,
                "fetched_at": timestamp,
            }
        )
    return rows


def installed_capacity_rows(payload: dict[str, Any], fetched_at: str | None = None) -> list[dict[str, Any]]:
    timestamp = fetched_at or utc_now_iso()
    rows = []
    for item in payload.get("installed_capacity") or []:
        rows.append(
            {
                "dataset": "installed_capacity",
                "year": int(item["year"]),
                "capacity_type": None,
                "region": None,
                "province": None,
                "source": None,
                "category": None,
                "subcategory": None,
                "type": item.get("type"),
                "efficient_power_mw": None,
                "installed_capacity_gw": parse_terna_decimal(item.get("installed_capacity_GWh")),
                "fetched_at": timestamp,
            }
        )
    return rows


def thermoelectric_capacity_rows(payload: dict[str, Any], fetched_at: str | None = None) -> list[dict[str, Any]]:
    timestamp = fetched_at or utc_now_iso()
    rows = []
    for item in payload.get("thermoelectric") or []:
        rows.append(
            {
                "dataset": "thermoelectric_capacity",
                "year": int(item["year"]),
                "capacity_type": item.get("capacity_type"),
                "region": item.get("region"),
                "province": item.get("province"),
                "source": "Termoelettrico",
                "category": item.get("category"),
                "subcategory": item.get("subcategory"),
                "type": None,
                "efficient_power_mw": parse_terna_decimal(item.get("efficient_power_MW")),
                "installed_capacity_gw": None,
                "fetched_at": timestamp,
            }
        )
    return rows

