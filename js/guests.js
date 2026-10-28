/**
 * VS PLAZA PMS - GUEST DIRECTORY CONTROLLER
 */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize guests from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderGuestDirectory();
  setupNewGuestForm();

  const searchInput = document.getElementById('guestSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderGuestDirectory(searchInput.value.trim().toLowerCase());
    });
  }
});

function renderGuestDirectory(query = '') {
  const tableBody = document.getElementById('guestTableBody');
  const countBadge = document.getElementById('guestCountBadge');
  if (!tableBody) return;

  const guests = HotelStore.getGuests();

  const filtered = guests.filter(g => {
    if (!query) return true;
    const fullName = `${g.firstName} ${g.lastName}`.toLowerCase();
    return (
      fullName.includes(query) ||
      g.guestId.toLowerCase().includes(query) ||
      (g.phone && g.phone.toLowerCase().includes(query)) ||
      (g.city && g.city.toLowerCase().includes(query)) ||
      (g.idNumber && g.idNumber.toLowerCase().includes(query))
    );
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} Guests`;
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-muted);">No guest profiles found matching your search.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filtered.map(g => {
    let statusBadge = 'badge-available';
    if (g.status === 'In-House') statusBadge = 'badge-occupied';
    else if (g.status === 'Reserved') statusBadge = 'badge-reserved';

    return `
      <tr>
        <td><strong>${g.guestId}</strong></td>
        <td>
          <div style="font-weight:600; color:var(--text-main);">${g.firstName} ${g.lastName}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${g.email || 'No email provided'}</div>
        </td>
        <td>${g.phone || 'N/A'}</td>
        <td>${g.city || 'N/A'}, ${g.country || 'India'}</td>
        <td>
          <div style="font-size:0.82rem; font-weight:600;">${g.idType || 'ID Proof'}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${g.idNumber || 'Verified on file'}</div>
        </td>
        <td><span class="badge ${statusBadge}">${g.status || 'Past Guest'}</span></td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="viewGuestProfile('${g.guestId}')">View Profile</button>
        </td>
      </tr>
    `;
  }).join('');
}

function viewGuestProfile(guestId) {
  const guests = HotelStore.getGuests();
  const bookings = HotelStore.getBookings();
  const guest = guests.find(g => g.guestId === guestId);
  if (!guest) return;

  const guestBookings = bookings.filter(b => b.guestName.toLowerCase() === `${guest.firstName} ${guest.lastName}`.toLowerCase() || b.guestId === guestId);

  document.getElementById('profileGuestName').textContent = `${guest.firstName} ${guest.lastName} (${guest.guestId})`;
  document.getElementById('profilePhone').textContent = guest.phone || 'N/A';
  document.getElementById('profileEmail').textContent = guest.email || 'N/A';
  
  const genderEl = document.getElementById('profileGenderDob');
  if (genderEl) {
    genderEl.textContent = `${guest.gender || 'Not specified'} • Born: ${guest.dob || 'N/A'}`;
  }
  
  const addressText = [guest.address, guest.city, guest.state, guest.country].filter(Boolean).join(', ');
  document.getElementById('profileAddress').textContent = addressText || 'N/A';
  document.getElementById('profileIdDoc').textContent = `${guest.idType || 'Govt ID'}: ${guest.idNumber || 'Recorded'}`;
  
  const statusBadge = document.getElementById('profileStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = guest.status || 'Active';
  }

  const historyEl = document.getElementById('profileStayHistory');
  if (guestBookings.length > 0) {
    historyEl.innerHTML = guestBookings.map(b => `
      <div style="padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; margin-bottom:8px; font-size:0.82rem;">
        <div style="display:flex; justify-content:space-between; font-weight:600;">
          <span>Booking ${b.bookingId} (Room ${b.roomNo})</span>
          <span>₹${Number(b.totalAmount).toLocaleString('en-IN')}</span>
        </div>
        <div style="color:#64748b; margin-top:2px;">Dates: ${b.checkIn} to ${b.checkOut} • Status: ${b.status}</div>
      </div>
    `).join('');
  } else {
    historyEl.innerHTML = `<p style="color:#94a3b8; font-size:0.82rem;">No previous stay logs recorded.</p>`;
  }

  openModal('guestProfileModal');
}

function setupNewGuestForm() {
  const form = document.getElementById('newGuestForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = document.getElementById('guestFirstName').value.trim();
    const lastName = document.getElementById('guestLastName').value.trim();
    const gender = document.getElementById('guestGender') ? document.getElementById('guestGender').value : 'Male';
    const dob = document.getElementById('guestDob') ? document.getElementById('guestDob').value : '';
    const phone = document.getElementById('guestPhone').value.trim();
    const email = document.getElementById('guestEmail').value.trim();
    const address = document.getElementById('guestAddress') ? document.getElementById('guestAddress').value.trim() : '';
    const city = document.getElementById('guestCity').value.trim();
    const state = document.getElementById('guestState') ? document.getElementById('guestState').value.trim() : '';
    const country = document.getElementById('guestCountry').value.trim();
    const idType = document.getElementById('guestIdType').value;
    const idNumber = document.getElementById('guestIdNumber').value.trim();

    const guests = HotelStore.getGuests();
    const guestId = `G00${guests.length + 1}`;

    guests.push({
      guestId,
      firstName,
      lastName,
      gender,
      dob,
      phone,
      email,
      address,
      city,
      state,
      country: country || 'India',
      idType,
      idNumber,
      status: 'Registered'
    });

    if (await HotelStore.saveGuests(guests) === false) return;
    showToast(`Guest profile created for ${firstName} ${lastName}!`, 'success');
    form.reset();
    closeModal('newGuestModal');
    renderGuestDirectory();
  });
}
