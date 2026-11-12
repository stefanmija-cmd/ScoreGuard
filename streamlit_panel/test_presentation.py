import unittest
import os
import requests
from presentation import preview_rows, preview_fingerprint, table_rows, local_time
from api_client import ApiClient, ApiError
from unittest.mock import patch, Mock


class PresentationTests(unittest.TestCase):
    def test_distinguishes_live_and_halftime_without_testing_goal_minute(self):
        row = {
            "internalId": "73608",
            "match": "A – B",
            "league": "Liga",
            "scheduleRaw": "sre 22:00",
            "marketRaw": "FT",
            "numericScore": "1:3",
            "colonScore": "1:2",
            "minuteRaw": "48'",
            "phaseRaw": "2nd half",
        }
        shown = preview_rows({"format": "native", "preview": [row]})[0]
        self.assertEqual(shown["Trenutni rezultat"], "1:3")
        self.assertEqual(shown["Poluvreme"], "1:2")
        self.assertEqual(shown["Minut gola (ne proverava se)"], "48'")

    def test_stale_reference_and_missing_score_are_visible(self):
        rows = table_rows(
            [
                {
                    "id": "one",
                    "time": "20:00",
                    "match": "A – B",
                    "league": "Liga",
                    "score": None,
                    "ht": None,
                    "comparisonStatus": "unverified",
                    "refs": {
                        "flash": {"state": "verified", "score": "1:0", "ht": "0:0", "stale": True}
                    },
                }
            ],
            ["flash"],
        )
        self.assertEqual(rows[0]["Interno"], "—")
        self.assertIn("zastarelo", rows[0]["Flashscore"])
        self.assertEqual(rows[0]["Provera"], "Nije provereno")

    def test_preview_is_invalidated_when_text_date_or_format_changes(self):
        first = preview_fingerprint("text", "2026-11-11", "native")
        self.assertNotEqual(first, preview_fingerprint("changed", "2026-11-11", "native"))
        self.assertNotEqual(first, preview_fingerprint("text", "2026-11-12", "native"))

    def test_table_omits_reason_and_keeps_comparison_status(self):
        reason = "Poluvreme: interno 3:0, Flashscore 2:0."
        row = table_rows(
            [
                {
                    "time": "18:00",
                    "match": "France U19 – Norway U19",
                    "league": "Liga",
                    "score": "6:0",
                    "ht": "3:0",
                    "comparisonStatus": "mismatch",
                    "comparisonReason": reason,
                }
            ],
            ["flash"],
        )[0]
        self.assertEqual(row["Provera"], "Neslaganje")
        self.assertNotIn("Razlog", row)
        self.assertNotIn("Prioritet", row)
        self.assertNotIn("Obrada", row)

    def test_belgrade_timezone_and_invalid_timestamp(self):
        self.assertEqual(local_time("2026-11-09T23:30:00Z", True), "10.11.2026. 00:30:00")
        self.assertEqual(local_time("invalid"), "—")


class ClientTests(unittest.TestCase):
    @patch("api_client.requests.request")
    def test_compare_waits_up_to_90_seconds_and_reports_a_timeout_without_a_result(self, request):
        response = Mock(status_code=200)
        response.json.return_value = {"results": [{"id": "one"}]}
        request.side_effect = [requests.Timeout("slow response"), response]
        client = ApiClient(
            cookie="test-cookie", operator_id="operator-test", base_url="http://api:8080"
        )
        with self.assertRaises(ApiError):
            client.check({"date": "2026-11-11"}, False)
        self.assertEqual(client.check({"date": "2026-11-11"}, False)["results"], [{"id": "one"}])
        for call in request.call_args_list:
            self.assertEqual(call.kwargs["timeout"], (5, 90))
            self.assertFalse(call.kwargs["allow_redirects"])
            self.assertEqual(call.kwargs["headers"]["Cookie"], "test-cookie")

    @patch("api_client.requests.Session")
    def test_cloud_loopback_compare_uses_the_same_timeout_and_private_session(
        self, session_factory
    ):
        session = session_factory.return_value.__enter__.return_value
        session.request.return_value = Mock(status_code=200)
        session.request.return_value.json.return_value = {"results": []}
        with patch.dict(os.environ, {"SCOREGUARD_CLOUD": "1"}):
            client = ApiClient(cookie="test-cookie", base_url="http://127.0.0.1:12345")
            self.assertEqual(client.check({}, False)["results"], [])
        self.assertFalse(session.trust_env)
        self.assertEqual(session.request.call_args.kwargs["timeout"], (5, 90))
        self.assertFalse(session.request.call_args.kwargs["allow_redirects"])

    @patch("api_client.requests.request")
    def test_operator_cookie_and_identity_are_sent_only_in_headers(self, request):
        response = Mock(status_code=200)
        response.json.return_value = {"monitor": None}
        request.return_value = response
        client = ApiClient(
            cookie="secure-session=value",
            operator_id="operator-stefan",
            base_url="http://api:8080",
            origin="https://scoreguard.test",
        )
        client.monitor()
        kwargs = request.call_args.kwargs
        self.assertEqual(kwargs["headers"]["Cookie"], "secure-session=value")
        self.assertEqual(kwargs["headers"]["X-ScoreGuard-Operator"], "operator-stefan")
        self.assertEqual(kwargs["headers"]["Origin"], "https://scoreguard.test")
        self.assertIsNone(kwargs["json"])

    @patch("api_client.requests.request")
    def test_failed_authentication_is_not_reported_as_success(self, request):
        response = Mock(status_code=401)
        response.json.return_value = {"error": "Prijavite se"}
        request.return_value = response
        with self.assertRaises(ApiError) as caught:
            ApiClient().monitor()
        self.assertEqual(caught.exception.status, 401)


if __name__ == "__main__":
    unittest.main()
