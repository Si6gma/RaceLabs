import os
import unittest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x")

from fastapi.testclient import TestClient

import app.main as main
from app.main import app, control_key_allows


class ControlKeyRuleTest(unittest.TestCase):
    def test_everything_open_without_key(self):
        self.assertTrue(control_key_allows("POST", "/api/recording/start", None, ""))
        self.assertTrue(control_key_allows("DELETE", "/api/import/sessions/x", None, ""))

    def test_writes_under_api_need_key(self):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertFalse(control_key_allows(method, "/api/lights", None, "secret"))
            self.assertFalse(control_key_allows(method, "/api/lights", "wrong", "secret"))
            self.assertTrue(control_key_allows(method, "/api/lights", "secret", "secret"))

    def test_reads_and_non_api_paths_stay_open(self):
        self.assertTrue(control_key_allows("GET", "/api/session", None, "secret"))
        self.assertTrue(control_key_allows("OPTIONS", "/api/session", None, "secret"))
        self.assertTrue(control_key_allows("POST", "/health", None, "secret"))


class ControlKeyMiddlewareTest(unittest.TestCase):
    def setUp(self):
        self.original = main.settings.CONTROL_KEY
        self.client = TestClient(app)

    def tearDown(self):
        main.settings.CONTROL_KEY = self.original

    def test_unprotected_when_unset(self):
        main.settings.CONTROL_KEY = ""
        self.assertEqual(self.client.get("/api/access").json(), {"protected": False})
        self.assertEqual(self.client.post("/api/recording/stop").status_code, 200)

    def test_write_without_key_is_403(self):
        main.settings.CONTROL_KEY = "secret"
        self.assertEqual(self.client.get("/api/access").json(), {"protected": True})
        response = self.client.post("/api/recording/stop")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "control key required"})
        wrong = self.client.post("/api/recording/stop", headers={"X-Control-Key": "nope"})
        self.assertEqual(wrong.status_code, 403)

    def test_write_with_key_passes(self):
        main.settings.CONTROL_KEY = "secret"
        response = self.client.post("/api/recording/stop", headers={"X-Control-Key": "secret"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("flashbacks", response.json())

    def test_get_unaffected(self):
        main.settings.CONTROL_KEY = "secret"
        self.assertEqual(self.client.get("/api/recording/status").status_code, 200)
        self.assertEqual(self.client.get("/health").status_code, 200)

    def test_403_carries_cors_headers(self):
        main.settings.CONTROL_KEY = "secret"
        response = self.client.post("/api/recording/stop", headers={"Origin": "http://localhost:5173"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("access-control-allow-origin", response.headers)


if __name__ == "__main__":
    unittest.main()
