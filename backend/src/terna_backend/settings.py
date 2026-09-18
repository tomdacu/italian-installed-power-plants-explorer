from __future__ import annotations

import json
import os
import platform
from dataclasses import dataclass
from pathlib import Path

import keyring

SERVICE_NAME = "terna-installed-capacity"


def app_data_dir() -> Path:
    override = os.getenv("TERNA_APP_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()

    system = platform.system().lower()
    if system == "windows":
        base = Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif system == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "TernaInstalledCapacity"


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
            try:
                keyring.delete_password(SERVICE_NAME, client_id)
            except keyring.errors.PasswordDeleteError:
                pass

    def get_client_secret(self, client_id: str | None = None) -> str | None:
        env_secret = os.getenv("TERNA_CLIENT_SECRET")
        if env_secret:
            return env_secret
        resolved_client_id = client_id or self.load().client_id
        if not resolved_client_id:
            return None
        try:
            return keyring.get_password(SERVICE_NAME, resolved_client_id)
        except keyring.errors.KeyringError:
            return None

    def has_credentials(self) -> bool:
        settings = self.load()
        return bool(settings.client_id and self.get_client_secret(settings.client_id))

    def _read_payload(self) -> dict[str, object]:
        if not self.settings_path.exists():
            return {}
        return json.loads(self.settings_path.read_text(encoding="utf-8"))

