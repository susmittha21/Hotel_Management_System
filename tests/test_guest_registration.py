import unittest

from pydantic import ValidationError

from backend.main import GuestRegisterRequest


class GuestRegistrationValidationTests(unittest.TestCase):
    def make_request(self, phone: str) -> GuestRegisterRequest:
        return GuestRegisterRequest(
            fullName="Asha Kumar",
            email="asha@example.com",
            phone=phone,
            password="guestpass123",
        )

    def test_normalizes_indian_mobile_number_formats(self):
        for phone in ("9876543210", "+91 98765 43210", "91-98765-43210"):
            with self.subTest(phone=phone):
                request = self.make_request(phone)
                self.assertEqual(request.phone, "+919876543210")

    def test_rejects_non_indian_or_invalid_mobile_numbers(self):
        for phone in ("1234567890", "5876543210", "987654321", "+1 2025550123"):
            with self.subTest(phone=phone):
                with self.assertRaises(ValidationError):
                    self.make_request(phone)


if __name__ == "__main__":
    unittest.main()
