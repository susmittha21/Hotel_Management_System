let guestAccount = null;
let guestAvailableRooms = [];
let activeGuestQrPayment = null;
let guestQrPaymentInProgress = false;

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
  document.getElementById('guestQrPayButton').disabled = !ready || !document.getElementById('guestAvailableRooms').value;
  if (!ready) {
    document.getElementById('guestAvailableRooms').disabled = true;
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
  document.getElementById('guestQrPayButton').addEventListener('click', startGuestQrPayment);
  document.getElementById('guestQrCancelButton').addEventListener('click', cancelGuestQrPayment);
  document.getElementById('guestQrRetryButton').addEventListener('click', () => {
    if (activeGuestQrPayment?.paymentDetected) {
      confirmGuestQrBooking(activeGuestQrPayment);
    }
  });
  document.getElementById('guestAvailableRooms').addEventListener('change', event => {
    updateGuestPaymentQuote(event.target.value);
  });
  document.getElementById('guestBookingForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const roomType = document.getElementById('guestAvailableRooms').value;
    const selectedRoom = guestAvailableRooms.find(room => room.type === roomType);
    if (!selectedRoom) {
      showGuestMessage('guestBookingMessage', 'Check availability and select a room type.', 'error');
      return;
    }
    if (typeof window.Razorpay !== 'function') {
      showGuestMessage('guestBookingMessage', 'Razorpay Checkout could not be loaded. Check your internet connection and try again.', 'error');
      return;
    }
    setGuestQrPaymentInProgress(true);
    showGuestMessage('guestBookingMessage', 'Preparing secure Razorpay test checkout…');
    try {
      const reservation = getGuestReservation(roomType);
      const order = await apiRequest('/guest/razorpay/orders', {
        method: 'POST',
        body: JSON.stringify(reservation)
      });
      let checkoutFinished = false;
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'VS Plaza Hotel & Suites',
        description: `${roomType} · ${order.nights} night(s)`,
        order_id: order.orderId,
        prefill: {
          name: `${guestAccount.guest.firstName} ${guestAccount.guest.lastName}`.trim(),
          email: guestAccount.guest.email || ''
        },
        theme: { color: '#173c42' },
        modal: {
          ondismiss: () => {
            if (checkoutFinished) return;
            setGuestQrPaymentInProgress(false);
            showGuestMessage('guestBookingMessage', 'Checkout was closed. No reservation was confirmed.', 'error');
          }
        },
        handler: async paymentResponse => {
          checkoutFinished = true;
          showGuestMessage('guestBookingMessage', 'Verifying your Razorpay test payment…');
          try {
            const booking = await apiRequest('/guest/bookings', {
              method: 'POST',
              body: JSON.stringify({
                ...reservation,
                razorpayOrderId: paymentResponse.razorpay_order_id,
                razorpayPaymentId: paymentResponse.razorpay_payment_id,
                razorpaySignature: paymentResponse.razorpay_signature
              })
            });
            guestAccount.bookings.unshift(booking);
            renderGuestBookings();
            document.getElementById('guestBookingNotes').value = '';
            clearGuestAvailability();
            setGuestQrPaymentInProgress(false);
            showGuestMessage(
              'guestBookingMessage',
              `Reservation ${booking.bookingId} is confirmed. Razorpay test payment complete for ${formatGuestMoney(booking.paidAmount)}; no real money was charged. Invoice ${booking.invoiceId}.`,
              'success'
            );
            notifyMongoSyncStatus(booking.mongoSynced, 'Reservation and Razorpay test payment saved; no real money was charged.');
          } catch (error) {
            setGuestQrPaymentInProgress(false);
            showGuestMessage('guestBookingMessage', error.message, 'error');
          }
        }
      });
      checkout.on('payment.failed', response => {
        checkoutFinished = true;
        setGuestQrPaymentInProgress(false);
        const description = response.error?.description || 'Razorpay did not complete the test payment.';
        showGuestMessage('guestBookingMessage', `${description} No reservation was confirmed.`, 'error');
      });
      showGuestMessage('guestBookingMessage', 'Complete the payment in Razorpay test mode. No real money will be charged.');
      checkout.open();
    } catch (error) {
      setGuestQrPaymentInProgress(false);
      showGuestMessage('guestBookingMessage', error.message, 'error');
      updateGuestPaymentQuote(document.getElementById('guestAvailableRooms').value);
    }
  });
}

function getGuestReservation(roomType) {
  return {
    roomType,
    checkIn: document.getElementById('guestCheckIn').value,
    checkOut: document.getElementById('guestCheckOut').value,
    guestsCount: Number(document.getElementById('guestCount').value),
    specialRequests: document.getElementById('guestBookingNotes').value.trim() || null
  };
}

async function startGuestQrPayment() {
  const roomType = document.getElementById('guestAvailableRooms').value;
  const room = guestAvailableRooms.find(item => item.type === roomType);
  if (!guestAccount || !room) {
    showGuestMessage('guestBookingMessage', 'Check availability and select a room type first.', 'error');
    return;
  }

  setGuestQrPaymentInProgress(true);
  showGuestMessage('guestBookingMessage', 'Creating a single-use Razorpay test QR…');
  try {
    const reservation = getGuestReservation(roomType);
    const qrCode = await apiRequest('/guest/razorpay/qr-codes', {
      method: 'POST',
      body: JSON.stringify(reservation)
    });
    const imageUrl = new URL(qrCode.imageUrl);
    if (imageUrl.protocol !== 'https:') {
      throw new Error('Razorpay returned an invalid QR image URL.');
    }
    activeGuestQrPayment = {
      qrCodeId: qrCode.qrCodeId,
      expiresAt: Number(qrCode.expiresAt) * 1000,
      reservation
    };
    document.getElementById('guestQrCodeImage').src = imageUrl.href;
    document.getElementById('guestQrCodeLink').href = imageUrl.href;
    document.getElementById('guestQrAmount').textContent =
      `Test amount: ${formatGuestMoney(qrCode.totalAmount)}`;
    document.getElementById('guestQrPaymentInstructions').textContent =
      'Scan through a UPI test flow supported by your Razorpay account before it expires. This single-use QR is valid for 15 minutes. Do not use a personal/live UPI account.';
    document.getElementById('guestQrPayment').hidden = false;
    showGuestMessage('guestBookingMessage', 'Waiting for Razorpay to confirm your test UPI payment…');
    scheduleGuestQrStatusCheck();
  } catch (error) {
    setGuestQrPaymentInProgress(false);
    showGuestMessage('guestBookingMessage', error.message, 'error');
  }
}

function setGuestQrPaymentInProgress(inProgress) {
  guestQrPaymentInProgress = inProgress;
  ['guestCheckIn', 'guestCheckOut', 'guestCount', 'guestBookingNotes', 'guestCheckAvailability']
    .forEach(id => { document.getElementById(id).disabled = inProgress || !guestAccount; });
  const roomSelect = document.getElementById('guestAvailableRooms');
  roomSelect.disabled = inProgress || !guestAccount || !guestAvailableRooms.length;
  const hasRoom = Boolean(roomSelect.value && guestAvailableRooms.some(room => room.type === roomSelect.value));
  document.getElementById('guestReserveButton').disabled = inProgress || !guestAccount || !hasRoom;
  document.getElementById('guestQrPayButton').disabled = inProgress || !guestAccount || !hasRoom;
}

function scheduleGuestQrStatusCheck() {
  if (!activeGuestQrPayment) return;
  const delay = Math.min(5000, Math.max(0, activeGuestQrPayment.expiresAt - Date.now()));
  activeGuestQrPayment.timer = window.setTimeout(checkGuestQrPaymentStatus, delay);
}

async function checkGuestQrPaymentStatus() {
  const activePayment = activeGuestQrPayment;
  if (!activePayment) return;
  if (Date.now() >= activePayment.expiresAt && !activePayment.paymentDetected) {
    activeGuestQrPayment = null;
    document.getElementById('guestQrPayment').hidden = true;
    document.getElementById('guestQrCodeImage').removeAttribute('src');
    setGuestQrPaymentInProgress(false);
    showGuestMessage('guestBookingMessage', 'This test QR expired without a confirmed payment. Create a new QR to try again.', 'error');
    return;
  }

  try {
    const result = await apiRequest(
      `/guest/razorpay/qr-codes/${encodeURIComponent(activePayment.qrCodeId)}`
    );
    if (activeGuestQrPayment !== activePayment) return;
    if (result.status === 'paid') {
      await confirmGuestQrBooking(activePayment);
      return;
    }
    if (result.status === 'expired') {
      activeGuestQrPayment = null;
      document.getElementById('guestQrPayment').hidden = true;
      document.getElementById('guestQrCodeImage').removeAttribute('src');
      setGuestQrPaymentInProgress(false);
      showGuestMessage('guestBookingMessage', 'This test QR expired without a confirmed payment. Create a new QR to try again.', 'error');
      return;
    }
    showGuestMessage('guestBookingMessage', 'Waiting for Razorpay to confirm your test UPI payment…');
  } catch (error) {
    if (activeGuestQrPayment !== activePayment) return;
    showGuestMessage('guestBookingMessage', `${error.message} We will keep checking while this QR is active.`, 'error');
  }
  scheduleGuestQrStatusCheck();
}

async function confirmGuestQrBooking(activePayment) {
  if (activeGuestQrPayment !== activePayment || activePayment.isConfirming) return;
  activePayment.paymentDetected = true;
  activePayment.isConfirming = true;
  document.getElementById('guestQrCancelButton').disabled = true;
  document.getElementById('guestQrRetryButton').hidden = true;
  showGuestMessage('guestBookingMessage', 'Payment detected. Verifying it and confirming your reservation…');
  try {
    const booking = await apiRequest('/guest/bookings/qr', {
      method: 'POST',
      body: JSON.stringify({
        ...activePayment.reservation,
        qrCodeId: activePayment.qrCodeId
      })
    });
    activeGuestQrPayment = null;
    document.getElementById('guestQrPayment').hidden = true;
    document.getElementById('guestQrCodeImage').removeAttribute('src');
    guestAccount.bookings.unshift(booking);
    renderGuestBookings();
    populateServiceBookingOptions();
    document.getElementById('guestBookingNotes').value = '';
    clearGuestAvailability();
    showGuestMessage(
      'guestBookingMessage',
      `Reservation ${booking.bookingId} is confirmed. Razorpay test QR payment complete for ${formatGuestMoney(booking.paidAmount)}; no real money was charged. Invoice ${booking.invoiceId}.`,
      'success'
    );
    notifyMongoSyncStatus(booking.mongoSynced, 'Reservation and Razorpay test QR payment saved; no real money was charged.');
  } catch (error) {
    document.getElementById('guestQrRetryButton').hidden = false;
    showGuestMessage(
      'guestBookingMessage',
      `Payment was detected, but reservation confirmation failed: ${error.message} Select “Retry reservation confirmation” to try again.`,
      'error'
    );
  } finally {
    activePayment.isConfirming = false;
    if (!activeGuestQrPayment) {
      setGuestQrPaymentInProgress(false);
      document.getElementById('guestQrCancelButton').disabled = false;
      document.getElementById('guestQrRetryButton').hidden = true;
    }
  }
}

async function cancelGuestQrPayment() {
  const activePayment = activeGuestQrPayment;
  if (!activePayment || activePayment.paymentDetected) return;
  document.getElementById('guestQrCancelButton').disabled = true;
  try {
    await apiRequest(
      `/guest/razorpay/qr-codes/${encodeURIComponent(activePayment.qrCodeId)}/close`,
      { method: 'POST' }
    );
    if (activePayment.timer) window.clearTimeout(activePayment.timer);
    activeGuestQrPayment = null;
    document.getElementById('guestQrPayment').hidden = true;
    document.getElementById('guestQrCodeImage').removeAttribute('src');
    document.getElementById('guestQrRetryButton').hidden = true;
    setGuestQrPaymentInProgress(false);
    showGuestMessage('guestBookingMessage', 'The test QR was cancelled. No reservation was confirmed.');
  } catch (error) {
    showGuestMessage('guestBookingMessage', error.message, 'error');
  } finally {
    document.getElementById('guestQrCancelButton').disabled = false;
  }
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
    roomSelect.replaceChildren(new Option('Select an available room type', ''));
    guestAvailableRooms.forEach(room => {
      roomSelect.add(new Option(
        `${room.type} · up to ${room.capacity} guests`,
        room.type
      ));
    });
    roomSelect.disabled = false;
    showGuestMessage('guestBookingMessage', 'Available room types are ready to select.');
  } catch (error) {
    showGuestMessage('guestBookingMessage', error.message, 'error');
  } finally {
    checkButton.disabled = !guestAccount;
  }
}

function clearGuestAvailability() {
  guestAvailableRooms = [];
  const roomSelect = document.getElementById('guestAvailableRooms');
  roomSelect.replaceChildren(new Option('Check availability to choose a room type', ''));
  roomSelect.disabled = true;
  document.getElementById('guestPaymentSummary').textContent =
    'Check availability and select a room to see the total.';
  document.getElementById('guestRoomPreview').hidden = true;
  document.getElementById('guestRoomImage').removeAttribute('src');
  document.getElementById('guestQrPayment').hidden = true;
  document.getElementById('guestQrCodeImage').removeAttribute('src');
  const submit = document.getElementById('guestReserveButton');
  submit.disabled = true;
  submit.textContent = 'Continue to Razorpay Test Checkout';
  document.getElementById('guestQrPayButton').disabled = true;
}

function updateGuestPaymentQuote(roomType) {
  const room = guestAvailableRooms.find(item => item.type === roomType);
  const paymentSummary = document.getElementById('guestPaymentSummary');
  const submit = document.getElementById('guestReserveButton');
  if (!room) {
    paymentSummary.textContent = 'Select an available room type to see the total.';
    document.getElementById('guestRoomPreview').hidden = true;
    submit.disabled = true;
    submit.textContent = 'Continue to Razorpay Test Checkout';
    return;
  }
  document.getElementById('guestRoomImage').src = guestRoomImage(room.type);
  document.getElementById('guestRoomImage').alt = `${room.type} guest room`;
  document.getElementById('guestRoomTypeLabel').textContent = room.type;
  document.getElementById('guestRoomDescription').textContent =
    `Up to ${room.capacity} guests · ${formatGuestMoney(room.price)} per night`;
  document.getElementById('guestRoomQuote').textContent =
    `${room.nights} night(s): ${formatGuestMoney(room.subtotal)} + tax ${formatGuestMoney(room.taxAmount)} = ${formatGuestMoney(room.totalAmount)} total`;
  document.getElementById('guestRoomPreview').hidden = false;
  paymentSummary.textContent = 'Razorpay test mode only. No real money will be charged.';
  submit.disabled = guestQrPaymentInProgress || !guestAccount;
  submit.textContent = `Continue to Razorpay · ${formatGuestMoney(room.totalAmount)}`;
  document.getElementById('guestQrPayButton').disabled = guestQrPaymentInProgress || !guestAccount;
}

function guestRoomImage(roomType) {
  const name = roomType.toLowerCase();
  if (name.includes('suite')) {
    return 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=85';
  }
  if (name.includes('deluxe') || name.includes('executive')) {
    return 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=900&q=85';
  }
  return 'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=900&q=85';
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
      <td>${escapeHtml(booking.roomType || 'Assigned room')}</td>
      <td>${escapeHtml(booking.checkIn)} – ${escapeHtml(booking.checkOut)}</td>
      <td>${escapeHtml(booking.guestsCount)}</td>
      <td>${escapeHtml(booking.status)}</td>
      <td>${booking.paymentStatus === 'Paid'
    ? 'Payment complete · Test mode · No money charged'
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
    select.add(new Option(`${booking.bookingId} · ${booking.roomType || 'Room assigned'}`, booking.bookingId));
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
      showGuestMessage('guestReviewMessage', 'Thank you for sharing your experience.', 'success');
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
    select.add(new Option(`${booking.bookingId} · ${booking.roomType || 'Room assigned'}`, booking.bookingId));
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
      showGuestMessage('guestServiceMessage', 'Your service request has been submitted.', 'success');
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
    link.textContent = 'Order with Zomato';
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
