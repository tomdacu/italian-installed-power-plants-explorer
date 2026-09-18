from __future__ import annotations

import json
import os
import platform
from dataclasses import dataclass
from pathlib import Path

import keyring

SERVICE_NAME = "italian-capacity-explorer"
#: Names used before the app was renamed. Kept so an existing install keeps its
#: credentials and cached data instead of silently starting from scratch.
LEGACY_SERVICE_NAME = "terna-installed-capacity"
APP_DIR_NAME = "ItalianCapacityExplorer"
LEGACY_APP_DIR_NAME = "TernaInstalledCapacity"


def _app_data_root() -> Path:
    system = platform.system().lower()
    if system == "windows":
        return Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming"))
    if system == "darwin":
        return Path.home() / "Library" / "Application Support"
    return Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share"))


def app_data_dir() -> Path:
    override = os.getenv("TERNA_APP_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()

    root = _app_data_root()
    target = root / APP_DIR_NAME
    legacy = root / LEGACY_APP_DIR_NAME
    if not target.exists() and legacy.exists():
        try:
            legacy.rename(target)  # one-time migration, same parent directory
        except OSError:
            return legacy
    return target


@dataclass(frozen=True)
class AppSettings:
    data_dir: Path
    database_path: Path
    client_id: str | None


class SettingsStore:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or app_data_dir()
        self.settings_path = self.data_dir / "settings.json"

    def load(self) -> AppSettings:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        payload = self._read_payload()
        database_path = Path(payload.get("database_path") or self.data_dir / "terna_cache.sqlite")
        client_id = payload.get("client_id") or os.getenv("TERNA_CLIENT_ID")
        return AppSettings(
            data_dir=self.data_dir,
            database_path=database_path,
            client_id=client_id,
        )

    def save_credentials(self, client_id: str, client_secret: str) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        payload = self._read_payload()
        payload["client_id"] = client_id
        self.settings_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        keyring.set_password(SERVICE_NAME, client_id, client_secret)

    def delete_credentials(self) -> None:
        payload = self._read_payload()
        client_id = payload.pop("client_id", None)
        self.settings_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        if client_id:
            for service in (SERVICE_NAME, LEGACY_SERVICE_NAME):
                try:
                    keyring.delete_password(service, client_id)
                except (keyring.errors.PasswordDeleteError, keyring.errors.KeyringError):
                    pass

    def get_client_secret(self, client_id: str | None = None) -> str | None:
        env_secret = os.getenv("TERNA_CLIENT_SECRET")
        if env_secret:
            return env_secret
        resolved_client_id = client_id or self.load().client_id
        if not resolved_client_id:
            return None
        try:
            secret = keyring.get_password(SERVICE_NAME, resolved_client_id)
            if secret:
                return secret
            # Credentials stored before the app was renamed: migrate them to
            # the new service name on first read.
            legacy = keyring.get_password(LEGACY_SERVICE_NAME, resolved_client_id)
            if legacy:
                try:
                    keyring.set_password(SERVICE_NAME, resolved_client_id, legacy)
                except keyring.errors.KeyringError:
                    pass
            return legacy
        except keyring.errors.KeyringError:
            return None

    def has_credentials(self) -> bool:
        settings = self.load()
        return bool(settings.client_id and self.get_client_secret(settings.client_id))

    def _read_payload(self) -> dict[str, object]:
        if not self.settings_path.exists():
            return {}
        return json.loads(self.settings_path.read_text(encoding="utf-8"))

