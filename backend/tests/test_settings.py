"""Settings/credential migration tests: the app was renamed, existing installs
must keep their cached data and their stored client secret."""

from backend.src.terna_backend import settings as settings_module


def test_app_data_dir_migrates_legacy_folder(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("TERNA_APP_DATA_DIR", raising=False)
    monkeypatch.setattr(settings_module, "_app_data_root", lambda: tmp_path)
    legacy = tmp_path / "TernaInstalledCapacity"
    legacy.mkdir()
    (legacy / "settings.json").write_text("{}", encoding="utf-8")

    resolved = settings_module.app_data_dir()

    assert resolved == tmp_path / "ItalianCapacityExplorer"
    assert (resolved / "settings.json").exists()
    assert not legacy.exists()


def test_app_data_dir_keeps_new_folder_when_both_exist(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("TERNA_APP_DATA_DIR", raising=False)
    monkeypatch.setattr(settings_module, "_app_data_root", lambda: tmp_path)
    (tmp_path / "TernaInstalledCapacity").mkdir()
    current = tmp_path / "ItalianCapacityExplorer"
    current.mkdir()

    assert settings_module.app_data_dir() == current
    assert (tmp_path / "TernaInstalledCapacity").exists()


def test_client_secret_is_migrated_from_the_legacy_keyring_service(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("TERNA_CLIENT_SECRET", raising=False)
    store = settings_module.SettingsStore(tmp_path)
    (tmp_path / "settings.json").write_text('{"client_id": "abc"}', encoding="utf-8")
    written: dict[str, str] = {}

    def fake_get_password(service: str, user: str) -> str | None:
        return "s3cret" if service == settings_module.LEGACY_SERVICE_NAME else None

    monkeypatch.setattr(settings_module.keyring, "get_password", fake_get_password)
    monkeypatch.setattr(
        settings_module.keyring,
        "set_password",
        lambda service, user, value: written.update({service: value}),
    )

    assert store.get_client_secret() == "s3cret"
    assert written == {settings_module.SERVICE_NAME: "s3cret"}
