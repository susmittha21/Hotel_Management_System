document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize food orders from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  await initializeFoodMenu();
  renderFoodOrdersTable();
  setupFoodOrderForm();
});

async function initializeFoodMenu() {
  const menuSelect = document.getElementById('foodItem');
  if (!menuSelect) return;

  const defaultMenu = [
    { name: 'Veg Biryani', price: 420 },
    { name: 'Grilled Sandwich', price: 260 },
    { name: 'Soup Bowl', price: 180 },
    { name: 'Fruit Platter', price: 320 },
    { name: 'Pasta Alfredo', price: 390 }
  ];

  const existing = HotelStore.getFoodMenu();
  const menu = existing.length ? existing : defaultMenu;
  if (await HotelStore.saveFoodMenu(menu) === false) return;

  menuSelect.innerHTML = menu.map(item => `<option value="${item.name}">${item.name} - ₹${item.price}</option>`).join('');
}

function renderFoodOrdersTable() {
  const tableBody = document.getElementById('foodOrdersTableBody');
  if (!tableBody) return;

  const orders = HotelStore.getFoodOrders();
  if (!orders.length) {
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 32px; color: var(--text-muted);">No food orders recorded.</td></tr>';
    return;
  }

  tableBody.innerHTML = orders.map(order => `
    <tr>
      <td>${order.orderId}</td>
      <td>${order.guestName}</td>
      <td>${order.item}</td>
      <td>${order.quantity}</td>
      <td>₹${Number(order.total).toLocaleString('en-IN')}</td>
      <td><span class="status-badge ${order.status.toLowerCase().replace(/\s+/g, '-')}">${order.status}</span></td>
    </tr>
  `).join('');
}

function setupFoodOrderForm() {
  const form = document.getElementById('newFoodOrderForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const guestName = document.getElementById('foodGuestName').value.trim();
    const item = document.getElementById('foodItem').value;
    const quantity = Number(document.getElementById('foodQty').value || 1);
    const status = document.getElementById('foodStatus').value;
    const menu = HotelStore.getFoodMenu();
    const selected = menu.find(m => m.name === item) || { price: 0 };
    const total = selected.price * quantity;

    const order = {
      orderId: `FO-${Date.now().toString().slice(-5)}`,
      guestName,
      item,
      quantity,
      total,
      status
    };

    const orders = HotelStore.getFoodOrders();
    orders.push(order);
    if (await HotelStore.saveFoodOrders(orders) === false) return;
    form.reset();
    closeModal('newOrderModal');
    renderFoodOrdersTable();
    showToast(`Food order ${order.orderId} created.`, 'success');
  });
}
