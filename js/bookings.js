/**
 * VS PLAZA PMS - BOOKING & CHECK-IN CONTROLLER
 */

let editingBookingId = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize bookings from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderBookingsTable();
  setupBookingForm();
  setupDateCalculations();
  populateAvailableRoomsDropdown();
  bindActionMenu(document.getElementById('bookingsTableBody'), (action, bookingId) => {
    if (action === 'edit') editBooking(bookingId);
    if (action === 'delete') deleteBooking(bookingId);
    if (action === 'check-in') performCheckIn(bookingId);
    if (action === 'check-out') performCheckOut(bookingId);
    if (action === 'cancel') cancelBooking(bookingId);
  });

  // Search input listener
  const searchEl = document.getElementById('bookingSearchInput');
  const statusFilter = document.getElementById('bookingStatusFilter');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      renderBookingsTable(searchEl.value.trim().toLowerCase());
    });
  }
  if (statusFilter) statusFilter.addEventListener('change', () => renderBookingsTable(searchEl?.value.trim().toLowerCase() || ''));
});

function renderBookingsTable(searchQuery = '') {
  const tableBody = document.getElementById('bookingsTableBody');
  const countBadge = document.getElementById('bookingCountBadge');
  if (!tableBody) return;

  const bookings = HotelStore.getBookings();
  const statusFilter = document.getElementById('bookingStatusFilter')?.value || '';

  const filtered = bookings.filter(b => {
    if (statusFilter && b.status !== statusFilter) return false;
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

  const invoices = HotelStore.getInvoices();
  const reviews = HotelStore.getReviews();
  tableBody.innerHTML = filtered.map(b => {
    let statusClass = 'badge-reserved';
    if (b.status === 'Checked-In') statusClass = 'badge-occupied';
    else if (b.status === 'Checked-Out') statusClass = 'badge-available';
    else if (b.status === 'Cancelled') statusClass = 'badge-maintenance';
    const linkedRecord = invoices.some(invoice => invoice.bookingId === b.bookingId) ||
      reviews.some(review => review.bookingId === b.bookingId);
    const actions = [{
      action: 'edit',
      label: 'Edit reservation',
      disabled: b.status !== 'Confirmed'
    }];
    if (b.status === 'Confirmed') {
      actions.push({ action: 'check-in', label: 'Check in' }, { action: 'cancel', label: 'Cancel reservation' });
    } else if (b.status === 'Checked-In') {
      actions.push({ action: 'check-out', label: 'Check out' });
    }
    actions.push({
      action: 'delete',
      label: 'Delete reservation',
      disabled: linkedRecord || b.status === 'Checked-In' || b.status === 'Checked-Out'
    });

    return `
      <tr>
        <td><strong>${escapeHtml(b.bookingId)}</strong></td>
        <td>
          <div style="font-weight:600; color:var(--text-main);">${escapeHtml(b.guestName)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(b.guestId || 'Registered Guest')} • ${escapeHtml(b.bookingSource || 'Walk-In')}</div>
          ${b.specialRequests ? `<div style="font-size:0.7rem; color:#64748b; font-style:italic;">Note: ${escapeHtml(b.specialRequests)}</div>` : ''}
        </td>
        <td><span class="badge" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">Room ${escapeHtml(b.roomNo)}</span></td>
        <td>
          <div>In: ${escapeHtml(b.checkIn)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">Out: ${escapeHtml(b.checkOut)}</div>
        </td>
        <td>${b.guestsCount || 1} Person(s)</td>
        <td><strong>₹${Number(b.totalAmount).toLocaleString('en-IN')}</strong> <span style="font-size:0.72rem; color:${b.paymentStatus === 'Paid' ? '#15803d' : '#b45309'};">(${b.paymentStatus || 'Pending'})</span></td>
        <td><span class="badge ${statusClass}">${escapeHtml(b.status)}</span></td>
        <td>${renderActionMenu(b.bookingId, actions)}</td>
      </tr>
    `;
  }).join('');
}

function populateAvailableRoomsDropdown(selectedRoomNo = '') {
  const select = document.getElementById('bookingRoomSelect');
  if (!select) return;

  const rooms = HotelStore.getRooms();
  const availableRooms = rooms.filter(r => r.status === 'Available' || r.roomNo === selectedRoomNo);

  select.innerHTML = `<option value="">-- Select Available Room --</option>` +
    availableRooms.map(r => `
      <option value="${r.roomNo}" data-price="${r.price}">
        Room ${r.roomNo} - ${r.type} (₹${Number(r.price).toLocaleString('en-IN')}/night)
      </option>
    `).join('');
  if (selectedRoomNo) select.value = selectedRoomNo;
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
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const formatDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const checkInEl = document.getElementById('bookingCheckIn');
  const checkOutEl = document.getElementById('bookingCheckOut');
  if (checkInEl && !checkInEl.value) checkInEl.value = formatDate(today);
  if (checkOutEl && !checkOutEl.value) checkOutEl.value = formatDate(tomorrow);

  form.addEventListener('submit', async (e) => {
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
    if (!checkIn || !checkOut || Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime()) || d2 <= d1) {
      showToast('Check-out must be later than check-in.', 'error');
      return;
    }
    const nights = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
    const totalAmount = nights * pricePerNight;

    const bookings = HotelStore.getBookings();
    const rooms = HotelStore.getRooms();
    const guests = HotelStore.getGuests();
    const existingBooking = editingBookingId
      ? bookings.find(booking => booking.bookingId === editingBookingId)
      : null;
    const roomConflict = bookings.some(booking =>
      booking.bookingId !== editingBookingId &&
      booking.roomNo === roomNo &&
      booking.status !== 'Cancelled' &&
      checkIn < booking.checkOut &&
      checkOut > booking.checkIn
    );
    if (roomConflict) {
      showToast('That room already has a reservation for part of these dates.', 'error');
      return;
    }

    // Auto-register guest if not existing
    let guest = guests.find(g => existingBooking ? g.guestId === existingBooking.guestId :
      g.firstName.toLowerCase() + ' ' + g.lastName.toLowerCase() === guestName.toLowerCase());
    if (!guest) {
      const guestId = `G-${crypto.randomUUID().slice(0, 16).toUpperCase()}`;
      guest = {
        guestId,
        firstName: guestName.split(' ')[0] || guestName,
        lastName: guestName.split(' ').slice(1).join(' ') || 'Guest',
        phone: guestPhone || 'N/A',
        city: 'Walk-in',
        status: immediateCheckIn ? 'In-House' : 'Reserved'
      };
      guests.push(guest);
    }

    const bookingSource = document.getElementById('bookingSource') ? document.getElementById('bookingSource').value : 'Walk-In';
    const specialRequests = document.getElementById('bookingSpecialRequests') ? document.getElementById('bookingSpecialRequests').value.trim() : '';

    if (existingBooking) {
      const previousRoomNo = existingBooking.roomNo;
      existingBooking.guestName = guestName;
      existingBooking.guestId = guest.guestId;
      existingBooking.roomNo = roomNo;
      existingBooking.checkIn = checkIn;
      existingBooking.checkOut = checkOut;
      existingBooking.guestsCount = guestsCount;
      existingBooking.totalAmount = totalAmount;
      existingBooking.bookingSource = bookingSource;
      existingBooking.specialRequests = specialRequests;
      guest.firstName = guestName.split(' ')[0] || guestName;
      guest.lastName = guestName.split(' ').slice(1).join(' ') || 'Guest';
      guest.phone = guestPhone;
      if (await HotelStore.saveGuests(guests) === false) return;
      if (await HotelStore.saveBookings(bookings) === false) return;
      if (previousRoomNo !== roomNo) {
        const oldRoom = rooms.find(room => room.roomNo === previousRoomNo);
        const otherReservations = bookings.some(booking =>
          booking.bookingId !== existingBooking.bookingId &&
          booking.roomNo === previousRoomNo &&
          booking.status !== 'Cancelled'
        );
        if (oldRoom && oldRoom.status === 'Reserved' && !otherReservations) {
          oldRoom.status = 'Available';
          delete oldRoom.currentGuest;
        }
        const nextRoom = rooms.find(room => room.roomNo === roomNo);
        if (nextRoom && nextRoom.status === 'Available') nextRoom.status = 'Reserved';
        if (await HotelStore.saveRooms(rooms) === false) return;
      }
      showToast(`Reservation #${existingBooking.bookingId} updated.`, 'success');
      editingBookingId = null;
      form.reset();
      closeModal('newBookingModal');
      renderBookingsTable();
      populateAvailableRoomsDropdown();
      return;
    }

    if (await HotelStore.saveGuests(guests) === false) return;
    const bookingId = `B-${crypto.randomUUID().slice(0, 16).toUpperCase()}`;
    const newBooking = {
      bookingId,
      guestName,
      guestId: guest.guestId,
      roomNo,
      bookingDate: formatDate(new Date()),
      checkIn,
      checkOut,
      guestsCount,
      totalAmount,
      status: immediateCheckIn ? 'Checked-In' : 'Confirmed',
      paymentStatus: 'Pending',
      bookingSource,
      specialRequests
    };

    bookings.unshift(newBooking);
    if (await HotelStore.saveBookings(bookings) === false) return;

    // Update Room state
    const room = rooms.find(r => r.roomNo === roomNo);
    if (room) {
      room.status = immediateCheckIn ? 'Occupied' : 'Reserved';
      room.currentGuest = guestName;
      if (await HotelStore.saveRooms(rooms) === false) return;
    }

    showToast(`Reservation #${bookingId} created for ${guestName}!`, 'success');
    form.reset();
    closeModal('newBookingModal');
    editingBookingId = null;
    renderBookingsTable();
    populateAvailableRoomsDropdown();
  });
}

function editBooking(bookingId) {
  const booking = HotelStore.getBookings().find(item => item.bookingId === bookingId);
  if (!booking || booking.status !== 'Confirmed') return;
  editingBookingId = bookingId;
  document.getElementById('newBookingTitle').textContent = `Edit Reservation ${bookingId}`;
  document.getElementById('bookingSubmitButton').textContent = 'Save Changes';
  document.getElementById('bookingGuestName').value = booking.guestName;
  const guest = HotelStore.getGuests().find(item => item.guestId === booking.guestId);
  document.getElementById('bookingGuestPhone').value = guest ? guest.phone : '';
  populateAvailableRoomsDropdown(booking.roomNo);
  document.getElementById('bookingCheckIn').value = booking.checkIn;
  document.getElementById('bookingCheckOut').value = booking.checkOut;
  document.getElementById('bookingGuestCount').value = booking.guestsCount || 1;
  document.getElementById('bookingSource').value = booking.bookingSource || 'Walk-In';
  document.getElementById('bookingSpecialRequests').value = booking.specialRequests || '';
  document.getElementById('bookingImmediateCheckIn').checked = false;
  openModal('newBookingModal');
}

function startNewBooking() {
  editingBookingId = null;
  const form = document.getElementById('newBookingForm');
  form.reset();
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const formatDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  document.getElementById('bookingCheckIn').value = formatDate(today);
  document.getElementById('bookingCheckOut').value = formatDate(tomorrow);
  document.getElementById('newBookingTitle').textContent = 'New Guest Reservation / Walk-In Check-In';
  document.getElementById('bookingSubmitButton').textContent = 'Confirm Reservation';
  populateAvailableRoomsDropdown();
  openModal('newBookingModal');
}

async function deleteBooking(bookingId) {
  const booking = HotelStore.getBookings().find(item => item.bookingId === bookingId);
  if (!booking || booking.status === 'Checked-In' || booking.status === 'Checked-Out') return;
  const hasInvoice = HotelStore.getInvoices().some(invoice => invoice.bookingId === bookingId);
  const hasReview = HotelStore.getReviews().some(review => review.bookingId === bookingId);
  if (hasInvoice || hasReview) {
    showToast('This reservation is linked to an invoice or review; cancel it instead of deleting it.', 'error');
    return;
  }
  if (!confirm(`Delete reservation ${bookingId}?`)) return;
  const bookings = HotelStore.getBookings().filter(item => item.bookingId !== bookingId);
  if (await HotelStore.saveBookings(bookings) === false) return;
  const rooms = HotelStore.getRooms();
  const room = rooms.find(item => item.roomNo === booking.roomNo);
  if (room && room.status === 'Reserved' && !bookings.some(item => item.roomNo === booking.roomNo && item.status !== 'Cancelled')) {
    room.status = 'Available';
    delete room.currentGuest;
    if (await HotelStore.saveRooms(rooms) === false) return;
  }
  renderBookingsTable();
  populateAvailableRoomsDropdown();
  showToast(`Reservation ${bookingId} deleted.`, 'info');
}

async function performCheckIn(bookingId) {
  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const b = bookings.find(x => x.bookingId === bookingId);
  if (!b) return;

  b.status = 'Checked-In';
  if (await HotelStore.saveBookings(bookings) === false) return;

  const room = rooms.find(r => r.roomNo === b.roomNo);
  if (room) {
    room.status = 'Occupied';
    room.currentGuest = b.guestName;
    if (await HotelStore.saveRooms(rooms) === false) return;
  }

  showToast(`Guest ${b.guestName} is now Checked In to Room ${b.roomNo}.`, 'success');
  renderBookingsTable();
}

async function performCheckOut(bookingId) {
  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const b = bookings.find(x => x.bookingId === bookingId);
  if (!b) return;

  b.status = 'Checked-Out';
  if (await HotelStore.saveBookings(bookings) === false) return;

  const room = rooms.find(r => r.roomNo === b.roomNo);
  if (room) {
    room.status = 'Cleaning';
    delete room.currentGuest;
    if (await HotelStore.saveRooms(rooms) === false) return;
  }

  showToast(`Folio finalized. Guest ${b.guestName} checked out successfully.`, 'info');
  renderBookingsTable();
}

async function cancelBooking(bookingId) {
  if (!confirm(`Are you sure you want to cancel booking #${bookingId}?`)) return;

  const bookings = HotelStore.getBookings();
  const rooms = HotelStore.getRooms();

  const b = bookings.find(x => x.bookingId === bookingId);
  if (!b) return;

  b.status = 'Cancelled';
  if (await HotelStore.saveBookings(bookings) === false) return;

  const room = rooms.find(r => r.roomNo === b.roomNo);
  const otherReservations = bookings.some(booking =>
    booking.bookingId !== b.bookingId &&
    booking.roomNo === b.roomNo &&
    booking.status !== 'Cancelled'
  );
  if (room && room.status === 'Reserved' && !otherReservations) {
    room.status = 'Available';
    delete room.currentGuest;
    if (await HotelStore.saveRooms(rooms) === false) return;
  }

  showToast(`Booking #${bookingId} marked as Cancelled.`, 'error');
  renderBookingsTable();
}
