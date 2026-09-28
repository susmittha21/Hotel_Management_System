/**
 * VS PLAZA PMS - ROOM MANAGEMENT & FLOOR MATRIX CONTROLLER
 */

let currentFilterStatus = 'ALL';
let currentFilterFloor = 'ALL';
let currentSearchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
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
          <span class="room-num">Room ${room.roomNo}</span>
          <span class="badge badge-${room.status.toLowerCase()}">${room.status}</span>
        </div>
        <div class="room-type">${room.type} • Floor ${room.floor}${room.viewType ? ` • ${room.viewType}` : ''}</div>
        <div class="room-card-body">
          <div style="display:flex; justify-content:space-between; margin-top:8px;">
            <span>Capacity: ${room.capacity} Guests</span>
            <span class="room-price">₹${Number(room.price).toLocaleString('en-IN')}/night</span>
          </div>
          ${room.currentGuest ? `<div class="room-guest">Guest: ${room.currentGuest}</div>` : ''}
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${room.amenities || 'Standard Amenities'}${room.smokingAllowed ? ' • Smoking' : ' • Non-Smoking'}
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
  document.getElementById('actionRoomFloor').value = room.floor;
  document.getElementById('actionRoomPrice').value = room.price;
  document.getElementById('actionRoomStatus').value = room.status;
  document.getElementById('hiddenTargetRoomNo').value = room.roomNo;

  openModal('roomActionModal');
}

function updateRoomDetailsFromModal() {
  const roomNo = document.getElementById('hiddenTargetRoomNo').value;
  const newStatus = document.getElementById('actionRoomStatus').value;
  const newPrice = Number(document.getElementById('actionRoomPrice').value);
  const newType = document.getElementById('actionRoomType').value;

  const rooms = HotelStore.getRooms();
  const room = rooms.find(r => r.roomNo === roomNo);
  if (room) {
    room.status = newStatus;
    room.price = newPrice;
    room.type = newType;
    if (newStatus !== 'Occupied') {
      delete room.currentGuest;
    }
    HotelStore.saveRooms(rooms);
    showToast(`Room ${roomNo} updated to "${newStatus}"!`, 'success');
    closeModal('roomActionModal');
    renderRoomGrid();
  }
}

function setupAddRoomForm() {
  const form = document.getElementById('newRoomForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
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

    HotelStore.saveRooms(rooms);
    showToast(`Room ${roomNo} added to inventory successfully!`, 'success');
    form.reset();
    closeModal('addRoomModal');
    renderRoomGrid();
  });
}
