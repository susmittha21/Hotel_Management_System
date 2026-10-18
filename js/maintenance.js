document.addEventListener('DOMContentLoaded', () => {
  renderMaintenanceTable();
  setupIssueForm();
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
      <td><button class="btn btn-sm btn-secondary" onclick="markIssueResolved('${issue.issueId}')">Resolve</button></td>
    </tr>
  `).join('');
}

function setupIssueForm() {
  const form = document.getElementById('newIssueForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const issue = {
      issueId: `MI-${Date.now().toString().slice(-5)}`,
      roomNo: document.getElementById('issueRoomNo').value.trim(),
      issueType: document.getElementById('issueType').value.trim(),
      priority: document.getElementById('issuePriority').value,
      assignedTo: document.getElementById('issueStaff').value.trim(),
      status: 'Open'
    };

    const issues = HotelStore.getMaintenance();
    issues.push(issue);
    HotelStore.saveMaintenance(issues);
    form.reset();
    closeModal('newIssueModal');
    renderMaintenanceTable();
    showToast(`Issue ${issue.issueId} filed.`, 'success');
  });
}

function markIssueResolved(issueId) {
  const issues = HotelStore.getMaintenance();
  const updated = issues.map(issue => issue.issueId === issueId ? { ...issue, status: 'Resolved' } : issue);
  HotelStore.saveMaintenance(updated);
  renderMaintenanceTable();
}
