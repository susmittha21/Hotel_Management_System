/**
 * VS PLAZA HOTEL MANAGEMENT SYSTEM - SHARED CORE LOGIC & STATE STORE
 * Client-side state manager with localStorage persistence for seamless prototype demos
 */

const STORAGE_KEYS = {
  ROOMS: 'vs_hotel_rooms',
  BOOKINGS: 'vs_hotel_bookings',
  GUESTS: 'vs_hotel_guests',
  AUTH: 'vs_hotel_auth',
};

// Default seed data matching the Course DBMS Relational Model
// Clean empty datasets ready for PostgreSQL & MongoDB database integration
const DEFAULT_ROOMS = [];
const DEFAULT_GUESTS = [];
const DEFAULT_BOOKINGS = [];

// Automatic cleanup of legacy demo records so database integration starts clean
(function purgeLegacyDemoData() {
  try {
    const g = localStorage.getItem(STORAGE_KEYS.GUESTS);
    const b = localStorage.getItem(STORAGE_KEYS.BOOKINGS);
    const r = localStorage.getItem(STORAGE_KEYS.ROOMS);
    if (g && (g.includes('Aarav') || g.includes('P8923411'))) {
      localStorage.setItem(STORAGE_KEYS.GUESTS, JSON.stringify([]));
    }
    if (b && (b.includes('B-1081') || b.includes('Aarav'))) {
      localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify([]));
    }
    if (r && (r.includes('King Bed, City View') || r.includes('Aarav Kumar'))) {
      localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify([]));
    }
  } catch (e) {}
})();

// Data Store Accessors
const HotelStore = {
  getRooms() {
    const data = localStorage.getItem(STORAGE_KEYS.ROOMS);
    if (!data) return [];
    try {
      const parsed = JSON.parse(data);
      // Auto-purge if old demo data is present
      if (parsed.length > 0 && parsed.some(r => r.currentGuest === 'Aarav Kumar' || r.roomNo === '101' && r.amenities && r.amenities.includes('High-Speed Wi-Fi, Mini Bar'))) {
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify([]));
        return [];
      }
      return parsed;
    } catch {
      return [];
    }
  },

  saveRooms(rooms) {
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
  },

  getGuests() {
    const data = localStorage.getItem(STORAGE_KEYS.GUESTS);
    if (!data) return [];
    try {
      const parsed = JSON.parse(data);
      if (parsed.length > 0 && parsed.some(g => g.guestId === 'G001' && g.firstName === 'Aarav')) {
        localStorage.setItem(STORAGE_KEYS.GUESTS, JSON.stringify([]));
        return [];
      }
      return parsed;
    } catch {
      return [];
    }
  },

  saveGuests(guests) {
    localStorage.setItem(STORAGE_KEYS.GUESTS, JSON.stringify(guests));
  },

  getBookings() {
    const data = localStorage.getItem(STORAGE_KEYS.BOOKINGS);
    if (!data) return [];
    try {
      const parsed = JSON.parse(data);
      if (parsed.length > 0 && parsed.some(b => b.bookingId === 'B-1081')) {
        localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify([]));
        return [];
      }
      return parsed;
    } catch {
      return [];
    }
  },

  saveBookings(bookings) {
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));
  },

  clearAllData() {
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.GUESTS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify([]));
  },

  getAuth() {
    const auth = localStorage.getItem(STORAGE_KEYS.AUTH);
    return auth ? JSON.parse(auth) : { loggedIn: true, user: 'Admin / Reception', role: 'Front Desk Lead' };
  },

  setAuth(authData) {
    localStorage.setItem(STORAGE_KEYS.AUTH, JSON.stringify(authData));
  },

  logout() {
    localStorage.removeItem(STORAGE_KEYS.AUTH);
    window.location.href = 'login.html';
  }
};

// UI Notifications
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <div>${message}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Modal Helpers
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('show');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('show');
}

// Global initialization for live clock and common triggers
document.addEventListener('DOMContentLoaded', () => {
  // Live Clock Update
  const clockEl = document.getElementById('liveClock');
  if (clockEl) {
    const updateTime = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' • ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  // Close modals on outside click
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('show');
      }
    });
  });

  // Logout Buttons
  document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      HotelStore.logout();
    });
  });
});
