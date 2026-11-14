import unittest
from urllib.parse import parse_qs, urlsplit

from pydantic import ValidationError

from backend.main import (
    GuestPasswordResetConfirmRequest,
    GuestPasswordResetRequest,
    _guest_password_reset_token_hash,
    _guest_password_reset_url,
)


class GuestPasswordResetTests(unittest.TestCase):
    def test_reset_request_normalizes_email(self):
        request = GuestPasswordResetRequest(email="Guest@Example.com")

        self.assertEqual(request.email, "guest@example.com")

    def test_reset_confirmation_reuses_guest_password_policy(self):
        with self.assertRaises(ValidationError):
            GuestPasswordResetConfirmRequest(token="t" * 43, password="onlyletters")

        request = GuestPasswordResetConfirmRequest(token="t" * 43, password="guestpass123")
        self.assertEqual(request.password, "guestpass123")

    def test_reset_url_puts_token_in_fragment(self):
        token = "random-reset-token"
        reset_url = _guest_password_reset_url(
            "https://hotel.example/pages/guest-account.html",
            token,
        )
        parsed_url = urlsplit(reset_url)

        self.assertEqual(parsed_url.query, "")
        self.assertEqual(parse_qs(parsed_url.fragment), {"reset_token": [token]})

    def test_reset_token_is_stored_as_a_digest(self):
        token = "random-reset-token"
        token_hash = _guest_password_reset_token_hash(token)

        self.assertNotEqual(token_hash, token)
        self.assertEqual(len(token_hash), 64)
        self.assertEqual(token_hash, _guest_password_reset_token_hash(token))


if __name__ == "__main__":
    unittest.main()
