/**
 * VS PLAZA PMS - BOOKING & CHECK-IN CONTROLLER
 */

document.addEventListener('DOMContentLoaded', () => {
  renderBookingsTable();
  setupBookingForm();
  setupDateCalculations();
  populateAvailableRoomsDropdown();

  // Search input listener
  const searchEl = document.getElementById('bookingSearchInput');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      renderBookingsTable(searchEl.value.trim().toLowerCase());
    });
  }
});

function renderBookingsTable(searchQuery = '') {
  const tableBody = document.getElementById('bookingsTableBody');
  const countBadge = document.getElementById('bookingCountBadge');
  if (!tableBody) return;

  const bookings = HotelStore.getBookings();

  const filtered = bookings.filter(b => {
    if (!searchQuery) return true;
    return (
      b.bookingId.toLowerCase().includes(searchQuery) ||
      b.guestName.toLowerCase().includes(searchQuery) ||
      b.roomNo.toString().includes(searchQuery) ||
      b.status.toLowerCase().includes(searchQuery)
    );
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} Bookings`;
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 32px; color: var(--text-muted);">No reservation records found.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filtered.map(b => {
    let statusClass = 'badge-reserved';
    if (b.status === 'Checked-In') statusClass = 'badge-occupied';
    else if (b.status === 'Checked-Out') statusClass = 'badge-available';
    else if (b.status === 'Cancelled') statusClass = 'badge-maintenance';

    return `
      <tr>
        <td><strong>${b.bookingId}</strong></td>
        <td>
          <div style="font-weight:600; color:var(--text-main);">${b.guestName}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${b.guestId || 'Registered Guest'} • ${b.bookingSource || 'Walk-In'}</div>
          ${b.specialRequests ? `<div style="font-size:0.7rem; color:#64748b; font-style:italic;">Note: ${b.specialRequests}</div>` : ''}
        </td>
        <td><span class="badge" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">Room ${b.roomNo}</span></td>
        <td>
          <div>In: ${b.checkIn}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">Out: ${b.checkOut}</div>
        </td>
        <td>${b.guestsCount || 1} Person(s)</td>
        <td><strong>₹${Number(b.totalAmount).toLocaleString('en-IN')}</strong> <span style="font-size:0.72rem; color:${b.paymentStatus === 'Paid' ? '#15803d' : '#b45309'};">(${b.paymentStatus || 'Pending'})</span></td>
        <td><span class="badge ${statusClass}">${b.status}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            ${b.status === 'Confirmed' ? `
              <button class="btn btn-sm btn-primary" onclick="performCheckIn('${b.bookingId}')">Check-In</button>
              <button class="btn btn-sm btn-danger" onclick="cancelBooking('${b.bookingId}')">Cancel</button>
            ` : b.status === 'Checked-In' ? `
              <button class="btn btn-sm btn-success" onclick="performCheckOut('${b.bookingId}')">Check-Out</button>
            ` : `
              <span style="font-size:0.8rem; color:var(--text-muted);">Archived</span>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function populateAvailableRoomsDropdown() {
  const select = document.getElementById('bookingRoomSelect');
  if (!select) return;

  const rooms = HotelStore.getRooms();
  const availableRooms = rooms.filter(r => r.status === 'Available');

  select.innerHTML = `<option value="">-- Select Available Room --</option>` + 
    availableRooms.map(r => `
      <option value="${r.roomNo}" data-price="${r.price}">
        Room ${r.roomNo} - ${r.type} (₹${Number(r.price).toLocaleString('en-IN')}/night)
      </option>
    `).join('');
}

function setupDateCalculations() {
  const checkIn = document.getElementById('bookingCheckIn');
  const checkOut = document.getElementById('bookingCheckOut');
  const roomSelect = document.getElementById('bookingRoomSelect');
  const calcField = document.getElementById('bookingEstimatedTotal');

  const recalculate = () => {
    if (!checkIn || !checkOut || !roomSelect || !calcField) return;
    const d1 = new Date(checkIn.value);
    const d2 = new Date(checkOut.value);
    const selectedOption = roomSelect.options[roomSelect.selectedIndex];
    const pricePerNight = selectedOption ? Number(selectedOption.dataset.price || 0) : 0;

    if (d1 && d2 && d2 > d1 && pricePerNight > 0) {
      const diffTime = Math.abs(d2 - d1);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const total = diffDays * pricePerNight;
      calcField.value = `₹${total.toLocaleString('en-IN')} (${diffDays} night(s) @ ₹${pricePerNight.toLocaleString('en-IN')}/night)`;
    } else {
      calcField.value = 'Select dates and room';
    }
  };

  if (checkIn) checkIn.addEventListener('change', recalculate);
  if (checkOut) checkOut.addEventListener('change', recalculate);
  if (roomSelect) roomSelect.addEventListener('change', recalculate);
}

function setupBookingForm() {
  const form = document.getElementById('newBookingForm');
  if (!form) return;

  // Set default dates (today and tomorrow)
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const checkInEl = document.getElementById('bookingCheckIn');
  const checkOutEl = document.getElementById('bookingCheckOut');
  if (checkInEl && !checkInEl.value) checkInEl.value = today;
  if (checkOutEl && !checkOutEl.value) checkOutEl.value = tomorrow;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const guestName = document.getElementById('bookingGuestName').value.trim();
    const guestPhone = document.getElementById('bookingGuestPhone').value.trim();
    const roomSelect = document.getElementById('bookingRoomSelect');
    const roomNo = roomSelect.value;
    const checkIn = document.getElementById('bookingCheckIn').value;
    const checkOut = document.getElementById('bookingCheckOut').value;
    const guestsCount = Number(document.getElementById('bookingGuestCount').value || 1);
    const immediateCheckIn = document.getElementById('bookingImmediateCheckIn').checked;

    if (!roomNo) {
      showToast('Please select an available room from the list.', 'error');
      return;
    }

    const selectedOption = roomSelect.options[roomSelect.selectedIndex];
    const pricePerNight = Number(selectedOption.dataset.price || 120);
    const d1 = new Date(checkIn);
    const d2 = new Date(checkOut);
    const nights = Math.max(1, Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)));
    const totalAmount = nights * pricePerNight;

    const bookingId = `B-${Math.floor(1000 + Math.random() * 9000)}`;

    const bookings = HotelStore.getBookings();
    const rooms = HotelStore.getRooms();
    const guests = HotelStore.getGuests();

    // Auto-register guest if not existing
    let guest = guests.find(g => g.firstName.toLowerCase() + ' ' + g.lastName.toLowerCase() === guestName.toLowerCase());
    if (!guest) {
      const guestId = `G00${guests.length + 1}`;
      guest = {
        guestId,
        firstName: guestName.split(' ')[0] || guestName,
        lastName: guestName.split(' ').slice(1).join(' ') || 'Guest',
        phone: guestPhone || 'N/A',
        city: 'Walk-in',
        status: immediateCheckIn ? 'In-House' : 'Reserved'
      };
      guests.push(guest);
      HotelStore.saveGuests(guests);
    }

    const bookingSource = document.getElementById('bookingSource') ? document.getElementById('bookingSource').value : 'Walk-In';
    const specialRequests = document.getElementById('bookingSpecialRequests') ? document.getElementById('bookingSpecialRequests').value.trim() : '';

    const newBooking = {
      bookingId,
      guestName,
      guestId: guest.guestId,
      roomNo,
      bookingDate: today,
      checkIn,
      checkOut,
      guestsCount,
      totalAmount,
      status: immediateCheckIn ? 'Checked-In' : 'Confirmed',
      paymentStatus: immediateCheckIn ? 'Paid' : 'Pending',
      bookingSource,
      specialRequests
    };

    bookings.unshift(newBooking);
    HotelStore.saveBookings(bookings);

    // Update Room state
    const room = rooms.find(r => r.roomNo === roomNo);
    if (room) {
      room.status = immediateCheckIn ? 'Occupied' : 'Reserved';
      room.currentGuest = guestName;
      HotelStore.saveRooms(rooms);
    }

    showToast(`Reservation #${bookingId} created for ${guestName}!`, 'success');
    form.reset();
    closeModal('newBookingModal');
    renderBookingsTable();
    populateAvailableRoomsDropdown();
  });
}

function performCheckIn(bookingId) {
  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const b = bookings.find(x => x.bookingId === bookingId);
  if (!b) return;

  b.status = 'Checked-In';
  HotelStore.saveBookings(bookings);

  const room = rooms.find(r => r.roomNo === b.roomNo);
  if (room) {
    room.status = 'Occupied';
    room.currentGuest = b.guestName;
    HotelStore.saveRooms(rooms);
  }

  showToast(`Guest ${b.guestName} is now Checked In to Room ${b.roomNo}.`, 'success');
  renderBookingsTable();
}

function performCheckOut(bookingId) {
  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const b = bookings.find(x => x.bookingId === bookingId);
  if (!b) return;

  b.status = 'Checked-Out';
  b.paymentStatus = 'Paid';
  HotelStore.saveBookings(bookings);

  const room = rooms.find(r => r.roomNo === b.roomNo);
  if (room) {
    room.status = 'Cleaning';
    delete room.currentGuest;
    HotelStore.saveRooms(rooms);
  }

  showToast(`Folio finalized. Guest ${b.guestName} checked out successfully.`, 'info');
  renderBookingsTable();
}

function cancelBooking(bookingId) {
  if (!confirm(`Are you sure you want to cancel booking #${bookingId}?`)) return;

  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const b = bookings.find(x => x.bookingId === bookingId);
  if (!b) return;

  b.status = 'Cancelled';
  HotelStore.saveBookings(bookings);

  const room = rooms.find(r => r.roomNo === b.roomNo);
  if (room && room.status === 'Reserved') {
    room.status = 'Available';
    delete room.currentGuest;
    HotelStore.saveRooms(rooms);
  }

  showToast(`Booking #${bookingId} marked as Cancelled.`, 'error');
  renderBookingsTable();
}
