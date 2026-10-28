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
# Works on Windows PowerShell when execution policy blocks .ps1 scripts
npm.cmd run dev
```
Or use the direct static server command:
```bash
npx.cmd -y serve . -l 3000
```
Open your browser and navigate to:
```
http://localhost:3000
```

### Option 2: Direct File Execution (No Dependencies)
Simply double-click [`index.html`](index.html) to open the public landing page in any web browser.

### Backend Database Purpose
This frontend is designed as a hotel operations UI for a real backend database system:
- **PostgreSQL** stores structured business data such as guest records, room inventory, bookings, staff, invoices, payments, housekeeping tasks, and maintenance logs.
- **MongoDB** stores flexible or document-heavy data such as room-service orders, audit logs, guest reviews, and operational metadata that do not fit a strict relational schema.
- **Frontend responsibility**: collect user actions, render dashboard tables, and send API requests to backend endpoints. It does not manage business data directly in production.
- **Typical API flow**: browser UI -> REST API -> PostgreSQL / MongoDB -> JSON response -> browser update.

### FastAPI and PostgreSQL Connection
The FastAPI service reads and writes management records in PostgreSQL's relational tables. Rooms, guests, bookings, departments, staff, housekeeping, maintenance, invoices, and payments use the tables below. PostgreSQL also stores the food menu, food orders, hotel services, and reviews in relational tables that the API creates when first used. The API maps the frontend's camel-case records to relational rows and enforces the database's foreign-key and check constraints. Browser `localStorage` is only a cache; PostgreSQL is the source of truth.

1. Keep your database settings in the root `.env` file. Copy `.env.example` as a template and set `DB_PASSWORD` locally; do not commit or share `.env`.
2. From the repository root, install the backend dependencies and start the API:
   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   py -m pip install -r requirements.txt
   py -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
   ```
3. Open `http://127.0.0.1:8000/api/health` to confirm the database connection. `http://127.0.0.1:8000/docs` lists the available API routes.
4. Open `http://127.0.0.1:8000/docs` to inspect the API. `GET /api/data` reads all screen collections; `PUT /api/data/{collection}` transactionally saves a collection to its relational PostgreSQL tables. `GET /api/rooms` reads the normalized `ROOM` table. If the previous version created `pms_app_data`, the API imports its records into empty relational collections once and records that migration in `hotel_app_migrations`.

Run the frontend separately with `npm.cmd run dev` and open `http://localhost:3000`. PostgreSQL credentials remain on the backend and must never be placed in frontend JavaScript.

For deployment, set backend `CORS_ORIGINS` to the exact HTTPS frontend origin and set `window.HOTEL_API_BASE_URL` to the deployed API URL ending in `/api` before `js/app.js` loads (or update the local default in `js/app.js`). Do not deploy real guest data publicly until server-side login and role authorization are implemented; the current login and role selector are demo-only.

### Demo Login Details (Frontend Only)
- **URL:** [`http://localhost:3000/pages/login.html`](pages/login.html)
- If the server reports a different port because `3000` is already in use, replace `3000` with the port shown in the server output.
- **Prefilled username:** `admin`
- **Prefilled password:** `admin123`
- **Role:** Select a role from the login form; role selection controls the demo module visibility.

There are no separate staff accounts or role-specific passwords yet. This static frontend accepts any non-empty username and password, so `admin` / `admin123` are convenience demo values, not validated credentials. To try the cashier view, enter the demo values and select **Accounts Cashier**. The role-to-module mapping and each role's landing page are listed in the RBAC section below.

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

The PostgreSQL API is implemented in `backend/main.py` and `backend/storage.py`. Core operational data is mapped to the normalized tables below; PostgreSQL-only tables for menu items, food orders, services, and reviews are created automatically. The API also adds stable frontend task/issue codes to the existing `HOUSEKEEPING` and `MAINTENANCE` tables, and links invoice payments to invoices. The MongoDB section remains optional design guidance and is not part of the current application.

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

### How the UI relates to the ER design
The table below maps the UI modules to the intended entities; it is not a claim that every listed workflow or relationship is complete. Current PostgreSQL persistence covers the management collections, but the demo login is not server-authenticated, checkout does not automatically calculate a folio, and analytics/reporting are not implemented.

| Entity | Relational Model / Schema | Web App Implementation & UI Module | Scope |
| :--- | :--- | :--- | :--- |
| **`GUEST`** | `Guest_ID (PK)`, `First_Name`, `Last_Name`, `Phone`, `Email`, `ID_Number`, `City`, `State` | [`guests.html`](guests.html) — Guest Directory, KYC modal, Indian ID proof selector | UI concept |
| **`ROOM`** | `Room_ID (PK)`, `Room_Number`, `Room_Type_ID (FK)`, `Floor_Number`, `Room_Status`, `Price`, `Capacity` | [`rooms.html`](rooms.html) — Room Status Board, Floor Filter, Status badges, Rate in ₹ | UI concept |
| **`ROOM_TYPE`** | `Room_Type_ID (PK)`, `Type_Name`, `Base_Price`, `Max_Occupancy` | Standard, Deluxe, Executive Suite room type classifications | UI concept |
| **`BOOKING`** | `Booking_ID (PK)`, `Guest_ID (FK)`, `Room_ID (FK)`, `Booking_Date`, `Check_In`, `Check_Out`, `Status` | [`bookings.html`](bookings.html) — New Reservation Modal, Tariff Calculator, Date validator | UI concept |
| **`CHECK_IN_OUT`** | `Stay_ID (PK)`, `Booking_ID (FK)`, `Actual_CheckIn`, `Actual_CheckOut` | Quick Check-in & Departure folios on [`dashboard.html`](dashboard.html) and [`bookings.html`](bookings.html) | UI concept |
| **`PAYMENT`** | `Payment_ID (PK)`, `Booking_ID (FK)`, `Amount`, `Payment_Date`, `Payment_Method` | Invoice settlement captures Cash, Card, UPI, or Net Banking | UI concept |
| **`INVOICE`** | `Invoice_ID (PK)`, `Booking_ID (FK)`, `Room_Charges`, `Tax_Amount`, `Discount`, `Total_Amount` | Invoice module stores totals and payment status | UI concept |
| **`STAFF`** | `Staff_ID (PK)`, `First_Name`, `Phone`, `Department_ID (FK)`, `Job_Role_ID` | Staff directory; role-based navigation remains demo-only | UI concept |
| **`DEPARTMENT`** | `Department_ID (PK)`, `Department_Name`, `Description` | Front Office, Housekeeping, Maintenance, Accounts, Food & Beverage | UI concept |
| **`HOUSEKEEPING`** | `Task_ID (PK)`, `Room_ID (FK)`, `Staff_ID (FK)`, `Task_Status` | Housekeeping task list and room turnover status | UI concept |
| **`MAINTENANCE`** | `Issue_ID (PK)`, `Room_ID (FK)`, `Staff_ID (FK)`, `Issue_Type`, `Priority`, `Status` | Room maintenance tickets and status | UI concept |
| **`FOOD`** | `Food_ID (PK)`, `Food_Name`, `Category`, `Price` | PostgreSQL food menu table and room-service menu UI | UI concept |
| **`FOOD_ORDER` & `ORDER_DETAIL`** | Resolves M:N cardinality between `FOOD` and `FOOD_ORDER` | Current UI stores a single menu item per order in PostgreSQL | UI concept |
| **`HOTEL_SERVICE` & `USAGE`** | `Service_ID (PK)`, `Service_Name`, `Price`; `Usage_ID (PK)` | Hotel service catalog; service usage/billing is not implemented | UI concept |
| **`REVIEW`** | `Review_ID (PK)`, `Booking_ID (FK)`, `Rating`, `Comments` | Reviews are stored in PostgreSQL and linked to a booking | UI concept |

---

## 👥 Role-Based Access Control (RBAC) Matrix

The frontend applies this module access matrix after login. The role selector is a demo identity switch, not account authentication. Access checks run in browser JavaScript and can be bypassed; enforce all permissions in a backend before using real guest or financial data.

| Login role | Frontend modules available |
| :--- | :--- |
| Hotel Manager | All modules |
| Front Desk | Dashboard, Room Status, Reservations, Guest Directory |
| Operations Staff | Housekeeping, Maintenance, Food & Orders, Hotel Services, Guest Reviews |
| Accounts Cashier | Invoices |

These are demo module groups implemented by the frontend. The API currently has no authentication or authorization, so these role checks do not protect records; enforce the access rules on the backend before deployment with real guest or payment data.

### Role summary
- **Hotel Manager:** full access to every frontend module.
- **Front Desk:** dashboard, rooms, bookings, and guest directory.
- **Operations Staff:** housekeeping, maintenance, food orders, services, and reviews.
- **Accounts Cashier:** invoices.

---

## 📅 4-Week Implementation Roadmap

| Week | Milestone / Deliverable | Target System Modules | Database Implementation |
| :--- | :--- | :--- | :--- |
| **Week 1** | **UI/UX Foundation & Front-Desk Operations** | Public Landing Page, Staff Login, Operations Dashboard, Room Status Board, Reservations & Guest Directory | Pure clean client state ready for live DB connectors; Schema specifications matching ChatGPT ER model. |
| **Week 2** | **Billing, Folio Management & Invoicing** | Checkout folio workflow, automated invoice calculator, GST tax breakdown (CGST + SGST), payment gateway simulation (Cash, Card, UPI) | **PostgreSQL**: `INVOICE` and `PAYMENT` relational tables.<br>**MongoDB**: Audit logs of financial transactions. |
| **Week 3** | **Housekeeping, Maintenance & Staff Roster** | Floor-by-floor cleaning board, maintenance issue ticketing, staff shift management, department directory | **PostgreSQL**: `STAFF`, `DEPARTMENT`, `HOUSEKEEPING`, `MAINTENANCE` tables with foreign key constraints. |
| **Week 4** | **PostgreSQL Persistence and Operations** | Frontend collections, menu/order/review screens backed by the PostgreSQL API | PostgreSQL integration is implemented for current UI collections. MongoDB, occupancy/revenue analytics, and service usage are not implemented. |

---

## 🧹 Data Storage & Clean State Architecture

- **PostgreSQL persistence:** The application loads and saves its relational collections using `GET /api/data` and `PUT /api/data/{collection}`. Writes are transactional, and PostgreSQL foreign keys and check constraints reject invalid relationships or values.
- **Browser cache:** The frontend updates `localStorage` only after a successful database save. When a PostgreSQL collection is empty, the app may import its existing cached records once; PostgreSQL then becomes the source of truth.
- **Additional PostgreSQL tables:** The API creates `food_menu`, `food_order`, and `hotel_service` on first use, and adds a stable external code to the existing `review` table. MongoDB is not required to run the current app.
- **Payment recording:** Marking an invoice as paid asks for a supported payment method and writes a corresponding record to `PAYMENT`.
