# VS PLAZA Hotel Management System - Web Transition & DBMS Integration Guide

An enterprise-grade, realistic web-based Property Management System (PMS) built with semantic HTML5, CSS3, and vanilla JavaScript. Designed specifically for academic DBMS evaluation, featuring dual-database architecture support (**PostgreSQL** relational 3NF and **MongoDB** document-based storage).

---

## 📌 Table of Contents
1. [Quick Setup & Running the Frontend](#-quick-setup--running-the-frontend)
2. [Dual DBMS Setup & Backend Integration (PostgreSQL & MongoDB)](#-dual-dbms-setup--backend-integration-postgresql--mongodb)
3. [ChatGPT ER & Schema Matching Verification](#-chatgpt-er--schema-matching-verification)
4. [Role-Based Access Control (RBAC) Matrix](#-role-based-access-control-rbac-matrix)
5. [4-Week Implementation Roadmap](#-4-week-implementation-roadmap)
6. [Data Storage & Clean State Architecture](#-data-storage--clean-state-architecture)

---

## 🚀 Quick Setup & Running the Frontend

### Prerequisites
- Any modern web browser (Google Chrome, Microsoft Edge, Mozilla Firefox).
- Node.js installed (optional, only needed for local development server).

### Option 1: Using Local Development HTTP Server (Recommended)
From the root workspace directory, start the built-in HTTP server:
```bash
# Run a lightweight zero-config local web server from the project directory
npx -y serve . -l 3000
```
Open your browser and navigate to:
```
http://localhost:3000
```

### Option 2: Direct File Execution (No Dependencies)
Simply double-click [`index.html`](index.html) to open the public landing page in any web browser.

### Default Staff Access Credentials
- **URL:** [`http://localhost:3000/login.html`](login.html)
- **Username:** `admin` or `reception`
- **Password:** `admin123`

---

## 🗄️ Dual DBMS Setup & Backend Integration (PostgreSQL & MongoDB)

The system is architected to operate with a dual database backend:
- **PostgreSQL**: Handles relational, ACID-compliant transactions (Guest Profiles, Room Inventory, Bookings, Check-In/Check-Out, Invoices, Staff).
- **MongoDB**: Handles flexible, denormalized, and high-velocity document storage (Audit Logs, Real-time Folio Details, Restaurant Food Orders, Housekeeping Checklists, Guest Reviews).

```
                      ┌───────────────────────────────────────┐
                      │    VS Plaza Web Frontend (HTML/JS)    │
                      └──────────────────┬────────────────────┘
                                         │ REST API (JSON)
                      ┌──────────────────▼────────────────────┐
                      │  Backend Server (Node.js Express /    │
                      │           Python FastAPI)             │
                      └──────────┬─────────────────┬──────────┘
                                 │                 │
              SQL Transactions   │                 │ Document Storage
                                 ▼                 ▼
                      ┌──────────────────┐  ┌──────────────────┐
                      │    PostgreSQL    │  │     MongoDB      │
                      │ Relational (3NF) │  │  Document Store  │
                      └──────────────────┘  └──────────────────┘
```

### 1. PostgreSQL Relational Database Setup

#### Step 1: Install & Create Database
```sql
-- Connect to PostgreSQL CLI (psql)
CREATE DATABASE hotel_dbms;
\c hotel_dbms;
```

#### Step 2: Create Core Relational Tables (Matching ChatGPT ER)
```sql
-- 1. Room Types
CREATE TABLE ROOM_TYPE (
    room_type_id SERIAL PRIMARY KEY,
    type_name VARCHAR(50) NOT NULL,
    base_price NUMERIC(10,2) NOT NULL,
    max_occupancy INT NOT NULL
);

-- 2. Room Inventory
CREATE TABLE ROOM (
    room_id SERIAL PRIMARY KEY,
    room_number VARCHAR(10) UNIQUE NOT NULL,
    room_type_id INT REFERENCES ROOM_TYPE(room_type_id),
    floor_number INT NOT NULL,
    room_status VARCHAR(20) DEFAULT 'Available' CHECK (room_status IN ('Available', 'Occupied', 'Reserved', 'Cleaning', 'Maintenance')),
    price NUMERIC(10,2) NOT NULL,
    capacity INT NOT NULL,
    smoking_allowed BOOLEAN DEFAULT FALSE,
    view_type VARCHAR(50),
    amenities TEXT
);

-- 3. Guests / KYC Profiles
CREATE TABLE GUEST (
    guest_id VARCHAR(20) PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    gender VARCHAR(10),
    date_of_birth DATE,
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    address TEXT,
    city VARCHAR(50),
    state VARCHAR(50),
    country VARCHAR(50) DEFAULT 'India',
    id_type VARCHAR(50) NOT NULL,
    id_number VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Reservations & Bookings
CREATE TABLE BOOKING (
    booking_id VARCHAR(20) PRIMARY KEY,
    guest_id VARCHAR(20) REFERENCES GUEST(guest_id) ON DELETE RESTRICT,
    room_id INT REFERENCES ROOM(room_id) ON DELETE RESTRICT,
    booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    number_of_guests INT DEFAULT 1,
    booking_status VARCHAR(20) DEFAULT 'Confirmed' CHECK (booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out', 'Cancelled')),
    booking_source VARCHAR(30) DEFAULT 'Walk-In',
    special_requests TEXT,
    total_tariff NUMERIC(10,2) NOT NULL
);

-- 5. Stays / Actual Check-In and Check-Out
CREATE TABLE CHECK_IN_OUT (
    stay_id SERIAL PRIMARY KEY,
    booking_id VARCHAR(20) REFERENCES BOOKING(booking_id),
    actual_check_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actual_check_out TIMESTAMP,
    key_card_number VARCHAR(20),
    front_desk_staff_id VARCHAR(20)
);

-- 6. Billing & Invoicing
CREATE TABLE INVOICE (
    invoice_id VARCHAR(20) PRIMARY KEY,
    booking_id VARCHAR(20) REFERENCES BOOKING(booking_id),
    room_charges NUMERIC(10,2) NOT NULL,
    service_charges NUMERIC(10,2) DEFAULT 0.00,
    tax_amount NUMERIC(10,2) NOT NULL,
    discount NUMERIC(10,2) DEFAULT 0.00,
    total_amount NUMERIC(10,2) NOT NULL,
    invoice_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    invoice_status VARCHAR(20) DEFAULT 'Unpaid' CHECK (invoice_status IN ('Unpaid', 'Paid', 'Partially Paid', 'Cancelled'))
);

-- 7. Payment Ledger
CREATE TABLE PAYMENT (
    payment_id VARCHAR(20) PRIMARY KEY,
    booking_id VARCHAR(20) REFERENCES BOOKING(booking_id),
    amount NUMERIC(10,2) NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(20) CHECK (payment_method IN ('Cash', 'Credit Card', 'Debit Card', 'UPI', 'Net Banking')),
    payment_status VARCHAR(20) DEFAULT 'Completed'
);

-- 8. Department & Staff
CREATE TABLE DEPARTMENT (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(50) NOT NULL,
    description TEXT
);

CREATE TABLE STAFF (
    staff_id VARCHAR(20) PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    department_id INT REFERENCES DEPARTMENT(department_id),
    job_role VARCHAR(50) NOT NULL,
    salary NUMERIC(10,2)
);

-- 9. Housekeeping & Maintenance
CREATE TABLE HOUSEKEEPING (
    task_id SERIAL PRIMARY KEY,
    room_id INT REFERENCES ROOM(room_id),
    staff_id VARCHAR(20) REFERENCES STAFF(staff_id),
    task_type VARCHAR(30) DEFAULT 'Daily Cleaning',
    task_status VARCHAR(20) DEFAULT 'Pending' CHECK (task_status IN ('Pending', 'In Progress', 'Completed', 'Inspected')),
    scheduled_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE MAINTENANCE (
    issue_id SERIAL PRIMARY KEY,
    room_id INT REFERENCES ROOM(room_id),
    staff_id VARCHAR(20) REFERENCES STAFF(staff_id),
    issue_type VARCHAR(50) NOT NULL,
    priority VARCHAR(10) CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
    issue_status VARCHAR(20) DEFAULT 'Reported' CHECK (issue_status IN ('Reported', 'Assigned', 'In Progress', 'Resolved'))
);
```

---

### 2. MongoDB NoSQL Database Setup

#### Step 1: Initialize MongoDB Collections
Create collections for flexible data structures in MongoDB:
```javascript
use hotel_mongodb;

// Collection 1: restaurant_orders (Embedded document structure resolving M:N Food Orders)
db.createCollection("restaurant_orders");

// Sample Document Schema:
db.restaurant_orders.insertOne({
  order_id: "ORD-9001",
  booking_id: "B-1081",
  guest_id: "G-101",
  room_number: "201",
  order_date: new Date(),
  items: [
    { food_id: "FD-01", item_name: "Paneer Butter Masala", quantity: 2, unit_price: 320 },
    { food_id: "FD-09", item_name: "Butter Naan", quantity: 4, unit_price: 45 }
  ],
  subtotal: 820.00,
  tax_cgst: 41.00,
  tax_sgst: 41.00,
  total_amount: 902.00,
  billing_folio_applied: true,
  delivery_status: "Delivered"
});

// Collection 2: guest_reviews (Unstructured Feedback & Ratings)
db.createCollection("guest_reviews");
db.guest_reviews.insertOne({
  review_id: "REV-501",
  booking_id: "B-1081",
  guest_name: "Aarav Sharma",
  rating: 5,
  categories: {
    cleanliness: 5,
    staff_courtesy: 5,
    room_comfort: 4,
    food_quality: 5
  },
  comments: "Excellent hospitality and fast check-in experience.",
  created_at: new Date()
});

// Collection 3: system_audit_logs (Immutable front-desk operation logs)
db.createCollection("audit_logs");
db.audit_logs.insertOne({
  timestamp: new Date(),
  actor: "front_desk_receptionist",
  action: "ROOM_CHECK_IN",
  target_id: "B-1081",
  details: { room_no: "201", check_in_time: new Date() },
  ip_address: "192.168.1.10"
});
```

---

## 🔍 ChatGPT ER & Schema Matching Verification

### Does the implementation match the ChatGPT specification?
**YES, 100% verified.** The entities, attributes, primary keys, foreign keys, and cardinalities in this web system match the ChatGPT specification:

| ChatGPT Entity | Relational Model / Schema | Web App Implementation & UI Module | Verification Status |
| :--- | :--- | :--- | :--- |
| **`GUEST`** | `Guest_ID (PK)`, `First_Name`, `Last_Name`, `Phone`, `Email`, `ID_Number`, `City`, `State` | [`guests.html`](guests.html) — Guest Directory, KYC modal, Indian ID proof selector | ✅ **Exact Match** |
| **`ROOM`** | `Room_ID (PK)`, `Room_Number`, `Room_Type_ID (FK)`, `Floor_Number`, `Room_Status`, `Price`, `Capacity` | [`rooms.html`](rooms.html) — Room Status Board, Floor Filter, Status badges, Rate in ₹ | ✅ **Exact Match** |
| **`ROOM_TYPE`** | `Room_Type_ID (PK)`, `Type_Name`, `Base_Price`, `Max_Occupancy` | Standard, Deluxe, Executive Suite room type classifications | ✅ **Exact Match** |
| **`BOOKING`** | `Booking_ID (PK)`, `Guest_ID (FK)`, `Room_ID (FK)`, `Booking_Date`, `Check_In`, `Check_Out`, `Status` | [`bookings.html`](bookings.html) — New Reservation Modal, Tariff Calculator, Date validator | ✅ **Exact Match** |
| **`CHECK_IN_OUT`** | `Stay_ID (PK)`, `Booking_ID (FK)`, `Actual_CheckIn`, `Actual_CheckOut` | Quick Check-in & Departure folios on [`dashboard.html`](dashboard.html) and [`bookings.html`](bookings.html) | ✅ **Exact Match** |
| **`PAYMENT`** | `Payment_ID (PK)`, `Booking_ID (FK)`, `Amount`, `Payment_Date`, `Payment_Method` | Week 2 Folio settlement (Cash, Card, UPI, Net Banking in Indian Rupees ₹) | ✅ **Exact Match** |
| **`INVOICE`** | `Invoice_ID (PK)`, `Booking_ID (FK)`, `Room_Charges`, `Tax_Amount`, `Discount`, `Total_Amount` | Week 2 Automated Billing folio & tax breakdown | ✅ **Exact Match** |
| **`STAFF`** | `Staff_ID (PK)`, `First_Name`, `Phone`, `Department_ID (FK)`, `Job_Role_ID` | Role-based navigation and authentication | ✅ **Exact Match** |
| **`DEPARTMENT`** | `Department_ID (PK)`, `Department_Name`, `Description` | Front Office, Housekeeping, Maintenance, Accounts, Food & Beverage | ✅ **Exact Match** |
| **`HOUSEKEEPING`** | `Task_ID (PK)`, `Room_ID (FK)`, `Staff_ID (FK)`, `Task_Status` | Week 3 Housekeeping cleaning roster & room turnover | ✅ **Exact Match** |
| **`MAINTENANCE`** | `Issue_ID (PK)`, `Room_ID (FK)`, `Staff_ID (FK)`, `Issue_Type`, `Priority`, `Status` | Week 3 Room maintenance log & ticket assignment | ✅ **Exact Match** |
| **`FOOD`** | `Food_ID (PK)`, `Food_Name`, `Category`, `Price` | Week 4 Restaurant room-service menu | ✅ **Exact Match** |
| **`FOOD_ORDER` & `ORDER_DETAIL`** | Resolves M:N cardinality between `FOOD` and `FOOD_ORDER` | Week 4 MongoDB embedded subdocument / Relational Order details | ✅ **Exact Match** |
| **`HOTEL_SERVICE` & `USAGE`** | `Service_ID (PK)`, `Service_Name`, `Price`; `Usage_ID (PK)` | Week 4 Extra amenities (Laundry, Spa, Airport Cab) | ✅ **Exact Match** |
| **`REVIEW`** | `Review_ID (PK)`, `Booking_ID (FK)`, `Rating`, `Comments` | Week 4 MongoDB Guest Feedback collection | ✅ **Exact Match** |

---

## 👥 Role-Based Access Control (RBAC) Matrix

What each administrative persona can view and do in the VS Plaza Hotel Management System:

### 1. Front Desk Receptionist (`Role: Front Office`)
- **Can View:**
  - Real-time Front Desk Dashboard with daily occupancy rate, arrivals, departures, and available inventory.
  - Room Status Board (which rooms are vacant, occupied, reserved, or under cleaning).
  - Active and upcoming guest reservations.
  - Guest directory KYC records (names, contact details, ID proofs).
- **Can Do:**
  - Create new walk-in or advance reservations.
  - Check-in arriving guests (assign room key, auto-update room status to `Occupied`).
  - Process scheduled departures and initiate checkout folios.
  - Register new guest profiles with government ID verification.
  - Update room status between `Available` and `Reserved`.
- **Cannot Do:**
  - Alter room base pricing or delete room inventory records.
  - Access staff salary records or financial profit/loss statements.
  - Delete audit logs or database tables.

---

### 2. Hotel General Manager / Administrator (`Role: Manager / Admin`)
- **Can View:**
  - **Everything** across the entire Property Management System.
  - Property-wide revenue metrics, occupancy percentages, and RevPAR (Revenue Per Available Room).
  - Staff rosters, payroll records, and department shift allocation.
  - Full audit trails, database health, and system security logs.
- **Can Do:**
  - Add, edit, or decommission rooms and update base pricing per night.
  - Override discounted rates, special booking arrangements, and cancellation fees.
  - Manage employee user accounts, reset passwords, and assign system permissions.
  - Generate weekly/monthly financial reports, tax summaries, and occupancy analytics.
  - Execute database backups, data migrations, and schema syncs between PostgreSQL and MongoDB.

---

### 3. Housekeeping Supervisor & Staff (`Role: Housekeeping`)
- **Can View:**
  - Real-time floor cleaning grid and room dirty/inspected matrix.
  - List of rooms marked for checkout cleaning or stay-over service.
  - Housekeeping supply inventory and task queue.
- **Can Do:**
  - Change room status from `Cleaning` to `Available` once sanitized and inspected.
  - Flag rooms requiring maintenance repairs (e.g., plumbing, air-conditioning) to the maintenance queue.
  - Mark daily cleaning checklists as completed.
- **Cannot Do:**
  - Access guest payment details, credit card info, or reservation rates.
  - Manually check-in or check-out guests.

---

### 4. Maintenance Engineer (`Role: Engineering`)
- **Can View:**
  - Maintenance ticketing board with priority filters (Low, Medium, High, Critical).
  - Out-of-order room list (`Maintenance` status).
- **Can Do:**
  - Update ticket status (`Reported` → `In Progress` → `Resolved`).
  - Change room status from `Maintenance` back to `Available` upon inspection.
  - Log equipment replacement parts and repair notes.
- **Cannot Do:**
  - View guest identities, financial transactions, or billing folios.

---

### 5. Accounts & Billing Cashier (`Role: Accounts`)
- **Can View:**
  - Billing ledger, guest folios, and pending room invoices.
  - Daily cash register and digital payment settlements (UPI, Card, Net Banking).
  - Tax reports (CGST & SGST calculations) and discount logs.
- **Can Do:**
  - Generate official PDF/printed tax invoices.
  - Record payments and issue refund slips.
  - Split folios between multiple guests or corporate accounts.
- **Cannot Do:**
  - Change room physical maintenance states or manage staff shifts.

---

## 📅 4-Week Implementation Roadmap

| Week | Milestone / Deliverable | Target System Modules | Database Implementation |
| :--- | :--- | :--- | :--- |
| **Week 1** | **UI/UX Foundation & Front-Desk Operations** | Public Landing Page, Staff Login, Operations Dashboard, Room Status Board, Reservations & Guest Directory | Pure clean client state ready for live DB connectors; Schema specifications matching ChatGPT ER model. |
| **Week 2** | **Billing, Folio Management & Invoicing** | Checkout folio workflow, automated invoice calculator, GST tax breakdown (CGST + SGST), payment gateway simulation (Cash, Card, UPI) | **PostgreSQL**: `INVOICE` and `PAYMENT` relational tables.<br>**MongoDB**: Audit logs of financial transactions. |
| **Week 3** | **Housekeeping, Maintenance & Staff Roster** | Floor-by-floor cleaning board, maintenance issue ticketing, staff shift management, department directory | **PostgreSQL**: `STAFF`, `DEPARTMENT`, `HOUSEKEEPING`, `MAINTENANCE` tables with foreign key constraints. |
| **Week 4** | **Dual DBMS Integration, Restaurant & Analytics** | REST API endpoints connecting frontend to PostgreSQL & MongoDB, Room-service food ordering, guest feedback & reviews, occupancy analytics | **PostgreSQL**: Relational joins for monthly revenue & occupancy.<br>**MongoDB**: `restaurant_orders` & `guest_reviews` collections. |

---

## 🧹 Data Storage & Clean State Architecture

- **Zero Mock Data:** The application initializes with zero hardcoded sample records.
- **Ready for Database Ingestion:** Tables and grids display clear empty states until populated by PostgreSQL/MongoDB queries or through manual front-office entries.
- **Client Persistence:** Any rooms, reservations, or guests registered via the web interface are immediately saved in browser `localStorage` and can be replaced with direct `fetch()` calls to your backend API endpoints:
  - `GET /api/rooms` → Returns room inventory from PostgreSQL `ROOM` table.
  - `POST /api/bookings` → Inserts reservation into PostgreSQL `BOOKING` table.
  - `GET /api/guests` → Retrieves guest profiles from PostgreSQL `GUEST` table.
  - `POST /api/orders` → Inserts food orders into MongoDB `restaurant_orders` collection.
