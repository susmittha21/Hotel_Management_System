document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize staff from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  populateDepartmentOptions();
  renderStaffTable();
  setupStaffForm();

  const searchInput = document.getElementById('staffSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderStaffTable(searchInput.value.trim().toLowerCase()));
  }
});

function populateDepartmentOptions() {
  const select = document.getElementById('staffDepartment');
  if (!select) return;
  const departments = HotelStore.getDepartments();
  select.innerHTML = departments.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
}

function renderStaffTable(query = '') {
  const tableBody = document.getElementById('staffTableBody');
  const countBadge = document.getElementById('staffCountBadge');
  if (!tableBody) return;

  const staff = HotelStore.getStaff();
  const filtered = staff.filter(s => {
    if (!query) return true;
    return (
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(query) ||
      (s.department && s.department.toLowerCase().includes(query)) ||
      (s.role && s.role.toLowerCase().includes(query))
    );
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} Staff`;
  }

  if (!filtered.length) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 32px; color: var(--text-muted);">No staff records found.</td></tr>';
    return;
  }

  tableBody.innerHTML = filtered.map(s => `
    <tr>
      <td><strong>${s.staffId}</strong></td>
      <td>${s.firstName} ${s.lastName}</td>
      <td>${s.department}</td>
      <td>${s.role}</td>
      <td>${s.phone}</td>
      <td>₹${Number(s.salary || 0).toLocaleString('en-IN')}</td>
      <td><button class="btn btn-sm btn-secondary" onclick="removeStaff('${s.staffId}')">Remove</button></td>
    </tr>
  `).join('');
}

function setupStaffForm() {
  const form = document.getElementById('newStaffForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstName = document.getElementById('staffFirstName').value.trim();
    const lastName = document.getElementById('staffLastName').value.trim();
    const department = document.getElementById('staffDepartment').value;
    const role = document.getElementById('staffRole').value.trim();
    const phone = document.getElementById('staffPhone').value.trim();
    const salary = Number(document.getElementById('staffSalary').value || 0);
    const email = document.getElementById('staffEmail').value.trim();

    const staff = HotelStore.getStaff();
    const staffId = `ST-${String(staff.length + 1).padStart(3, '0')}`;

    staff.push({
      staffId,
      firstName,
      lastName,
      department,
      role,
      phone,
      email,
      salary
    });

    if (await HotelStore.saveStaff(staff) === false) return;
    form.reset();
    closeModal('newStaffModal');
    renderStaffTable();
    showToast(`Staff member ${firstName} ${lastName} added.`, 'success');
  });
}

async function removeStaff(staffId) {
  const staff = HotelStore.getStaff();
  const updated = staff.filter(s => s.staffId !== staffId);
  if (await HotelStore.saveStaff(updated) === false) return;
  renderStaffTable();
  showToast(`Staff ${staffId} removed.`, 'info');
}
