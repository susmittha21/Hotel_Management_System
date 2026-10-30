/**
 * VS PLAZA HOTEL MANAGEMENT SYSTEM - SHARED CORE LOGIC & STATE STORE
 * Client-side state manager with localStorage persistence for seamless prototype demos
 */

const STORAGE_KEYS = {
  ROOMS: 'vs_hotel_rooms',
  BOOKINGS: 'vs_hotel_bookings',
  GUESTS: 'vs_hotel_guests',
  AUTH: 'vs_hotel_auth',
  STAFF: 'vs_hotel_staff',
  DEPARTMENTS: 'vs_hotel_departments',
  HOUSEKEEPING: 'vs_hotel_housekeeping',
  MAINTENANCE: 'vs_hotel_maintenance',
  INVOICES: 'vs_hotel_invoices',
  FOOD_MENU: 'vs_hotel_food_menu',
  FOOD_ORDERS: 'vs_hotel_food_orders',
  SERVICES: 'vs_hotel_services',
  REVIEWS: 'vs_hotel_reviews',
};

// Default seed data matching the Course DBMS Relational Model
// Clean empty datasets ready for PostgreSQL & MongoDB database integration
const DEFAULT_ROOMS = [];
const DEFAULT_GUESTS = [];
const DEFAULT_BOOKINGS = [];
const DEFAULT_STAFF = [];
const DEFAULT_DEPARTMENTS = [
  { departmentId: 'DEP-01', name: 'Front Office', description: 'Front desk, reservations, guest services' },
  { departmentId: 'DEP-02', name: 'Housekeeping', description: 'Room cleaning and room readiness' },
  { departmentId: 'DEP-03', name: 'Maintenance', description: 'Repair and room upkeep' },
  { departmentId: 'DEP-04', name: 'Accounts', description: 'Billing and settlement' },
  { departmentId: 'DEP-05', name: 'Food & Beverage', description: 'Dining and in-room orders' }
];
const DEFAULT_HOUSEKEEPING = [];
const DEFAULT_MAINTENANCE = [];
const DEFAULT_INVOICES = [];
const DEFAULT_FOOD_MENU = [
  { itemId: 'FD-01', name: 'Paneer Butter Masala', category: 'Main Course', price: 320 },
  { itemId: 'FD-02', name: 'Veg Biryani', category: 'Main Course', price: 280 },
  { itemId: 'FD-03', name: 'Butter Naan', category: 'Bread', price: 45 },
  { itemId: 'FD-04', name: 'Fresh Lime Soda', category: 'Beverage', price: 70 }
];
const DEFAULT_FOOD_ORDERS = [];
const DEFAULT_SERVICES = [
  { serviceId: 'SV-01', name: 'Airport Pickup', price: 850, category: 'Transfer' },
  { serviceId: 'SV-02', name: 'Laundry Service', price: 320, category: 'Housekeeping' },
  { serviceId: 'SV-03', name: 'Spa Session', price: 1500, category: 'Wellness' }
];
const DEFAULT_REVIEWS = [];

const ROLE_MODULES = {
  'Hotel Manager': ['dashboard', 'rooms', 'bookings', 'guests', 'staff', 'housekeeping', 'maintenance', 'invoices', 'food', 'services', 'reviews'],
  'Front Desk': ['dashboard', 'rooms', 'bookings', 'guests'],
  'Accounts Cashier': ['invoices']
};

const ROLE_HOME_MODULE = {
  'Hotel Manager': 'dashboard',
  'Front Desk': 'dashboard',
  'Accounts Cashier': 'invoices'
};

const API_BASE_URL = (window.HOTEL_API_BASE_URL || 'http://localhost:8000/api').replace(/\/+$/, '');
const DATA_COLLECTIONS = {
  [STORAGE_KEYS.ROOMS]: 'rooms',
  [STORAGE_KEYS.GUESTS]: 'guests',
  [STORAGE_KEYS.BOOKINGS]: 'bookings',
  [STORAGE_KEYS.DEPARTMENTS]: 'departments',
  [STORAGE_KEYS.STAFF]: 'staff',
  [STORAGE_KEYS.HOUSEKEEPING]: 'housekeeping',
  [STORAGE_KEYS.MAINTENANCE]: 'maintenance',
  [STORAGE_KEYS.INVOICES]: 'invoices',
  [STORAGE_KEYS.FOOD_MENU]: 'food_menu',
  [STORAGE_KEYS.FOOD_ORDERS]: 'food_orders',
  [STORAGE_KEYS.SERVICES]: 'services',
  [STORAGE_KEYS.REVIEWS]: 'reviews'
};
const pendingCollectionWrites = new Map();
let mongoSyncNoticeShown = false;

function notifyMongoSyncStatus(mongoSynced, message = 'Changes were saved in PostgreSQL.') {
  if (mongoSynced !== false || mongoSyncNoticeShown) return;
  mongoSyncNoticeShown = true;
  showToast(`${message} MongoDB is offline; it will sync when available.`, 'info');
}

function saveCollectionToDatabase(storageKey, collection, records) {
  const previousWrite = pendingCollectionWrites.get(collection) || Promise.resolve();
  const write = previousWrite.catch(() => {}).then(async () => {
    const response = await fetch(`${API_BASE_URL}/data/${collection}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(records)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.detail || `Database save failed (${response.status}).`);
    }
    const result = await response.json();
    localStorage.setItem(storageKey, JSON.stringify(records));
    notifyMongoSyncStatus(result.mongoSynced, 'Saved in PostgreSQL.');
    return result;
  });
  pendingCollectionWrites.set(collection, write);
  return write.catch(error => {
    console.error(`Unable to save ${collection} to PostgreSQL.`, error);
    showToast(`Database save failed for ${collection}: ${error.message}`, 'error');
    return false;
  }).finally(() => {
    if (pendingCollectionWrites.get(collection) === write) {
      pendingCollectionWrites.delete(collection);
    }
  });
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.detail || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

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
  _databaseReady: null,

  initialize() {
    if (!this._databaseReady) {
      this._databaseReady = apiRequest('/data')
        .then(async data => {
          const legacyRecords = {};
          Object.entries(DATA_COLLECTIONS).forEach(([storageKey, collection]) => {
            if (!Object.hasOwn(data, collection)) return;
            let existingRecords = [];
            try {
              const cached = JSON.parse(localStorage.getItem(storageKey) || '[]');
              if (Array.isArray(cached)) existingRecords = cached;
            } catch (error) {
              console.warn(`Ignoring invalid local cache for ${collection}.`, error);
            }
            const databaseRecords = data[collection] || [];
            const records = collection === 'invoices'
              ? databaseRecords
              : databaseRecords.length ? databaseRecords : existingRecords;
            localStorage.setItem(storageKey, JSON.stringify(records));
            if (collection !== 'invoices' && !databaseRecords.length && existingRecords.length) {
              legacyRecords[collection] = { storageKey, records };
            }
          });
          const migrations = Object.entries(legacyRecords).map(([collection, dataSet]) =>
            saveCollectionToDatabase(dataSet.storageKey, collection, dataSet.records)
          );
          if (Object.hasOwn(data, 'departments') && data.departments.length === 0) {
            if (!legacyRecords.departments) migrations.push(this.saveDepartments(DEFAULT_DEPARTMENTS));
          }
          if (Object.hasOwn(data, 'food_menu') && data.food_menu.length === 0) {
            if (!legacyRecords.food_menu) migrations.push(this.saveFoodMenu(DEFAULT_FOOD_MENU));
          }
          if (Object.hasOwn(data, 'services') && data.services.length === 0) {
            if (!legacyRecords.services) migrations.push(this.saveServices(DEFAULT_SERVICES));
          }
          const saves = await Promise.all(migrations);
          if (saves.includes(false)) {
            throw new Error('Unable to initialize default database records.');
          }
        })
        .catch(error => {
          this._databaseReady = null;
          throw error;
        });
    }
    return this._databaseReady;
  },

  getRooms() {
    const data = localStorage.getItem(STORAGE_KEYS.ROOMS);
    if (!data) return [];
    try {
      const parsed = JSON.parse(data);
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
    return saveCollectionToDatabase(STORAGE_KEYS.ROOMS, 'rooms', rooms);
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
    return saveCollectionToDatabase(STORAGE_KEYS.GUESTS, 'guests', guests);
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
    return saveCollectionToDatabase(STORAGE_KEYS.BOOKINGS, 'bookings', bookings);
  },

  getDepartments() {
    const data = localStorage.getItem(STORAGE_KEYS.DEPARTMENTS);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(DEFAULT_DEPARTMENTS));
      return DEFAULT_DEPARTMENTS;
    }
    try { return JSON.parse(data); } catch { return DEFAULT_DEPARTMENTS; }
  },

  saveDepartments(departments) {
    return saveCollectionToDatabase(STORAGE_KEYS.DEPARTMENTS, 'departments', departments);
  },

  getStaff() {
    const data = localStorage.getItem(STORAGE_KEYS.STAFF);
    if (!data) return DEFAULT_STAFF;
    try { return JSON.parse(data); } catch { return DEFAULT_STAFF; }
  },

  saveStaff(staff) {
    return saveCollectionToDatabase(STORAGE_KEYS.STAFF, 'staff', staff);
  },

  getHousekeeping() {
    const data = localStorage.getItem(STORAGE_KEYS.HOUSEKEEPING);
    if (!data) return DEFAULT_HOUSEKEEPING;
    try { return JSON.parse(data); } catch { return DEFAULT_HOUSEKEEPING; }
  },

  saveHousekeeping(list) {
    return saveCollectionToDatabase(STORAGE_KEYS.HOUSEKEEPING, 'housekeeping', list);
  },

  getMaintenance() {
    const data = localStorage.getItem(STORAGE_KEYS.MAINTENANCE);
    if (!data) return DEFAULT_MAINTENANCE;
    try { return JSON.parse(data); } catch { return DEFAULT_MAINTENANCE; }
  },

  saveMaintenance(list) {
    return saveCollectionToDatabase(STORAGE_KEYS.MAINTENANCE, 'maintenance', list);
  },

  getInvoices() {
    const data = localStorage.getItem(STORAGE_KEYS.INVOICES);
    if (!data) return DEFAULT_INVOICES;
    try { return JSON.parse(data); } catch { return DEFAULT_INVOICES; }
  },

  saveInvoices(invoices) {
    return saveCollectionToDatabase(STORAGE_KEYS.INVOICES, 'invoices', invoices);
  },

  async createInvoice(payload) {
    const invoice = await apiRequest('/invoices', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const invoices = this.getInvoices();
    invoices.unshift(invoice);
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
    return invoice;
  },

  async payInvoice(invoiceId, paymentMethod) {
    const result = await apiRequest(`/invoices/${encodeURIComponent(invoiceId)}/payment`, {
      method: 'PUT',
      body: JSON.stringify({ paymentMethod })
    });
    const invoices = this.getInvoices().map(invoice => invoice.invoiceId === invoiceId
      ? { ...invoice, status: result.status, paymentMethod: result.paymentMethod }
      : invoice);
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
    return result;
  },

  getDashboardAnalytics() {
    return apiRequest('/analytics');
  },

  getInvoiceOptions() {
    return apiRequest('/invoice-options');
  },

  getFoodMenu() {
    const data = localStorage.getItem(STORAGE_KEYS.FOOD_MENU);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.FOOD_MENU, JSON.stringify(DEFAULT_FOOD_MENU));
      return DEFAULT_FOOD_MENU;
    }
    try { return JSON.parse(data); } catch { return DEFAULT_FOOD_MENU; }
  },

  saveFoodMenu(menu) {
    return saveCollectionToDatabase(STORAGE_KEYS.FOOD_MENU, 'food_menu', menu);
  },

  getFoodOrders() {
    const data = localStorage.getItem(STORAGE_KEYS.FOOD_ORDERS);
    if (!data) return DEFAULT_FOOD_ORDERS;
    try { return JSON.parse(data); } catch { return DEFAULT_FOOD_ORDERS; }
  },

  saveFoodOrders(orders) {
    return saveCollectionToDatabase(STORAGE_KEYS.FOOD_ORDERS, 'food_orders', orders);
  },

  getServices() {
    const data = localStorage.getItem(STORAGE_KEYS.SERVICES);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.SERVICES, JSON.stringify(DEFAULT_SERVICES));
      return DEFAULT_SERVICES;
    }
    try { return JSON.parse(data); } catch { return DEFAULT_SERVICES; }
  },

  saveServices(services) {
    return saveCollectionToDatabase(STORAGE_KEYS.SERVICES, 'services', services);
  },

  getReviews() {
    const data = localStorage.getItem(STORAGE_KEYS.REVIEWS);
    if (!data) return DEFAULT_REVIEWS;
    try { return JSON.parse(data); } catch { return DEFAULT_REVIEWS; }
  },

  saveReviews(reviews) {
    return saveCollectionToDatabase(STORAGE_KEYS.REVIEWS, 'reviews', reviews);
  },

  clearAllData() {
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.GUESTS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.STAFF, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(DEFAULT_DEPARTMENTS));
    localStorage.setItem(STORAGE_KEYS.HOUSEKEEPING, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.MAINTENANCE, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.FOOD_MENU, JSON.stringify(DEFAULT_FOOD_MENU));
    localStorage.setItem(STORAGE_KEYS.FOOD_ORDERS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.SERVICES, JSON.stringify(DEFAULT_SERVICES));
    localStorage.setItem(STORAGE_KEYS.REVIEWS, JSON.stringify([]));
  },

  getAuth() {
    const auth = localStorage.getItem(STORAGE_KEYS.AUTH);
    if (!auth) return null;
    try { return JSON.parse(auth); } catch { return null; }
  },

  setAuth(authData) {
    localStorage.setItem(STORAGE_KEYS.AUTH, JSON.stringify(authData));
  },

  async logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn('Unable to close the backend session.', error);
    }
    localStorage.removeItem(STORAGE_KEYS.AUTH);
    const target = window.location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html';
    window.location.href = target;
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

function renderActionMenu(recordId, actions) {
  const options = actions.map(({ action, label, disabled = false }) => `
    <option value="${action}"${disabled ? ' disabled' : ''}>${label}</option>
  `).join('');
  return `<select class="action-menu-select" aria-label="Record actions" data-record-id="${encodeURIComponent(recordId)}"><option value="">Actions</option>${options}</select>`;
}

function escapeHtml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function bindActionMenu(tableBody, handler) {
  tableBody.addEventListener('change', event => {
    const select = event.target.closest('select[data-record-id]');
    if (!select || !select.value) return;
    const action = select.value;
    const recordId = decodeURIComponent(select.dataset.recordId);
    select.selectedIndex = 0;
    handler(action, recordId);
  });
}

// Global initialization for live clock and common triggers
document.addEventListener('DOMContentLoaded', async () => {
  const pageName = window.location.pathname.split('/').pop().replace(/\.html$/, '');
  if (pageName && pageName !== 'login' && pageName !== 'index') {
    let auth;
    try {
      const session = await apiRequest('/auth/me');
      auth = { loggedIn: true, user: session.username, role: session.role };
      HotelStore.setAuth(auth);
    } catch (error) {
      console.warn('A backend login is required to open this page.', error);
      localStorage.removeItem(STORAGE_KEYS.AUTH);
      const target = window.location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html';
      window.location.replace(target);
      return;
    }
    const allowedModules = ROLE_MODULES[auth.role];

    if (!allowedModules) {
      HotelStore.logout();
      return;
    }

    if (!allowedModules.includes(pageName)) {
      window.location.replace(`${ROLE_HOME_MODULE[auth.role]}.html`);
      return;
    }

    document.querySelectorAll('a[href$=".html"]').forEach(link => {
      const moduleName = link.getAttribute('href').split('/').pop().replace(/\.html$/, '');
      if (!allowedModules.includes(moduleName)) {
        link.remove();
      }
    });

    document.querySelectorAll('.user-name').forEach(element => {
      element.textContent = auth.user;
    });
    document.querySelectorAll('.user-role').forEach(element => {
      element.textContent = auth.role;
    });
  }

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
