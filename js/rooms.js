/**
 * VS PLAZA PMS - ROOM MANAGEMENT & FLOOR MATRIX CONTROLLER
 */

let currentFilterStatus = 'ALL';
let currentFilterFloor = 'ALL';
let currentSearchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize room management from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderRoomGrid();
  setupFilterListeners();
  setupAddRoomForm();
});

function setupFilterListeners() {
  // Status filter buttons
  document.querySelectorAll('.status-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilterStatus = btn.dataset.status;
      renderRoomGrid();
    });
  });

  // Floor selector
  const floorSelect = document.getElementById('floorSelect');
  if (floorSelect) {
    floorSelect.addEventListener('change', (e) => {
      currentFilterFloor = e.target.value;
      renderRoomGrid();
    });
  }

  // Room search
  const searchInput = document.getElementById('roomSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.toLowerCase().trim();
      renderRoomGrid();
    });
  }
}

function renderRoomGrid() {
  const gridContainer = document.getElementById('roomGridContainer');
  const countBadge = document.getElementById('matchingRoomsCount');
  if (!gridContainer) return;

  const rooms = HotelStore.getRooms();

  const filtered = rooms.filter(room => {
    const matchStatus = (currentFilterStatus === 'ALL') || (room.status.toUpperCase() === currentFilterStatus.toUpperCase());
    const matchFloor = (currentFilterFloor === 'ALL') || (room.floor.toString() === currentFilterFloor.toString());
    const matchSearch = !currentSearchQuery || (
      room.roomNo.toLowerCase().includes(currentSearchQuery) ||
      room.type.toLowerCase().includes(currentSearchQuery) ||
      (room.currentGuest && room.currentGuest.toLowerCase().includes(currentSearchQuery))
    );
    return matchStatus && matchFloor && matchSearch;
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} Rooms`;
  }

  if (filtered.length === 0) {
    const isTotalEmpty = rooms.length === 0;
    gridContainer.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; background: white; border: 1px solid var(--border-color); border-radius: 8px;">
        <p style="font-size: 1.05rem; font-weight: 600; color: var(--text-main);">
          ${isTotalEmpty ? 'No rooms currently in inventory.' : 'No rooms match your filter criteria.'}
        </p>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;">
          ${isTotalEmpty ? 'Ready for PostgreSQL / MongoDB database sync or register rooms using "+ Add Room".' : 'Try adjusting status filter or clear the search query.'}
        </p>
      </div>
    `;
    return;
  }

  gridContainer.innerHTML = filtered.map(room => {
    const statusClass = `status-${room.status.toLowerCase()}`;
    return `
      <div class="room-card ${statusClass}" onclick="openRoomActionModal('${room.roomNo}')">
        <div class="room-card-head">
          <span class="room-num">Room ${escapeHtml(room.roomNo)}</span>
          <span class="badge badge-${room.status.toLowerCase()}">${escapeHtml(room.status)}</span>
        </div>
        <div class="room-type">${escapeHtml(room.type)} • Floor ${escapeHtml(room.floor)}${room.viewType ? ` • ${escapeHtml(room.viewType)}` : ''}</div>
        <div class="room-card-body">
          <div style="display:flex; justify-content:space-between; margin-top:8px;">
            <span>Capacity: ${room.capacity} Guests</span>
            <span class="room-price">₹${Number(room.price).toLocaleString('en-IN')}/night</span>
          </div>
          ${room.currentGuest ? `<div class="room-guest">Guest: ${escapeHtml(room.currentGuest)}</div>` : ''}
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(room.amenities || 'Standard Amenities')}${room.smokingAllowed ? ' • Smoking' : ' • Non-Smoking'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openRoomActionModal(roomNo) {
  const rooms = HotelStore.getRooms();
  const room = rooms.find(r => r.roomNo === roomNo);
  if (!room) return;

  document.getElementById('actionModalRoomNo').textContent = `Room ${room.roomNo} (${room.type})`;
  document.getElementById('actionRoomType').value = room.type;
  document.getElementById('actionRoomFloor').value = String(room.floor);
  document.getElementById('actionRoomCapacity').value = room.capacity || 1;
  document.getElementById('actionRoomPrice').value = room.price;
  document.getElementById('actionRoomStatus').value = room.status;
  document.getElementById('actionRoomView').value = room.viewType || 'City View';
  document.getElementById('actionRoomSmoking').value = room.smokingAllowed ? 'Yes' : 'No';
  document.getElementById('actionRoomAmenities').value = room.amenities || '';
  document.getElementById('hiddenTargetRoomNo').value = room.roomNo;
  const hasBookings = HotelStore.getBookings().some(booking => booking.roomNo === room.roomNo);
  document.getElementById('deleteRoomButton').disabled = hasBookings;
  document.getElementById('deleteRoomButton').title = hasBookings ? 'Rooms with reservation history cannot be deleted.' : '';

  openModal('roomActionModal');
}

async function updateRoomDetailsFromModal() {
  const roomNo = document.getElementById('hiddenTargetRoomNo').value;
  const newStatus = document.getElementById('actionRoomStatus').value;
  const newPrice = Number(document.getElementById('actionRoomPrice').value);
  const newType = document.getElementById('actionRoomType').value;
  const newFloor = document.getElementById('actionRoomFloor').value;
  const capacity = Number(document.getElementById('actionRoomCapacity').value);

  const rooms = HotelStore.getRooms();
  const room = rooms.find(r => r.roomNo === roomNo);
  if (room) {
    if (!Number.isFinite(newPrice) || newPrice < 0 || !Number.isInteger(capacity) || capacity < 1) {
      showToast('Enter a valid room rate and guest capacity.', 'error');
      return;
    }
    room.status = newStatus;
    room.price = newPrice;
    room.type = newType;
    room.floor = newFloor;
    room.capacity = capacity;
    room.viewType = document.getElementById('actionRoomView').value;
    room.smokingAllowed = document.getElementById('actionRoomSmoking').value === 'Yes';
    room.amenities = document.getElementById('actionRoomAmenities').value.trim();
    if (newStatus !== 'Occupied') {
      delete room.currentGuest;
    }
    if (await HotelStore.saveRooms(rooms) === false) return;
    showToast(`Room ${roomNo} updated to "${newStatus}"!`, 'success');
    closeModal('roomActionModal');
    renderRoomGrid();
  }
}

async function deleteRoomFromModal() {
  const roomNo = document.getElementById('hiddenTargetRoomNo').value;
  if (HotelStore.getBookings().some(booking => booking.roomNo === roomNo)) {
    showToast('Rooms with reservation history cannot be deleted.', 'error');
    return;
  }
  if (!confirm(`Delete Room ${roomNo} from the inventory?`)) return;
  const rooms = HotelStore.getRooms().filter(room => room.roomNo !== roomNo);
  if (await HotelStore.saveRooms(rooms) === false) return;
  closeModal('roomActionModal');
  renderRoomGrid();
  showToast(`Room ${roomNo} deleted.`, 'info');
}

function setupAddRoomForm() {
  const form = document.getElementById('newRoomForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomNo = document.getElementById('addRoomNo').value.trim();
    const type = document.getElementById('addRoomType').value;
    const floor = document.getElementById('addRoomFloor').value;
    const capacity = Number(document.getElementById('addRoomCapacity').value);
    const price = Number(document.getElementById('addRoomPrice').value);
    const status = document.getElementById('addRoomStatus').value;
    const viewType = document.getElementById('addRoomView') ? document.getElementById('addRoomView').value : 'City View';
    const smokingAllowed = document.getElementById('addRoomSmoking') ? document.getElementById('addRoomSmoking').value === 'Yes' : false;
    const amenities = document.getElementById('addRoomAmenities').value.trim();

    const rooms = HotelStore.getRooms();
    if (rooms.some(r => r.roomNo === roomNo)) {
      showToast(`Error: Room #${roomNo} already exists!`, 'error');
      return;
    }

    rooms.push({
      roomNo,
      type,
      floor,
      capacity,
      price,
      status,
      viewType,
      smokingAllowed,
      amenities: amenities || 'Standard Hotel Amenities'
    });

    if (await HotelStore.saveRooms(rooms) === false) return;
    showToast(`Room ${roomNo} added to inventory successfully!`, 'success');
    form.reset();
    closeModal('addRoomModal');
    renderRoomGrid();
  });
}
