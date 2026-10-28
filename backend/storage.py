import re
from datetime import date
from typing import Any

from sqlalchemy import text
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
        CREATE TABLE IF NOT EXISTS "{schema}".guest_review (
            review_code VARCHAR(40) PRIMARY KEY,
            guest_name VARCHAR(150) NOT NULL,
            booking_id VARCHAR(20) NOT NULL,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
            comment TEXT
        )
        """,
        f'ALTER TABLE "{schema}".housekeeping ADD COLUMN IF NOT EXISTS task_code VARCHAR(40)',
        f'ALTER TABLE "{schema}".housekeeping ADD COLUMN IF NOT EXISTS assigned_staff_label VARCHAR(100)',
        f'CREATE UNIQUE INDEX IF NOT EXISTS housekeeping_task_code_uq ON "{schema}".housekeeping (task_code)',
        f'ALTER TABLE "{schema}".maintenance ADD COLUMN IF NOT EXISTS issue_code VARCHAR(40)',
        f'ALTER TABLE "{schema}".maintenance ADD COLUMN IF NOT EXISTS assigned_staff_label VARCHAR(100)',
        f'CREATE UNIQUE INDEX IF NOT EXISTS maintenance_issue_code_uq ON "{schema}".maintenance (issue_code)',
    ]
    for statement in statements:
        connection.execute(text(statement))


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
                   b.special_requests, b.total_tariff
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
                   i.discount, i.total_amount, i.invoice_status
            FROM "{schema}".invoice i
            LEFT JOIN "{schema}".booking b ON b.booking_id = i.booking_id
            LEFT JOIN "{schema}".guest g ON g.guest_id = b.guest_id
            LEFT JOIN "{schema}".room r ON r.room_id = b.room_id
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
            f'SELECT review_code, guest_name, booking_id, rating, comment '
            f'FROM "{schema}".guest_review ORDER BY review_code'
        )
    ).mappings()

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
                    "paymentStatus": "Paid" if row["booking_status"] == "Checked-Out" else "Pending",
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
                    "status": "Pending" if row["invoice_status"] == "Unpaid" else row["invoice_status"],
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
                    "comment": row["comment"],
                }
            )
            for row in reviews
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
            "floor": record.get("floor") or 1,
            "status": record.get("status") or "Available",
            "price": record.get("price") or 0,
            "capacity": record.get("capacity") or 1,
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
                    "date_of_birth=:dob, phone_number=:phone, email=:email, address=:address, city=:city, "
                    "state=:state, country=:country, id_type=:id_type, id_number=:id_number WHERE guest_id=:id"
                ),
                values,
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".guest (guest_id, first_name, last_name, gender, date_of_birth, '
                    "phone_number, email, address, city, state, country, id_type, id_number) "
                    "VALUES (:id, :first, :last, :gender, :dob, :phone, :email, :address, :city, :state, "
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
                    "booking_date=CAST(:booking_date AS TIMESTAMP), check_in_date=:check_in, "
                    "check_out_date=:check_out, number_of_guests=:guests, booking_status=:status, "
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
                    "CAST(:booking_date AS TIMESTAMP), :check_in, :check_out, :guests, :status, :source, :requests, :tariff)"
                ),
                values,
            )
        if values["status"] in ("Checked-In", "Checked-Out"):
            _update_stay(connection, schema, booking_id, values["status"])
    _delete_missing(connection, schema, "booking", "booking_id", retained)


def _update_stay(connection: Connection, schema: str, booking_id: str, status: str) -> None:
    stay_id = connection.execute(
        text(f'SELECT stay_id FROM "{schema}".check_in_out WHERE booking_id=:id ORDER BY stay_id LIMIT 1'),
        {"id": booking_id},
    ).scalar_one_or_none()
    if stay_id is None:
        if status == "Checked-Out":
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".check_in_out (booking_id, actual_check_in, actual_check_out) '
                    "VALUES (:id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": booking_id},
            )
        else:
            connection.execute(
                text(
                    f'INSERT INTO "{schema}".check_in_out (booking_id, actual_check_in) '
                    "VALUES (:id, CURRENT_TIMESTAMP)"
                ),
                {"id": booking_id},
            )
    elif status == "Checked-Out":
        connection.execute(
            text(f'UPDATE "{schema}".check_in_out SET actual_check_out=CURRENT_TIMESTAMP WHERE stay_id=:stay_id'),
            {"stay_id": stay_id},
        )


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
        values = {
            "id": invoice_id,
            "booking_id": str(record.get("bookingId") or ""),
            "room_charges": record.get("roomCharges", record.get("total", 0)) or 0,
            "service_charges": record.get("serviceCharges") or 0,
            "tax": record.get("taxAmount") or 0,
            "discount": record.get("discount") or 0,
            "total": record.get("total") or 0,
            "status": "Unpaid" if status == "Pending" else status,
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
    _delete_missing(connection, schema, "invoice", "invoice_id", retained)


def _save_food_menu(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    _save_simple_table(connection, schema, "food_menu", "item_code", "itemId", records, {
        "name": lambda record: record.get("name") or "Menu Item",
        "category": lambda record: record.get("category") or "Other",
        "price": lambda record: record.get("price") or 0,
    })


def _save_food_orders(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    _save_simple_table(connection, schema, "food_order", "order_code", "orderId", records, {
        "guest_name": lambda record: record.get("guestName") or "Guest",
        "item_name": lambda record: record.get("item") or "Unknown",
        "quantity": lambda record: record.get("quantity") or 1,
        "total": lambda record: record.get("total") or 0,
        "status": lambda record: record.get("status") or "Pending",
    })


def _save_services(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    _save_simple_table(connection, schema, "hotel_service", "service_code", "serviceId", records, {
        "name": lambda record: record.get("name") or "Service",
        "category": lambda record: record.get("category") or "Other",
        "price": lambda record: record.get("price") or 0,
    })


def _save_reviews(connection: Connection, schema: str, records: list[dict[str, Any]]) -> None:
    _save_simple_table(connection, schema, "guest_review", "review_code", "reviewId", records, {
        "guest_name": lambda record: record.get("guestName") or "Guest",
        "booking_id": lambda record: record.get("bookingId") or "",
        "rating": lambda record: record.get("rating") or 5,
        "comment": lambda record: record.get("comment"),
    })


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
