import os
from functools import lru_cache
from typing import Any

from pymongo import MongoClient, ReplaceOne
from pymongo.collection import Collection
from pymongo.database import Database


@lru_cache(maxsize=1)
def get_mongo_client() -> MongoClient:
    uri = os.getenv("MONGO_URI", "").strip()
    if not uri:
        raise RuntimeError("Set MONGO_URI in the project .env file.")
    return MongoClient(uri, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)


def get_mongo_database() -> Database:
    name = os.getenv("MONGO_DB_NAME", "").strip()
    if not name:
        raise RuntimeError("Set MONGO_DB_NAME in the project .env file.")
    return get_mongo_client()[name]


def check_mongo_connection() -> None:
    get_mongo_database().command("ping")


def replace_documents(
    collection: Collection,
    id_field: str,
    records: list[dict[str, Any]],
) -> None:
    collection.create_index(id_field, unique=True)
    operations = [
        ReplaceOne({id_field: record[id_field]}, record, upsert=True)
        for record in records
    ]
    if operations:
        collection.bulk_write(operations, ordered=True)

    retained_ids = [record[id_field] for record in records]
    collection.delete_many({id_field: {"$nin": retained_ids}})


def synchronize_collections(
    database: Database,
    collections: dict[str, list[dict[str, Any]]],
    id_fields: dict[str, str],
) -> None:
    check_mongo_connection()
    for name, records in collections.items():
        replace_documents(database[name], id_fields[name], records)


def read_collections(
    database: Database,
    collection_names: list[str],
) -> dict[str, list[dict[str, Any]]]:
    check_mongo_connection()
    return {
        name: [
            {key: value for key, value in document.items() if key != "_id"}
            for document in database[name].find({}, {"_id": False})
        ]
        for name in collection_names
    }
