let editingServiceId = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize services from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderServicesTable();
  setupServiceForm();
  bindActionMenu(document.getElementById('servicesTableBody'), (action, serviceId) => {
    if (action === 'edit') editService(serviceId);
    if (action === 'delete') removeService(serviceId);
  });
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
      <td>${service.serviceId}</td>
      <td>${service.name}</td>
      <td>${service.category}</td>
      <td>₹${Number(service.price).toLocaleString('en-IN')}</td>
      <td>${renderActionMenu(service.serviceId, [
        { action: 'edit', label: 'Edit service' },
        {
          action: 'delete',
          label: 'Delete service',
          disabled: HotelStore.getInvoices().some(invoice =>
            invoice.lines?.some(line => line.referenceCode === service.serviceId)
          )
        }
      ])}</td>
    </tr>
  `).join('');
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
  editingServiceId = null;
  document.getElementById('newServiceForm').reset();
  document.getElementById('serviceModalTitle').textContent = 'Add Hotel Service';
  document.getElementById('serviceSubmitButton').textContent = 'Save Service';
  openModal('newServiceModal');
}

async function removeService(serviceId) {
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
