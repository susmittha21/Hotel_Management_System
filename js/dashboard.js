/**
 * VS PLAZA PMS - DASHBOARD CONTROLLER
 * Real-time hotel operations KPIs, today's arrivals & departures, room availability summary
 */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize dashboard from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderDashboardMetrics();
  renderArrivalsTable();
  renderDeparturesTable();
  renderQuickRoomStatus();
});

function renderDashboardMetrics() {
  const rooms = HotelStore.getRooms();
  const bookings = HotelStore.getBookings();

  const totalRooms = rooms.length;
  const occupiedCount = rooms.filter(r => r.status === 'Occupied').length;
  const availableCount = rooms.filter(r => r.status === 'Available').length;
  const cleaningCount = rooms.filter(r => r.status === 'Cleaning' || r.status === 'Maintenance').length;
  const reservedCount = rooms.filter(r => r.status === 'Reserved').length;

  const occupancyRate = Math.round((occupiedCount / (totalRooms || 1)) * 100);

  // Set values on dashboard cards
  const elOccRate = document.getElementById('metricOccupancyRate');
  const elOccupied = document.getElementById('metricOccupiedRooms');
  const elAvailable = document.getElementById('metricAvailableRooms');
  const elArrivals = document.getElementById('metricArrivals');
  const elRevenue = document.getElementById('metricTodayRevenue');

  if (elOccRate) elOccRate.textContent = `${occupancyRate}%`;
  if (elOccupied) elOccupied.textContent = `${occupiedCount} / ${totalRooms}`;
  if (elAvailable) elAvailable.textContent = availableCount;
  if (elArrivals) elArrivals.textContent = bookings.filter(b => b.status === 'Confirmed').length;
  if (elRevenue) {
    const totalRev = bookings.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);
    elRevenue.textContent = `₹${totalRev.toLocaleString('en-IN')}`;
  }
}

function renderArrivalsTable() {
  const tableBody = document.getElementById('arrivalsTableBody');
  if (!tableBody) return;

  const bookings = HotelStore.getBookings();
  const arrivals = bookings.filter(b => b.status === 'Confirmed' || b.status === 'Checked-In');

  if (arrivals.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No upcoming arrivals recorded for today.</td></tr>`;
    return;
  }

  tableBody.innerHTML = arrivals.map(b => `
    <tr>
      <td><strong>${b.bookingId}</strong></td>
      <td>${b.guestName}</td>
      <td><span class="badge" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">Room ${b.roomNo}</span></td>
      <td>${b.checkIn}</td>
      <td>
        <span class="badge ${b.status === 'Checked-In' ? 'badge-occupied' : 'badge-reserved'}">
          ${b.status}
        </span>
      </td>
      <td>
        ${b.status === 'Confirmed' 
          ? `<button class="btn btn-sm btn-primary" onclick="quickCheckIn('${b.bookingId}')">Check-In</button>`
          : `<span style="font-size:0.8rem; color:#15803d; font-weight:600;">In House</span>`
        }
      </td>
    </tr>
  `).join('');
}

function renderDeparturesTable() {
  const tableBody = document.getElementById('departuresTableBody');
  if (!tableBody) return;

  const bookings = HotelStore.getBookings().filter(b => b.status === 'Checked-In');

  if (bookings.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 20px;">No scheduled check-outs today.</td></tr>`;
    return;
  }

  tableBody.innerHTML = bookings.map(b => `
    <tr>
      <td><strong>${b.bookingId}</strong></td>
      <td>${b.guestName}</td>
      <td>Room ${b.roomNo}</td>
      <td>${b.checkOut}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="quickCheckOut('${b.bookingId}', '${b.roomNo}')">Process Folio</button>
      </td>
    </tr>
  `).join('');
}

function renderQuickRoomStatus() {
  const summaryEl = document.getElementById('roomTypeSummaryList');
  if (!summaryEl) return;

  const rooms = HotelStore.getRooms();
  if (rooms.length === 0) {
    summaryEl.innerHTML = `
      <div style="padding: 18px 8px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No room inventory recorded.<br>
        <span style="font-size: 0.78rem;">Add rooms in Room Status or sync via database.</span>
      </div>
    `;
    return;
  }

  const types = ['Deluxe', 'Suite', 'Standard'];

  summaryEl.innerHTML = types.map(t => {
    const total = rooms.filter(r => r.type === t).length;
    const avail = rooms.filter(r => r.type === t && r.status === 'Available').length;
    const percent = Math.round((avail / (total || 1)) * 100);
    return `
      <div style="margin-bottom: 14px;">
        <div style="display:flex; justify-content:space-between; font-size:0.84rem; margin-bottom:4px;">
          <span style="font-weight:600;">${t} Rooms</span>
          <span style="color:var(--text-muted);">${avail} of ${total} vacant</span>
        </div>
        <div style="height:6px; background:#e2e8f0; border-radius:9999px; overflow:hidden;">
          <div style="height:100%; width:${percent}%; background:#10b981; border-radius:9999px;"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function quickCheckIn(bookingId) {
  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (!booking) return;

  booking.status = 'Checked-In';
  if (await HotelStore.saveBookings(bookings) === false) return;

  // Update room status to Occupied
  const room = rooms.find(r => r.roomNo === booking.roomNo);
  if (room) {
    room.status = 'Occupied';
    room.currentGuest = booking.guestName;
    if (await HotelStore.saveRooms(rooms) === false) return;
  }

  showToast(`Guest ${booking.guestName} successfully checked into Room ${booking.roomNo}!`, 'success');
  renderDashboardMetrics();
  renderArrivalsTable();
  renderDeparturesTable();
}

async function quickCheckOut(bookingId, roomNo) {
  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const booking = bookings.find(b => b.bookingId === bookingId);
  if (booking) {
    booking.status = 'Checked-Out';
    if (await HotelStore.saveBookings(bookings) === false) return;
  }

  const room = rooms.find(r => r.roomNo === roomNo);
  if (room) {
    room.status = 'Cleaning';
    delete room.currentGuest;
    if (await HotelStore.saveRooms(rooms) === false) return;
  }

  showToast(`Folio finalized. Room ${roomNo} marked for Housekeeping.`, 'info');
  renderDashboardMetrics();
  renderArrivalsTable();
  renderDeparturesTable();
  renderQuickRoomStatus();
}
