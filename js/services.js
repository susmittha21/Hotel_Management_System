let editingServiceId = null;
let canManageServices = false;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
    const user = await apiRequest('/auth/me');
    canManageServices = user.role === 'Hotel Manager';
  } catch (error) {
    console.error('Unable to initialize services from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderServicesTable();
  renderServiceRequests();
  setupServiceForm();
  document.getElementById('addServiceButton').hidden = !canManageServices;
  document.getElementById('newServiceModal').hidden = !canManageServices;
  if (canManageServices) {
    bindActionMenu(document.getElementById('servicesTableBody'), (action, serviceId) => {
      if (action === 'edit') editService(serviceId);
      if (action === 'delete') removeService(serviceId);
    });
  }
  document.getElementById('serviceRequestsTableBody').addEventListener('change', updateServiceRequestStatus);
});

function renderServicesTable() {
  const tableBody = document.getElementById('servicesTableBody');
  if (!tableBody) return;

  const services = HotelStore.getServices();
  if (!services.length) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 32px; color: var(--text-muted);">No hotel services configured.</td></tr>';
    return;
  }

  tableBody.innerHTML = services.map(service => `
    <tr>
      <td>${escapeHtml(service.serviceId)}</td>
      <td>${escapeHtml(service.name)}</td>
      <td>${escapeHtml(service.category)}</td>
      <td>₹${Number(service.price).toLocaleString('en-IN')}</td>
      <td>${canManageServices ? renderActionMenu(service.serviceId, [
        { action: 'edit', label: 'Edit service' },
        {
          action: 'delete',
          label: 'Delete service',
          disabled: HotelStore.getInvoices().some(invoice =>
            invoice.lines?.some(line => line.referenceCode === service.serviceId)
          ) || HotelStore.getServiceRequests().some(request => request.serviceId === service.serviceId)
        }
      ]) : '—'}</td>
    </tr>
  `).join('');
}

function renderServiceRequests() {
  const tableBody = document.getElementById('serviceRequestsTableBody');
  if (!tableBody) return;
  const requests = HotelStore.getServiceRequests();
  if (!requests.length) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 32px; color: var(--text-muted);">No guest service requests.</td></tr>';
    return;
  }
  const statuses = ['Pending', 'In Progress', 'Completed', 'Declined'];
  tableBody.innerHTML = requests.map(request => `
    <tr>
      <td>${escapeHtml(request.requestId)}</td>
      <td>${escapeHtml(request.guestName)}</td>
      <td>${escapeHtml(request.serviceName)}</td>
      <td>${escapeHtml(request.bookingId || '—')}</td>
      <td>${escapeHtml(request.notes || '—')}</td>
      <td>${escapeHtml(request.requestedAt || '')}</td>
      <td>
        <select class="form-control service-request-status" data-request-id="${encodeURIComponent(request.requestId)}">
          ${statuses.map(status => `<option${status === request.status ? ' selected' : ''}>${status}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('');
}

async function updateServiceRequestStatus(event) {
  const select = event.target.closest('select[data-request-id]');
  if (!select) return;
  const requestId = decodeURIComponent(select.dataset.requestId);
  const request = HotelStore.getServiceRequests().find(item => item.requestId === requestId);
  if (!request || !['Pending', 'In Progress', 'Completed', 'Declined'].includes(select.value)) return;
  const nextStatus = select.value;
  select.disabled = true;
  if (await HotelStore.updateServiceRequest(requestId, nextStatus) === false) {
    select.value = request.status;
  } else {
    request.status = nextStatus;
    showToast(`Service request ${requestId} updated.`, 'success');
  }
  select.disabled = false;
  renderServiceRequests();
}

function setupServiceForm() {
  const form = document.getElementById('newServiceForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const services = HotelStore.getServices();
    const serviceId = editingServiceId || `SRV-${crypto.randomUUID().slice(0, 16).toUpperCase()}`;
    const service = {
      serviceId,
      name: document.getElementById('serviceName').value.trim(),
      category: document.getElementById('serviceCategory').value.trim(),
      price: Number(document.getElementById('servicePrice').value || 0)
    };

    const existingIndex = services.findIndex(item => item.serviceId === editingServiceId);
    if (existingIndex >= 0) services[existingIndex] = service;
    else services.push(service);
    if (await HotelStore.saveServices(services) === false) return;
    const wasEditing = Boolean(editingServiceId);
    editingServiceId = null;
    form.reset();
    closeModal('newServiceModal');
    document.getElementById('serviceModalTitle').textContent = 'Add Hotel Service';
    document.getElementById('serviceSubmitButton').textContent = 'Save Service';
    renderServicesTable();
    showToast(`Service ${service.name} ${wasEditing ? 'updated' : 'added'}.`, 'success');
  });
}

function editService(serviceId) {
  const service = HotelStore.getServices().find(item => item.serviceId === serviceId);
  if (!service) return;
  editingServiceId = serviceId;
  document.getElementById('serviceName').value = service.name || '';
  document.getElementById('serviceCategory').value = service.category || '';
  document.getElementById('servicePrice').value = service.price || 0;
  document.getElementById('serviceModalTitle').textContent = `Edit Service ${serviceId}`;
  document.getElementById('serviceSubmitButton').textContent = 'Save Changes';
  openModal('newServiceModal');
}

function startNewService() {
  if (!canManageServices) return;
  editingServiceId = null;
  document.getElementById('newServiceForm').reset();
  document.getElementById('serviceModalTitle').textContent = 'Add Hotel Service';
  document.getElementById('serviceSubmitButton').textContent = 'Save Service';
  openModal('newServiceModal');
}

async function removeService(serviceId) {
  if (HotelStore.getServiceRequests().some(request => request.serviceId === serviceId)) {
    showToast('This service has guest requests and cannot be deleted.', 'error');
    return;
  }
  if (HotelStore.getInvoices().some(invoice => invoice.lines?.some(line => line.referenceCode === serviceId))) {
    showToast('This service is linked to an invoice and cannot be deleted.', 'error');
    return;
  }
  if (!confirm(`Delete service ${serviceId}?`)) return;
  const services = HotelStore.getServices();
  const updated = services.filter(service => service.serviceId !== serviceId);
  if (await HotelStore.saveServices(updated) === false) return;
  renderServicesTable();
  showToast(`Service ${serviceId} deleted.`, 'info');
}
