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
      <td><button class="btn btn-sm btn-secondary" onclick="removeService('${service.serviceId}')">Delete</button></td>
    </tr>
  `).join('');
}

function setupServiceForm() {
  const form = document.getElementById('newServiceForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const service = {
      serviceId: `SRV-${Date.now().toString().slice(-5)}`,
      name: document.getElementById('serviceName').value.trim(),
      category: document.getElementById('serviceCategory').value.trim(),
      price: Number(document.getElementById('servicePrice').value || 0)
    };

    const services = HotelStore.getServices();
    services.push(service);
    if (await HotelStore.saveServices(services) === false) return;
    form.reset();
    closeModal('newServiceModal');
    renderServicesTable();
    showToast(`Service ${service.name} added.`, 'success');
  });
}

async function removeService(serviceId) {
  const services = HotelStore.getServices();
  const updated = services.filter(service => service.serviceId !== serviceId);
  if (await HotelStore.saveServices(updated) === false) return;
  renderServicesTable();
}
