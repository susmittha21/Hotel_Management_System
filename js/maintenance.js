let editingIssueId = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize maintenance from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderMaintenanceTable();
  setupIssueForm();
  bindActionMenu(document.getElementById('maintenanceTableBody'), (action, issueId) => {
    if (action === 'edit') editMaintenanceIssue(issueId);
    if (action === 'delete') deleteMaintenanceIssue(issueId);
    if (action === 'resolve') markIssueResolved(issueId);
  });
});

function renderMaintenanceTable() {
  const tableBody = document.getElementById('maintenanceTableBody');
  if (!tableBody) return;

  const issues = HotelStore.getMaintenance();
  if (!issues.length) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 32px; color: var(--text-muted);">No maintenance issues logged.</td></tr>';
    return;
  }

  tableBody.innerHTML = issues.map(issue => `
    <tr>
      <td>${issue.issueId}</td>
      <td>${issue.roomNo}</td>
      <td>${issue.issueType}</td>
      <td><span class="priority-pill ${issue.priority.toLowerCase()}">${issue.priority}</span></td>
      <td>${issue.assignedTo}</td>
      <td><span class="status-badge ${issue.status.toLowerCase().replace(/\s+/g, '-')}">${issue.status}</span></td>
      <td>${renderActionMenu(issue.issueId, [
        { action: 'edit', label: 'Edit issue' },
        ...(issue.status === 'Resolved' ? [] : [{ action: 'resolve', label: 'Mark resolved' }]),
        { action: 'delete', label: 'Delete issue' }
      ])}</td>
    </tr>
  `).join('');
}

function setupIssueForm() {
  const form = document.getElementById('newIssueForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const issues = HotelStore.getMaintenance();
    const issueId = editingIssueId || `MI-${crypto.randomUUID().slice(0, 16).toUpperCase()}`;
    const issue = {
      issueId,
      roomNo: document.getElementById('issueRoomNo').value.trim(),
      issueType: document.getElementById('issueType').value.trim(),
      priority: document.getElementById('issuePriority').value,
      assignedTo: document.getElementById('issueStaff').value.trim(),
      status: document.getElementById('issueStatus').value
    };

    const existingIndex = issues.findIndex(item => item.issueId === editingIssueId);
    if (existingIndex >= 0) issues[existingIndex] = issue;
    else issues.push(issue);
    if (await HotelStore.saveMaintenance(issues) === false) return;
    const wasEditing = Boolean(editingIssueId);
    editingIssueId = null;
    form.reset();
    closeModal('newIssueModal');
    document.getElementById('issueModalTitle').textContent = 'Report Room Issue';
    document.getElementById('issueSubmitButton').textContent = 'Save Issue';
    renderMaintenanceTable();
    showToast(`Issue ${issue.issueId} ${wasEditing ? 'updated' : 'filed'}.`, 'success');
  });
}

function editMaintenanceIssue(issueId) {
  const issue = HotelStore.getMaintenance().find(item => item.issueId === issueId);
  if (!issue) return;
  editingIssueId = issueId;
  document.getElementById('issueRoomNo').value = issue.roomNo || '';
  document.getElementById('issueType').value = issue.issueType || '';
  document.getElementById('issuePriority').value = issue.priority || 'Medium';
  document.getElementById('issueStaff').value = issue.assignedTo || '';
  document.getElementById('issueStatus').value = issue.status || 'Open';
  document.getElementById('issueModalTitle').textContent = `Edit Issue ${issueId}`;
  document.getElementById('issueSubmitButton').textContent = 'Save Changes';
  openModal('newIssueModal');
}

function startNewMaintenanceIssue() {
  editingIssueId = null;
  document.getElementById('newIssueForm').reset();
  document.getElementById('issueStatus').value = 'Open';
  document.getElementById('issueModalTitle').textContent = 'Report Room Issue';
  document.getElementById('issueSubmitButton').textContent = 'Save Issue';
  openModal('newIssueModal');
}

async function deleteMaintenanceIssue(issueId) {
  if (!confirm(`Delete maintenance issue ${issueId}?`)) return;
  const updated = HotelStore.getMaintenance().filter(issue => issue.issueId !== issueId);
  if (await HotelStore.saveMaintenance(updated) === false) return;
  renderMaintenanceTable();
  showToast(`Issue ${issueId} deleted.`, 'info');
}

async function markIssueResolved(issueId) {
  const issues = HotelStore.getMaintenance();
  const updated = issues.map(issue => issue.issueId === issueId ? { ...issue, status: 'Resolved' } : issue);
  if (await HotelStore.saveMaintenance(updated) === false) return;
  renderMaintenanceTable();
}
