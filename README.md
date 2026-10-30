# VS PLAZA Hotel Management System - Web Transition & DBMS Integration Guide

An academic Property Management System (PMS) built with semantic HTML5, CSS3, vanilla JavaScript, FastAPI, PostgreSQL, and MongoDB. PostgreSQL is the relational source of truth; the API mirrors application data to MongoDB.

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
- **MongoDB** stores matching application collection documents. Each app write is mirrored to both configured databases.
- **Frontend responsibility**: collect user actions, render dashboard tables, and send API requests to backend endpoints. It does not manage business data directly in production.
- **Current API flow**: browser UI -> FastAPI -> selected database for reads; writes -> PostgreSQL and MongoDB -> response -> browser update.

### FastAPI and PostgreSQL Connection
The FastAPI service stores management records in PostgreSQL's relational tables and can mirror the same frontend entities to MongoDB collections. PostgreSQL remains the source of truth for writes and billing transactions. Selecting PostgreSQL works without MongoDB; selecting MongoDB requires it to be reachable and refreshes the mirrored collections from PostgreSQL. Browser `localStorage` is only a cache.

1. Keep your database settings in the root `.env` file. Copy `.env.example` as a template and set PostgreSQL (`DB_*`) locally. Set MongoDB (`MONGO_URI`, `MONGO_DB_NAME`) when you want to use MongoDB; it is optional for PostgreSQL-only work. Do not commit or share `.env`.
2. From the repository root, install the backend dependencies and start the API:
   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   py -m pip install -r requirements.txt
   py -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
   ```
3. Start PostgreSQL, then open `http://127.0.0.1:8000/api/health` to confirm it is connected. MongoDB connectivity is reported separately and is optional when using PostgreSQL. `http://127.0.0.1:8000/docs` lists the available API routes.
4. `GET /api/data` reads the database chosen at login. Writes, invoice creation, and payments are saved in PostgreSQL first. When MongoDB is available, the API mirrors those records; if it is offline, PostgreSQL operations still succeed and the frontend displays a sync notice. Selecting MongoDB requires it to be reachable. Its collections are refreshed from PostgreSQL, which wins if their data differs.

The public home page uses `GET /api/public/availability` to list rooms that can fit the selected dates and party size. Submitting the form uses `POST /api/public/bookings` to create the guest and confirmed reservation in one PostgreSQL transaction; that reservation appears in the staff Reservations page and is mirrored to MongoDB when available. Guest booking requires the backend, PostgreSQL, and room inventory to be configured. Public API requests are restricted to the configured frontend origins; no staff login is needed for a guest to submit a booking.

Run the frontend separately with `npm.cmd run dev` and open `http://localhost:3000`. PostgreSQL and MongoDB credentials remain on the backend and must never be placed in frontend JavaScript.

#### Staff login and permissions

Set a unique username and password for each role in `.env`. Passwords must be at least 12 characters. Leave unused role pairs blank. Generate a session signing key in PowerShell with:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the output to `PMS_SESSION_SECRET`. Keep all account credentials and the session key private and out of Git. On the login screen, select the matching role, select PostgreSQL or MongoDB as the read database, then enter that role's username and password. The backend verifies the username/password against the selected role; the role is not just a visual preference. Writes always save to PostgreSQL first and are mirrored to MongoDB when it is reachable. MongoDB being offline does not block PostgreSQL use. The backend sets an HTTP-only session cookie and enforces role permissions. Use the same `localhost` hostname for both local servers (frontend `http://localhost:3000`). For HTTPS deployments, set `PMS_COOKIE_SECURE=true`, configure `CORS_ORIGINS` to the exact frontend origin, and set `window.HOTEL_API_BASE_URL` to the deployed API URL ending in `/api`.

The database selector does not connect to a database on the browser's laptop. When using MongoDB, its endpoint must be network-accessible from the FastAPI computer. If your team has PostgreSQL and MongoDB on different laptops, configure `MONGO_URI` with the MongoDB laptop's reachable LAN/VPN address and restrict the database port to trusted devices; the frontend alone cannot synchronize two unreachable laptops.

#### Invoice calculation

The invoice page calculates room charges from the booking tariff and nights, optionally adds the guest's unbilled food orders and selected services, then adds GST split equally into CGST and SGST. `PMS_GST_RATE` defaults to **5% for this project demo**; configure it to the rate required by your assignment. This configurable example is not tax advice and does not determine the legally applicable rate.

### Staff Login
- **URL:** [`http://localhost:3000/pages/login.html`](pages/login.html)
- Select the account's role and the database to read from, then sign in with the username and password configured for that role in `.env`.
- If the server reports a different frontend port because `3000` is in use, use that port and add its origin to backend `CORS_ORIGINS`.

---

## 🗄️ Dual DBMS Setup & Backend Integration (PostgreSQL & MongoDB)

The app uses both database systems:
- **PostgreSQL**: Handles relational, ACID-compliant transactions (Guest Profiles, Room Inventory, Bookings, Check-In/Check-Out, Invoices, Staff).
- **MongoDB**: Holds mirrored documents for the app's rooms, guests, bookings, staff, invoices, housekeeping, maintenance, menu, food orders, services, reviews, and departments collections.

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

The API is implemented in `backend/main.py`, `backend/storage.py`, and `backend/mongo_store.py`. Core operational data is mapped to normalized PostgreSQL tables; the API mirrors the corresponding app entities as documents in MongoDB. The PostgreSQL relational schema remains authoritative for writes and invoice/payment calculations.

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

The API connects to MongoDB using `MONGO_URI` and `MONGO_DB_NAME` from `.env`. Install the dependencies with `py -m pip install -r requirements.txt` and ensure MongoDB is running and reachable before login. The API creates and maintains collections named `rooms`, `guests`, `bookings`, `departments`, `staff`, `housekeeping`, `maintenance`, `invoices`, `food_menu`, `food_orders`, `services`, and `reviews`. Each document is the corresponding frontend entity, keyed by its stable frontend ID. You do not need to run the separate legacy Express server in `backend/server.js` or manually insert the examples below for the current app.

The examples below show an older, optional document-design exercise. They are separate from the current synchronized app collections:
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
The table below maps the UI modules to the intended entities; it is not a claim that every listed workflow or relationship is complete. The app has backend-configured login and role checks, invoice calculation, and dashboard analytics. PostgreSQL stores the managed app entities and MongoDB mirrors them when reachable.

| Entity | Relational Model / Schema | Web App Implementation & UI Module | Scope |
| :--- | :--- | :--- | :--- |
| **`GUEST`** | `Guest_ID (PK)`, `First_Name`, `Last_Name`, `Phone`, `Email`, `ID_Number`, `City`, `State` | [`guests.html`](guests.html) — Guest Directory, KYC modal, Indian ID proof selector | UI concept |
| **`ROOM`** | `Room_ID (PK)`, `Room_Number`, `Room_Type_ID (FK)`, `Floor_Number`, `Room_Status`, `Price`, `Capacity` | [`rooms.html`](rooms.html) — Room Status Board, Floor Filter, Status badges, Rate in ₹ | UI concept |
| **`ROOM_TYPE`** | `Room_Type_ID (PK)`, `Type_Name`, `Base_Price`, `Max_Occupancy` | Standard, Deluxe, Executive Suite room type classifications | UI concept |
| **`BOOKING`** | `Booking_ID (PK)`, `Guest_ID (FK)`, `Room_ID (FK)`, `Booking_Date`, `Check_In`, `Check_Out`, `Status` | [`bookings.html`](bookings.html) — New Reservation Modal, Tariff Calculator, Date validator | UI concept |
| **`CHECK_IN_OUT`** | `Stay_ID (PK)`, `Booking_ID (FK)`, `Actual_CheckIn`, `Actual_CheckOut` | Quick Check-in & Departure folios on [`dashboard.html`](dashboard.html) and [`bookings.html`](bookings.html) | UI concept |
| **`PAYMENT`** | `Payment_ID (PK)`, `Booking_ID (FK)`, `Amount`, `Payment_Date`, `Payment_Method` | Invoice settlement captures Cash, Card, UPI, or Net Banking | UI concept |
| **`INVOICE`** | `Invoice_ID (PK)`, `Booking_ID (FK)`, `Room_Charges`, `Tax_Amount`, `Discount`, `Total_Amount` | Invoice module stores totals and payment status | UI concept |
| **`STAFF`** | `Staff_ID (PK)`, `First_Name`, `Phone`, `Department_ID (FK)`, `Job_Role_ID` | Staff directory; login accounts and app roles are configured separately in backend `.env` | UI concept |
| **`DEPARTMENT`** | `Department_ID (PK)`, `Department_Name`, `Description` | Front Office, Housekeeping, Maintenance, Accounts, Food & Beverage | UI concept |
| **`HOUSEKEEPING`** | `Task_ID (PK)`, `Room_ID (FK)`, `Staff_ID (FK)`, `Task_Status` | Housekeeping task list and room turnover status | UI concept |
| **`MAINTENANCE`** | `Issue_ID (PK)`, `Room_ID (FK)`, `Staff_ID (FK)`, `Issue_Type`, `Priority`, `Status` | Room maintenance tickets and status | UI concept |
| **`FOOD`** | `Food_ID (PK)`, `Food_Name`, `Category`, `Price` | PostgreSQL food menu table and room-service menu UI | UI concept |
| **`FOOD_ORDER` & `ORDER_DETAIL`** | Resolves M:N cardinality between `FOOD` and `FOOD_ORDER` | Current UI stores a single menu item per order in PostgreSQL | UI concept |
| **`HOTEL_SERVICE` & `USAGE`** | `Service_ID (PK)`, `Service_Name`, `Price`; `Usage_ID (PK)` | Hotel service catalog; service usage/billing is not implemented | UI concept |
| **`REVIEW`** | `Review_ID (PK)`, `Booking_ID (FK)`, `Rating`, `Comments` | Reviews are stored in PostgreSQL and linked to a booking | UI concept |

---

## 👥 Role-Based Access Control (RBAC) Matrix

The backend authenticates accounts configured in `.env`, checks the role selected on the login screen against that account, and enforces access to database API operations. The frontend hides modules that the signed-in role cannot use; the backend remains the authorization boundary.

| Login role | Frontend modules available |
| :--- | :--- |
| Hotel Manager | All modules |
| Front Desk | Dashboard, Room Status, Reservations, Guest Directory |
| Accounts Cashier | Invoices |

The backend enforces these module permissions on API requests. Staff login accounts are configured through the backend `.env` file.

### Role summary
- **Hotel Manager:** full access to every frontend module.
- **Front Desk:** dashboard, rooms, bookings, and guest directory.
- **Accounts Cashier:** invoices.

---

## 📅 4-Week Implementation Roadmap

| Week | Milestone / Deliverable | Target System Modules | Database Implementation |
| :--- | :--- | :--- | :--- |
| **Week 1** | **UI/UX Foundation & Front-Desk Operations** | Public Landing Page, Staff Login, Operations Dashboard, Room Status Board, Reservations & Guest Directory | Pure clean client state ready for live DB connectors; Schema specifications matching ChatGPT ER model. |
| **Week 2** | **Billing, Folio Management & Invoicing** | Invoice calculation, GST tax breakdown (CGST + SGST), and payment recording (Cash, Card, UPI) | PostgreSQL `INVOICE` and `PAYMENT` tables, mirrored to MongoDB invoice documents. |
| **Week 3** | **Housekeeping, Maintenance & Staff Roster** | Floor-by-floor cleaning board, maintenance issue ticketing, staff shift management, department directory | **PostgreSQL**: `STAFF`, `DEPARTMENT`, `HOUSEKEEPING`, `MAINTENANCE` tables with foreign key constraints. |
| **Week 4** | **Dual-Database Persistence and Operations** | Frontend collections, menu/order/review screens, role-protected API, invoice calculation, and dashboard analytics | PostgreSQL relational persistence with MongoDB document mirroring for the app collections. |

---

## 🧹 Data Storage & Clean State Architecture

- **Database persistence:** PostgreSQL stores relational records; corresponding app entities are mirrored to MongoDB documents. PostgreSQL is the source of truth when the API reconciles the MongoDB copy.
- **Optional MongoDB mirror:** The API writes to PostgreSQL first, then attempts to synchronize application data to MongoDB. MongoDB downtime does not block PostgreSQL logins, reads, writes, invoice creation, or payments. The frontend displays a notice if a write was not mirrored; after MongoDB is available, choose MongoDB and log in to refresh it from PostgreSQL.
- **Browser cache:** The frontend updates `localStorage` only after a successful API response. PostgreSQL may import existing cached records once when its collections are empty; it then becomes the source of truth.
- **Additional PostgreSQL tables:** The API creates `food_menu`, `food_order`, and `hotel_service` on first use, and adds a stable external code to the existing `review` table.
- **Authentication and authorization:** Accounts are configured on the backend by role; the browser receives an HTTP-only signed session cookie. API permissions are enforced server-side.
- **Invoices:** The server computes room, food, and selected service charges, adds the configured GST percentage as equal CGST/SGST amounts, and records invoice/payment details in PostgreSQL and the mirrored MongoDB invoice document.
- **Dashboard analytics:** Occupancy, today's arrivals/departures, room availability, and today's recorded payment revenue are available using the selected read database.
- **Payment recording:** Marking an invoice as paid asks for a supported payment method and writes a corresponding record to `PAYMENT`.
