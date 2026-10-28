import re
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from typing import Any
from uuid import uuid4

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection


def ensure_extension_tables(connection: Connection, schema: str) -> None:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
        raise ValueError("Invalid PostgreSQL schema identifier.")

    statements = [
        f"""
        CREATE TABLE IF NOT EXISTS "{schema}".food_menu (
            item_code VARCHAR(40) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            category VARCHAR(50) NOT NULL,
            price NUMERIC(10, 2) NOT NULL CHECK (price >= 0)
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS "{schema}".food_order (
            order_code VARCHAR(40) PRIMARY KEY,
            guest_id VARCHAR(20) REFERENCES "{schema}".guest(guest_id) ON DELETE SET NULL,
            item_code VARCHAR(40) NOT NULL REFERENCES "{schema}".food_menu(item_code) ON DELETE RESTRICT,
            guest_name VARCHAR(150) NOT NULL,
            item_name VARCHAR(100) NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
            status VARCHAR(30) NOT NULL
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS "{schema}".hotel_service (
            service_code VARCHAR(40) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            category VARCHAR(50) NOT NULL,
            price NUMERIC(10, 2) NOT NULL CHECK (price >= 0)
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS "{schema}".invoice_line_item (
            line_id BIGSERIAL PRIMARY KEY,
            invoice_id VARCHAR(20) NOT NULL REFERENCES "{schema}".invoice(invoice_id) ON DELETE CASCADE,
            item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('Room', 'Food Order', 'Hotel Service')),
            reference_code VARCHAR(40),
            description VARCHAR(200) NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
            line_total NUMERIC(10, 2) NOT NULL CHECK (line_total >= 0)
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS "{schema}".review (
            review_id SERIAL PRIMARY KEY,
            review_code VARCHAR(40),
            booking_id VARCHAR(20) REFERENCES "{schema}".booking(booking_id) ON DELETE RESTRICT,
            guest_id VARCHAR(20) REFERENCES "{schema}".guest(guest_id) ON DELETE SET NULL,
            room_id INTEGER REFERENCES "{schema}".room(room_id) ON DELETE SET NULL,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
            cleanliness_rating INTEGER CHECK (cleanliness_rating BETWEEN 1 AND 5),
            service_rating INTEGER CHECK (service_rating BETWEEN 1 AND 5),
            review_comments TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        f'ALTER TABLE "{schema}".review ADD COLUMN IF NOT EXISTS review_code VARCHAR(40)',
        f'UPDATE "{schema}".review SET review_code=\'LEGACY-REVIEW-\' || review_id WHERE review_code IS NULL',
        f'CREATE UNIQUE INDEX IF NOT EXISTS review_code_uq ON "{schema}".review (review_code)',
        f'ALTER TABLE "{schema}".payment ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(20) '
        f'REFERENCES "{schema}".invoice(invoice_id) ON DELETE RESTRICT',
        f'ALTER TABLE "{schema}".invoice ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0',
        f'ALTER TABLE "{schema}".invoice ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0',
        f'DROP INDEX IF EXISTS "{schema}".payment_invoice_id_uq',
        f'ALTER TABLE "{schema}".housekeeping ADD COLUMN IF NOT EXISTS task_code VARCHAR(40)',
        f'ALTER TABLE "{schema}".housekeeping ADD COLUMN IF NOT EXISTS assigned_staff_label VARCHAR(100)',
        f'UPDATE "{schema}".housekeeping SET task_code=\'LEGACY-HK-\' || task_id WHERE task_code IS NULL',
        f'CREATE UNIQUE INDEX IF NOT EXISTS housekeeping_task_code_uq ON "{schema}".housekeeping (task_code)',
        f'ALTER TABLE "{schema}".maintenance ADD COLUMN IF NOT EXISTS issue_code VARCHAR(40)',
        f'ALTER TABLE "{schema}".maintenance ADD COLUMN IF NOT EXISTS assigned_staff_label VARCHAR(100)',
        f'UPDATE "{schema}".maintenance SET issue_code=\'LEGACY-MI-\' || issue_id WHERE issue_code IS NULL',
        f'CREATE UNIQUE INDEX IF NOT EXISTS maintenance_issue_code_uq ON "{schema}".maintenance (issue_code)',
    ]
    for statement in statements:
        connection.execute(text(statement))
    _ensure_check_in_out_table(connection, schema)
    _migrate_legacy_json_data(connection, schema)


def _ensure_check_in_out_table(connection: Connection, schema: str) -> None:
    for table in ("check_in_out", "check_in_check_out"):
        found = connection.execute(
            text("SELECT to_regclass(:table_name)"),
            {"table_name": f'"{schema}".{table}'},
        ).scalar_one()
        if found is not None:
            return
    connection.execute(
        text(
            f"""
            CREATE TABLE "{schema}".check_in_out (
                stay_id SERIAL PRIMARY KEY,
                booking_id VARCHAR(20) REFERENCES "{schema}".booking(booking_id),
                actual_check_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actual_check_out TIMESTAMP,
                key_card_number VARCHAR(20),
                front_desk_staff_id VARCHAR(20)
            )
            """
        )
    )


def _migrate_legacy_json_data(connection: Connection, schema: str) -> None:
    legacy_table = f'"{schema}".pms_app_data'
    exists = connection.execute(
        text("SELECT to_regclass(:table_name)"),
        {"table_name": legacy_table},
    ).scalar_one()
    if exists is None:
        return

    connection.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS "{schema}".hotel_app_migrations (
                migration_key VARCHAR(100) PRIMARY KEY,
                completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    migration_key = "pms-json-to-relational-v1"
    if connection.execute(
        text(f'SELECT 1 FROM "{schema}".hotel_app_migrations WHERE migration_key=:key'),
        {"key": migration_key},
    ).first():
        return

    legacy_rows = connection.execute(
        text(f'SELECT collection, payload FROM {legacy_table} ORDER BY collection, record_id')
    ).mappings()
    legacy: dict[str, list[dict[str, Any]]] = {}
    for row in legacy_rows:
        payload = row["payload"]
        if not isinstance(payload, dict):
            raise ValueError(f"Legacy PostgreSQL data for {row['collection']} is not a JSON object.")
        legacy.setdefault(row["collection"], []).append(payload)

    targets = {
        "rooms": ("room", "room_number"),
        "guests": ("guest", "guest_id"),
        "departments": ("department", "department_id"),
        "staff": ("staff", "staff_id"),
        "bookings": ("booking", "booking_id"),
        "housekeeping": ("housekeeping", "task_code"),
        "maintenance": ("maintenance", "issue_code"),
        "invoices": ("invoice", "invoice_id"),
        "food_menu": ("food_menu", "item_code"),
        "food_orders": ("food_order", "order_code"),
        "services": ("hotel_service", "service_code"),
        "reviews": ("review", "review_code"),
    }
    for collection, (table, id_column) in targets.items():
        if legacy.get(collection) and not _existing_ids(connection, schema, table, id_column):
            replace_collection(connection, schema, collection, legacy[collection])

    connection.execute(
        text(
            f'INSERT INTO "{schema}".hotel_app_migrations (migration_key) VALUES (:key) '
            "ON CONFLICT (migration_key) DO NOTHING"
        ),
        {"key": migration_key},
    )


def read_collections(connection: Connection, schema: str) -> dict[str, list[dict[str, Any]]]:
    rooms = connection.execute(
        text(
            f"""
            SELECT r.room_number, rt.type_name, r.floor_number, r.capacity, r.price,
                   r.room_status, r.view_type, r.smoking_allowed, r.amenities,
                   guest.first_name || ' ' || guest.last_name AS current_guest
            FROM "{schema}".room r
            LEFT JOIN "{schema}".room_type rt ON rt.room_type_id = r.room_type_id
            LEFT JOIN "{schema}".booking b
                ON b.room_id = r.room_id AND b.booking_status = 'Checked-In'
            LEFT JOIN "{schema}".guest guest ON guest.guest_id = b.guest_id
            ORDER BY r.room_number
            """
        )
    ).mappings()

    guests = connection.execute(
        text(
            f"""
            SELECT guest_id, first_name, last_name, gender, date_of_birth, phone_number,
                   email, address, city, state, country, id_type, id_number
            FROM "{schema}".guest ORDER BY guest_id
            """
        )
    ).mappings()

    bookings = connection.execute(
        text(
            f"""
            SELECT b.booking_id, b.guest_id, g.first_name || ' ' || g.last_name AS guest_name,
                   r.room_number, b.booking_date, b.check_in_date, b.check_out_date,
                   b.number_of_guests, b.booking_status, b.booking_source,
                   b.special_requests, b.total_tariff,
                   CASE
                       WHEN EXISTS (
                           SELECT 1 FROM "{schema}".invoice i
                           JOIN "{schema}".payment p ON p.invoice_id=i.invoice_id
                           WHERE i.booking_id=b.booking_id AND i.invoice_status='Paid'
                       ) THEN 'Paid'
                       WHEN EXISTS (
                           SELECT 1 FROM "{schema}".invoice i
                           WHERE i.booking_id=b.booking_id AND i.invoice_status='Partially Paid'
                       ) THEN 'Partially Paid'
                       ELSE 'Pending'
                   END AS payment_status
            FROM "{schema}".booking b
            JOIN "{schema}".guest g ON g.guest_id = b.guest_id
            JOIN "{schema}".room r ON r.room_id = b.room_id
            ORDER BY b.booking_date DESC, b.booking_id
            """
        )
    ).mappings()

    departments = connection.execute(
        text(
            f"""
            SELECT department_id, department_name, description
            FROM "{schema}".department ORDER BY department_id
            """
        )
    ).mappings()

    staff = connection.execute(
        text(
            f"""
            SELECT s.staff_id, s.first_name, s.last_name, d.department_name,
                   s.job_role, s.phone, s.email, s.salary
            FROM "{schema}".staff s
            LEFT JOIN "{schema}".department d ON d.department_id = s.department_id
            ORDER BY s.staff_id
            """
        )
    ).mappings()

    housekeeping = connection.execute(
        text(
            f"""
            SELECT h.task_code, h.task_id, r.room_number, h.assigned_staff_label,
                   s.first_name || ' ' || s.last_name AS staff_name, h.task_type,
                   h.scheduled_time, h.task_status
            FROM "{schema}".housekeeping h
            LEFT JOIN "{schema}".room r ON r.room_id = h.room_id
            LEFT JOIN "{schema}".staff s ON s.staff_id = h.staff_id
            ORDER BY h.scheduled_time DESC, h.task_id
            """
        )
    ).mappings()

    maintenance = connection.execute(
        text(
            f"""
            SELECT m.issue_code, m.issue_id, r.room_number, m.issue_type, m.priority,
                   m.assigned_staff_label, s.first_name || ' ' || s.last_name AS staff_name,
                   m.issue_status
            FROM "{schema}".maintenance m
            LEFT JOIN "{schema}".room r ON r.room_id = m.room_id
            LEFT JOIN "{schema}".staff s ON s.staff_id = m.staff_id
            ORDER BY m.issue_id
            """
        )
    ).mappings()

    invoices = connection.execute(
        text(
            f"""
            SELECT i.invoice_id, i.booking_id, g.first_name || ' ' || g.last_name AS guest_name,
                   r.room_number, i.room_charges, i.service_charges, i.tax_amount,
                   i.cgst_amount, i.sgst_amount, i.discount, i.total_amount,
                   i.invoice_status, p.payment_method
            FROM "{schema}".invoice i
            LEFT JOIN "{schema}".booking b ON b.booking_id = i.booking_id
            LEFT JOIN "{schema}".guest g ON g.guest_id = b.guest_id
            LEFT JOIN "{schema}".room r ON r.room_id = b.room_id
            LEFT JOIN LATERAL (
                SELECT payment_method FROM "{schema}".payment
                WHERE invoice_id=i.invoice_id AND payment_status='Completed'
                ORDER BY payment_date DESC LIMIT 1
            ) p ON TRUE
            ORDER BY i.invoice_date DESC, i.invoice_id
            """
        )
    ).mappings()

    menu = connection.execute(
        text(f'SELECT item_code, name, category, price FROM "{schema}".food_menu ORDER BY item_code')
    ).mappings()
    orders = connection.execute(
        text(
            f'SELECT order_code, guest_name, item_name, quantity, total, status '
            f'FROM "{schema}".food_order ORDER BY order_code'
        )
    ).mappings()
    services = connection.execute(
        text(f'SELECT service_code, name, category, price FROM "{schema}".hotel_service ORDER BY service_code')
    ).mappings()
    reviews = connection.execute(
        text(
            f'SELECT rv.review_code, guest.first_name || \' \' || guest.last_name AS guest_name, '
            f'rv.booking_id, rv.rating, rv.review_comments '
            f'FROM "{schema}".review rv '
            f'LEFT JOIN "{schema}".guest guest ON guest.guest_id=rv.guest_id '
            f'ORDER BY rv.created_at DESC, rv.review_id'
        )
    ).mappings()
    invoice_lines = connection.execute(
        text(
            f'SELECT invoice_id, item_type, reference_code, description, quantity, unit_price, line_total '
            f'FROM "{schema}".invoice_line_item ORDER BY line_id'
        )
    ).mappings()
    lines_by_invoice: dict[str, list[dict[str, Any]]] = {}
    for row in invoice_lines:
        lines_by_invoice.setdefault(row["invoice_id"], []).append(
            _record(
                {
                    "type": row["item_type"],
                    "referenceCode": row["reference_code"],
                    "description": row["description"],
                    "quantity": row["quantity"],
                    "unitPrice": row["unit_price"],
                    "total": row["line_total"],
                }
            )
        )

    return {
        "rooms": [
            _record(
                {
                    "roomNo": row["room_number"],
                    "type": row["type_name"] or "Standard",
                    "floor": row["floor_number"],
                    "capacity": row["capacity"],
                    "price": row["price"],
                    "status": row["room_status"],
                    "viewType": row["view_type"],
                    "smokingAllowed": row["smoking_allowed"],
                    "amenities": row["amenities"],
                    "currentGuest": row["current_guest"],
                }
            )
            for row in rooms
        ],
        "guests": [
            _record(
                {
                    "guestId": row["guest_id"],
                    "firstName": row["first_name"],
                    "lastName": row["last_name"],
                    "gender": row["gender"],
                    "dob": row["date_of_birth"],
                    "phone": row["phone_number"],
                    "email": row["email"],
                    "address": row["address"],
                    "city": row["city"],
                    "state": row["state"],
                    "country": row["country"],
                    "idType": row["id_type"],
                    "idNumber": row["id_number"],
                    "status": "Registered",
                }
            )
            for row in guests
        ],
        "bookings": [
            _record(
                {
                    "bookingId": row["booking_id"],
                    "guestId": row["guest_id"],
                    "guestName": row["guest_name"],
                    "roomNo": row["room_number"],
                    "bookingDate": row["booking_date"],
                    "checkIn": row["check_in_date"],
                    "checkOut": row["check_out_date"],
                    "guestsCount": row["number_of_guests"],
                    "status": row["booking_status"],
                    "bookingSource": row["booking_source"],
                    "specialRequests": row["special_requests"],
                    "totalAmount": row["total_tariff"],
                    "paymentStatus": row["payment_status"],
                }
            )
            for row in bookings
        ],
        "departments": [
            _record(
                {
                    "departmentId": f"DEP-{row['department_id']:02d}",
                    "name": row["department_name"],
                    "description": row["description"],
                }
            )
            for row in departments
        ],
        "staff": [
            _record(
                {
                    "staffId": row["staff_id"],
                    "firstName": row["first_name"],
                    "lastName": row["last_name"],
                    "department": row["department_name"],
                    "role": row["job_role"],
                    "phone": row["phone"],
                    "email": row["email"],
                    "salary": row["salary"],
                }
            )
            for row in staff
        ],
        "housekeeping": [
            _record(
                {
                    "taskId": row["task_code"] or str(row["task_id"]),
                    "roomNo": row["room_number"],
                    "assignedStaff": row["assigned_staff_label"] or row["staff_name"],
                    "taskType": row["task_type"],
                    "scheduledDate": row["scheduled_time"],
                    "status": row["task_status"],
                }
            )
            for row in housekeeping
        ],
        "maintenance": [
            _record(
                {
                    "issueId": row["issue_code"] or str(row["issue_id"]),
                    "roomNo": row["room_number"],
                    "issueType": row["issue_type"],
                    "priority": row["priority"],
                    "assignedTo": row["assigned_staff_label"] or row["staff_name"],
                    "status": "Open" if row["issue_status"] == "Reported" else row["issue_status"],
                }
            )
            for row in maintenance
        ],
        "invoices": [
            _record(
                {
                    "invoiceId": row["invoice_id"],
                    "bookingId": row["booking_id"],
                    "guestName": row["guest_name"],
                    "roomNo": row["room_number"],
                    "roomCharges": row["room_charges"],
                    "serviceCharges": row["service_charges"],
                    "taxAmount": row["tax_amount"],
                    "discount": row["discount"],
                    "total": row["total_amount"],
                    "cgst": row["cgst_amount"],
                    "sgst": row["sgst_amount"],
                    "status": "Pending" if row["invoice_status"] == "Unpaid" else row["invoice_status"],
                    "paymentMethod": row["payment_method"],
                    "lines": lines_by_invoice.get(row["invoice_id"], []),
                }
            )
            for row in invoices
        ],
        "food_menu": [
            _record(
                {"itemId": row["item_code"], "name": row["name"], "category": row["category"], "price": row["price"]}
            )
            for row in menu
        ],
        "food_orders": [
            _record(
                {
                    "orderId": row["order_code"],
                    "guestName": row["guest_name"],
                    "item": row["item_name"],
                    "quantity": row["quantity"],
                    "total": row["total"],
                    "status": row["status"],
                }
            )
            for row in orders
        ],
        "services": [
            _record(
                {
                    "serviceId": row["service_code"],
                    "name": row["name"],
                    "category": row["category"],
                    "price": row["price"],
                }
            )
            for row in services
        ],
        "reviews": [
            _record(
                {
                    "reviewId": row["review_code"],
                    "guestName": row["guest_name"],
                    "bookingId": row["booking_id"],
                    "rating": row["rating"],
                    "comment": row["review_comments"],
                }
            )
            for row in reviews
        ],
    }


def invoice_options(connection: Connection, schema: str) -> dict[str, list[dict[str, Any]]]:
    bookings = connection.execute(
        text(
            f"""
            SELECT b.booking_id, b.guest_id, g.first_name || ' ' || g.last_name AS guest_name,
                   r.room_number, b.check_in_date, b.check_out_date, b.total_tariff
            FROM "{schema}".booking b
            JOIN "{schema}".guest g ON g.guest_id=b.guest_id
            JOIN "{schema}".room r ON r.room_id=b.room_id
            WHERE b.booking_status <> 'Cancelled'
            ORDER BY b.booking_date DESC
            """
        )
    ).mappings()
    food_orders = connection.execute(
        text(
            f"""
            SELECT o.order_code, o.guest_id, o.guest_name, o.item_name, o.quantity, o.total
            FROM "{schema}".food_order o
            WHERE NOT EXISTS (
                SELECT 1 FROM "{schema}".invoice_line_item line
                WHERE line.item_type='Food Order' AND line.reference_code=o.order_code
            )
            ORDER BY o.order_code
            """
        )
    ).mappings()
    services = connection.execute(
        text(
            f'SELECT service_code, name, category, price '
            f'FROM "{schema}".hotel_service ORDER BY name'
        )
    ).mappings()
    return {
        "bookings": [
            _record(
                {
                    "bookingId": row["booking_id"],
                    "guestId": row["guest_id"],
                    "guestName": row["guest_name"],
                    "roomNo": row["room_number"],
                    "checkIn": row["check_in_date"],
                    "checkOut": row["check_out_date"],
                    "roomCharges": row["total_tariff"],
                }
            )
            for row in bookings
        ],
        "foodOrders": [
            _record(
                {
                    "orderId": row["order_code"],
                    "guestId": row["guest_id"],
                    "guestName": row["guest_name"],
                    "item": row["item_name"],
                    "quantity": row["quantity"],
                    "total": row["total"],
                }
            )
            for row in food_orders
        ],
        "services": [
            _record(
                {
                    "serviceId": row["service_code"],
                    "name": row["name"],
                    "category": row["category"],
                    "price": row["price"],
                }
            )
            for row in services
        ],
    }


def create_invoice(
    connection: Connection,
    schema: str,
    booking_id: str,
    food_order_ids: list[str],
    service_ids: list[str],
    gst_rate: Decimal,
) -> dict[str, Any]:
    if len(food_order_ids) != len(set(food_order_ids)) or len(service_ids) != len(set(service_ids)):
        raise ValueError("Selected food orders and services must not contain duplicates.")
    booking = connection.execute(
        text(
            f"""
            SELECT b.booking_id, b.guest_id, g.first_name || ' ' || g.last_name AS guest_name,
                   r.room_number, r.price AS nightly_rate, b.check_in_date, b.check_out_date,
                   b.total_tariff, b.booking_status
            FROM "{schema}".booking b
            JOIN "{schema}".guest g ON g.guest_id=b.guest_id
            JOIN "{schema}".room r ON r.room_id=b.room_id
            WHERE b.booking_id=:booking_id
            FOR UPDATE OF b
            """
        ),
        {"booking_id": booking_id},
    ).mappings().one_or_none()
    if booking is None:
        raise ValueError(f"Booking {booking_id} does not exist.")
    if booking["booking_status"] == "Cancelled":
        raise ValueError("An invoice cannot be created for a cancelled booking.")
    existing_invoice = connection.execute(
        text(f'SELECT 1 FROM "{schema}".invoice WHERE booking_id=:booking_id LIMIT 1'),
        {"booking_id": booking_id},
    ).first()
    if existing_invoice:
        raise ValueError(f"Booking {booking_id} already has an invoice.")
    nights = (booking["check_out_date"] - booking["check_in_date"]).days
    if nights < 1:
        raise ValueError("The booking must have at least one night before it can be invoiced.")
    room_charges = Decimal(str(booking["total_tariff"] or 0))
    if room_charges <= 0:
        room_charges = Decimal(str(booking["nightly_rate"])) * nights
    lines: list[dict[str, Any]] = [
        {
            "type": "Room",
            "referenceCode": booking_id,
            "description": f"Room {booking['room_number']} - {nights} night(s)",
            "quantity": nights,
            "unitPrice": (room_charges / nights).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            "total": room_charges,
        }
    ]

    if food_order_ids:
        orders = connection.execute(
            text(
                f"""
                SELECT o.order_code, o.item_name, o.quantity, o.total
                FROM "{schema}".food_order o
                WHERE o.order_code IN :order_ids AND o.guest_id=:guest_id
                  AND NOT EXISTS (
                      SELECT 1 FROM "{schema}".invoice_line_item line
                      WHERE line.item_type='Food Order' AND line.reference_code=o.order_code
                  )
                """
            ).bindparams(bindparam("order_ids", expanding=True)),
            {"order_ids": food_order_ids, "guest_id": booking["guest_id"]},
        ).mappings()
        orders = list(orders)
        if len(orders) != len(food_order_ids):
            raise ValueError("One or more selected food orders do not belong to this guest or were already invoiced.")
        for order in orders:
            total = Decimal(str(order["total"]))
            quantity = int(order["quantity"])
            lines.append(
                {
                    "type": "Food Order",
                    "referenceCode": order["order_code"],
                    "description": order["item_name"],
                    "quantity": quantity,
                    "unitPrice": (total / quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    "total": total,
                }
            )

    if service_ids:
        services = connection.execute(
            text(
                f'SELECT service_code, name, price FROM "{schema}".hotel_service '
                "WHERE service_code IN :service_ids"
            ).bindparams(bindparam("service_ids", expanding=True)),
            {"service_ids": service_ids},
        ).mappings()
        services = list(services)
        if len(services) != len(service_ids):
            raise ValueError("One or more selected hotel services no longer exist.")
        for service in services:
            price = Decimal(str(service["price"]))
            lines.append(
                {
                    "type": "Hotel Service",
                    "referenceCode": service["service_code"],
                    "description": service["name"],
                    "quantity": 1,
                    "unitPrice": price,
                    "total": price,
                }
            )

    room_amount = room_charges
    add_on_amount = sum((line["total"] for line in lines[1:]), Decimal("0.00"))
    subtotal = room_amount + add_on_amount
    cgst = (subtotal * gst_rate / 2).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sgst = cgst
    tax = cgst + sgst
    invoice_id = f"INV-{uuid4().hex[:16].upper()}"
    connection.execute(
        text(
            f"""
            INSERT INTO "{schema}".invoice
                (invoice_id, booking_id, room_charges, service_charges, tax_amount,
                 cgst_amount, sgst_amount, discount, total_amount, invoice_status)
            VALUES
                (:invoice_id, :booking_id, :room_charges, :service_charges, :tax,
                 :cgst, :sgst, 0, :total, 'Unpaid')
            """
        ),
        {
            "invoice_id": invoice_id,
            "booking_id": booking_id,
            "room_charges": room_amount,
            "service_charges": add_on_amount,
            "tax": tax,
            "cgst": cgst,
            "sgst": sgst,
            "total": subtotal + tax,
        },
    )
    for line in lines:
        connection.execute(
            text(
                f"""
                INSERT INTO "{schema}".invoice_line_item
                    (invoice_id, item_type, reference_code, description, quantity, unit_price, line_total)
                VALUES
                    (:invoice_id, :item_type, :reference_code, :description, :quantity, :unit_price, :line_total)
                """
            ),
            {
                "invoice_id": invoice_id,
                "item_type": line["type"],
                "reference_code": line["referenceCode"],
                "description": line["description"],
                "quantity": line["quantity"],
                "unit_price": line["unitPrice"],
                "line_total": line["total"],
            },
        )
    return {
        "invoiceId": invoice_id,
        "bookingId": booking_id,
        "guestName": booking["guest_name"],
        "roomNo": booking["room_number"],
        "roomCharges": float(room_amount),
        "serviceCharges": float(add_on_amount),
        "subtotal": float(subtotal),
        "gstRate": float(gst_rate * 100),
        "cgst": float(cgst),
        "sgst": float(sgst),
        "taxAmount": float(tax),
        "discount": 0,
        "total": float(subtotal + tax),
        "status": "Pending",
        "lines": [
            {
                **line,
                "unitPrice": float(line["unitPrice"]),
                "total": float(line["total"]),
            }
            for line in lines
        ],
    }


def settle_invoice(
    connection: Connection,
    schema: str,
    invoice_id: str,
    payment_method: str,
) -> None:
    invoice = connection.execute(
        text(
            f'SELECT invoice_id, booking_id, total_amount, invoice_status '
            f'FROM "{schema}".invoice WHERE invoice_id=:invoice_id FOR UPDATE'
        ),
        {"invoice_id": invoice_id},
    ).mappings().one_or_none()
    if invoice is None:
        raise ValueError(f"Invoice {invoice_id} does not exist.")
    if invoice["invoice_status"] == "Paid":
        raise ValueError("This invoice is already paid.")
    payment_id = f"PAY-{sha256(invoice_id.encode('utf-8')).hexdigest()[:16].upper()}"
    connection.execute(
        text(
            f"""
            INSERT INTO "{schema}".payment
                (payment_id, invoice_id, booking_id, amount, payment_method, payment_status)
            VALUES (:payment_id, :invoice_id, :booking_id, :amount, :method, 'Completed')
            ON CONFLICT (payment_id) DO NOTHING
            """
        ),
        {
            "payment_id": payment_id,
            "invoice_id": invoice_id,
            "booking_id": invoice["booking_id"],
            "amount": invoice["total_amount"],
            "method": payment_method,
        },
    )
    connection.execute(
        text(f'UPDATE "{schema}".invoice SET invoice_status=\'Paid\' WHERE invoice_id=:invoice_id'),
        {"invoice_id": invoice_id},
    )


def dashboard_analytics(connection: Connection, schema: str) -> dict[str, Any]:
    totals = connection.execute(
        text(
            f"""
            SELECT COUNT(*) AS total_rooms,
                   COUNT(*) FILTER (WHERE room_status='Occupied') AS occupied_rooms,
                   COUNT(*) FILTER (WHERE room_status='Available') AS available_rooms,
                   (
                       SELECT COUNT(*) FROM "{schema}".booking
                       WHERE booking_status='Confirmed' AND check_in_date=CURRENT_DATE
                   ) AS arrivals_today,
                   (
                       SELECT COUNT(*) FROM "{schema}".booking
                       WHERE booking_status='Checked-In' AND check_out_date=CURRENT_DATE
                   ) AS departures_today,
                   (
                       SELECT COALESCE(SUM(amount), 0) FROM "{schema}".payment
                       WHERE payment_status='Completed' AND payment_date::date=CURRENT_DATE
                   ) AS revenue_today
            FROM "{schema}".room
            """
        )
    ).mappings().one()
    room_types = connection.execute(
        text(
            f"""
            SELECT COALESCE(rt.type_name, 'Uncategorized') AS name,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE r.room_status='Available') AS available
            FROM "{schema}".room r
            LEFT JOIN "{schema}".room_type rt ON rt.room_type_id=r.room_type_id
            GROUP BY rt.type_name
            ORDER BY rt.type_name NULLS LAST
            """
        )
    ).mappings()
    total_rooms = int(totals["total_rooms"])
    occupied = int(totals["occupied_rooms"])
    return {
        "totalRooms": total_rooms,
        "occupiedRooms": occupied,
        "availableRooms": int(totals["available_rooms"]),
        "occupancyRate": round(occupied / total_rooms * 100) if total_rooms else 0,
        "arrivalsToday": int(totals["arrivals_today"]),
        "departuresToday": int(totals["departures_today"]),
        "revenueToday": float(totals["revenue_today"]),
        "roomTypes": [
            {"name": row["name"], "total": int(row["total"]), "available": int(row["available"])}
            for row in room_types
        ],
    }


def replace_collection(
    connection: Connection,
    schema: str,
    collection: str,
    records: list[dict[str, Any]],
) -> int:
    handlers = {
        "rooms": _save_rooms,
        "guests": _save_guests,
        "bookings": _save_bookings,
        "departments": _save_departments,
        "staff": _save_staff,
        "housekeeping": _save_housekeeping,
        "maintenance": _save_maintenance,
        "invoices": _save_invoices,
        "food_menu": _save_food_menu,
        "food_orders": _save_food_orders,
        "services": _save_services,
        "reviews": _save_reviews,
    }
    if collection not in handlers:
        raise ValueError("Unknown data collection.")
    handlers[collection](connection, schema, records)
    return len(records)


def _save_rooms(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "room", "room_number")
    retained = set()
    for record in records:
        number = str(record["roomNo"])
        retained.add(number)
        room_type = str(record.get("type") or "Standard")
        room_type_id = connection.execute(
            text(f'SELECT room_type_id FROM "{schema}".room_type WHERE type_name = :name ORDER BY room_type_id LIMIT 1'),
            {"name": room_type},
        ).scalar_one_or_none()
        if room_type_id is None:
            room_type_id = connection.execute(
                text(
                    f'INSERT INTO "{schema}".room_type (type_name, base_price, max_occupancy) '
                    "VALUES (:name, :price, :capacity) RETURNING room_type_id"
                ),
                {"name": room_type, "price": record.get("price", 0), "capacity": record.get("capacity", 1)},
            ).scalar_one()
        values = {
            "room_number": number,
            "room_type_id": room_type_id,
            "floor": int(record.get("floor") or 1),
            "status": record.get("status") or "Available",
            "price": record.get("price") or 0,
            "capacity": int(record.get("capacity") or 1),
            "smoking": bool(record.get("smokingAllowed", False)),
            "view": record.get("viewType"),
            "amenities": record.get("amenities"),
        }
        if number in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".room SET room_type_id=:room_type_id, floor_number=:floor, '
                    "room_status=:status, price=:price, capacity=:capacity, smoking_allowed=:smoking, "
                    "view_type=:view, amenities=:amenities WHERE room_number=:room_number"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".room (room_number, room_type_id, floor_number, room_status, '
                    "price, capacity, smoking_allowed, view_type, amenities) "
                    "VALUES (:room_number, :room_type_id, :floor, :status, :price, :capacity, :smoking, :view, :amenities)"
                ),
                values,
            )
    _delete_missing(connection, schema, "room", "room_number", retained)


def _save_guests(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "guest", "guest_id")
    retained = set()
    for record in records:
        guest_id = str(record["guestId"])
        retained.add(guest_id)
        values = {
            "id": guest_id,
            "first": str(record.get("firstName") or "Guest"),
            "last": str(record.get("lastName") or "Guest"),
            "gender": record.get("gender"),
            "dob": _date_value(record.get("dob")),
            "phone": str(record.get("phone") or "N/A"),
            "email": record.get("email"),
            "address": record.get("address"),
            "city": record.get("city"),
            "state": record.get("state"),
            "country": record.get("country") or "India",
            "id_type": record.get("idType") or "Not Provided",
            "id_number": record.get("idNumber") or f"NOT-PROVIDED-{guest_id}",
        }
        if guest_id in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".guest SET first_name=:first, last_name=:last, gender=:gender, '
                    "date_of_birth=CAST(:dob AS DATE), phone_number=:phone, email=:email, address=:address, city=:city, "
                    "state=:state, country=:country, id_type=:id_type, id_number=:id_number WHERE guest_id=:id"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".guest (guest_id, first_name, last_name, gender, date_of_birth, '
                    "phone_number, email, address, city, state, country, id_type, id_number) "
                    "VALUES (:id, :first, :last, :gender, CAST(:dob AS DATE), :phone, :email, :address, :city, :state, "
                    ":country, :id_type, :id_number)"
                ),
                values,
            )
    _delete_missing(connection, schema, "guest", "guest_id", retained)


def _save_bookings(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "booking", "booking_id")
    retained = set()
    for record in records:
        booking_id = str(record["bookingId"])
        retained.add(booking_id)
        room_id = connection.execute(
            text(f'SELECT room_id FROM "{schema}".room WHERE room_number=:number'),
            {"number": record.get("roomNo")},
        ).scalar_one_or_none()
        if room_id is None:
            raise ValueError(f"Room {record.get('roomNo')} does not exist.")
        values = {
            "id": booking_id,
            "guest_id": str(record.get("guestId") or ""),
            "room_id": room_id,
            "booking_date": record.get("bookingDate") or date.today().isoformat(),
            "check_in": record.get("checkIn"),
            "check_out": record.get("checkOut"),
            "guests": int(record.get("guestsCount") or 1),
            "status": record.get("status") or "Confirmed",
            "source": record.get("bookingSource") or "Walk-In",
            "requests": record.get("specialRequests"),
            "tariff": record.get("totalAmount") or 0,
        }
        if existing and booking_id in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".booking SET guest_id=:guest_id, room_id=:room_id, '
                    "booking_date=CAST(:booking_date AS TIMESTAMP), check_in_date=CAST(:check_in AS DATE), "
                    "check_out_date=CAST(:check_out AS DATE), number_of_guests=:guests, booking_status=:status, "
                    "booking_source=:source, special_requests=:requests, total_tariff=:tariff "
                    "WHERE booking_id=:id"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".booking (booking_id, guest_id, room_id, booking_date, '
                    "check_in_date, check_out_date, number_of_guests, booking_status, booking_source, "
                    "special_requests, total_tariff) VALUES (:id, :guest_id, :room_id, "
                    "CAST(:booking_date AS TIMESTAMP), CAST(:check_in AS DATE), CAST(:check_out AS DATE), "
                    ":guests, :status, :source, :requests, :tariff)"
                ),
                values,
            )
        if values["status"] in ("Checked-In", "Checked-Out"):
            _update_stay(connection, schema, booking_id, values["status"])
    _delete_missing(connection, schema, "booking", "booking_id", retained)


def _update_stay(connection: Connection, schema: str, booking_id: str, status: str) -> None:
    table = _check_in_out_table(connection, schema)
    stay_id = connection.execute(
        text(f'SELECT stay_id FROM "{schema}".{table} WHERE booking_id=:id ORDER BY stay_id LIMIT 1'),
        {"id": booking_id},
    ).scalar_one_or_none()
    if stay_id is None:
        if status == "Checked-Out":
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".{table} (booking_id, actual_check_in, actual_check_out) '
                    "VALUES (:id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": booking_id},
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".{table} (booking_id, actual_check_in) '
                    "VALUES (:id, CURRENT_TIMESTAMP)"
                ),
                {"id": booking_id},
            )
    elif status == "Checked-Out":
        connection.execute(
            text(f'UPDATE "{schema}".{table} SET actual_check_out=CURRENT_TIMESTAMP WHERE stay_id=:stay_id'),
            {"stay_id": stay_id},
        )


def _check_in_out_table(connection: Connection, schema: str) -> str:
    for table in ("check_in_out", "check_in_check_out"):
        exists = connection.execute(
            text("SELECT to_regclass(:table_name)"),
            {"table_name": f'"{schema}".{table}'},
        ).scalar_one()
        if exists is not None:
            return table
    raise ValueError("Neither CHECK_IN_OUT nor CHECK_IN_CHECK_OUT table exists.")


def _save_departments(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing_rows = connection.execute(
        text(f'SELECT department_id, department_name FROM "{schema}".department')
    ).mappings()
    by_name = {row["department_name"]: row["department_id"] for row in existing_rows}
    retained = set()
    for record in records:
        name = str(record["name"])
        retained.add(name)
        if name in by_name:
            connection.execute(
                text(f'UPDATE "{schema}".department SET description=:description WHERE department_id=:id'),
                {"description": record.get("description"), "id": by_name[name]},
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".department (department_name, description) VALUES (:name, :description)'
                ),
                {"name": name, "description": record.get("description")},
            )
    for name in set(by_name) - retained:
        connection.execute(
            text(f'DELETE FROM "{schema}".department WHERE department_name=:name'),
            {"name": name},
        )


def _save_staff(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "staff", "staff_id")
    retained = set()
    for record in records:
        staff_id = str(record["staffId"])
        retained.add(staff_id)
        department_id = None
        department_name = record.get("department")
        if department_name:
            department_id = connection.execute(
                text(f'SELECT department_id FROM "{schema}".department WHERE department_name=:name'),
                {"name": department_name},
            ).scalar_one_or_none()
        values = {
            "id": staff_id,
            "first": record.get("firstName") or "Staff",
            "last": record.get("lastName") or "Member",
            "phone": record.get("phone") or "N/A",
            "email": record.get("email"),
            "department_id": department_id,
            "role": record.get("role") or "Staff",
            "salary": record.get("salary") or 0,
        }
        if staff_id in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".staff SET first_name=:first, last_name=:last, phone=:phone, '
                    "email=:email, department_id=:department_id, job_role=:role, salary=:salary WHERE staff_id=:id"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".staff (staff_id, first_name, last_name, phone, email, '
                    "department_id, job_role, salary) VALUES (:id, :first, :last, :phone, :email, "
                    ":department_id, :role, :salary)"
                ),
                values,
            )
    _delete_missing(connection, schema, "staff", "staff_id", retained)


def _save_housekeeping(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "housekeeping", "task_code")
    retained = set()
    for record in records:
        code = str(record["taskId"])
        retained.add(code)
        room_id, staff_id = _room_and_staff(connection, schema, record.get("roomNo"), record.get("assignedStaff"))
        values = {
            "code": code,
            "room_id": room_id,
            "staff_id": staff_id,
            "staff_label": record.get("assignedStaff"),
            "type": record.get("taskType") or "Daily Cleaning",
            "status": record.get("status") or "Pending",
            "scheduled": record.get("scheduledDate"),
        }
        if code in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".housekeeping SET room_id=:room_id, staff_id=:staff_id, '
                    "assigned_staff_label=:staff_label, task_type=:type, task_status=:status, "
                    "scheduled_time=COALESCE(CAST(:scheduled AS TIMESTAMP), scheduled_time) WHERE task_code=:code"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".housekeeping '
                    "(task_code, room_id, staff_id, assigned_staff_label, task_type, task_status, scheduled_time) "
                    "VALUES (:code, :room_id, :staff_id, :staff_label, :type, :status, "
                    "COALESCE(CAST(:scheduled AS TIMESTAMP), CURRENT_TIMESTAMP))"
                ),
                values,
            )
    _delete_missing(connection, schema, "housekeeping", "task_code", retained)


def _save_maintenance(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "maintenance", "issue_code")
    retained = set()
    for record in records:
        code = str(record["issueId"])
        retained.add(code)
        room_id, staff_id = _room_and_staff(connection, schema, record.get("roomNo"), record.get("assignedTo"))
        status = record.get("status") or "Open"
        values = {
            "code": code,
            "room_id": room_id,
            "staff_id": staff_id,
            "staff_label": record.get("assignedTo"),
            "type": record.get("issueType") or "Other",
            "priority": record.get("priority") or "Medium",
            "status": "Reported" if status == "Open" else status,
        }
        if code in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".maintenance SET room_id=:room_id, staff_id=:staff_id, '
                    "assigned_staff_label=:staff_label, issue_type=:type, priority=:priority, "
                    "issue_status=:status WHERE issue_code=:code"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".maintenance '
                    "(issue_code, room_id, staff_id, assigned_staff_label, issue_type, priority, issue_status) "
                    "VALUES (:code, :room_id, :staff_id, :staff_label, :type, :priority, :status)"
                ),
                values,
            )
    _delete_missing(connection, schema, "maintenance", "issue_code", retained)


def _save_invoices(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "invoice", "invoice_id")
    retained = set()
    for record in records:
        invoice_id = str(record["invoiceId"])
        retained.add(invoice_id)
        status = record.get("status") or "Pending"
        database_status = "Unpaid" if status == "Pending" else status
        values = {
            "id": invoice_id,
            "booking_id": str(record.get("bookingId") or ""),
            "room_charges": record.get("roomCharges", record.get("total", 0)) or 0,
            "service_charges": record.get("serviceCharges") or 0,
            "tax": record.get("taxAmount") or 0,
            "discount": record.get("discount") or 0,
            "total": record.get("total") or 0,
            "status": database_status,
        }
        if invoice_id in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".invoice SET booking_id=:booking_id, room_charges=:room_charges, '
                    "service_charges=:service_charges, tax_amount=:tax, discount=:discount, "
                    "total_amount=:total, invoice_status=:status WHERE invoice_id=:id"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".invoice '
                    "(invoice_id, booking_id, room_charges, service_charges, tax_amount, discount, total_amount, invoice_status) "
                    "VALUES (:id, :booking_id, :room_charges, :service_charges, :tax, :discount, :total, :status)"
                ),
                values,
            )
        if database_status == "Paid":
            method = record.get("paymentMethod")
            valid_methods = {"Cash", "Credit Card", "Debit Card", "UPI", "Net Banking"}
            if method not in valid_methods:
                raise ValueError(f"A valid payment method is required to settle invoice {invoice_id}.")
            payment_id = f"PAY-{sha256(invoice_id.encode('utf-8')).hexdigest()[:16]}"
            payment = {
                "payment_id": payment_id,
                "invoice_id": invoice_id,
                "booking_id": values["booking_id"],
                "amount": values["total"],
                "method": method,
            }
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".payment '
                    "(payment_id, invoice_id, booking_id, amount, payment_method, payment_status) "
                    "VALUES (:payment_id, :invoice_id, :booking_id, :amount, :method, 'Completed') "
                    "ON CONFLICT (payment_id) DO UPDATE SET invoice_id=EXCLUDED.invoice_id, "
                    "booking_id=EXCLUDED.booking_id, "
                    "amount=EXCLUDED.amount, payment_method=EXCLUDED.payment_method, "
                    "payment_status='Completed'"
                ),
                payment,
            )
    _delete_missing(connection, schema, "invoice", "invoice_id", retained)


def _save_food_menu(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    _save_simple_table(connection, schema, "food_menu", "item_code", "itemId", records, {
        "name": lambda record: record.get("name") or "Menu Item",
        "category": lambda record: record.get("category") or "Other",
        "price": lambda record: record.get("price") or 0,
    })


def _save_food_orders(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "food_order", "order_code")
    retained = set()
    for record in records:
        code = str(record["orderId"])
        retained.add(code)
        item = str(record.get("item") or "")
        item_code = connection.execute(
            text(f'SELECT item_code FROM "{schema}".food_menu WHERE name=:name ORDER BY item_code LIMIT 1'),
            {"name": item},
        ).scalar_one_or_none()
        if item_code is None:
            raise ValueError(f"Food menu item {item} does not exist.")
        guest_name = record.get("guestName") or "Guest"
        guest_id = connection.execute(
            text(
                f'SELECT guest_id FROM "{schema}".guest '
                "WHERE first_name || ' ' || last_name=:name ORDER BY guest_id LIMIT 1"
            ),
            {"name": guest_name},
        ).scalar_one_or_none()
        values = {
            "code": code,
            "guest_id": guest_id,
            "item_code": item_code,
            "guest_name": guest_name,
            "item_name": item,
            "quantity": int(record.get("quantity") or 1),
            "total": record.get("total") or 0,
            "status": record.get("status") or "Pending",
        }
        if code in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".food_order SET guest_id=:guest_id, item_code=:item_code, '
                    "guest_name=:guest_name, item_name=:item_name, quantity=:quantity, total=:total, "
                    "status=:status WHERE order_code=:code"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".food_order '
                    "(order_code, guest_id, item_code, guest_name, item_name, quantity, total, status) "
                    "VALUES (:code, :guest_id, :item_code, :guest_name, :item_name, :quantity, :total, :status)"
                ),
                values,
            )
    _delete_missing(connection, schema, "food_order", "order_code", retained)


def _save_services(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    _save_simple_table(connection, schema, "hotel_service", "service_code", "serviceId", records, {
        "name": lambda record: record.get("name") or "Service",
        "category": lambda record: record.get("category") or "Other",
        "price": lambda record: record.get("price") or 0,
    })


def _save_reviews(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    existing = _existing_ids(connection, schema, "review", "review_code")
    retained = set()
    for record in records:
        code = str(record["reviewId"])
        retained.add(code)
        booking_id = str(record.get("bookingId") or "")
        booking = connection.execute(
            text(f'SELECT guest_id, room_id FROM "{schema}".booking WHERE booking_id=:id'),
            {"id": booking_id},
        ).mappings().one_or_none()
        if booking is None:
            raise ValueError(f"Booking {booking_id} does not exist.")
        values = {
            "code": code,
            "guest_id": booking["guest_id"],
            "room_id": booking["room_id"],
            "booking_id": booking_id,
            "rating": int(record.get("rating") or 5),
            "comment": record.get("comment"),
        }
        if code in existing:
            connection.execute(
                text(
                    f'UPDATE "{schema}".review SET guest_id=:guest_id, room_id=:room_id, '
                    "booking_id=:booking_id, rating=:rating, cleanliness_rating=:rating, "
                    "service_rating=:rating, review_comments=:comment WHERE review_code=:code"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".review '
                    "(review_code, guest_id, room_id, booking_id, rating, cleanliness_rating, "
                    "service_rating, review_comments) VALUES (:code, :guest_id, :room_id, :booking_id, "
                    ":rating, :rating, :rating, :comment)"
                ),
                values,
            )
    _delete_missing(connection, schema, "review", "review_code", retained)


def _save_simple_table(
    connection: Connection,
    schema: str,
    table: str,
    id_column: str,
    id_field: str,
    records: list[dict[str, Any]],
    fields: dict[str, Any],
) -> None:
    existing = _existing_ids(connection, schema, table, id_column)
    retained = set()
    columns = [id_column, *fields]
    assignments = ", ".join(f"{column}=:{column}" for column in fields)
    column_list = ", ".join(columns)
    value_list = ", ".join(f":{column}" for column in columns)
    for record in records:
        record_id = str(record[id_field])
        retained.add(record_id)
        values = {column: getter(record) for column, getter in fields.items()}
        values[id_column] = record_id
        if record_id in existing:
            connection.execute(
                text(f'UPDATE "{schema}".{table} SET {assignments} WHERE {id_column}=:{id_column}'),
                values,
            )
        else:
            connection.execute(
                text(f'INSERT INTO "{schema}".{table} ({column_list}) VALUES ({value_list})'),
                values,
            )
    _delete_missing(connection, schema, table, id_column, retained)


def _room_and_staff(
    connection: Connection, schema: str, room_number: Any, staff_label: Any
) -> tuple[Any, Any]:
    room_id = None
    if room_number:
        room_id = connection.execute(
            text(f'SELECT room_id FROM "{schema}".room WHERE room_number=:number'),
            {"number": room_number},
        ).scalar_one_or_none()
        if room_id is None:
            raise ValueError(f"Room {room_number} does not exist.")
    staff_id = None
    if staff_label:
        staff_id = connection.execute(
            text(
                f'SELECT staff_id FROM "{schema}".staff WHERE staff_id=:value '
                "OR first_name || ' ' || last_name=:value ORDER BY staff_id LIMIT 1"
            ),
            {"value": staff_label},
        ).scalar_one_or_none()
    return room_id, staff_id


def _existing_ids(connection: Connection, schema: str, table: str, column: str) -> set[Any]:
    rows = connection.execute(text(f'SELECT {column} FROM "{schema}".{table}'))
    return {row[0] for row in rows}


def _delete_missing(
    connection: Connection, schema: str, table: str, column: str, retained: set[Any]
) -> None:
    existing = _existing_ids(connection, schema, table, column)
    for value in existing - retained:
        connection.execute(
            text(f'DELETE FROM "{schema}".{table} WHERE {column}=:value'),
            {"value": value},
        )


def _date_value(value: Any) -> Any:
    if value in (None, ""):
        return None
    return value


def _record(values: dict[str, Any]) -> dict[str, Any]:
    result = {}
    for key, value in values.items():
        if value is not None:
            result[key] = value.isoformat() if hasattr(value, "isoformat") else value
    return result
