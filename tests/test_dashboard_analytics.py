import unittest
from datetime import date, timedelta

from backend.main import mongo_dashboard_analytics


class DashboardAnalyticsTests(unittest.TestCase):
    def test_separates_test_payments_from_real_revenue(self):
        today = date.today().isoformat()
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        analytics = mongo_dashboard_analytics(
            {
                "rooms": [],
                "bookings": [],
                "invoices": [
                    {
                        "status": "Paid",
                        "total": 2400,
                        "paymentDate": today,
                        "paymentNote": None,
                    },
                    {
                        "status": "Paid",
                        "total": 1800,
                        "paymentDate": today,
                        "paymentNote": "Razorpay test payment. No money was charged.",
                    },
                    {
                        "status": "Paid",
                        "total": 900,
                        "paymentDate": yesterday,
                        "paymentNote": "Razorpay test payment. No money was charged.",
                    },
                ],
            }
        )

        self.assertEqual(analytics["revenueToday"], 2400)
        self.assertEqual(analytics["testPaymentsToday"], 1800)


if __name__ == "__main__":
    unittest.main()
