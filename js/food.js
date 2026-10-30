let editingFoodOrderId = null;

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
  bindActionMenu(document.getElementById('foodOrdersTableBody'), (action, orderId) => {
    if (action === 'edit') editFoodOrder(orderId);
    if (action === 'delete') deleteFoodOrder(orderId);
  });
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
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 32px; color: var(--text-muted);">No food orders recorded.</td></tr>';
    return;
  }

  const invoices = HotelStore.getInvoices();
  tableBody.innerHTML = orders.map(order => `
    <tr>
      <td>${order.orderId}</td>
      <td>${escapeHtml(order.guestName)}</td>
      <td>${order.item}</td>
      <td>${order.quantity}</td>
      <td>₹${Number(order.total).toLocaleString('en-IN')}</td>
      <td><span class="status-badge ${order.status.toLowerCase().replace(/\s+/g, '-')}">${order.status}</span></td>
      <td>${renderActionMenu(order.orderId, [
        { action: 'edit', label: 'Edit order' },
        {
          action: 'delete',
          label: 'Delete order',
          disabled: invoices.some(invoice => invoice.lines?.some(line => line.referenceCode === order.orderId))
        }
      ])}</td>
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

    const orders = HotelStore.getFoodOrders();
    const orderId = editingFoodOrderId || `FO-${crypto.randomUUID().slice(0, 16).toUpperCase()}`;
    const order = {
      orderId,
      guestName,
      item,
      quantity,
      total,
      status
    };

    const existingIndex = orders.findIndex(item => item.orderId === editingFoodOrderId);
    if (existingIndex >= 0) orders[existingIndex] = order;
    else orders.push(order);
    if (await HotelStore.saveFoodOrders(orders) === false) return;
    const wasEditing = Boolean(editingFoodOrderId);
    editingFoodOrderId = null;
    form.reset();
    closeModal('newOrderModal');
    document.getElementById('foodOrderModalTitle').textContent = 'Place Food Order';
    document.getElementById('foodOrderSubmitButton').textContent = 'Save Order';
    renderFoodOrdersTable();
    showToast(`Food order ${order.orderId} ${wasEditing ? 'updated' : 'created'}.`, 'success');
  });
}

function editFoodOrder(orderId) {
  const order = HotelStore.getFoodOrders().find(item => item.orderId === orderId);
  if (!order) return;
  editingFoodOrderId = orderId;
  document.getElementById('foodGuestName').value = order.guestName || '';
  document.getElementById('foodItem').value = order.item || '';
  document.getElementById('foodQty').value = order.quantity || 1;
  document.getElementById('foodStatus').value = order.status || 'Pending';
  document.getElementById('foodOrderModalTitle').textContent = `Edit Order ${orderId}`;
  document.getElementById('foodOrderSubmitButton').textContent = 'Save Changes';
  openModal('newOrderModal');
}

function startNewFoodOrder() {
  editingFoodOrderId = null;
  document.getElementById('newFoodOrderForm').reset();
  document.getElementById('foodOrderModalTitle').textContent = 'Place Food Order';
  document.getElementById('foodOrderSubmitButton').textContent = 'Save Order';
  openModal('newOrderModal');
}

async function deleteFoodOrder(orderId) {
  if (HotelStore.getInvoices().some(invoice => invoice.lines?.some(line => line.referenceCode === orderId))) {
    showToast('This food order is linked to an invoice and cannot be deleted.', 'error');
    return;
  }
  if (!confirm(`Delete food order ${orderId}?`)) return;
  const orders = HotelStore.getFoodOrders().filter(order => order.orderId !== orderId);
  if (await HotelStore.saveFoodOrders(orders) === false) return;
  renderFoodOrdersTable();
  showToast(`Food order ${orderId} deleted.`, 'info');
}
