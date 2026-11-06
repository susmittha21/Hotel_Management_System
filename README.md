# VS PLAZA Hotel Management System - Web Transition & DBMS Integration Guide

A Hotel Property Management System (PMS) built with semantic HTML5, CSS3, vanilla JavaScript, FastAPI, PostgreSQL, and optional MongoDB synchronization. PostgreSQL is the relational source of truth.

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

The website must be served over HTTP or HTTPS. Opening the HTML files directly with `file://` is not supported because browser session cookies and API requests require an HTTP origin.

### Backend Database Purpose
This frontend is designed as a hotel operations UI for a real backend database system:
- **PostgreSQL** stores shared business data such as guest records, the fixed room inventory, bookings, staff, invoices, and payments.
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
3. Start PostgreSQL, then open `http://127.0.0.1:8000/` to confirm the API is running and `http://127.0.0.1:8000/api/health` to confirm the database is connected. MongoDB connectivity is reported separately and is optional when using PostgreSQL. `http://127.0.0.1:8000/docs` lists the available API routes.
4. `GET /api/data` reads the database chosen at login. Writes, invoice creation, and payments are saved in PostgreSQL first. When MongoDB is available, the API mirrors those records; if it is offline, PostgreSQL operations still succeed and the frontend displays a sync notice. Selecting MongoDB requires it to be reachable. Its collections are refreshed from PostgreSQL, which wins if their data differs.

The backend seeds the shared room inventory to 30 rooms when it contains fewer than 30; existing rooms are preserved, and the room catalog cannot be added to or deleted through the app. Room cards link directly to the shared reservation flow. All staff login roles can view rooms and create reservations, and changes are stored in the database rather than isolated in a browser cache.

The landing page sends room reservations to the Guest Portal. Guests register or sign in before checking availability and submitting a reservation. Guest accounts use a separate PostgreSQL `guest_account` table with PBKDF2-hashed passwords; guests can see only their own reservations, room types, hotel service requests, and reviews (physical room numbers remain staff-only). Before a reservation is confirmed, the guest selects an available room type and completes Razorpay Checkout in test mode. The backend requires Razorpay test credentials, verifies the payment signature and captured order with Razorpay, rechecks room capacity and date conflicts, automatically assigns a physical room, then creates the GST-inclusive invoice and reservation. Test mode does not charge or transfer real money. A failed or unverified checkout leaves no confirmed reservation or invoice. Paid guest invoices appear in the Hotel Manager and Accounts Cashier invoice pages. Guest service requests are stored in `service_request` and appear in the staff dashboard and Hotel Services page. Guests can submit one 1–5-star review with a comment for each checked-out reservation; reviews are stored in PostgreSQL and appear in the Hotel Manager Reviews page. These tables are created automatically when the backend initializes the schema.

To enable guest checkout, configure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the backend environment using Razorpay test-mode credentials only. The backend rejects live key IDs. Keep the secret in the backend environment; do not expose it in frontend files or commit it to Git. The checkout requires internet access to load Razorpay's hosted Checkout script.

The guest portal’s food-order button opens [Zomato](https://www.zomato.com/) in a new tab; its URL is configured in [`js/guest-config.js`](js/guest-config.js). Food Orders is not available as a staff dashboard module or quick action. Guest and staff forms validate input in the browser and backend; the backend remains authoritative.

Run the frontend separately with `npm.cmd run dev` and open `http://localhost:3000`. PostgreSQL and MongoDB credentials remain on the backend and must never be placed in frontend JavaScript.

If the login page reports that it cannot reach the hotel API, start the FastAPI command above and confirm `http://localhost:8000/` responds. When the frontend is opened at `http://localhost:3000`, keep the API on the same `localhost` hostname (`http://localhost:8000/api`); mixing `localhost` and `127.0.0.1` can prevent the browser from retaining the strict login session cookie. For a deployed frontend, set `window.HOTEL_API_BASE_URL` to the reachable API URL ending in `/api`, and include the exact frontend origin in backend `CORS_ORIGINS`. A browser network error happens before the API can report a database error, so selecting MongoDB is not itself the cause of an unreachable API.

#### Staff login and permissions

Set a unique username and password for each role in `.env`. Passwords must be at least 12 characters. Leave unused role pairs blank. The variable names are `PMS_MANAGER_USERNAME` / `PMS_MANAGER_PASSWORD`, `PMS_FRONT_DESK_USERNAME` / `PMS_FRONT_DESK_PASSWORD`, and `PMS_ACCOUNTS_USERNAME` / `PMS_ACCOUNTS_PASSWORD`. Generate a session signing key in PowerShell with:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the output to `PMS_SESSION_SECRET`. Keep all account credentials and the session key private and out of Git. On the login screen, select the matching role, select PostgreSQL or MongoDB as the read database, then enter that role's username and password. The backend verifies the username/password against the selected role; the role is not just a visual preference. Writes always save to PostgreSQL first and are mirrored to MongoDB when it is reachable. MongoDB being offline does not block PostgreSQL use. The backend sets an HTTP-only session cookie and enforces role permissions. Use the same `localhost` hostname for both local servers (frontend `http://localhost:3000`). For HTTPS deployments, set `PMS_COOKIE_SECURE=true`, configure `CORS_ORIGINS` to the exact frontend origin, and set `window.HOTEL_API_BASE_URL` to the deployed API URL ending in `/api`.

The database selector does not connect to a database on the browser's laptop. When using MongoDB, its endpoint must be network-accessible from the FastAPI computer. If your team has PostgreSQL and MongoDB on different laptops, configure `MONGO_URI` with the MongoDB laptop's reachable LAN/VPN address and restrict the database port to trusted devices; the frontend alone cannot synchronize two unreachable laptops.

#### Deployment checklist

- Serve the frontend and API over HTTPS. Set `window.HOTEL_API_BASE_URL` in `js/app.js` to the deployed API base URL ending in `/api`; do not leave the localhost default in a deployed build.
- Set `CORS_ORIGINS` to the exact HTTPS frontend origin(s), without a wildcard. The browser sends the login cookie with API requests, so deploy frontend and API on the same site (for example, `hotel.example.com` and `api.example.com`) and keep credentials-enabled CORS.
- Set `PMS_COOKIE_SECURE=true` in the production backend environment. Keep `.env` private and configure database credentials, at least one staff account, and a random `PMS_SESSION_SECRET` of 32 or more characters.
- Run FastAPI behind a trusted HTTPS reverse proxy or managed application host; do not use `--reload` in production. Keep PostgreSQL private and reachable only by the backend. MongoDB remains optional unless users choose it at staff sign-in.
- After deployment, verify `/` and `/api/health`, then exercise guest registration/sign-in, staff sign-in, availability, service requests, reviews, and invoice workflows against the deployed database.

This project can be deployed as a web application when those environment and hosting requirements are met. Razorpay checkout is separately restricted to test credentials, so it does not collect real payments.

#### Invoice calculation

The invoice page calculates room charges from the booking tariff and nights, optionally adds the guest's unbilled food orders and selected services, then adds GST split equally into CGST and SGST. `PMS_GST_RATE` defaults to **5% for this project**; configure it to the rate required by your assignment. This configurable example is not tax advice and does not determine the legally applicable rate.

### Staff Login
- **URL:** [`http://localhost:3000/pages/login.html`](pages/login.html)
- Select the account's role and the database to read from, then sign in with the username and password configured for that role in `.env`.
- If the server reports a different frontend port because `3000` is in use, use that port and add its origin to backend `CORS_ORIGINS`.
- All staff roles can view guest service requests on their dashboard and the Hotel Services page. Front Desk and Accounts Cashier staff can update request status; only Hotel Managers can edit the service catalog.
- **Guest Portal:** [`http://localhost:3000/pages/guest-account.html`](pages/guest-account.html) supports guest account registration and sign-in; guests then use [`guest-dashboard.html`](pages/guest-dashboard.html) to manage their bookings and service requests.

---

## 🗄️ Dual DBMS Setup & Backend Integration (PostgreSQL & MongoDB)

The app uses both database systems:
- **PostgreSQL**: Handles relational, ACID-compliant transactions (Guest Profiles, Room Inventory, Bookings, Check-In/Check-Out, Invoices, Staff).
- **MongoDB**: Holds mirrored documents for the app's rooms, guests, bookings, staff, invoices, menu, food orders, services, service requests, reviews, and departments collections. Guest password hashes remain in PostgreSQL and are never mirrored.

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
    room_status VARCHAR(20) DEFAULT 'Available' CHECK (room_status IN ('Available', 'Occupied', 'Reserved')),
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
    payment_reference VARCHAR(40),
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

```

---

### 2. MongoDB NoSQL Database Setup

The API connects to MongoDB using `MONGO_URI` and `MONGO_DB_NAME` from `.env`. Install the dependencies with `py -m pip install -r requirements.txt` and ensure MongoDB is running and reachable before login. The API creates and maintains collections named `rooms`, `guests`, `bookings`, `departments`, `staff`, `invoices`, `food_menu`, `food_orders`, `services`, and `reviews`. Each document is the corresponding frontend entity, keyed by its stable frontend ID. You do not need to run the separate legacy Express server in `backend/server.js` or manually insert the examples below for the current app.

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
| **`GUEST_ACCOUNT`** | `Guest_ID (PK/FK)`, normalized email, password hash | Guest Portal registration and sign-in; passwords are stored as PBKDF2 hashes in PostgreSQL | Implemented |
| **`ROOM`** | `Room_ID (PK)`, `Room_Number`, `Room_Type_ID (FK)`, `Floor_Number`, `Room_Status`, `Price`, `Capacity` | [`rooms.html`](rooms.html) — Shared fixed inventory, availability, and reservation links | UI concept |
| **`ROOM_TYPE`** | `Room_Type_ID (PK)`, `Type_Name`, `Base_Price`, `Max_Occupancy` | Standard, Deluxe, Executive Suite room type classifications | UI concept |
| **`BOOKING`** | `Booking_ID (PK)`, `Guest_ID (FK)`, `Room_ID (FK)`, `Booking_Date`, `Check_In`, `Check_Out`, `Status` | [`bookings.html`](bookings.html) — New Reservation Modal, Tariff Calculator, Date validator | UI concept |
| **`CHECK_IN_OUT`** | `Stay_ID (PK)`, `Booking_ID (FK)`, `Actual_CheckIn`, `Actual_CheckOut` | Quick Check-in & Departure folios on [`dashboard.html`](dashboard.html) and [`bookings.html`](bookings.html) | UI concept |
| **`PAYMENT`** | `Payment_ID (PK)`, `Booking_ID (FK)`, `Amount`, `Payment_Date`, `Payment_Method`, optional no-charge reference | Guest checkout completion is recorded without transferring money | Implemented |
| **`INVOICE`** | `Invoice_ID (PK)`, `Booking_ID (FK)`, `Room_Charges`, `Tax_Amount`, `Discount`, `Total_Amount` | Invoice module stores totals and payment status | UI concept |
| **`STAFF`** | `Staff_ID (PK)`, `First_Name`, `Phone`, `Department_ID (FK)`, `Job_Role_ID` | Staff directory; login accounts and app roles are configured separately in backend `.env` | UI concept |
| **`DEPARTMENT`** | `Department_ID (PK)`, `Department_Name`, `Description` | Front Office, Accounts, Food & Beverage | UI concept |
| **`FOOD`** | `Food_ID (PK)`, `Food_Name`, `Category`, `Price` | PostgreSQL food menu table and room-service menu UI | UI concept |
| **`FOOD_ORDER` & `ORDER_DETAIL`** | Resolves M:N cardinality between `FOOD` and `FOOD_ORDER` | Current UI stores a single menu item per order in PostgreSQL | UI concept |
| **`HOTEL_SERVICE` & `SERVICE_REQUEST`** | Service catalog; request links guest, service, optional booking, notes, status, and timestamp | Guest requests appear in the guest portal, staff dashboard, and Hotel Services page | Implemented |
| **`REVIEW`** | `Review_ID (PK)`, `Booking_ID (FK)`, `Rating`, `Comments` | Guest Portal submission for a guest's checked-out booking; visible in the Hotel Manager Reviews page | Implemented |

---

## 👥 Role-Based Access Control (RBAC) Matrix

The backend authenticates accounts configured in `.env`, checks the role selected on the login screen against that account, and enforces access to database API operations. The frontend hides modules that the signed-in role cannot use; the backend remains the authorization boundary.

| Login role | Frontend modules available |
| :--- | :--- |
| Hotel Manager | Dashboard, rooms, reservations, guests, staff, invoices, services, and reviews |
| Front Desk | Dashboard, Room Status, Reservations, Guest Directory, Hotel Services |
| Accounts Cashier | Dashboard, Room Status, Reservations, Guest Directory, Invoices, Hotel Services |

The backend enforces these module permissions on API requests. Staff login accounts are configured through the backend `.env` file.

### Role summary
- **Hotel Manager:** access to the management, room, reservation, and guest modules.
- **Front Desk:** dashboard, rooms, bookings, guest directory, and guest service requests.
- **Accounts Cashier:** dashboard, rooms, bookings, guest directory, invoices, and guest service requests.
- **Guest:** own reservations, service requests, reviews, and available services only.

---

## 📅 4-Week Implementation Roadmap

| Week | Milestone / Deliverable | Target System Modules | Database Implementation |
| :--- | :--- | :--- | :--- |
| **Week 1** | **UI/UX Foundation & Front-Desk Operations** | Public Landing Page, Staff Login, Operations Dashboard, Room Status Board, Reservations & Guest Directory | Pure clean client state ready for live DB connectors; Schema specifications matching ChatGPT ER model. |
| **Week 2** | **Billing, Folio Management & Invoicing** | Invoice calculation, GST tax breakdown (CGST + SGST), and payment recording (Cash, Card, UPI) | PostgreSQL `INVOICE` and `PAYMENT` tables, mirrored to MongoDB invoice documents. |
| **Week 3** | **Staff Roster** | Staff shift management and department directory | **PostgreSQL**: `STAFF` and `DEPARTMENT` tables with foreign key constraints. |
| **Week 4** | **Dual-Database Persistence and Operations** | Frontend collections, menu/order/review screens, role-protected API, invoice calculation, and dashboard analytics | PostgreSQL relational persistence with MongoDB document mirroring for the app collections. |

---

## 🧹 Data Storage & Clean State Architecture

- **Database persistence:** PostgreSQL stores relational records; corresponding app entities are mirrored to MongoDB documents. PostgreSQL is the source of truth when the API reconciles the MongoDB copy.
- **Optional MongoDB mirror:** The API writes to PostgreSQL first, then attempts to synchronize application data to MongoDB. MongoDB downtime does not block PostgreSQL logins, reads, writes, invoice creation, or payments. The frontend displays a notice if a write was not mirrored; after MongoDB is available, choose MongoDB and log in to refresh it from PostgreSQL.
- **Browser cache:** `localStorage` is a display cache, not the room or reservation source of truth. Existing non-room records may be imported once when their PostgreSQL collections are empty.
- **Additional PostgreSQL tables:** The API creates `food_menu`, `food_order`, and `hotel_service` on first use, and adds a stable external code to the existing `review` table.
- **Authentication and authorization:** Accounts are configured on the backend by role; the browser receives an HTTP-only signed session cookie. API permissions are enforced server-side.
- **Invoices:** The server computes room, food, and selected service charges, adds the configured GST percentage as equal CGST/SGST amounts, and records invoice/payment details in PostgreSQL and the mirrored MongoDB invoice document.
- **Dashboard analytics:** Occupancy, today's arrivals/departures, room availability, and today's recorded payment revenue are available using the selected read database.
- **Payment recording:** Marking an invoice as paid asks for a supported payment method and writes a corresponding record to `PAYMENT`.
