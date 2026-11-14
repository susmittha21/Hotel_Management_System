import unittest
from unittest.mock import Mock, patch

from backend.mongo_store import replace_documents


class MongoStoreTests(unittest.TestCase):
    def test_replace_documents_uses_builtin_id_index(self):
        collection = Mock()
        record = {"booking_id": "B-1", "status": "confirmed"}

        with patch(
            "backend.mongo_store.ReplaceOne",
            side_effect=lambda query, replacement, upsert: (
                query,
                replacement,
                upsert,
            ),
        ):
            replace_documents(collection, "booking_id", [record])

        collection.create_index.assert_not_called()
        collection.bulk_write.assert_called_once_with(
            [
                (
                    {"_id": "B-1"},
                    {"booking_id": "B-1", "status": "confirmed", "_id": "B-1"},
                    True,
                )
            ],
            ordered=True,
        )
        collection.delete_many.assert_called_once_with(
            {"_id": {"$nin": ["B-1"]}}
        )


if __name__ == "__main__":
    unittest.main()
