document.addEventListener('DOMContentLoaded', () => {
  renderHousekeepingTable();
  setupHousekeepingForm();
});

function renderHousekeepingTable() {
  const tableBody = document.getElementById('housekeepingTableBody');
  if (!tableBody) return;

  const tasks = HotelStore.getHousekeeping();
  if (!tasks.length) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 32px; color: var(--text-muted);">No housekeeping tasks assigned.</td></tr>';
    return;
  }

  tableBody.innerHTML = tasks.map(task => `
    <tr>
      <td>${task.taskId}</td>
      <td>${task.roomNo}</td>
      <td>${task.assignedStaff}</td>
      <td>${task.taskType}</td>
      <td>${task.scheduledDate}</td>
      <td><span class="status-badge ${task.status.toLowerCase().replace(/\s+/g, '-')}">${task.status}</span></td>
      <td><button class="btn btn-sm btn-secondary" onclick="updateHousekeepingStatus('${task.taskId}')">Mark Done</button></td>
    </tr>
  `).join('');
}

function setupHousekeepingForm() {
  const form = document.getElementById('newHousekeepingForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const task = {
      taskId: `HK-${Date.now().toString().slice(-5)}`,
      roomNo: document.getElementById('taskRoomNo').value.trim(),
      assignedStaff: document.getElementById('taskStaff').value.trim(),
      taskType: document.getElementById('taskType').value,
      scheduledDate: document.getElementById('taskDate').value,
      status: 'Pending'
    };

    const tasks = HotelStore.getHousekeeping();
    tasks.push(task);
    HotelStore.saveHousekeeping(tasks);
    form.reset();
    closeModal('newTaskModal');
    renderHousekeepingTable();
    showToast(`Housekeeping task ${task.taskId} created.`, 'success');
  });
}

function updateHousekeepingStatus(taskId) {
  const tasks = HotelStore.getHousekeeping();
  const updated = tasks.map(task => {
    if (task.taskId === taskId) {
      return { ...task, status: task.status === 'Completed' ? 'Pending' : 'Completed' };
    }
    return task;
  });
  HotelStore.saveHousekeeping(updated);
  renderHousekeepingTable();
}
