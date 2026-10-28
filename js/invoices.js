let invoiceOptions = { bookings: [], foodOrders: [], services: [], gstRate: 5 };

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
    invoiceOptions = await HotelStore.getInvoiceOptions();
  } catch (error) {
    console.error('Unable to initialize invoices from PostgreSQL.', error);
    showToast(`Could not load invoice data: ${error.message}`, 'error');
    return;
  }
  renderInvoicesTable();
  setupInvoiceForm();
  renderBookingOptions();
  renderServiceOptions();
  renderFoodOrderOptions();
  document.getElementById('invoiceBooking').addEventListener('change', renderFoodOrderOptions);
  document.getElementById('invoiceTaxHint').textContent =
    `GST ${invoiceOptions.gstRate}% is added to the room, selected food orders, and selected services. ` +
    `CGST and SGST are calculated equally (${invoiceOptions.gstRate / 2}% each).`;
});

function renderInvoicesTable() {
  const tableBody = document.getElementById('invoicesTableBody');
  if (!tableBody) return;

  const invoices = HotelStore.getInvoices();
  if (!invoices.length) {
    tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 32px; color: var(--text-muted);">No invoices created yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = invoices.map(invoice => `
    <tr>
      <td>${invoice.invoiceId}</td>
      <td>${invoice.guestName || ''}</td>
      <td>${invoice.bookingId || ''}</td>
      <td>${invoice.roomNo || ''}</td>
      <td>₹${Number(invoice.subtotal ?? (Number(invoice.roomCharges || 0) + Number(invoice.serviceCharges || 0))).toLocaleString('en-IN')}</td>
      <td>₹${Number(invoice.cgst || 0).toLocaleString('en-IN')}</td>
      <td>₹${Number(invoice.sgst || 0).toLocaleString('en-IN')}</td>
      <td><strong>₹${Number(invoice.total).toLocaleString('en-IN')}</strong></td>
      <td><span class="status-badge ${String(invoice.status).toLowerCase().replace(/\s+/g, '-')}">${invoice.status}</span></td>
      <td>${invoice.status === 'Paid' ? invoice.paymentMethod || 'Paid' : `<button class="btn btn-sm btn-secondary" onclick="markInvoicePaid('${invoice.invoiceId}')">Mark Paid</button>`}</td>
    </tr>
    ${invoice.lines && invoice.lines.length ? `
      <tr><td colspan="10" style="padding:6px 16px;color:var(--text-muted);font-size:0.8rem;">
        ${invoice.lines.map(line => `${line.description} × ${line.quantity}: ₹${Number(line.total).toLocaleString('en-IN')}`).join(' · ')}
      </td></tr>` : ''}
  `).join('');
}

function renderBookingOptions() {
  const select = document.getElementById('invoiceBooking');
  select.innerHTML = '<option value="">Select a booking</option>' + invoiceOptions.bookings.map(booking =>
    `<option value="${booking.bookingId}">${booking.bookingId} — ${booking.guestName}, room ${booking.roomNo} (${booking.checkIn} to ${booking.checkOut})</option>`
  ).join('');
}

function renderFoodOrderOptions() {
  const container = document.getElementById('invoiceFoodOrders');
  const booking = invoiceOptions.bookings.find(item => item.bookingId === document.getElementById('invoiceBooking').value);
  const orders = booking ? invoiceOptions.foodOrders.filter(order => order.guestId === booking.guestId) : [];
  container.innerHTML = orders.length ? orders.map(order => `
    <label style="display:block;padding:4px 0;">
      <input type="checkbox" name="invoiceFoodOrder" value="${order.orderId}">
      ${order.orderId}: ${order.item} × ${order.quantity} — ₹${Number(order.total).toLocaleString('en-IN')}
    </label>
  `).join('') : '<span style="color:var(--text-muted);">No unbilled food orders for this booking guest.</span>';
}

function renderServiceOptions() {
  const container = document.getElementById('invoiceServices');
  container.innerHTML = invoiceOptions.services.length ? invoiceOptions.services.map(service => `
    <label style="display:block;padding:4px 0;">
      <input type="checkbox" name="invoiceService" value="${service.serviceId}">
      ${service.name} (${service.category}) — ₹${Number(service.price).toLocaleString('en-IN')}
    </label>
  `).join('') : '<span style="color:var(--text-muted);">No services configured.</span>';
}

function setupInvoiceForm() {
  const form = document.getElementById('newInvoiceForm');
  if (!form) return;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const bookingId = document.getElementById('invoiceBooking').value;
    if (!bookingId) {
      showToast('Select a booking before creating an invoice.', 'error');
      return;
    }

    const payload = {
      bookingId,
      foodOrderIds: [...document.querySelectorAll('input[name="invoiceFoodOrder"]:checked')].map(input => input.value),
      serviceIds: [...document.querySelectorAll('input[name="invoiceService"]:checked')].map(input => input.value)
    };

    try {
      const invoice = await HotelStore.createInvoice(payload);
      form.reset();
      closeModal('newInvoiceModal');
      renderInvoicesTable();
      invoiceOptions = await HotelStore.getInvoiceOptions();
      renderBookingOptions();
      renderServiceOptions();
      renderFoodOrderOptions();
      showToast(`Invoice ${invoice.invoiceId} created: ₹${Number(invoice.total).toLocaleString('en-IN')}.`, 'success');
      notifyMongoSyncStatus(invoice.mongoSynced, 'Invoice saved in PostgreSQL.');
    } catch (error) {
      showToast(`Could not create invoice: ${error.message}`, 'error');
    }
  });
}

async function markInvoicePaid(invoiceId) {
  const paymentMethod = prompt('Enter payment method: Cash, Credit Card, Debit Card, UPI, or Net Banking');
  if (paymentMethod === null) return;
  const acceptedMethods = ['Cash', 'Credit Card', 'Debit Card', 'UPI', 'Net Banking'];
  if (!acceptedMethods.includes(paymentMethod.trim())) {
    showToast('Choose Cash, Credit Card, Debit Card, UPI, or Net Banking.', 'error');
    return;
  }

  try {
    const result = await HotelStore.payInvoice(invoiceId, paymentMethod.trim());
    renderInvoicesTable();
    notifyMongoSyncStatus(result.mongoSynced, 'Payment recorded in PostgreSQL.');
  } catch (error) {
    showToast(`Could not record payment: ${error.message}`, 'error');
  }
}
