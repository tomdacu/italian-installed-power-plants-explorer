from __future__ import annotations

import csv
import hashlib
import io
import re
import sqlite3
from pathlib import Path
from typing import Any

from .constants import DEFAULT_CAPACITY_TYPE
from .schemas import GroupBy, RecordFilters

ALLOWED_GROUP_BY = {"year", "region", "province", "source", "capacity_type", "category", "subcategory", "type"}

#: Datasets whose rows carry efficient power in MW + capacity_type.
MW_DATASETS = {"renewable_source_capacity", "generation_plants", "thermoelectric_capacity"}


def parse_group_by(raw: str) -> list[str]:
    """Parse a group-by expression into validated column names.

    Accepts comma-separated lists ("year,source") as well as the legacy
    "+" separator ("year+source", which arrives URL-decoded as "year source").
    Raises ValueError on unknown or empty input.
    """
    parts = [p.strip() for p in re.split(r"[,+;\s]+", raw or "") if p.strip()]
    seen: list[str] = []
    for part in parts:
        if part not in ALLOWED_GROUP_BY:
            raise ValueError(f"Unsupported group_by: {raw!r}")
        if part not in seen:
            seen.append(part)
    if not seen:
        raise ValueError(f"Unsupported group_by: {raw!r}")
    return seen


class CapacityStore:
    def __init__(self, database_path: Path | str) -> None:
        self.database_path = Path(database_path)

    def connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS capacity_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_key TEXT NOT NULL UNIQUE,
                    dataset TEXT NOT NULL,
                    year INTEGER NOT NULL,
                    capacity_type TEXT,
                    region TEXT,
                    province TEXT,
                    source TEXT,
                    category TEXT,
                    subcategory TEXT,
                    type TEXT,
                    efficient_power_mw REAL,
                    installed_capacity_gw REAL,
                    fetched_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_capacity_filters
                    ON capacity_records (dataset, year, region, province, source, capacity_type);
                CREATE INDEX IF NOT EXISTS idx_capacity_year ON capacity_records (year);
                """
            )

    def upsert_records(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        keyed_rows = [{**row, "record_key": self._record_key(row)} for row in rows]
        with self.connect() as connection:
            connection.executemany(
                """
                INSERT INTO capacity_records (
                    record_key, dataset, year, capacity_type, region, province, source,
                    category, subcategory, type, efficient_power_mw,
                    installed_capacity_gw, fetched_at
                )
                VALUES (
                    :record_key, :dataset, :year, :capacity_type, :region, :province, :source,
                    :category, :subcategory, :type, :efficient_power_mw,
                    :installed_capacity_gw, :fetched_at
                )
                ON CONFLICT DO UPDATE SET
                    efficient_power_mw = excluded.efficient_power_mw,
                    installed_capacity_gw = excluded.installed_capacity_gw,
                    fetched_at = excluded.fetched_at
                """,
                keyed_rows,
            )
        return len(rows)

    def records(self, filters: RecordFilters, limit: int = 5000, offset: int = 0) -> list[dict[str, Any]]:
        where, params = self._where(filters)
        query = f"""
            SELECT dataset, year, capacity_type, region, province, source, category,
                   subcategory, type, efficient_power_mw, installed_capacity_gw, fetched_at
            FROM capacity_records
            {where}
            ORDER BY year, region, province, source, capacity_type, category, subcategory, type
            LIMIT :limit OFFSET :offset
        """
        params.update({"limit": limit, "offset": offset})
        with self.connect() as connection:
            return [dict(row) for row in connection.execute(query, params).fetchall()]

    def summary(self, filters: RecordFilters) -> dict[str, Any]:
        """Selection overview with stock semantics.

        `total_*` keep the historical meaning (sums over every filtered row,
        all years) for backward compatibility. The `latest_*` fields are the
        ones dashboards should display: stock of the latest year in the
        selection, computed with a single capacity index (caller's choice, or
        Lorda by default) so Lorda+Netta are never summed together.
        """
        where, params = self._where(filters)
        with self.connect() as connection:
            base = dict(
                connection.execute(
                    f"""
                    SELECT
                        COUNT(*) AS row_count,
                        SUM(efficient_power_mw) AS total_efficient_power_mw,
                        SUM(installed_capacity_gw) AS total_installed_capacity_gw,
                        MIN(year) AS year_min,
                        MAX(year) AS year_max
                    FROM capacity_records
                    {where}
                    """,
                    params,
                ).fetchone()
            )

        latest_year = base["year_max"]
        applied = self._capacity_applied(filters)
        latest_mw: float | None = None
        latest_gw: float | None = None
        prev_year: int | None = None
        prev_mw: float | None = None
        if latest_year is not None:
            latest_mw, latest_gw = self._stock_totals(filters, applied, latest_year)
            prev_year = self._previous_year(filters, latest_year)
            if prev_year is not None:
                prev_mw, _ = self._stock_totals(filters, applied, prev_year)

        is_gw_dataset = filters.dataset == "installed_capacity"
        primary_latest = latest_gw if is_gw_dataset else latest_mw
        primary_prev = None if is_gw_dataset else prev_mw
        # For the GW dataset compare GW-vs-GW across years.
        gw_prev: float | None = None
        if is_gw_dataset and prev_year is not None:
            _, gw_prev = self._stock_totals(filters, applied, prev_year)
            primary_prev = gw_prev

        yoy_new: float | None = None
        yoy_pct: float | None = None
        if primary_latest is not None and primary_prev is not None:
            yoy_new = primary_latest - primary_prev
            yoy_pct = (yoy_new / primary_prev * 100.0) if primary_prev else None

        return {
            **base,
            "latest_year": latest_year,
            "latest_total_efficient_power_mw": latest_mw,
            "latest_total_installed_capacity_gw": latest_gw,
            "previous_year": prev_year,
            "previous_total_efficient_power_mw": prev_mw,
            "yoy_new_mw": None if is_gw_dataset else yoy_new,
            "yoy_new_gw": yoy_new if is_gw_dataset else None,
            "yoy_pct": yoy_pct,
            "capacity_type_applied": applied,
        }

    def aggregate(
        self,
        filters: RecordFilters,
        group_by: GroupBy | str,
        latest_only: bool = False,
    ) -> list[dict[str, Any]]:
        """Aggregate sums grouped by one or more columns.

        `group_by` may be "source" or a compound like "year,source".
        With `latest_only`, rows are restricted to MAX(year) inside the rest
        of the selection — used for "by source / by region" stock charts so
        multi-year ranges don't sum stocks of different years together.
        """
        keys = parse_group_by(str(group_by))
        where, params = self._where(filters)
        if latest_only:
            where = (
                f"{where} AND year = (SELECT MAX(year) FROM capacity_records {where})"
                if where
                else "WHERE year = (SELECT MAX(year) FROM capacity_records)"
            )
        cols = ", ".join(keys)
        query = f"""
            SELECT
                {cols},
                SUM(efficient_power_mw) AS efficient_power_mw,
                SUM(installed_capacity_gw) AS installed_capacity_gw
            FROM capacity_records
            {where}
            GROUP BY {cols}
            ORDER BY {cols}
        """
        with self.connect() as connection:
            return [dict(row) for row in connection.execute(query, params).fetchall()]

    def options(self) -> dict[str, list[Any]]:
        fields = ["dataset", "year", "region", "province", "source", "capacity_type", "category", "subcategory", "type"]
        result: dict[str, list[Any]] = {}
        with self.connect() as connection:
            for field in fields:
                rows = connection.execute(
                    f"SELECT DISTINCT {field} FROM capacity_records WHERE {field} IS NOT NULL ORDER BY {field}"
                ).fetchall()
                result[field + "s"] = [row[0] for row in rows]
        return result

    def availability(self) -> dict[str, Any]:
        """What is actually stored: per dataset and year, row counts plus the
        source / capacity_type values present. Powers the sync page ("what do
        I already have?") without hardcoding year lists in the frontend."""
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT dataset, year, COUNT(*) AS rows,
                       GROUP_CONCAT(DISTINCT source) AS sources,
                       GROUP_CONCAT(DISTINCT capacity_type) AS capacity_types,
                       MAX(fetched_at) AS last_fetched
                FROM capacity_records
                GROUP BY dataset, year
                ORDER BY dataset, year
                """
            ).fetchall()
            total = connection.execute("SELECT COUNT(*) AS n FROM capacity_records").fetchone()["n"]
        datasets: dict[str, Any] = {}
        for row in rows:
            entry = datasets.setdefault(
                row["dataset"],
                {"years": [], "total_rows": 0, "year_min": None, "year_max": None, "last_fetched": None},
            )
            entry["years"].append(
                {
                    "year": row["year"],
                    "rows": row["rows"],
                    "sources": sorted(s for s in (row["sources"] or "").split(",") if s),
                    "capacity_types": sorted(s for s in (row["capacity_types"] or "").split(",") if s),
                }
            )
            entry["total_rows"] += row["rows"]
            entry["year_min"] = row["year"] if entry["year_min"] is None else min(entry["year_min"], row["year"])
            entry["year_max"] = row["year"] if entry["year_max"] is None else max(entry["year_max"], row["year"])
            if row["last_fetched"] and (entry["last_fetched"] is None or row["last_fetched"] > entry["last_fetched"]):
                entry["last_fetched"] = row["last_fetched"]
        return {"datasets": datasets, "total_rows": total}

    def to_csv(self, filters: RecordFilters) -> str:
        rows = self.records(filters, limit=1_000_000)
        output = io.StringIO()
        fieldnames = [
            "dataset",
            "year",
            "capacity_type",
            "region",
            "province",
            "source",
            "category",
            "subcategory",
            "type",
            "efficient_power_mw",
            "installed_capacity_gw",
            "fetched_at",
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue()

    # -- internals ------------------------------------------------------

    def _capacity_applied(self, filters: RecordFilters) -> str | None:
        """Single capacity index used for latest-stock MW totals."""
        if filters.dataset == "installed_capacity":
            return None
        if filters.dataset is not None and filters.dataset not in MW_DATASETS:
            return None
        return filters.capacity_type or DEFAULT_CAPACITY_TYPE

    def _stock_totals(
        self, filters: RecordFilters, applied: str | None, year: int
    ) -> tuple[float | None, float | None]:
        stock = RecordFilters(**{**filters.model_dump(), "year_from": year, "year_to": year})
        if applied:
            stock.capacity_type = applied  # type: ignore[assignment]
        where, params = self._where(stock)
        with self.connect() as connection:
            row = connection.execute(
                f"""
                SELECT SUM(efficient_power_mw) AS mw,
                       SUM(installed_capacity_gw) AS gw
                FROM capacity_records {where}
                """,
                params,
            ).fetchone()
        return row["mw"], row["gw"]

    def _previous_year(self, filters: RecordFilters, latest: int) -> int | None:
        scoped = RecordFilters(**{**filters.model_dump(), "year_to": latest - 1})
        where, params = self._where(scoped)
        with self.connect() as connection:
            row = connection.execute(
                f"SELECT MAX(year) AS y FROM capacity_records {where}", params
            ).fetchone()
        return row["y"]

    def _where(self, filters: RecordFilters) -> tuple[str, dict[str, Any]]:
        clauses: list[str] = []
        params: dict[str, Any] = {}
        exact_fields = ["dataset", "region", "province", "source", "capacity_type", "category", "subcategory", "type"]
        for field in exact_fields:
            value = getattr(filters, field)
            if value:
                clauses.append(f"{field} = :{field}")
                params[field] = value
        if filters.year_from is not None:
            clauses.append("year >= :year_from")
            params["year_from"] = filters.year_from
        if filters.year_to is not None:
            clauses.append("year <= :year_to")
            params["year_to"] = filters.year_to
        if not clauses:
            return "", params
        return "WHERE " + " AND ".join(clauses), params

    def _record_key(self, row: dict[str, Any]) -> str:
        parts = [
            row.get("dataset"),
            row.get("year"),
            row.get("capacity_type"),
            row.get("region"),
            row.get("province"),
            row.get("source"),
            row.get("category"),
            row.get("subcategory"),
            row.get("type"),
        ]
        raw = "|".join("" if part is None else str(part) for part in parts)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
