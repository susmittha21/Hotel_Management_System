import logging
import os
import re
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import URL, create_engine, text
from sqlalchemy.exc import SQLAlchemyError

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_COLLECTIONS = {
    "rooms": "roomNo",
    "guests": "guestId",
    "bookings": "bookingId",
    "departments": "departmentId",
    "staff": "staffId",
    "housekeeping": "taskId",
    "maintenance": "issueId",
    "invoices": "invoiceId",
    "food_menu": "itemId",
    "food_orders": "orderId",
    "services": "serviceId",
    "reviews": "reviewId",
}


def database_settings() -> dict[str, Any]:
    schema = os.getenv("DB_SCHEMA", "public")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
        raise RuntimeError("DB_SCHEMA must be a valid PostgreSQL schema identifier.")

    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "database": os.getenv("DB_NAME", ""),
        "username": os.getenv("DB_USER", ""),
        "password": os.getenv("DB_PASSWORD", ""),
        "schema": schema,
    }


@lru_cache(maxsize=1)
def get_engine():
    settings = database_settings()
    if not settings["database"] or not settings["username"]:
        raise RuntimeError("Set DB_NAME and DB_USER in the project .env file.")

    url = URL.create(
        "postgresql+psycopg",
        username=settings["username"],
        password=settings["password"],
        host=settings["host"],
        port=settings["port"],
        database=settings["database"],
    )
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def ensure_app_data_table():
    schema = database_settings()["schema"]
    with get_engine().begin() as connection:
        connection.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS "{schema}"."pms_app_data" (
                    collection VARCHAR(40) NOT NULL,
                    record_id VARCHAR(100) NOT NULL,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (collection, record_id)
                )
                """
            )
        )


app = FastAPI(title="VS Plaza Hotel Management API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/data")
def get_app_data():
    try:
        ensure_app_data_table()
        schema = database_settings()["schema"]
        with get_engine().connect() as connection:
            rows = connection.execute(
                text(
                    f'SELECT collection, payload FROM "{schema}"."pms_app_data" '
                    "ORDER BY collection, record_id"
                )
            ).mappings()
            data = {collection: [] for collection in DATA_COLLECTIONS}
            for row in rows:
                if row["collection"] in data:
                    data[row["collection"]].append(row["payload"])
        return data
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to load application data from PostgreSQL")
        raise HTTPException(
            status_code=503,
            detail="Unable to load application data from PostgreSQL. Check the database connection and schema.",
        ) from None


@app.put("/api/data/{collection}")
def replace_app_data(collection: str, records: list[dict[str, Any]]):
    if collection not in DATA_COLLECTIONS:
        raise HTTPException(status_code=404, detail="Unknown data collection.")

    id_field = DATA_COLLECTIONS[collection]
    record_ids = []
    for record in records:
        record_id = record.get(id_field)
        if not isinstance(record_id, (str, int)) or not str(record_id).strip():
            raise HTTPException(
                status_code=422,
                detail=f"Every {collection} record must include a non-empty {id_field}.",
            )
        record_ids.append(str(record_id))
    if len(record_ids) != len(set(record_ids)):
        raise HTTPException(status_code=409, detail=f"Duplicate {id_field} values are not allowed.")

    try:
        ensure_app_data_table()
        schema = database_settings()["schema"]
        with get_engine().begin() as connection:
            connection.execute(
                text(
                    f'DELETE FROM "{schema}"."pms_app_data" WHERE collection = :collection'
                ),
                {"collection": collection},
            )
            if records:
                connection.execute(
                    text(
                        f"""
                        INSERT INTO "{schema}"."pms_app_data"
                            (collection, record_id, payload, updated_at)
                        VALUES (:collection, :record_id, CAST(:payload AS JSONB), CURRENT_TIMESTAMP)
                        """
                    ),
                    [
                        {
                            "collection": collection,
                            "record_id": str(record[id_field]),
                            "payload": json.dumps(record, ensure_ascii=False),
                        }
                        for record in records
                    ],
                )
        return {"collection": collection, "saved": len(records)}
    except SQLAlchemyError:
        logger.exception("Unable to save %s to PostgreSQL", collection)
        raise HTTPException(
            status_code=503,
            detail=f"Unable to save {collection} in PostgreSQL.",
        ) from None


@app.get("/api/health")
def health_check():
    try:
        settings = database_settings()
        engine = get_engine()
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "database": "connected",
            "database_name": settings["database"],
            "schema": settings["schema"],
        }
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("PostgreSQL health check failed")
        raise HTTPException(
            status_code=503,
            detail="PostgreSQL is unavailable. Check the local .env settings and database service.",
        ) from None


@app.get("/api/rooms")
def list_rooms():
    try:
        settings = database_settings()
        engine = get_engine()
        query = text(
            f"""
            SELECT room_id, room_number, room_type_id, floor_number, room_status,
                   price, capacity, smoking_allowed, view_type, amenities
            FROM "{settings['schema']}"."room"
            ORDER BY room_number
            """
        )
        with engine.connect() as connection:
            rows = connection.execute(query).mappings().all()
        return [dict(row) for row in rows]
    except SQLAlchemyError as error:
        logger.exception("Unable to load rooms from PostgreSQL")
        if getattr(getattr(error, "orig", None), "sqlstate", None) == "42P01":
            raise HTTPException(
                status_code=503,
                detail=f"Room table is missing from schema '{database_settings()['schema']}'. Run the PostgreSQL schema SQL from README.md.",
            ) from None
        raise HTTPException(
            status_code=503,
            detail="Unable to load rooms. Check the database connection and schema.",
        ) from None
    except (RuntimeError, ValueError):
        logger.exception("PostgreSQL room query configuration failed")
        raise HTTPException(
            status_code=503,
            detail="Unable to load rooms. Check the local .env settings.",
        ) from None
