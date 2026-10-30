let editingTaskId = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize housekeeping from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  renderHousekeepingTable();
  setupHousekeepingForm();
  bindActionMenu(document.getElementById('housekeepingTableBody'), (action, taskId) => {
    if (action === 'edit') editHousekeepingTask(taskId);
    if (action === 'delete') deleteHousekeepingTask(taskId);
  });
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
      <td>${renderActionMenu(task.taskId, [
        { action: 'edit', label: 'Edit task' },
        { action: 'delete', label: 'Delete task' }
      ])}</td>
    </tr>
  `).join('');
}

function setupHousekeepingForm() {
  const form = document.getElementById('newHousekeepingForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tasks = HotelStore.getHousekeeping();
    const taskId = editingTaskId || `HK-${crypto.randomUUID().slice(0, 16).toUpperCase()}`;
    const task = {
      taskId,
      roomNo: document.getElementById('taskRoomNo').value.trim(),
      assignedStaff: document.getElementById('taskStaff').value.trim(),
      taskType: document.getElementById('taskType').value,
      scheduledDate: document.getElementById('taskDate').value,
      status: document.getElementById('taskStatus').value
    };

    const existingIndex = tasks.findIndex(item => item.taskId === editingTaskId);
    if (existingIndex >= 0) tasks[existingIndex] = task;
    else tasks.push(task);
    if (await HotelStore.saveHousekeeping(tasks) === false) return;
    const wasEditing = Boolean(editingTaskId);
    editingTaskId = null;
    form.reset();
    closeModal('newTaskModal');
    document.getElementById('taskModalTitle').textContent = 'Create Housekeeping Task';
    document.getElementById('taskSubmitButton').textContent = 'Add Task';
    renderHousekeepingTable();
    showToast(`Housekeeping task ${task.taskId} ${wasEditing ? 'updated' : 'created'}.`, 'success');
  });
}

function editHousekeepingTask(taskId) {
  const tasks = HotelStore.getHousekeeping();
  const task = tasks.find(item => item.taskId === taskId);
  if (!task) return;
  editingTaskId = taskId;
  document.getElementById('taskRoomNo').value = task.roomNo || '';
  document.getElementById('taskStaff').value = task.assignedStaff || '';
  document.getElementById('taskType').value = task.taskType || 'Daily Cleaning';
  document.getElementById('taskDate').value = task.scheduledDate || '';
  document.getElementById('taskStatus').value = task.status || 'Pending';
  document.getElementById('taskModalTitle').textContent = `Edit Task ${taskId}`;
  document.getElementById('taskSubmitButton').textContent = 'Save Changes';
  openModal('newTaskModal');
}

function startNewHousekeepingTask() {
  editingTaskId = null;
  document.getElementById('newHousekeepingForm').reset();
  document.getElementById('taskStatus').value = 'Pending';
  document.getElementById('taskModalTitle').textContent = 'Create Housekeeping Task';
  document.getElementById('taskSubmitButton').textContent = 'Add Task';
  openModal('newTaskModal');
}

async function deleteHousekeepingTask(taskId) {
  if (!confirm(`Delete housekeeping task ${taskId}?`)) return;
  const updated = HotelStore.getHousekeeping().filter(task => task.taskId !== taskId);
  if (await HotelStore.saveHousekeeping(updated) === false) return;
  renderHousekeepingTable();
  showToast(`Housekeeping task ${taskId} deleted.`, 'info');
}
