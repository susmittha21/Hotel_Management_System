document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize invoices from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderInvoicesTable();
  setupInvoiceForm();
});

function renderInvoicesTable() {
  const tableBody = document.getElementById('invoicesTableBody');
  if (!tableBody) return;

  const invoices = HotelStore.getInvoices();
  if (!invoices.length) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 32px; color: var(--text-muted);">No invoices created yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = invoices.map(invoice => `
    <tr>
      <td>${invoice.invoiceId}</td>
      <td>${invoice.guestName}</td>
      <td>${invoice.bookingId}</td>
      <td>${invoice.roomNo}</td>
      <td>₹${Number(invoice.total).toLocaleString('en-IN')}</td>
      <td><span class="status-badge ${invoice.status.toLowerCase().replace(/\s+/g, '-')}">${invoice.status}</span></td>
      <td><button class="btn btn-sm btn-secondary" onclick="markInvoicePaid('${invoice.invoiceId}')">Mark Paid</button></td>
    </tr>
  `).join('');
}

function setupInvoiceForm() {
  const form = document.getElementById('newInvoiceForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const invoice = {
      invoiceId: `INV-${Date.now().toString().slice(-5)}`,
      guestName: document.getElementById('invoiceGuest').value.trim(),
      bookingId: document.getElementById('invoiceBooking').value.trim(),
      roomNo: document.getElementById('invoiceRoom').value.trim(),
      total: Number(document.getElementById('invoiceTotal').value || 0),
      status: 'Pending'
    };

    const invoices = HotelStore.getInvoices();
    invoices.push(invoice);
    if (await HotelStore.saveInvoices(invoices) === false) return;
    form.reset();
    closeModal('newInvoiceModal');
    renderInvoicesTable();
    showToast(`Invoice ${invoice.invoiceId} generated.`, 'success');
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

  const invoices = HotelStore.getInvoices();
  const updated = invoices.map(invoice => invoice.invoiceId === invoiceId
    ? { ...invoice, status: 'Paid', paymentMethod: paymentMethod.trim() }
    : invoice);
  if (await HotelStore.saveInvoices(updated) === false) return;
  renderInvoicesTable();
}
