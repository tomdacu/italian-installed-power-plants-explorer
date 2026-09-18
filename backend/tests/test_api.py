def test_health(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TERNA_APP_DATA_DIR", str(tmp_path))
    from fastapi.testclient import TestClient

    from backend.src.terna_backend.api import app

    client = TestClient(app)
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
