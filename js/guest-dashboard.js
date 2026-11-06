let guestAccount = null;
let guestAvailableRooms = [];

document.addEventListener('DOMContentLoaded', async () => {
  setupGuestBooking();
  setupGuestServiceRequest();
  setupGuestReview();
  document.getElementById('guestLogoutButton').addEventListener('click', logoutGuest);
  configureFoodOrderLink();

  try {
    guestAccount = await apiRequest('/guest/account');
    document.getElementById('guestWelcome').textContent =
      `Hello, ${guestAccount.guest.firstName} ${guestAccount.guest.lastName}`;
    renderGuestBookings();
    renderGuestReviews();
    populateGuestReviewBookings();
    renderGuestServices();
    populateGuestServices();
    populateServiceBookingOptions();
  } catch (error) {
    console.error('Unable to load guest account data.', error);
    showGuestMessage('guestBookingMessage', error.message, 'error');
  }
  initializeGuestBookingDates();
});

function showGuestMessage(elementId, text, kind = '') {
  const message = document.getElementById(elementId);
  message.textContent = text;
  message.className = `guest-message${kind ? ` ${kind}` : ''}`;
}

function initializeGuestBookingDates() {
  const dateValue = offset => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const checkIn = document.getElementById('guestCheckIn');
  const checkOut = document.getElementById('guestCheckOut');
  checkIn.min = dateValue(0);
  checkIn.value = dateValue(0);
  checkOut.min = dateValue(1);
  checkOut.value = dateValue(1);
  checkIn.addEventListener('change', () => {
    const minCheckout = new Date(`${checkIn.value}T00:00:00`);
    minCheckout.setDate(minCheckout.getDate() + 1);
    const minDate = `${minCheckout.getFullYear()}-${String(minCheckout.getMonth() + 1).padStart(2, '0')}-${String(minCheckout.getDate()).padStart(2, '0')}`;
    checkOut.min = minDate;
    if (!checkOut.value || checkOut.value <= checkIn.value) checkOut.value = minDate;
    clearGuestAvailability();
  });
  checkOut.addEventListener('change', clearGuestAvailability);
  document.getElementById('guestCount').addEventListener('change', clearGuestAvailability);
}

function setupGuestBooking() {
  document.getElementById('guestCheckAvailability').addEventListener('click', loadGuestAvailability);
  document.getElementById('guestAvailableRooms').addEventListener('change', event => {
    updateGuestPaymentQuote(event.target.value);
  });
  document.getElementById('guestPaymentMethod').addEventListener('change', () => {
    updateGuestPaymentQuote(document.getElementById('guestAvailableRooms').value);
  });
  document.getElementById('guestBookingForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const roomNo = document.getElementById('guestAvailableRooms').value;
    const selectedRoom = guestAvailableRooms.find(room => room.roomNo === roomNo);
    const paymentMethod = document.getElementById('guestPaymentMethod').value;
    if (!selectedRoom || !['UPI', 'Credit Card', 'Net Banking'].includes(paymentMethod)) {
      showGuestMessage('guestBookingMessage', 'Check availability, select a room, and choose a demo payment option.', 'error');
      return;
    }
    const submit = document.getElementById('guestReserveButton');
    submit.disabled = true;
    showGuestMessage('guestBookingMessage', 'Processing the demo payment…');
    try {
      const booking = await apiRequest('/guest/bookings', {
        method: 'POST',
        body: JSON.stringify({
          roomNo,
          checkIn: document.getElementById('guestCheckIn').value,
          checkOut: document.getElementById('guestCheckOut').value,
          guestsCount: Number(document.getElementById('guestCount').value),
          specialRequests: document.getElementById('guestBookingNotes').value.trim() || null,
          paymentMethod
        })
      });
      guestAccount.bookings.unshift(booking);
      renderGuestBookings();
      document.getElementById('guestBookingNotes').value = '';
      document.getElementById('guestPaymentMethod').value = '';
      clearGuestAvailability();
      showGuestMessage(
        'guestBookingMessage',
        `Reservation ${booking.bookingId} is confirmed. Demo payment of ${formatGuestMoney(booking.paidAmount)} was recorded. Invoice ${booking.invoiceId}; transaction ${booking.paymentTransactionId}.`,
        'success'
      );
      notifyMongoSyncStatus(booking.mongoSynced, 'Reservation, paid invoice, and simulated demo payment saved in PostgreSQL.');
    } catch (error) {
      showGuestMessage('guestBookingMessage', error.message, 'error');
    } finally {
      updateGuestPaymentQuote(document.getElementById('guestAvailableRooms').value);
    }
  });
}

async function loadGuestAvailability() {
  const checkIn = document.getElementById('guestCheckIn').value;
  const checkOut = document.getElementById('guestCheckOut').value;
  const guestsCount = Number(document.getElementById('guestCount').value);
  const roomSelect = document.getElementById('guestAvailableRooms');
  const checkButton = document.getElementById('guestCheckAvailability');
  clearGuestAvailability();
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    showGuestMessage('guestBookingMessage', 'Choose a check-out date later than check-in.', 'error');
    return;
  }

  checkButton.disabled = true;
  showGuestMessage('guestBookingMessage', 'Checking room availability…');
  try {
    const params = new URLSearchParams({
      check_in: checkIn,
      check_out: checkOut,
      guests_count: String(guestsCount)
    });
    const result = await apiRequest(`/public/availability?${params}`);
    guestAvailableRooms = result.rooms;
    if (!guestAvailableRooms.length) {
      showGuestMessage('guestBookingMessage', 'No room is available for those dates and guest count.', 'error');
      return;
    }
    roomSelect.replaceChildren(new Option('Select an available room', ''));
    guestAvailableRooms.forEach(room => {
      roomSelect.add(new Option(
        `${room.type} · Room ${room.roomNo} · ${room.capacity} guests · ${formatGuestMoney(room.price)}/night · ${room.nights} night(s) · Total ${formatGuestMoney(room.totalAmount)} incl. tax`,
        room.roomNo
      ));
    });
    roomSelect.disabled = false;
    showGuestMessage('guestBookingMessage', `${guestAvailableRooms.length} room(s) available.`);
  } catch (error) {
    showGuestMessage('guestBookingMessage', error.message, 'error');
  } finally {
    checkButton.disabled = false;
  }
}

function clearGuestAvailability() {
  guestAvailableRooms = [];
  const roomSelect = document.getElementById('guestAvailableRooms');
  roomSelect.replaceChildren(new Option('Check availability to choose a room', ''));
  roomSelect.disabled = true;
  const paymentMethod = document.getElementById('guestPaymentMethod');
  paymentMethod.value = '';
  paymentMethod.disabled = true;
  document.getElementById('guestPaymentSummary').textContent =
    'Check availability and select a room to see the total.';
  const submit = document.getElementById('guestReserveButton');
  submit.disabled = true;
  submit.textContent = 'Pay & Confirm Reservation';
}

function updateGuestPaymentQuote(roomNo) {
  const room = guestAvailableRooms.find(item => item.roomNo === roomNo);
  const paymentMethod = document.getElementById('guestPaymentMethod');
  const paymentSummary = document.getElementById('guestPaymentSummary');
  const submit = document.getElementById('guestReserveButton');
  paymentMethod.disabled = !room;
  if (!room) {
    paymentSummary.textContent = 'Select an available room to see the total.';
    submit.disabled = true;
    submit.textContent = 'Pay & Confirm Reservation';
    return;
  }
  paymentSummary.textContent =
    `${room.nights} night(s): ${formatGuestMoney(room.subtotal)} + tax ${formatGuestMoney(room.taxAmount)} = ${formatGuestMoney(room.totalAmount)}. This demo checkout records the payment and confirms your reservation.`;
  submit.disabled = !paymentMethod.value;
  submit.textContent = paymentMethod.value
    ? `Pay ${formatGuestMoney(room.totalAmount)} & Confirm Reservation`
    : 'Pay & Confirm Reservation';
}

function formatGuestMoney(amount) {
  return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderGuestBookings() {
  const body = document.getElementById('guestBookingsBody');
  const bookings = guestAccount?.bookings || [];
  if (!bookings.length) {
    body.innerHTML = '<tr><td class="guest-empty" colspan="8">No reservations yet.</td></tr>';
    return;
  }
  body.innerHTML = bookings.map(booking => `
    <tr>
      <td>${escapeHtml(booking.bookingId)}</td>
      <td>Room ${escapeHtml(booking.roomNo)}</td>
      <td>${escapeHtml(booking.checkIn)} – ${escapeHtml(booking.checkOut)}</td>
      <td>${escapeHtml(booking.guestsCount)}</td>
      <td>${escapeHtml(booking.status)}</td>
      <td>${escapeHtml(booking.paymentStatus || 'Pending')}</td>
      <td>${booking.paidAmount == null ? '—' : escapeHtml(formatGuestMoney(booking.paidAmount))}</td>
      <td>${escapeHtml(booking.invoiceId || '—')}</td>
    </tr>
  `).join('');
}

function populateGuestReviewBookings() {
  const select = document.getElementById('guestReviewBooking');
  const existingBookingIds = new Set((guestAccount?.reviews || []).map(review => review.bookingId));
  const eligibleBookings = (guestAccount?.bookings || []).filter(booking =>
    booking.status === 'Checked-Out' && !existingBookingIds.has(booking.bookingId)
  );
  select.replaceChildren(new Option(
    eligibleBookings.length ? 'Select a completed reservation' : 'No reservations available to review',
    ''
  ));
  eligibleBookings.forEach(booking => {
    select.add(new Option(`${booking.bookingId} · Room ${booking.roomNo}`, booking.bookingId));
  });
  select.disabled = !eligibleBookings.length;
  document.getElementById('guestReviewSubmit').disabled = !eligibleBookings.length;
}

function setupGuestReview() {
  document.getElementById('guestReviewForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const bookingId = document.getElementById('guestReviewBooking').value;
    if (!(guestAccount?.bookings || []).some(booking =>
      booking.bookingId === bookingId && booking.status === 'Checked-Out'
    ) || (guestAccount?.reviews || []).some(review => review.bookingId === bookingId)) {
      showGuestMessage('guestReviewMessage', 'Choose an eligible reservation that has not already been reviewed.', 'error');
      populateGuestReviewBookings();
      return;
    }

    const submit = document.getElementById('guestReviewSubmit');
    submit.disabled = true;
    try {
      const review = await apiRequest('/guest/reviews', {
        method: 'POST',
        body: JSON.stringify({
          bookingId,
          rating: Number(document.getElementById('guestReviewRating').value),
          comment: document.getElementById('guestReviewComment').value.trim()
        })
      });
      guestAccount.reviews.unshift(review);
      renderGuestReviews();
      populateGuestReviewBookings();
      document.getElementById('guestReviewForm').reset();
      showGuestMessage('guestReviewMessage', 'Thank you. Your review has been shared with hotel management.', 'success');
      notifyMongoSyncStatus(review.mongoSynced, 'Review saved in PostgreSQL.');
    } catch (error) {
      showGuestMessage('guestReviewMessage', error.message, 'error');
      populateGuestReviewBookings();
    }
  });
}

function renderGuestReviews() {
  const body = document.getElementById('guestReviewsBody');
  const reviews = guestAccount?.reviews || [];
  if (!reviews.length) {
    body.innerHTML = '<tr><td class="guest-empty" colspan="3">You have not submitted any reviews yet.</td></tr>';
    return;
  }
  body.innerHTML = reviews.map(review => `
    <tr>
      <td>${escapeHtml(review.bookingId)}</td>
      <td>${escapeHtml(review.rating)} / 5</td>
      <td>${escapeHtml(review.comment || '—')}</td>
    </tr>
  `).join('');
}

function populateGuestServices() {
  const select = document.getElementById('guestService');
  select.replaceChildren(new Option('Choose a service', ''));
  (guestAccount?.services || []).forEach(service => {
    select.add(new Option(`${service.name} · ₹${Number(service.price).toLocaleString('en-IN')}`, service.serviceId));
  });
  select.disabled = !(guestAccount?.services || []).length;
  document.getElementById('guestServiceSubmit').disabled = select.disabled;
}

function populateServiceBookingOptions() {
  const select = document.getElementById('guestServiceBooking');
  select.replaceChildren(new Option('Not linked to a reservation', ''));
  (guestAccount?.bookings || []).filter(booking => booking.status !== 'Cancelled').forEach(booking => {
    select.add(new Option(`${booking.bookingId} · Room ${booking.roomNo}`, booking.bookingId));
  });
}

function setupGuestServiceRequest() {
  document.getElementById('guestServiceForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const serviceId = document.getElementById('guestService').value;
    if (!(guestAccount?.services || []).some(service => service.serviceId === serviceId)) {
      showGuestMessage('guestServiceMessage', 'Choose a valid hotel service.', 'error');
      return;
    }
    const submit = document.getElementById('guestServiceSubmit');
    submit.disabled = true;
    try {
      const request = await apiRequest('/guest/service-requests', {
        method: 'POST',
        body: JSON.stringify({
          serviceId,
          bookingId: document.getElementById('guestServiceBooking').value || null,
          notes: document.getElementById('guestServiceNotes').value.trim() || null
        })
      });
      guestAccount.serviceRequests.unshift(request);
      renderGuestServices();
      document.getElementById('guestServiceNotes').value = '';
      showGuestMessage('guestServiceMessage', 'Your service request has been sent to hotel staff.', 'success');
      notifyMongoSyncStatus(request.mongoSynced, 'Service request saved in PostgreSQL.');
    } catch (error) {
      showGuestMessage('guestServiceMessage', error.message, 'error');
    } finally {
      submit.disabled = !(guestAccount?.services || []).length;
    }
  });
}

function renderGuestServices() {
  const body = document.getElementById('guestServiceRequestsBody');
  const requests = guestAccount?.serviceRequests || [];
  if (!requests.length) {
    body.innerHTML = '<tr><td class="guest-empty" colspan="6">No service requests yet.</td></tr>';
    return;
  }
  body.innerHTML = requests.map(request => `
    <tr>
      <td>${escapeHtml(request.requestId)}</td>
      <td>${escapeHtml(request.serviceName)}</td>
      <td>${escapeHtml(request.bookingId || '—')}</td>
      <td>${escapeHtml(request.notes || '—')}</td>
      <td>${escapeHtml(request.status)}</td>
      <td>${escapeHtml(request.requestedAt || '')}</td>
    </tr>
  `).join('');
}

function configureFoodOrderLink() {
  const link = document.getElementById('guestFoodOrderLink');
  const configuredUrl = window.HOTEL_FOOD_ORDER_URL;
  if (!configuredUrl) return;
  try {
    const target = new URL(configuredUrl, window.location.href);
    if (!['http:', 'https:'].includes(target.protocol)) return;
    link.href = target.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Order Food Online';
    link.setAttribute('aria-disabled', 'false');
  } catch (error) {
    console.error('The configured food ordering link is invalid.', error);
  }
}

async function logoutGuest() {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Unable to close guest session.', error);
  }
  localStorage.removeItem(STORAGE_KEYS.AUTH);
  window.location.replace('guest-account.html');
}
