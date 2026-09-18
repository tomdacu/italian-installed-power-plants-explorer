"""Entry point that runs the FastAPI backend as a standalone process.

Used by PyInstaller to produce the `app-backend` sidecar that the Tauri shell
spawns at startup. The port is passed as the first argument (or TERNA_PORT env).
"""
from __future__ import annotations

import os
import sys


def _bootstrap_path() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "src")
    if os.path.isdir(src) and src not in sys.path:
        sys.path.insert(0, src)


def _redirect_streams() -> None:
    """PyInstaller --noconsole leaves stdout/stderr as None on Windows; uvicorn
    logging would crash. Redirect to a log file in the app data dir."""
    if not getattr(sys, "frozen", False):
        return
    try:
        from terna_backend.settings import app_data_dir

        log_dir = app_data_dir()
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "backend.log"
        stream = open(log_path, "a", encoding="utf-8")
        sys.stdout = stream
        sys.stderr = stream
    except Exception:
        pass


def _force_windows_keyring() -> None:
    if sys.platform != "win32":
        return
    try:
        import keyring
        from keyring.backends.Windows import WinVaultKeyring

        keyring.set_keyring(WinVaultKeyring())
    except Exception:
        pass


def _resolve_port() -> int:
    candidates = []
    if len(sys.argv) > 1:
        candidates.append(sys.argv[1])
    env_port = os.environ.get("TERNA_PORT")
    if env_port:
        candidates.append(env_port)
    candidates.append("8765")
    for c in candidates:
        try:
            return int(c)
        except (TypeError, ValueError):
            continue
    return 8765


def main() -> None:
    _bootstrap_path()
    _redirect_streams()
    _force_windows_keyring()

    import uvicorn
    from terna_backend.api import app  # noqa: F401

    port = _resolve_port()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
