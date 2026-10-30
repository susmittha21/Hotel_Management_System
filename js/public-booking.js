document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('publicBookingForm');
  if (!form) return;

  const checkIn = document.getElementById('publicCheckIn');
  const checkOut = document.getElementById('publicCheckOut');
  const roomType = document.getElementById('publicRoomType');
  const guests = document.getElementById('publicGuests');
  const roomSelect = document.getElementById('publicRoomNo');
  const availabilityButton = document.getElementById('checkAvailabilityButton');
  const submitButton = document.getElementById('submitPublicBooking');
  const message = document.getElementById('publicBookingMessage');
  let availableRooms = [];

  const formatLocalDate = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  checkIn.min = formatLocalDate(today);
  checkIn.value = formatLocalDate(today);
  checkOut.min = formatLocalDate(tomorrow);
  checkOut.value = formatLocalDate(tomorrow);

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `booking-message${kind ? ` ${kind}` : ''}`;
  }

  function clearRoomSelection() {
    availableRooms = [];
    roomSelect.replaceChildren(new Option('Check availability to choose a room', ''));
    roomSelect.disabled = true;
    submitButton.disabled = true;
  }

  async function refreshAvailability() {
    clearRoomSelection();
    setMessage('');
    if (!checkIn.value || !checkOut.value || checkOut.value <= checkIn.value) {
      setMessage('Choose a check-out date later than your check-in date.', 'error');
      return;
    }

    checkOut.min = checkIn.value;
    availabilityButton.disabled = true;
    try {
      const params = new URLSearchParams({
        check_in: checkIn.value,
        check_out: checkOut.value,
        guests_count: guests.value
      });
      if (roomType.value) params.set('room_type', roomType.value);
      const result = await apiRequest(`/public/availability?${params}`);
      availableRooms = result.rooms;

      const types = [...new Set(availableRooms.map(room => room.type))].sort();
      const selectedType = roomType.value;
      roomType.replaceChildren(new Option('All available types', ''));
      types.forEach(type => roomType.add(new Option(type, type)));
      if (types.includes(selectedType)) roomType.value = selectedType;

      if (!availableRooms.length) {
        setMessage('No rooms match those dates and guest count. Try different dates or room types.', 'error');
        return;
      }

      roomSelect.replaceChildren(new Option('Select an available room', ''));
      availableRooms.forEach(room => {
        const label = `${room.type} · Room ${room.roomNo} · ${room.capacity} guests · ₹${Number(room.price).toLocaleString('en-IN')}/night`;
        roomSelect.add(new Option(label, room.roomNo));
      });
      roomSelect.disabled = false;
      roomSelect.value = '';
      setMessage(`${availableRooms.length} room${availableRooms.length === 1 ? '' : 's'} available.`);
    } catch (error) {
      setMessage(`Could not check availability: ${error.message}`, 'error');
    } finally {
      availabilityButton.disabled = false;
    }
  }

  checkIn.addEventListener('change', () => {
    const nextDay = new Date(`${checkIn.value}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    checkOut.min = formatLocalDate(nextDay);
    if (checkOut.value <= checkIn.value) checkOut.value = formatLocalDate(nextDay);
    refreshAvailability();
  });
  checkOut.addEventListener('change', refreshAvailability);
  roomType.addEventListener('change', refreshAvailability);
  guests.addEventListener('change', refreshAvailability);
  availabilityButton.addEventListener('click', refreshAvailability);
  roomSelect.addEventListener('change', () => {
    submitButton.disabled = !roomSelect.value;
  });

  document.querySelectorAll('.room-book-link').forEach(link => {
    link.addEventListener('click', () => {
      const requestedType = link.dataset.roomType;
      const matchingType = [...roomType.options].find(option =>
        option.value.toLowerCase().includes(requestedType.toLowerCase())
      );
      roomType.value = matchingType ? matchingType.value : '';
      refreshAvailability();
    });
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!roomSelect.value) {
      setMessage('Check availability and select a room before requesting a reservation.', 'error');
      return;
    }

    submitButton.disabled = true;
    availabilityButton.disabled = true;
    setMessage('Submitting your reservation request…');
    const payload = {
      roomNo: roomSelect.value,
      guestName: document.getElementById('publicGuestName').value.trim(),
      phone: document.getElementById('publicGuestPhone').value.trim(),
      email: document.getElementById('publicGuestEmail').value.trim() || null,
      checkIn: checkIn.value,
      checkOut: checkOut.value,
      guestsCount: Number(guests.value),
      specialRequests: document.getElementById('publicSpecialRequests').value.trim() || null
    };

    try {
      const booking = await apiRequest('/public/bookings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      form.reset();
      checkIn.value = formatLocalDate(today);
      checkOut.value = formatLocalDate(tomorrow);
      clearRoomSelection();
      if (typeof showToast === 'function') showToast(`Reservation ${booking.bookingId} created.`, 'success');
      await refreshAvailability();
      setMessage(`Reservation ${booking.bookingId} is confirmed for Room ${booking.roomNo}. The front desk can now see it in Reservations.`, 'success');
    } catch (error) {
      setMessage(`Could not complete the reservation: ${error.message}. Check availability and try again.`, 'error');
      submitButton.disabled = !roomSelect.value;
    } finally {
      availabilityButton.disabled = false;
    }
  });

  refreshAvailability();
});
