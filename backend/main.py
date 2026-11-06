import base64
import hashlib
import hmac
import logging
import os
import re
import threading
import time
import json
import urllib.error
import urllib.request
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import URL, create_engine, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from pymongo.errors import PyMongoError

from backend.mongo_store import (
    check_mongo_connection,
    get_mongo_database,
    read_collections as read_mongo_collections,
    synchronize_collections,
)
from backend.storage import (
    create_public_booking,
    create_public_booking_for_type,
    create_invoice,
    dashboard_analytics,
    ensure_extension_tables,
    ensure_default_rooms,
    ensure_default_services,
    invoice_options,
    public_available_rooms,
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
_database_sync_lock = threading.RLock()

DATA_COLLECTIONS = {
    "rooms": "roomNo",
    "guests": "guestId",
    "bookings": "bookingId",
    "departments": "departmentId",
    "staff": "staffId",
    "invoices": "invoiceId",
    "food_menu": "itemId",
    "food_orders": "orderId",
    "services": "serviceId",
    "reviews": "reviewId",
    "service_requests": "requestId",
}
ROLE_MODULES = {
    "Hotel Manager": {
        "dashboard", "rooms", "bookings", "guests", "staff", "invoices",
        "services", "reviews",
    },
    "Front Desk": {"dashboard", "rooms", "bookings", "guests", "services"},
    "Accounts Cashier": {"dashboard", "rooms", "bookings", "guests", "invoices", "services"},
    "Guest": {"guest-dashboard"},
}
COLLECTION_ROLES = {
    "rooms": {"Hotel Manager", "Front Desk", "Accounts Cashier"},
    "guests": {"Hotel Manager", "Front Desk", "Accounts Cashier"},
    "bookings": {"Hotel Manager", "Front Desk", "Accounts Cashier"},
    "departments": {"Hotel Manager"},
    "staff": {"Hotel Manager"},
    "invoices": {"Hotel Manager", "Accounts Cashier"},
    "food_menu": {"Hotel Manager"},
    "food_orders": {"Hotel Manager"},
    "services": {"Hotel Manager", "Front Desk", "Accounts Cashier"},
    "reviews": {"Hotel Manager"},
    "service_requests": {"Hotel Manager", "Front Desk", "Accounts Cashier"},
}
COLLECTION_WRITE_ROLES = {
    **COLLECTION_ROLES,
    "services": {"Hotel Manager"},
}
SESSION_COOKIE = "vs_plaza_session"
SESSION_MAX_AGE = 60 * 60 * 8


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)
    role: Literal["Hotel Manager", "Front Desk", "Accounts Cashier"]
    dbms: Literal["postgresql", "mongodb"]


class InvoiceRequest(BaseModel):
    bookingId: str = Field(min_length=1, max_length=20)
    foodOrderIds: list[str] = Field(default_factory=list)
    serviceIds: list[str] = Field(default_factory=list)


class PaymentRequest(BaseModel):
    paymentMethod: str


class RoomStatusUpdate(BaseModel):
    status: Literal["Available", "Occupied", "Reserved"]


class StaffBookingRequest(BaseModel):
    roomNo: str = Field(min_length=1, max_length=10)
    guestName: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=5, max_length=20)
    email: str | None = Field(default=None, max_length=100)
    checkIn: date
    checkOut: date
    guestsCount: int = Field(ge=1, le=8)
    specialRequests: str | None = Field(default=None, max_length=1000)
    bookingSource: Literal["Walk-In", "Online Portal", "Phone Booking", "Corporate"] = "Walk-In"
    checkInImmediately: bool = False


class GuestBookingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    roomType: str = Field(min_length=1, max_length=50)
    checkIn: date
    checkOut: date
    guestsCount: int = Field(ge=1, le=8)
    specialRequests: str | None = Field(default=None, max_length=1000)
    razorpayOrderId: str = Field(min_length=1, max_length=40)
    razorpayPaymentId: str = Field(min_length=1, max_length=40)
    razorpaySignature: str = Field(min_length=1, max_length=128)

    @field_validator("roomType")
    @classmethod
    def validate_room_type(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9 &-]{1,50}", value):
            raise ValueError("Choose a valid room type.")
        return value


class GuestRazorpayOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    roomType: str = Field(min_length=1, max_length=50)
    checkIn: date
    checkOut: date
    guestsCount: int = Field(ge=1, le=8)
    specialRequests: str | None = Field(default=None, max_length=1000)

    @field_validator("roomType")
    @classmethod
    def validate_room_type(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9 &-]{1,50}", value):
            raise ValueError("Choose a valid room type.")
        return value


class RazorpayGatewayError(RuntimeError):
    pass


def _razorpay_credentials() -> tuple[str, str]:
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id.startswith("rzp_test_") or not key_secret:
        raise RazorpayGatewayError(
            "Razorpay test mode is not configured. Set RAZORPAY_KEY_ID and "
            "RAZORPAY_KEY_SECRET with Razorpay test credentials in the backend environment."
        )
    return key_id, key_secret


def _razorpay_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    key_id, key_secret = _razorpay_credentials()
    token = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"https://api.razorpay.com/v1/{path.lstrip('/')}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
            message = body.get("error", {}).get("description", "Razorpay rejected the request.")
        except (json.JSONDecodeError, AttributeError):
            message = "Razorpay rejected the request."
        raise RazorpayGatewayError(str(message)[:240]) from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        logger.exception("Razorpay test gateway request failed")
        raise RazorpayGatewayError("Could not reach Razorpay test mode. Please try again.") from None
    if not isinstance(result, dict):
        raise RazorpayGatewayError("Razorpay returned an invalid response.")
    return result


def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    _, key_secret = _razorpay_credentials()
    expected = hmac.new(
        key_secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _normalize_guest_email(value: str) -> str:
    normalized = value.casefold()
    if normalized.count("@") != 1:
        raise ValueError("Enter a valid email address.")
    local, domain = normalized.rsplit("@", 1)
    if (
        len(local) > 64
        or local.startswith(".")
        or local.endswith(".")
        or ".." in local
        or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+", local)
        or not re.fullmatch(
            r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}",
            domain,
        )
    ):
        raise ValueError("Enter a valid email address.")
    return normalized


class GuestRegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fullName: str = Field(min_length=5, max_length=100)
    email: str = Field(min_length=6, max_length=100)
    phone: str = Field(min_length=8, max_length=20)
    password: str = Field(min_length=10, max_length=200)

    @field_validator("fullName")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        name_parts = normalized.split()
        if (
            len(name_parts) < 2
            or len(name_parts[0]) > 50
            or len(" ".join(name_parts[1:])) > 50
            or not re.fullmatch(
            r"[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*(?: [A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*)+",
            normalized,
            )
        ):
            raise ValueError("Enter a valid first and last name.")
        return normalized

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalize_guest_email(value)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        normalized = re.sub(r"[\s()-]", "", value)
        if not re.fullmatch(r"\+?[0-9]{8,15}", normalized):
            raise ValueError("Enter a valid phone number with 8 to 15 digits.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if any(character.isspace() for character in value) or not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
            raise ValueError("Password must contain a letter and a number, with no spaces.")
        return value


class GuestLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=6, max_length=100)
    password: str = Field(min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalize_guest_email(value)


class GuestServiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    serviceId: str = Field(min_length=1, max_length=40)
    bookingId: str | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=500)


class GuestReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    bookingId: str = Field(min_length=1, max_length=20)
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=3, max_length=2000)


class ServiceRequestStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["Pending", "In Progress", "Completed", "Declined"]

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


def configured_gst_rate() -> Decimal:
    try:
        rate = Decimal(os.getenv("PMS_GST_RATE", "5"))
    except InvalidOperation:
        raise RuntimeError("PMS_GST_RATE must be a number from 0 to 100.") from None
    if not rate.is_finite() or rate < 0 or rate > 100:
        raise RuntimeError("PMS_GST_RATE must be a number from 0 to 100.")
    return rate


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
            ensure_default_rooms(connection, schema)
            ensure_default_services(connection, schema)
        _initialized_schemas.add(schema)


def synchronize_databases(schema: str) -> dict[str, list[dict[str, Any]]]:
    with _database_sync_lock:
        with get_engine().connect() as connection:
            collections = read_collections(connection, schema)
        synchronize_collections(get_mongo_database(), collections, DATA_COLLECTIONS)
        return collections


def try_synchronize_mongo(schema: str) -> bool:
    try:
        synchronize_databases(schema)
        return True
    except (RuntimeError, PyMongoError):
        logger.warning(
            "MongoDB is unavailable; PostgreSQL changes are saved but not yet mirrored.",
            exc_info=True,
        )
        return False


def mongo_invoice_options(
    collections: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    invoiced_orders = {
        line.get("referenceCode")
        for invoice in collections["invoices"]
        for line in invoice.get("lines", [])
        if line.get("type") == "Food Order"
    }
    invoiced_bookings = {
        invoice.get("bookingId") for invoice in collections["invoices"]
    }
    return {
        "bookings": [
            {
                "bookingId": booking["bookingId"],
                "guestId": booking["guestId"],
                "guestName": booking["guestName"],
                "roomNo": booking["roomNo"],
                "checkIn": booking["checkIn"],
                "checkOut": booking["checkOut"],
                "roomCharges": booking["totalAmount"],
            }
            for booking in collections["bookings"]
            if booking.get("status") != "Cancelled"
            and booking.get("bookingId") not in invoiced_bookings
        ],
        "foodOrders": [
            {
                "orderId": order["orderId"],
                "guestId": order.get("guestId"),
                "guestName": order["guestName"],
                "item": order["item"],
                "quantity": order["quantity"],
                "total": order["total"],
            }
            for order in collections["food_orders"]
            if order["orderId"] not in invoiced_orders
        ],
        "services": collections["services"],
    }


def mongo_dashboard_analytics(collections: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    rooms = collections["rooms"]
    bookings = collections["bookings"]
    today = date.today().isoformat()
    totals_by_type: dict[str, dict[str, int]] = {}
    for room in rooms:
        name = room.get("type") or "Uncategorized"
        summary = totals_by_type.setdefault(name, {"total": 0, "available": 0})
        summary["total"] += 1
        if room.get("status") == "Available":
            summary["available"] += 1
    occupied = sum(room.get("status") == "Occupied" for room in rooms)
    paid_today = sum(
        float(invoice.get("total", 0))
        for invoice in collections["invoices"]
        if invoice.get("status") == "Paid"
        and not invoice.get("paymentNote")
        and str(invoice.get("paymentDate", "")).startswith(today)
    )
    return {
        "totalRooms": len(rooms),
        "occupiedRooms": occupied,
        "availableRooms": sum(room.get("status") == "Available" for room in rooms),
        "occupancyRate": round(occupied / len(rooms) * 100) if rooms else 0,
        "arrivalsToday": sum(
            booking.get("status") == "Confirmed" and booking.get("checkIn") == today
            for booking in bookings
        ),
        "departuresToday": sum(
            booking.get("status") == "Checked-In" and booking.get("checkOut") == today
            for booking in bookings
        ),
        "revenueToday": paid_today,
        "roomTypes": [
            {"name": name, **summary}
            for name, summary in sorted(totals_by_type.items())
        ],
    }


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


@app.get("/")
def api_root():
    return {
        "message": "VS Plaza Hotel Management API is running.",
        "docs": "/docs",
        "health": "/api/health",
    }


def _configured_users() -> dict[str, tuple[str, str]]:
    config = {
        "Hotel Manager": ("PMS_MANAGER_USERNAME", "PMS_MANAGER_PASSWORD"),
        "Front Desk": ("PMS_FRONT_DESK_USERNAME", "PMS_FRONT_DESK_PASSWORD"),
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


def _encode_session(username: str, role: str, dbms: str, guest_id: str | None = None) -> str:
    session = {"sub": username, "role": role, "dbms": dbms, "exp": int(time.time()) + SESSION_MAX_AGE}
    if guest_id:
        session["guestId"] = guest_id
    payload = json.dumps(
        session,
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
        if (
            payload.get("exp", 0) < int(time.time())
            or payload.get("role") not in ROLE_MODULES
        ):
            raise ValueError("Expired or invalid session.")
        if payload["role"] == "Guest":
            guest_id = payload.get("guestId")
            if not isinstance(guest_id, str) or not re.fullmatch(r"G-[A-F0-9]{16}", guest_id):
                raise ValueError("Invalid guest session.")
            if payload.get("dbms") != "postgresql":
                raise ValueError("Invalid guest session database.")
            return {"username": payload["sub"], "role": "Guest", "dbms": "postgresql", "guestId": guest_id}
        if payload.get("dbms") not in {"postgresql", "mongodb"}:
            raise ValueError("Invalid staff session database.")
        configured = _configured_users().get(payload.get("role"))
        if not configured or configured[0] != payload.get("sub"):
            raise ValueError("Staff account is no longer configured.")
        return {"username": payload["sub"], "role": payload["role"], "dbms": payload["dbms"]}
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, RuntimeError):
        raise HTTPException(status_code=401, detail="A valid login is required.") from None


def _require_role(user: dict[str, str], allowed: set[str]) -> None:
    if user["role"] not in allowed:
        raise HTTPException(status_code=403, detail="Your account cannot access this operation.")


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
    configured = users.get(credentials.role)
    if not configured:
        raise HTTPException(status_code=401, detail="No account is configured for the selected role.")
    username, password = configured
    username_matches = hmac.compare_digest(credentials.username.strip().casefold(), username.casefold())
    password_matches = hmac.compare_digest(credentials.password, password)
    if not (username_matches and password_matches):
        raise HTTPException(status_code=401, detail="Credentials do not match the selected role.")
    try:
        settings = database_settings()
        with _database_sync_lock:
            ensure_database_schema(settings["schema"])
            if credentials.dbms == "mongodb":
                synchronize_databases(settings["schema"])
    except (SQLAlchemyError, RuntimeError, ValueError, PyMongoError):
        logger.exception("Unable to synchronize PostgreSQL and MongoDB before login")
        raise HTTPException(
            status_code=503,
            detail="Both databases must be configured and reachable before login. Check PostgreSQL and MongoDB settings.",
        ) from None
    secure_cookie = os.getenv("PMS_COOKIE_SECURE", "false").strip().casefold() == "true"
    response.set_cookie(
        SESSION_COOKIE,
        _encode_session(username, credentials.role, credentials.dbms),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=secure_cookie,
        samesite="strict",
        path="/",
    )
    return {"username": username, "role": credentials.role, "dbms": credentials.dbms}


def _guest_password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return f"pbkdf2_sha256$310000${base64.urlsafe_b64encode(salt).decode('ascii')}${base64.urlsafe_b64encode(derived).decode('ascii')}"


def _verify_guest_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, rounds, salt_text, expected_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256" or int(rounds) != 310_000:
            return False
        salt = base64.urlsafe_b64decode(salt_text)
        expected = base64.urlsafe_b64decode(expected_text)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _set_login_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=os.getenv("PMS_COOKIE_SECURE", "false").strip().casefold() == "true",
        samesite="strict",
        path="/",
    )


@app.post("/api/guest/register", status_code=201)
def register_guest(payload: GuestRegisterRequest, request: Request):
    _verify_origin(request)
    try:
        _session_secret()
        schema = database_settings()["schema"]
        guest_id = f"G-{uuid4().hex[:16].upper()}"
        first_name, _, last_name = payload.fullName.partition(" ")
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                connection.execute(
                    text(
                        f'INSERT INTO "{schema}".guest '
                        "(guest_id, first_name, last_name, phone_number, email, country, id_type, id_number) "
                        "VALUES (:guest_id, :first_name, :last_name, :phone, :email, 'India', "
                        "'Not Provided', :id_number)"
                    ),
                    {
                        "guest_id": guest_id,
                        "first_name": first_name,
                        "last_name": last_name,
                        "phone": payload.phone,
                        "email": payload.email,
                        "id_number": f"ACCOUNT-{guest_id}",
                    },
                )
                connection.execute(
                    text(
                        f'INSERT INTO "{schema}".guest_account (guest_id, email_normalized, password_hash) '
                        "VALUES (:guest_id, :email, :password_hash)"
                    ),
                    {
                        "guest_id": guest_id,
                        "email": payload.email,
                        "password_hash": _guest_password_hash(payload.password),
                    },
                )
            mongo_synced = try_synchronize_mongo(schema)
        return {
            "guestId": guest_id,
            "fullName": payload.fullName,
            "email": payload.email,
            "role": "Guest",
            "registered": True,
            "mongoSynced": mongo_synced,
        }
    except IntegrityError:
        raise HTTPException(status_code=409, detail="An account already exists for that email address.") from None
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to register guest account")
        raise HTTPException(status_code=503, detail="Unable to create your account right now.") from None


@app.post("/api/guest/login")
def login_guest(credentials: GuestLoginRequest, request: Request, response: Response):
    _verify_origin(request)
    try:
        _session_secret()
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().connect() as connection:
                account = connection.execute(
                    text(
                        f'SELECT guest_id, email_normalized, password_hash '
                        f'FROM "{schema}".guest_account WHERE email_normalized=:email'
                    ),
                    {"email": credentials.email},
                ).mappings().one_or_none()
        if not account or not _verify_guest_password(credentials.password, account["password_hash"]):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        _set_login_cookie(
            response,
            _encode_session(account["email_normalized"], "Guest", "postgresql", account["guest_id"]),
        )
        return {
            "guestId": account["guest_id"],
            "email": account["email_normalized"],
            "role": "Guest",
        }
    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to sign in guest")
        raise HTTPException(status_code=503, detail="Unable to sign in right now.") from None


@app.get("/api/guest/account")
def get_guest_account(user: dict[str, str] = Depends(current_user)):
    _require_role(user, {"Guest"})
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().connect() as connection:
                data = read_collections(connection, schema)
        guest_id = user["guestId"]
        guest = next((record for record in data["guests"] if record["guestId"] == guest_id), None)
        if guest is None:
            raise HTTPException(status_code=404, detail="Guest account not found.")
        bookings = [
            {key: value for key, value in record.items() if key != "roomNo"}
            for record in data["bookings"]
            if record["guestId"] == guest_id
        ]
        return {
            "guest": guest,
            "bookings": bookings,
            "services": data["services"],
            "serviceRequests": [
                record for record in data["service_requests"] if record["guestId"] == guest_id
            ],
            "reviews": [record for record in data["reviews"] if record["guestId"] == guest_id],
        }
    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to load guest account data")
        raise HTTPException(status_code=503, detail="Unable to load your account right now.") from None


@app.post("/api/guest/reviews", status_code=201)
def create_guest_review(
    payload: GuestReviewRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Guest"})
    try:
        schema = database_settings()["schema"]
        review_id = f"REV-{uuid4().hex[:16].upper()}"
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                booking = connection.execute(
                    text(
                        f'SELECT b.booking_id, b.guest_id, b.booking_status, r.room_id, r.room_number, '
                        "g.first_name || ' ' || g.last_name AS guest_name "
                        f'FROM "{schema}".booking b JOIN "{schema}".room r ON r.room_id=b.room_id '
                        f'JOIN "{schema}".guest g ON g.guest_id=b.guest_id '
                        "WHERE b.booking_id=:booking_id AND b.guest_id=:guest_id FOR UPDATE OF b"
                    ),
                    {"booking_id": payload.bookingId, "guest_id": user["guestId"]},
                ).mappings().one_or_none()
                if booking is None:
                    raise HTTPException(status_code=404, detail="Reservation not found in your account.")
                if booking["booking_status"] != "Checked-Out":
                    raise HTTPException(status_code=409, detail="You can review a reservation after check-out.")
                existing_review = connection.execute(
                    text(
                        f'SELECT 1 FROM "{schema}".review WHERE booking_id=:booking_id LIMIT 1'
                    ),
                    {"booking_id": payload.bookingId},
                ).first()
                if existing_review:
                    raise HTTPException(status_code=409, detail="A review has already been submitted for this reservation.")
                connection.execute(
                    text(
                        f'INSERT INTO "{schema}".review '
                        "(review_code, guest_id, room_id, booking_id, rating, "
                        "cleanliness_rating, service_rating, review_comments) "
                        "VALUES (:review_id, :guest_id, :room_id, :booking_id, :rating, :rating, :rating, :comment)"
                    ),
                    {
                        "review_id": review_id,
                        "guest_id": user["guestId"],
                        "room_id": booking["room_id"],
                        "booking_id": payload.bookingId,
                        "rating": payload.rating,
                        "comment": payload.comment,
                    },
                )
            mongo_synced = try_synchronize_mongo(schema)
        return {
            "reviewId": review_id,
            "guestId": user["guestId"],
            "guestName": booking["guest_name"],
            "bookingId": payload.bookingId,
            "roomNo": booking["room_number"],
            "rating": payload.rating,
            "comment": payload.comment,
            "mongoSynced": mongo_synced,
        }
    except HTTPException:
        raise
    except IntegrityError:
        raise HTTPException(status_code=409, detail="A review could not be saved for this reservation.") from None
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to save guest review")
        raise HTTPException(status_code=503, detail="Unable to save your review right now.") from None


@app.get("/api/public/availability")
def get_public_availability(
    request: Request,
    check_in: date,
    check_out: date,
    guests_count: int = 1,
    room_type: str | None = None,
):
    _verify_origin(request)
    if check_in < date.today() or check_out <= check_in:
        raise HTTPException(status_code=422, detail="Choose a future check-in date and a later check-out date.")
    if not 1 <= guests_count <= 8:
        raise HTTPException(status_code=422, detail="Guest count must be between 1 and 8.")
    try:
        schema = database_settings()["schema"]
        gst_percent = configured_gst_rate()
        gst_rate = gst_percent / 100
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().connect() as connection:
                rooms = public_available_rooms(
                    connection, schema, check_in, check_out, guests_count, room_type or None
                )
        nights = (check_out - check_in).days
        room_types: dict[str, dict[str, Any]] = {}
        for room in rooms:
            option = room_types.setdefault(
                room["type"],
                {
                    "type": room["type"],
                    "capacity": room["capacity"],
                    "price": room["price"],
                },
            )
            option["capacity"] = max(option["capacity"], room["capacity"])
            option["price"] = min(option["price"], room["price"])
        for option in room_types.values():
            subtotal = Decimal(str(option["price"])) * nights
            half_tax = (subtotal * gst_rate / 2).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            option["nights"] = nights
            option["subtotal"] = float(subtotal)
            option["taxAmount"] = float(half_tax * 2)
            option["totalAmount"] = float(subtotal + half_tax * 2)
        return {"rooms": list(room_types.values()), "gstRate": float(gst_percent)}
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to load public room availability")
        raise HTTPException(status_code=503, detail="Unable to check room availability right now.") from None


@app.post("/api/guest/razorpay/orders")
def create_guest_razorpay_order(
    payload: GuestRazorpayOrderRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Guest"})
    if payload.checkIn < date.today() or payload.checkOut <= payload.checkIn:
        raise HTTPException(status_code=422, detail="Choose a future check-in date and a later check-out date.")
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().connect() as connection:
                available = public_available_rooms(
                    connection,
                    schema,
                    payload.checkIn,
                    payload.checkOut,
                    payload.guestsCount,
                    payload.roomType,
                )
        if not available:
            raise HTTPException(status_code=409, detail="No room of the selected type is available for those dates.")
        nights = (payload.checkOut - payload.checkIn).days
        subtotal = Decimal(str(available[0]["price"])) * nights
        gst = configured_gst_rate() / 100
        half_tax = (subtotal * gst / 2).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total = subtotal + half_tax * 2
        amount_paise = int((total * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        order = _razorpay_request(
            "POST",
            "/orders",
            {
                "amount": amount_paise,
                "currency": "INR",
                "receipt": f"guest-{uuid4().hex[:24]}",
                "notes": {
                    "guest_id": user["guestId"],
                    "room_type": payload.roomType,
                    "check_in": payload.checkIn.isoformat(),
                    "check_out": payload.checkOut.isoformat(),
                    "guests_count": str(payload.guestsCount),
                },
            },
        )
        if order.get("currency") != "INR" or order.get("amount") != amount_paise:
            raise RazorpayGatewayError("Razorpay returned an order with an unexpected amount or currency.")
        key_id, _ = _razorpay_credentials()
        return {
            "keyId": key_id,
            "orderId": order["id"],
            "amount": amount_paise,
            "currency": "INR",
            "roomType": payload.roomType,
            "nights": nights,
            "subtotal": float(subtotal),
            "taxAmount": float(half_tax * 2),
            "totalAmount": float(total),
            "paymentMode": "test",
        }
    except HTTPException:
        raise
    except RazorpayGatewayError as error:
        logger.warning("Unable to create Razorpay test order: %s", error)
        raise HTTPException(status_code=503, detail=str(error)) from None
    except (SQLAlchemyError, RuntimeError, ValueError, KeyError):
        logger.exception("Unable to create a Razorpay test order")
        raise HTTPException(status_code=503, detail="Unable to start Razorpay checkout right now.") from None


@app.post("/api/guest/bookings", status_code=201)
def create_guest_booking(
    payload: GuestBookingRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Guest"})
    if payload.checkIn < date.today() or payload.checkOut <= payload.checkIn:
        raise HTTPException(status_code=422, detail="Choose a future check-in date and a later check-out date.")
    try:
        if not re.fullmatch(r"order_[A-Za-z0-9]+", payload.razorpayOrderId):
            raise HTTPException(status_code=422, detail="Invalid Razorpay order.")
        if not re.fullmatch(r"pay_[A-Za-z0-9]+", payload.razorpayPaymentId):
            raise HTTPException(status_code=422, detail="Invalid Razorpay payment.")
        if not _verify_razorpay_signature(
            payload.razorpayOrderId, payload.razorpayPaymentId, payload.razorpaySignature
        ):
            raise HTTPException(status_code=422, detail="Razorpay payment signature could not be verified.")
        order = _razorpay_request("GET", f"/orders/{payload.razorpayOrderId}")
        notes = order.get("notes") or {}
        expected_notes = {
            "guest_id": user["guestId"],
            "room_type": payload.roomType,
            "check_in": payload.checkIn.isoformat(),
            "check_out": payload.checkOut.isoformat(),
            "guests_count": str(payload.guestsCount),
        }
        if any(notes.get(key) != value for key, value in expected_notes.items()):
            raise HTTPException(status_code=422, detail="This Razorpay order does not match your reservation.")
        payment = _razorpay_request("GET", f"/payments/{payload.razorpayPaymentId}")
        if (
            payment.get("order_id") != payload.razorpayOrderId
            or payment.get("amount") != order.get("amount")
            or payment.get("currency") != "INR"
        ):
            raise HTTPException(status_code=422, detail="Razorpay payment details do not match this order.")
        if payment.get("status") == "authorized":
            _razorpay_request(
                "POST",
                f"/payments/{payload.razorpayPaymentId}/capture",
                {"amount": payment["amount"], "currency": "INR"},
            )
            payment = _razorpay_request("GET", f"/payments/{payload.razorpayPaymentId}")
        if payment.get("status") != "captured":
            raise HTTPException(status_code=409, detail="Razorpay has not confirmed this payment.")
        payment_methods = {
            "upi": "UPI",
            "card": "Credit Card",
            "netbanking": "Net Banking",
        }
        payment_method = payment_methods.get(payment.get("method"))
        if payment_method is None:
            raise HTTPException(status_code=422, detail="This Razorpay payment method is not supported.")

        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                booking = create_public_booking_for_type(
                    connection,
                    schema,
                    room_type=payload.roomType,
                    guest_id=user["guestId"],
                    check_in=payload.checkIn,
                    check_out=payload.checkOut,
                    guests_count=payload.guestsCount,
                    special_requests=payload.specialRequests,
                    booking_source="Website",
                )
                invoice = create_invoice(
                    connection,
                    schema,
                    booking["bookingId"],
                    [],
                    [],
                    configured_gst_rate() / 100,
                )
                expected_amount = int(
                    (Decimal(str(invoice["total"])) * 100).quantize(
                        Decimal("1"), rounding=ROUND_HALF_UP
                    )
                )
                if expected_amount != order["amount"]:
                    raise ValueError("The room price changed after checkout started. Please check availability and try again.")
                payment_transaction_id = settle_invoice(
                    connection,
                    schema,
                    invoice["invoiceId"],
                    payment_method,
                    no_charge=True,
                    payment_reference=f"RAZORPAY-TEST-{payload.razorpayPaymentId}",
                )
            booking["paymentStatus"] = "Paid"
            booking["invoiceId"] = invoice["invoiceId"]
            booking["paymentMethod"] = payment_method
            booking["paymentNote"] = "Razorpay test payment. No money was charged."
            booking["paymentTransactionId"] = payment_transaction_id
            booking["paidAmount"] = invoice["total"]
            booking.pop("roomNo", None)
            booking["mongoSynced"] = try_synchronize_mongo(schema)
        return booking
    except HTTPException:
        raise
    except RazorpayGatewayError as error:
        logger.warning("Unable to verify Razorpay test payment: %s", error)
        raise HTTPException(status_code=503, detail=str(error)) from None
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except IntegrityError:
        logger.exception("PostgreSQL constraint rejected a public room booking")
        raise HTTPException(status_code=409, detail="Unable to reserve the selected room. Please try another room.") from None
    except (SQLAlchemyError, RuntimeError):
        logger.exception("Unable to save a public room booking")
        raise HTTPException(status_code=503, detail="Unable to save your reservation right now.") from None


@app.post("/api/guest/service-requests", status_code=201)
def create_guest_service_request(
    payload: GuestServiceRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Guest"})
    try:
        schema = database_settings()["schema"]
        request_id = f"SR-{uuid4().hex[:16].upper()}"
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                service = connection.execute(
                    text(
                        f'SELECT name FROM "{schema}".hotel_service WHERE service_code=:service_id'
                    ),
                    {"service_id": payload.serviceId},
                ).scalar_one_or_none()
                if service is None:
                    raise HTTPException(status_code=422, detail="Choose a valid hotel service.")
                if payload.bookingId:
                    booking = connection.execute(
                        text(
                            f'SELECT 1 FROM "{schema}".booking '
                            "WHERE booking_id=:booking_id AND guest_id=:guest_id"
                        ),
                        {"booking_id": payload.bookingId, "guest_id": user["guestId"]},
                    ).first()
                    if booking is None:
                        raise HTTPException(status_code=422, detail="Choose a reservation belonging to your account.")
                connection.execute(
                    text(
                        f'INSERT INTO "{schema}".service_request '
                        "(request_id, guest_id, service_code, booking_id, notes) "
                        "VALUES (:request_id, :guest_id, :service_id, :booking_id, :notes)"
                    ),
                    {
                        "request_id": request_id,
                        "guest_id": user["guestId"],
                        "service_id": payload.serviceId,
                        "booking_id": payload.bookingId,
                        "notes": payload.notes,
                    },
                )
            mongo_synced = try_synchronize_mongo(schema)
        return {
            "requestId": request_id,
            "guestId": user["guestId"],
            "serviceId": payload.serviceId,
            "serviceName": service,
            "bookingId": payload.bookingId,
            "notes": payload.notes,
            "status": "Pending",
            "mongoSynced": mongo_synced,
        }
    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to create guest service request")
        raise HTTPException(status_code=503, detail="Unable to send your service request right now.") from None


@app.put("/api/service-requests/{request_id}/status")
def update_service_request_status(
    request_id: str,
    payload: ServiceRequestStatusUpdate,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Front Desk", "Accounts Cashier"})
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                updated = connection.execute(
                    text(
                        f'UPDATE "{schema}".service_request SET request_status=:status '
                        "WHERE request_id=:request_id RETURNING request_id"
                    ),
                    {"status": payload.status, "request_id": request_id},
                ).scalar_one_or_none()
                if updated is None:
                    raise HTTPException(status_code=404, detail="Service request not found.")
            mongo_synced = try_synchronize_mongo(schema)
        return {"requestId": updated, "status": payload.status, "mongoSynced": mongo_synced}
    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to update guest service request status")
        raise HTTPException(status_code=503, detail="Unable to update the service request right now.") from None


@app.post("/api/bookings", status_code=201)
def create_staff_booking(
    payload: StaffBookingRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Front Desk", "Accounts Cashier"})
    if payload.checkIn < date.today() or payload.checkOut <= payload.checkIn:
        raise HTTPException(status_code=422, detail="Choose a valid check-in date and a later check-out date.")
    if len(payload.guestName.split()) < 2:
        raise HTTPException(status_code=422, detail="Enter the guest's first and last name.")
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                booking = create_public_booking(
                    connection,
                    schema,
                    room_number=payload.roomNo,
                    guest_name=payload.guestName,
                    phone=payload.phone,
                    email=payload.email,
                    check_in=payload.checkIn,
                    check_out=payload.checkOut,
                    guests_count=payload.guestsCount,
                    special_requests=payload.specialRequests,
                    booking_source=payload.bookingSource,
                    check_in_immediately=payload.checkInImmediately,
                )
            booking["mongoSynced"] = try_synchronize_mongo(schema)
        return booking
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except IntegrityError:
        logger.exception("PostgreSQL constraint rejected a staff room booking")
        raise HTTPException(status_code=409, detail="Unable to reserve the selected room. Please try another room.") from None
    except (SQLAlchemyError, RuntimeError):
        logger.exception("Unable to save a staff room booking")
        raise HTTPException(status_code=503, detail="Unable to save the reservation right now.") from None


@app.delete("/api/bookings/{booking_id}")
def delete_staff_booking(
    booking_id: str,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Front Desk", "Accounts Cashier"})
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                booking = connection.execute(
                    text(
                        f'SELECT b.booking_status, b.room_id, r.room_number, r.room_status '
                        f'FROM "{schema}".booking b JOIN "{schema}".room r ON r.room_id=b.room_id '
                        "WHERE b.booking_id=:booking_id FOR UPDATE OF b"
                    ),
                    {"booking_id": booking_id},
                ).mappings().one_or_none()
                if booking is None:
                    raise HTTPException(status_code=404, detail="Reservation not found.")
                if booking["booking_status"] in {"Checked-In", "Checked-Out"}:
                    raise HTTPException(status_code=409, detail="Completed stays cannot be deleted.")
                linked = connection.execute(
                    text(
                        f'SELECT EXISTS (SELECT 1 FROM "{schema}".invoice WHERE booking_id=:booking_id) '
                        f'OR EXISTS (SELECT 1 FROM "{schema}".review WHERE booking_id=:booking_id)'
                    ),
                    {"booking_id": booking_id},
                ).scalar_one()
                if linked:
                    raise HTTPException(status_code=409, detail="Reservations linked to invoices or reviews cannot be deleted.")
                stay_table = "check_in_out"
                for candidate in ("check_in_out", "check_in_check_out"):
                    if connection.execute(
                        text("SELECT to_regclass(:table_name)"),
                        {"table_name": f'"{schema}".{candidate}'},
                    ).scalar_one():
                        stay_table = candidate
                        break
                connection.execute(
                    text(f'DELETE FROM "{schema}".{stay_table} WHERE booking_id=:booking_id'),
                    {"booking_id": booking_id},
                )
                connection.execute(
                    text(f'DELETE FROM "{schema}".booking WHERE booking_id=:booking_id'),
                    {"booking_id": booking_id},
                )
                room_status = booking["room_status"]
                if room_status == "Reserved":
                    still_reserved = connection.execute(
                        text(
                            f'SELECT 1 FROM "{schema}".booking WHERE room_id=:room_id '
                            "AND booking_status <> 'Cancelled' LIMIT 1"
                        ),
                        {"room_id": booking["room_id"]},
                    ).first()
                    if not still_reserved:
                        room_status = "Available"
                        connection.execute(
                            text(f'UPDATE "{schema}".room SET room_status=:status WHERE room_id=:room_id'),
                            {"status": room_status, "room_id": booking["room_id"]},
                        )
            mongo_synced = try_synchronize_mongo(schema)
        return {
            "bookingId": booking_id,
            "roomNo": booking["room_number"],
            "roomStatus": room_status,
            "mongoSynced": mongo_synced,
        }
    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to delete staff reservation")
        raise HTTPException(status_code=503, detail="Unable to delete the reservation right now.") from None


@app.put("/api/bookings/{booking_id}")
def update_staff_booking(
    booking_id: str,
    payload: dict[str, Any],
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Front Desk", "Accounts Cashier"})
    if payload.get("bookingId") != booking_id:
        raise HTTPException(status_code=422, detail="Reservation ID does not match the request.")
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                exists = connection.execute(
                    text(f'SELECT 1 FROM "{schema}".booking WHERE booking_id=:booking_id FOR UPDATE'),
                    {"booking_id": booking_id},
                ).first()
                if exists is None:
                    raise HTTPException(status_code=404, detail="Reservation not found.")
                replace_collection(connection, schema, "bookings", [payload])
            mongo_synced = try_synchronize_mongo(schema)
        return {"bookingId": booking_id, "mongoSynced": mongo_synced}
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except IntegrityError:
        logger.exception("PostgreSQL constraint rejected a staff reservation update")
        raise HTTPException(status_code=409, detail="Unable to update the selected reservation.") from None
    except (SQLAlchemyError, RuntimeError):
        logger.exception("Unable to update staff reservation")
        raise HTTPException(status_code=503, detail="Unable to update the reservation right now.") from None


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
        with _database_sync_lock:
            ensure_database_schema(schema)
            if user["dbms"] == "mongodb":
                synchronize_databases(schema)
                data = read_mongo_collections(get_mongo_database(), list(DATA_COLLECTIONS))
            else:
                with get_engine().connect() as connection:
                    data = read_collections(connection, schema)
        visible = {
            collection
            for collection, roles in COLLECTION_ROLES.items()
            if user["role"] in roles
        }
        return {collection: rows for collection, rows in data.items() if collection in visible}
    except (SQLAlchemyError, RuntimeError, ValueError, PyMongoError):
        logger.exception("Unable to load application data from the selected database")
        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to load application data. Check the selected database connection and PostgreSQL schema."
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
    _require_role(user, COLLECTION_WRITE_ROLES[collection])
    if collection == "service_requests":
        raise HTTPException(
            status_code=405,
            detail="Guest service requests are created through the authenticated guest request endpoint.",
        )
    if collection in {"rooms", "bookings"}:
        raise HTTPException(
            status_code=405,
            detail=(
                "Room inventory is fixed, and reservations must use their dedicated create, update, and delete endpoints."
            ),
        )
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
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                saved = replace_collection(connection, schema, collection, records)
            mongo_synced = try_synchronize_mongo(schema)
        return {
            "collection": collection,
            "saved": saved,
            "mongoSynced": mongo_synced,
        }
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
        with _database_sync_lock:
            ensure_database_schema(schema)
            if user["dbms"] == "mongodb":
                synchronize_databases(schema)
                options = mongo_invoice_options(
                    read_mongo_collections(get_mongo_database(), list(DATA_COLLECTIONS))
                )
            else:
                with get_engine().connect() as connection:
                    options = invoice_options(connection, schema)
        rate = configured_gst_rate()
        options["gstRate"] = float(rate)
        return options
    except (SQLAlchemyError, RuntimeError, ValueError, PyMongoError):
        logger.exception("Unable to load invoice options")
        raise HTTPException(status_code=503, detail="Unable to load synchronized invoice options.") from None


@app.post("/api/invoices", status_code=201)
def post_invoice(
    payload: InvoiceRequest,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Accounts Cashier"})
    try:
        gst_rate = configured_gst_rate() / 100
        schema = database_settings()["schema"]
        with _database_sync_lock:
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
            invoice["mongoSynced"] = try_synchronize_mongo(schema)
        return invoice
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except (SQLAlchemyError, RuntimeError, InvalidOperation):
        logger.exception("Unable to create invoice")
        raise HTTPException(status_code=503, detail="Unable to create the invoice in PostgreSQL.") from None


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
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                settle_invoice(connection, schema, invoice_id, payment_method)
            mongo_synced = try_synchronize_mongo(schema)
        return {
            "invoiceId": invoice_id,
            "status": "Paid",
            "paymentMethod": payment_method,
            "mongoSynced": mongo_synced,
        }
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except (SQLAlchemyError, RuntimeError):
        logger.exception("Unable to record invoice payment")
        raise HTTPException(status_code=503, detail="Unable to record the payment in PostgreSQL.") from None


@app.get("/api/analytics")
def get_dashboard_analytics(user: dict[str, str] = Depends(current_user)):
    _require_role(user, {"Hotel Manager", "Front Desk", "Accounts Cashier"})
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            if user["dbms"] == "mongodb":
                synchronize_databases(schema)
                data = read_mongo_collections(get_mongo_database(), list(DATA_COLLECTIONS))
                return mongo_dashboard_analytics(data)
            with get_engine().connect() as connection:
                return dashboard_analytics(connection, schema)
    except (SQLAlchemyError, RuntimeError, ValueError, PyMongoError):
        logger.exception("Unable to load dashboard analytics")
        raise HTTPException(status_code=503, detail="Unable to load synchronized database analytics.") from None


@app.get("/api/health")
def health_check():
    try:
        settings = database_settings()
        engine = get_engine()
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        try:
            check_mongo_connection()
            mongodb_status = "connected"
        except (RuntimeError, PyMongoError):
            logger.info("MongoDB is unavailable; PostgreSQL remains available for the application.")
            mongodb_status = "disconnected"
        return {
            "status": "ok",
            "database": "connected",
            "database_name": settings["database"],
            "schema": settings["schema"],
            "mongodb": mongodb_status,
            "mongodb_database": os.getenv("MONGO_DB_NAME", ""),
        }
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("PostgreSQL health check failed")
        raise HTTPException(
            status_code=503,
            detail="PostgreSQL is unavailable. Check the PostgreSQL .env settings and database service.",
        ) from None


@app.get("/api/rooms")
def list_rooms(user: dict[str, str] = Depends(current_user)):
    _require_role(user, {"Hotel Manager", "Front Desk", "Accounts Cashier"})
    try:
        settings = database_settings()
        if user["dbms"] == "mongodb":
            with _database_sync_lock:
                return synchronize_databases(settings["schema"])["rooms"]
        engine = get_engine()
        query = text(
            f"""
            SELECT r.room_number, rt.type_name, r.floor_number, r.capacity, r.price,
                   r.room_status, r.view_type, r.smoking_allowed, r.amenities,
                   guest.first_name || ' ' || guest.last_name AS current_guest
            FROM "{settings['schema']}"."room" r
            LEFT JOIN "{settings['schema']}"."room_type" rt ON rt.room_type_id=r.room_type_id
            LEFT JOIN "{settings['schema']}"."booking" b
                ON b.room_id=r.room_id AND b.booking_status='Checked-In'
            LEFT JOIN "{settings['schema']}"."guest" guest ON guest.guest_id=b.guest_id
            ORDER BY r.room_number
            """
        )
        with engine.connect() as connection:
            rows = connection.execute(query).mappings().all()
        return [
            {
                "roomNo": row["room_number"],
                "type": row["type_name"] or "Standard",
                "floor": row["floor_number"],
                "capacity": row["capacity"],
                "price": float(row["price"]),
                "status": row["room_status"],
                "viewType": row["view_type"],
                "smokingAllowed": row["smoking_allowed"],
                "amenities": row["amenities"],
                "currentGuest": row["current_guest"],
            }
            for row in rows
        ]
    except (SQLAlchemyError, PyMongoError) as error:
        logger.exception("Unable to load rooms from the selected database")
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
        logger.exception("Room query configuration failed")
        raise HTTPException(
            status_code=503,
            detail="Unable to load rooms. Check the local .env settings.",
        ) from None


@app.put("/api/rooms/{room_number}/status")
def update_room_status(
    room_number: str,
    payload: RoomStatusUpdate,
    request: Request,
    user: dict[str, str] = Depends(current_user),
):
    _verify_origin(request)
    _require_role(user, {"Hotel Manager", "Front Desk", "Accounts Cashier"})
    try:
        schema = database_settings()["schema"]
        with _database_sync_lock:
            ensure_database_schema(schema)
            with get_engine().begin() as connection:
                updated = connection.execute(
                    text(
                        f'UPDATE "{schema}".room SET room_status=:status '
                        "WHERE room_number=:room_number RETURNING room_number"
                    ),
                    {"status": payload.status, "room_number": room_number},
                ).mappings().one_or_none()
                if updated is None:
                    raise HTTPException(status_code=404, detail="Room not found.")
            mongo_synced = try_synchronize_mongo(schema)
        return {"roomNo": updated["room_number"], "status": payload.status, "mongoSynced": mongo_synced}
    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError, ValueError):
        logger.exception("Unable to update room availability")
        raise HTTPException(
            status_code=503,
            detail="Unable to update room availability. Check the database connection and schema.",
        ) from None
