from __future__ import annotations

RENEWABLE_SOURCES = [
    "Bioenergie",
    "Eolico",
    "Fotovoltaico",
    "Geotermoelettrico",
    "Idrico",
]

GENERATION_PLANT_SOURCES = [
    "Eolico",
    "Fotovoltaico",
    "Geotermoelettrico",
    "Idrico",
    "Termoelettrico",
]

INSTALLED_CAPACITY_TYPES = [
    "Thermal",
    "Wind",
    "Geothermal",
    "Photovoltaic",
    "Hydro",
]

CAPACITY_TYPES = ["Lorda", "Netta"]

#: Canonical capacity type used by analytics (summary latest-totals, default
#: dashboard filter). Lorda and Netta differ only slightly for renewables;
#: summing both double-counts every MW, so analytics never aggregate across
#: capacity types — one index is stored, one index is shown.
DEFAULT_CAPACITY_TYPE = "Lorda"

#: The /installed-capacity endpoint only serves the current year and the
#: previous 6 ("value between the current year and the last 6" per docs).
INSTALLED_CAPACITY_YEAR_WINDOW = 7

THERMOELECTRIC_CATEGORIES = ["Non cogenerativa", "Cogenerativa"]

THERMOELECTRIC_SUBCATEGORIES = [
    "Altro genere",
    "Celle combustibili",
    "Ciclo combinato",
    "Combustione interna",
    "Condensazione",
    "Geotermoelettrica A Condensazione",
    "Ripotenziato",
    "Turbine a gas",
    "Turbo espansione",
    "Celle combustibili con cogenerazione",
    "Ciclo combinato con cogenerazione",
    "Combustione interna con cogenerazione",
    "Condensazione e spillamento",
    "Contropressione",
    "Turbine a gas con cogenerazione",
]

SYNCABLE_DATASETS = [
    "renewable_source_capacity",
    "generation_plants",
    "installed_capacity",
    "thermoelectric_capacity",
]

#: Valid `source` values per dataset, mirroring the Terna docs. Anything
#: outside these lists makes the API return an empty body (no error), so the
#: sync intersects user requests with these lists instead of blindly querying.
#: Note: generation plants have no Bioenergie entry point (docs list); the
#: frontend sends the union of sources and the sync maps per dataset.
DATASET_SOURCES: dict[str, list[str]] = {
    "renewable_source_capacity": RENEWABLE_SOURCES,
    "generation_plants": GENERATION_PLANT_SOURCES,
    "installed_capacity": [],
    "thermoelectric_capacity": [],
}

#: Datasets whose rows carry `capacity_type` (Lorda/Netta). `installed_capacity`
#: rows carry only `type` + GW values.
DATASETS_WITH_CAPACITY_TYPE = [
    "renewable_source_capacity",
    "generation_plants",
    "thermoelectric_capacity",
]
