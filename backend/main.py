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
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.storage import ensure_extension_tables, read_collections, replace_collection

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
        schema = database_settings()["schema"]
        with get_engine().begin() as connection:
            ensure_extension_tables(connection, schema)
            return read_collections(connection, schema)
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to load application data from PostgreSQL")
        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to load application data from PostgreSQL. Confirm the schema tables "
                "from README.md exist and check the database connection."
            ),
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
        schema = database_settings()["schema"]
        with get_engine().begin() as connection:
            ensure_extension_tables(connection, schema)
            saved = replace_collection(connection, schema, collection, records)
        return {"collection": collection, "saved": saved}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except IntegrityError:
        logger.exception("PostgreSQL constraint rejected %s", collection)
        raise HTTPException(
            status_code=409,
            detail=(
                f"PostgreSQL rejected {collection}. Check required related records, "
                "duplicate values, and the database constraints."
            ),
        ) from None
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
