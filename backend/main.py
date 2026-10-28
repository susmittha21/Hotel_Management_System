import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import threading
import time
import json
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import URL, create_engine, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.storage import (
    create_invoice,
    dashboard_analytics,
    ensure_extension_tables,
    invoice_options,
    read_collections,
    replace_collection,
    settle_invoice,
)

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
_schema_initialization_lock = threading.Lock()
_initialized_schemas: set[str] = set()

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
ROLE_MODULES = {
    "Hotel Manager": {
        "dashboard", "rooms", "bookings", "guests", "staff", "housekeeping",
        "maintenance", "invoices", "food", "services", "reviews",
    },
    "Front Desk": {"dashboard", "rooms", "bookings", "guests"},
    "Operations Staff": {"housekeeping", "maintenance", "food", "services", "reviews"},
    "Accounts Cashier": {"invoices"},
}
COLLECTION_ROLES = {
    "rooms": {"Hotel Manager", "Front Desk"},
    "guests": {"Hotel Manager", "Front Desk"},
    "bookings": {"Hotel Manager", "Front Desk"},
    "departments": {"Hotel Manager"},
    "staff": {"Hotel Manager"},
    "housekeeping": {"Hotel Manager", "Operations Staff"},
    "maintenance": {"Hotel Manager", "Operations Staff"},
    "invoices": {"Hotel Manager", "Accounts Cashier"},
    "food_menu": {"Hotel Manager", "Operations Staff"},
    "food_orders": {"Hotel Manager", "Operations Staff"},
    "services": {"Hotel Manager", "Operations Staff"},
    "reviews": {"Hotel Manager", "Operations Staff"},
}
SESSION_COOKIE = "vs_plaza_session"
SESSION_MAX_AGE = 60 * 60 * 8


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class InvoiceRequest(BaseModel):
    bookingId: str = Field(min_length=1, max_length=20)
    foodOrderIds: list[str] = Field(default_factory=list)
    serviceIds: list[str] = Field(default_factory=list)


class PaymentRequest(BaseModel):
    paymentMethod: str


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


def ensure_database_schema(schema: str) -> None:
    if schema in _initialized_schemas:
        return
    with _schema_initialization_lock:
        if schema in _initialized_schemas:
            return
        with get_engine().begin() as connection:
            ensure_extension_tables(connection, schema)
        _initialized_schemas.add(schema)


app = FastAPI(title="VS Plaza Hotel Management API", version="1.0.0")
configured_origins = os.getenv("CORS_ORIGINS", "")
allowed_origins = (
    [origin.strip().rstrip("/") for origin in configured_origins.split(",") if origin.strip()]
    if configured_origins
    else [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _configured_users() -> dict[str, tuple[str, str]]:
    config = {
        "Hotel Manager": ("PMS_MANAGER_USERNAME", "PMS_MANAGER_PASSWORD"),
        "Front Desk": ("PMS_FRONT_DESK_USERNAME", "PMS_FRONT_DESK_PASSWORD"),
        "Operations Staff": ("PMS_OPERATIONS_USERNAME", "PMS_OPERATIONS_PASSWORD"),
        "Accounts Cashier": ("PMS_ACCOUNTS_USERNAME", "PMS_ACCOUNTS_PASSWORD"),
    }
    users = {}
    usernames = set()
    for role, (username_key, password_key) in config.items():
        username = os.getenv(username_key, "").strip()
        password = os.getenv(password_key, "")
        if bool(username) != bool(password):
            raise RuntimeError(f"Configure both {username_key} and {password_key}, or leave both empty.")
        if username:
            if username.casefold() in usernames:
                raise RuntimeError("Each configured staff account must have a unique username.")
            if len(password) < 12:
                raise RuntimeError(f"{password_key} must contain at least 12 characters.")
            usernames.add(username.casefold())
            users[role] = (username, password)
    if not users:
        raise RuntimeError("Configure at least one PMS staff username and password in .env.")
    return users


def _session_secret() -> bytes:
    secret = os.getenv("PMS_SESSION_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("Set PMS_SESSION_SECRET to a random value of at least 32 characters.")
    return secret.encode("utf-8")


def _encode_session(username: str, role: str) -> str:
    payload = json.dumps(
        {"sub": username, "role": role, "exp": int(time.time()) + SESSION_MAX_AGE},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")
    signature = hmac.new(_session_secret(), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode('ascii')}"


def current_user(request: Request) -> dict[str, str]:
    token = request.cookies.get(SESSION_COOKIE, "")
    try:
        encoded, signature = token.split(".", 1)
        expected = hmac.new(_session_secret(), encoded.encode("ascii"), hashlib.sha256).digest()
        supplied = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(expected, supplied):
            raise ValueError("Invalid session signature.")
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if payload.get("exp", 0) < int(time.time()) or payload.get("role") not in ROLE_MODULES:
            raise ValueError("Expired or invalid session.")
        configured = _configured_users().get(payload.get("role"))
        if not configured or configured[0] != payload.get("sub"):
            raise ValueError("Staff account is no longer configured.")
        return {"username": payload["sub"], "role": payload["role"]}
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, RuntimeError):
        raise HTTPException(status_code=401, detail="A valid staff login is required.") from None


def _require_role(user: dict[str, str], allowed: set[str]) -> None:
    if user["role"] not in allowed:
        raise HTTPException(status_code=403, detail="Your staff role cannot access this operation.")


def _verify_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in allowed_origins:
        raise HTTPException(status_code=403, detail="Request origin is not allowed.")


@app.post("/api/auth/login")
def login(credentials: LoginRequest, request: Request, response: Response):
    _verify_origin(request)
    try:
        users = _configured_users()
        _session_secret()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    for role, (username, password) in users.items():
        username_matches = hmac.compare_digest(credentials.username.strip().casefold(), username.casefold())
        password_matches = hmac.compare_digest(credentials.password, password)
        if username_matches and password_matches:
            secure_cookie = os.getenv("PMS_COOKIE_SECURE", "false").strip().casefold() == "true"
            response.set_cookie(
                SESSION_COOKIE,
                _encode_session(username, role),
                max_age=SESSION_MAX_AGE,
                httponly=True,
                secure=secure_cookie,
                samesite="strict",
                path="/",
            )
            return {"username": username, "role": role}
    raise HTTPException(status_code=401, detail="Incorrect username or password.")


@app.get("/api/auth/me")
def who_am_i(user: dict[str, str] = Depends(current_user)):
    return user


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    _verify_origin(request)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="strict")
    return {"loggedOut": True}


@app.get("/api/data")
def get_app_data(user: dict[str, str] = Depends(current_user)):
    try:
        schema = database_settings()["schema"]
        ensure_database_schema(schema)
        with get_engine().connect() as connection:
            data = read_collections(connection, schema)
            visible = {
                collection
                for collection, roles in COLLECTION_ROLES.items()
                if user["role"] in roles
            }
            return {collection: rows for collection, rows in data.items() if collection in visible}
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
def replace_app_data(
    collection: str,
    records: list[dict[str, Any]],
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    if collection not in DATA_COLLECTIONS:
        raise HTTPException(status_code=404, detail="Unknown data collection.")
    _verify_origin(request)
    _require_role(user, COLLECTION_ROLES[collection])
    if collection == "invoices":
        raise HTTPException(
            status_code=405,
            detail="Create invoices through POST /api/invoices and settle them through the payment endpoint.",
        )

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
        ensure_database_schema(schema)
        with get_engine().begin() as connection:
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


@app.get("/api/invoice-options")
def get_invoice_options(user: dict[str, str] = Depends(current_user)):
    _require_role(user, {"Hotel Manager", "Accounts Cashier"})
    try:
        schema = database_settings()["schema"]
        ensure_database_schema(schema)
        with get_engine().connect() as connection:
            options = invoice_options(connection, schema)
        try:
            rate = Decimal(os.getenv("PMS_GST_RATE", "5"))
        except InvalidOperation:
            raise RuntimeError("PMS_GST_RATE must be a number from 0 to 100.") from None
        if rate < 0 or rate > 100:
            raise RuntimeError("PMS_GST_RATE must be a number from 0 to 100.")
        options["gstRate"] = float(rate)
        return options
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to load invoice options")
        raise HTTPException(status_code=503, detail="Unable to load invoice options from PostgreSQL.") from None


@app.post("/api/invoices", status_code=201)
def post_invoice(
    payload: InvoiceRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Accounts Cashier"})
    try:
        gst_rate = Decimal(os.getenv("PMS_GST_RATE", "5")) / 100
        if gst_rate < 0 or gst_rate > 1:
            raise ValueError("PMS_GST_RATE must be a number from 0 to 100.")
        schema = database_settings()["schema"]
        ensure_database_schema(schema)
        with get_engine().begin() as connection:
            invoice = create_invoice(
                connection,
                schema,
                payload.bookingId,
                payload.foodOrderIds,
                payload.serviceIds,
                gst_rate,
            )
        return invoice
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except (SQLAlchemyError, RuntimeError, InvalidOperation):
        logger.exception("Unable to create invoice")
        raise HTTPException(status_code=503, detail="Unable to create invoice in PostgreSQL.") from None


@app.put("/api/invoices/{invoice_id}/payment")
def put_invoice_payment(
    invoice_id: str,
    payload: PaymentRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Accounts Cashier"})
    payment_method = payload.paymentMethod.strip()
    if payment_method not in {"Cash", "Credit Card", "Debit Card", "UPI", "Net Banking"}:
        raise HTTPException(status_code=422, detail="Unsupported payment method.")
    try:
        schema = database_settings()["schema"]
        ensure_database_schema(schema)
        with get_engine().begin() as connection:
            settle_invoice(connection, schema, invoice_id, payment_method)
        return {"invoiceId": invoice_id, "status": "Paid", "paymentMethod": payment_method}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except SQLAlchemyError:
        logger.exception("Unable to record invoice payment")
        raise HTTPException(status_code=503, detail="Unable to record payment in PostgreSQL.") from None


@app.get("/api/analytics")
def get_dashboard_analytics(user: dict[str, str] = Depends(current_user)):
    _require_role(user, {"Hotel Manager", "Front Desk"})
    try:
        schema = database_settings()["schema"]
        ensure_database_schema(schema)
        with get_engine().connect() as connection:
            return dashboard_analytics(connection, schema)
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to load dashboard analytics")
        raise HTTPException(status_code=503, detail="Unable to load PostgreSQL dashboard analytics.") from None


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
def list_rooms(user: dict[str, str] = Depends(current_user)):
    _require_role(user, {"Hotel Manager", "Front Desk"})
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
