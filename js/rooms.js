/**
 * VS PLAZA PMS - SHARED ROOM INVENTORY
 */

let currentFilterStatus = 'ALL';
let currentFilterFloor = 'ALL';
let currentSearchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize the shared room inventory.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }

  renderRoomGrid();
  setupFilterListeners();
  window.setInterval(refreshRoomGrid, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshRoomGrid();
  });
});

async function refreshRoomGrid() {
  try {
    await HotelStore.refreshRooms();
    renderRoomGrid();
  } catch (error) {
    console.error('Unable to refresh the shared room inventory.', error);
    showToast(`Could not refresh room availability: ${error.message}`, 'error');
  }
}

function setupFilterListeners() {
  document.querySelectorAll('.status-filter-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.status-filter-btn').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      currentFilterStatus = button.dataset.status;
      renderRoomGrid();
    });
  });

  const floorSelect = document.getElementById('floorSelect');
  if (floorSelect) {
    floorSelect.addEventListener('change', event => {
      currentFilterFloor = event.target.value;
      renderRoomGrid();
    });
  }

  const searchInput = document.getElementById('roomSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', event => {
      currentSearchQuery = event.target.value.toLowerCase().trim();
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
    const matchStatus = currentFilterStatus === 'ALL' ||
      room.status.toUpperCase() === currentFilterStatus.toUpperCase();
    const matchFloor = currentFilterFloor === 'ALL' ||
      String(room.floor) === currentFilterFloor;
    const searchText = `${room.roomNo} ${room.type} ${room.currentGuest || ''}`.toLowerCase();
    return matchStatus && matchFloor && (!currentSearchQuery || searchText.includes(currentSearchQuery));
  });

  if (countBadge) countBadge.textContent = `${filtered.length} Rooms`;

  if (filtered.length === 0) {
    const isTotalEmpty = rooms.length === 0;
    gridContainer.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; background: white; border: 1px solid var(--border-color); border-radius: 8px;">
        <p style="font-size: 1.05rem; font-weight: 600; color: var(--text-main);">
          ${isTotalEmpty ? 'No rooms are configured in the database.' : 'No rooms match your filter criteria.'}
        </p>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;">
          ${isTotalEmpty ? 'Check that the shared room inventory has been initialized.' : 'Try adjusting the filters or search query.'}
        </p>
      </div>
    `;
    return;
  }

  gridContainer.innerHTML = filtered.map(room => {
    const knownStatus = ['Available', 'Occupied', 'Reserved'].includes(room.status);
    const displayedStatus = knownStatus ? room.status : 'Unavailable';
    const statusClass = `status-${displayedStatus.toLowerCase()}`;
    const reserveAction = room.status === 'Available'
      ? `<a class="btn btn-sm btn-primary" href="bookings.html?roomNo=${encodeURIComponent(room.roomNo)}">Reserve</a>`
      : '';
    return `
      <article class="room-card ${statusClass}">
        <div class="room-card-head">
          <span class="room-num">Room ${escapeHtml(room.roomNo)}</span>
          <span class="badge ${knownStatus ? `badge-${room.status.toLowerCase()}` : 'badge-unavailable'}">${escapeHtml(displayedStatus)}</span>
        </div>
        <div class="room-type">${escapeHtml(room.type)} • Floor ${escapeHtml(room.floor)}${room.viewType ? ` • ${escapeHtml(room.viewType)}` : ''}</div>
        <div class="room-card-body">
          <div style="display:flex; justify-content:space-between; margin-top:8px;">
            <span>Capacity: ${Number(room.capacity)} Guests</span>
            <span class="room-price">₹${Number(room.price).toLocaleString('en-IN')}/night</span>
          </div>
          ${room.currentGuest ? `<div class="room-guest">Guest: ${escapeHtml(room.currentGuest)}</div>` : ''}
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(room.amenities || 'Standard Amenities')}${room.smokingAllowed ? ' • Smoking' : ' • Non-Smoking'}
          </div>
          ${reserveAction ? `<div style="margin-top:12px;">${reserveAction}</div>` : ''}
        </div>
      </article>
    `;
  }).join('');
}
