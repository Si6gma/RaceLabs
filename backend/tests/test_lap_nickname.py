import os
import unittest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x")

from fastapi.testclient import TestClient

import app.main as main
from app.csv_import_service import normalize_nickname
from app.main import app


class NormalizeNicknameTest(unittest.TestCase):
    def test_strips_surrounding_whitespace(self):
        self.assertEqual(normalize_nickname("  Quali sim  "), "Quali sim")

    def test_empty_or_blank_clears_to_none(self):
        self.assertIsNone(normalize_nickname(""))
        self.assertIsNone(normalize_nickname("   "))


class LapNicknameEndpointTest(unittest.TestCase):
    def setUp(self):
        self.original = main.settings.CONTROL_KEY
        self.client = TestClient(app)

    def tearDown(self):
        main.settings.CONTROL_KEY = self.original

    def test_patch_without_key_is_403(self):
        main.settings.CONTROL_KEY = "secret"
        response = self.client.patch("/api/import/laps/x", json={"nickname": "a"})
        self.assertEqual(response.status_code, 403)

    def test_too_long_nickname_is_422(self):
        main.settings.CONTROL_KEY = ""
        response = self.client.patch("/api/import/laps/x", json={"nickname": "a" * 41})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
