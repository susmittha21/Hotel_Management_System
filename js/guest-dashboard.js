let guestAccount = null;
let guestAvailableRooms = [];
let guestUpiScanConfirmed = false;

document.addEventListener('DOMContentLoaded', async () => {
  setGuestAccountReady(false);
  setupGuestBooking();
  setupGuestServiceRequest();
  setupGuestReview();
  document.getElementById('guestLogoutButton').addEventListener('click', logoutGuest);
  configureFoodOrderLink();

  try {
    guestAccount = await apiRequest('/guest/account');
    setGuestAccountReady(true);
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
    showGuestMessage(
      'guestBookingMessage',
      'We could not load your guest account, so reservations are paused. Check that the hotel API and database are running, then refresh or sign in again.',
      'error'
    );
  }
  initializeGuestBookingDates();
});

function setGuestAccountReady(ready) {
  const form = document.getElementById('guestBookingForm');
  if (!form) return;
  ['guestCheckIn', 'guestCheckOut', 'guestCount', 'guestBookingNotes', 'guestCheckAvailability']
    .forEach(id => { document.getElementById(id).disabled = !ready; });
  if (!ready) {
    document.getElementById('guestAvailableRooms').disabled = true;
    document.getElementById('guestPaymentMethod').disabled = true;
    document.getElementById('guestReserveButton').disabled = true;
  }
}

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
    guestUpiScanConfirmed = false;
    document.getElementById('guestUpiScanConfirm').disabled = false;
    document.getElementById('guestUpiScanStatus').textContent = '';
    updateGuestPaymentQuote(event.target.value);
  });
  document.getElementById('guestPaymentMethod').addEventListener('change', () => {
    guestUpiScanConfirmed = false;
    document.getElementById('guestUpiScanConfirm').disabled = false;
    document.getElementById('guestUpiScanStatus').textContent = '';
    updateGuestPaymentQuote(document.getElementById('guestAvailableRooms').value);
  });
  document.getElementById('guestUpiScanConfirm').addEventListener('click', () => {
    if (document.getElementById('guestPaymentMethod').value !== 'UPI') return;
    guestUpiScanConfirmed = true;
    document.getElementById('guestUpiScanConfirm').disabled = true;
    document.getElementById('guestUpiScanStatus').textContent = 'Scan acknowledged. You can now complete the no-charge reservation.';
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
      showGuestMessage('guestBookingMessage', 'Check availability, select a room, and choose a payment option.', 'error');
      return;
    }
    if (paymentMethod === 'UPI' && !guestUpiScanConfirmed) {
      showGuestMessage('guestBookingMessage', 'Scan the no-charge QR and confirm the scan before completing the reservation.', 'error');
      return;
    }
    const submit = document.getElementById('guestReserveButton');
    submit.disabled = true;
    showGuestMessage('guestBookingMessage', 'Completing payment…');
    try {
      const booking = await apiRequest('/guest/bookings', {
        method: 'POST',
        body: JSON.stringify({
          roomNo,
          checkIn: document.getElementById('guestCheckIn').value,
          checkOut: document.getElementById('guestCheckOut').value,
          guestsCount: Number(document.getElementById('guestCount').value),
          specialRequests: document.getElementById('guestBookingNotes').value.trim() || null,
          paymentMethod,
          upiScanConfirmed: paymentMethod === 'UPI' && guestUpiScanConfirmed
        })
      });
      guestAccount.bookings.unshift(booking);
      renderGuestBookings();
      document.getElementById('guestBookingNotes').value = '';
      document.getElementById('guestPaymentMethod').value = '';
      clearGuestAvailability();
      showGuestMessage(
        'guestBookingMessage',
        `Reservation ${booking.bookingId} is confirmed. Payment complete for ${formatGuestMoney(booking.paidAmount)}; no money was charged. Invoice ${booking.invoiceId}; transaction ${booking.paymentTransactionId}.`,
        'success'
      );
      notifyMongoSyncStatus(booking.mongoSynced, 'Reservation and payment completion recorded in PostgreSQL; no money was charged.');
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
    checkButton.disabled = !guestAccount;
  }
}

function clearGuestAvailability() {
  guestAvailableRooms = [];
  guestUpiScanConfirmed = false;
  const roomSelect = document.getElementById('guestAvailableRooms');
  roomSelect.replaceChildren(new Option('Check availability to choose a room', ''));
  roomSelect.disabled = true;
  const paymentMethod = document.getElementById('guestPaymentMethod');
  paymentMethod.value = '';
  paymentMethod.disabled = true;
  document.getElementById('guestPaymentSummary').textContent =
    'Check availability and select a room to see the total.';
  document.getElementById('guestUpiQrPanel').hidden = true;
  const qrImage = document.getElementById('guestUpiQrImage');
  qrImage.removeAttribute('src');
  delete qrImage.dataset.roomNo;
  delete qrImage.dataset.total;
  document.getElementById('guestUpiScanConfirm').disabled = false;
  document.getElementById('guestUpiScanStatus').textContent = '';
  const submit = document.getElementById('guestReserveButton');
  submit.disabled = true;
  submit.textContent = 'Pay & Confirm Reservation';
}

function updateGuestPaymentQuote(roomNo) {
  const room = guestAvailableRooms.find(item => item.roomNo === roomNo);
  const paymentMethod = document.getElementById('guestPaymentMethod');
  const paymentSummary = document.getElementById('guestPaymentSummary');
  const submit = document.getElementById('guestReserveButton');
  const qrPanel = document.getElementById('guestUpiQrPanel');
  paymentMethod.disabled = !room;
  if (!room) {
    paymentSummary.textContent = 'Select an available room to see the total.';
    qrPanel.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Pay & Confirm Reservation';
    return;
  }
  const isUpi = paymentMethod.value === 'UPI';
  paymentSummary.textContent = isUpi
    ? `${room.nights} night(s): ${formatGuestMoney(room.subtotal)} + tax ${formatGuestMoney(room.taxAmount)} = ${formatGuestMoney(room.totalAmount)}. Scan the no-charge QR, then confirm the scan to continue. No money will be charged.`
    : `${room.nights} night(s): ${formatGuestMoney(room.subtotal)} + tax ${formatGuestMoney(room.taxAmount)} = ${formatGuestMoney(room.totalAmount)}. Payment completion confirms your reservation; no money will be charged.`;
  qrPanel.hidden = !isUpi;
  if (isUpi) renderGuestUpiQr(room);
  submit.disabled = !paymentMethod.value || (isUpi && !guestUpiScanConfirmed);
  submit.textContent = paymentMethod.value
    ? `Pay ${formatGuestMoney(room.totalAmount)} & Confirm Reservation`
    : 'Pay & Confirm Reservation';
}

function renderGuestUpiQr(room) {
  const image = document.getElementById('guestUpiQrImage');
  const confirmButton = document.getElementById('guestUpiScanConfirm');
  if (image.dataset.roomNo === room.roomNo && image.dataset.total === String(room.totalAmount) && image.src) {
    confirmButton.disabled = guestUpiScanConfirmed;
    return;
  }
  confirmButton.disabled = true;
  image.dataset.roomNo = room.roomNo;
  image.dataset.total = String(room.totalAmount);
  try {
    if (typeof qrcode !== 'function') throw new Error('QR code generator is unavailable.');
    const qr = qrcode(0, 'M');
    qr.addData(
      `VS PLAZA NO-CHARGE UPI SCAN SIMULATION | Room ${room.roomNo} | ` +
      `${room.nights} night(s) | INR ${Number(room.totalAmount).toFixed(2)} | No money transfer`
    );
    qr.make();
    image.src = qr.createDataURL(5, 4);
    confirmButton.disabled = false;
  } catch (error) {
    console.error('Unable to render the no-charge UPI QR code.', error);
    image.removeAttribute('src');
    delete image.dataset.roomNo;
    delete image.dataset.total;
    showGuestMessage('guestBookingMessage', 'The no-charge UPI QR could not be generated. Refresh the page and try again.', 'error');
  }
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
      <td>${booking.paymentStatus === 'Paid'
    ? 'Payment complete · No money charged'
    : escapeHtml(booking.paymentStatus || 'Pending')}</td>
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
