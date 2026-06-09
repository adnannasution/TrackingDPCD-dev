// Admin panel: users, departments, activity log
const Admin = {
  async loadUsers() {
    const res = await Auth.apiFetch('/api/users');
    if (!res) return;
    const users = await res.json();
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.full_name}</strong><br><small style="color:#6b7a8d">@${u.username}</small></td>
        <td><span class="role-badge role-${u.role}">${u.role}</span></td>
        <td>${u.dept_name || '—'}</td>
        <td><span class="status-pill ${u.is_active ? 'active' : 'inactive'}">${u.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
        <td>
          <button class="btn-icon" onclick="Admin.editUser(${u.id})" title="Edit">✏️</button>
          ${u.id !== Auth.getUser()?.id ? `<button class="btn-icon btn-danger" onclick="Admin.toggleUser(${u.id}, ${u.is_active})" title="${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}">${u.is_active ? '🔒' : '🔓'}</button>` : ''}
        </td>
      </tr>
    `).join('');
  },

  async loadDepartments() {
    const res = await Auth.apiFetch('/api/departments');
    if (!res) return;
    const depts = await res.json();
    const container = document.getElementById('deptsContainer');
    if (!container) return;

    container.innerHTML = depts.map(d => `
      <div class="dept-card">
        <div class="dept-info">
          <h4>🏢 ${d.name}</h4>
          <p>${d.description || 'Tidak ada deskripsi'}</p>
          <div class="dept-stats">
            <span>👥 ${d.member_count} anggota</span>
            <span>📁 ${d.project_count} proyek</span>
          </div>
        </div>
        ${Auth.isAdmin() ? `
        <div class="dept-actions">
          <button class="btn-icon" onclick="Admin.editDept(${d.id}, '${d.name}', '${d.description || ''}')">✏️</button>
          <button class="btn-icon btn-danger" onclick="Admin.deleteDept(${d.id})">🗑️</button>
        </div>` : ''}
      </div>
    `).join('');
  },

  async loadActivity() {
    const res = await Auth.apiFetch('/api/activity');
    if (!res) return;
    const logs = await res.json();
    const container = document.getElementById('activityList');
    if (!container) return;

    const actionIcon = { create_project: '📁', update_project: '✏️', delete_project: '🗑️', create_user: '👤', assign_member: '👥', login: '🔑', create_department: '🏢' };

    container.innerHTML = logs.map(l => `
      <div class="activity-item">
        <span class="activity-icon">${actionIcon[l.action] || '📝'}</span>
        <div class="activity-body">
          <strong>${l.full_name || 'System'}</strong> ${l.action.replace(/_/g, ' ')}
          ${l.entity_name ? `<em>${l.entity_name}</em>` : ''}
          <div class="activity-time">${new Date(l.created_at).toLocaleString('id-ID')}</div>
        </div>
      </div>
    `).join('') || '<p style="color:#6b7a8d;padding:16px">Belum ada aktivitas</p>';
  },

  async createUser(data) {
    const res = await Auth.apiFetch('/api/users', { method: 'POST', body: JSON.stringify(data) });
    if (!res) return;
    if (!res.ok) { const e = await res.json(); alert(e.error); return; }
    await this.loadUsers();
    closeModal('modalUser');
  },

  async editUser(id) {
    const res = await Auth.apiFetch('/api/users');
    if (!res) return;
    const users = await res.json();
    const user = users.find(u => u.id === id);
    if (!user) return;

    const dRes = await Auth.apiFetch('/api/departments');
    const depts = dRes ? await dRes.json() : [];

    showUserModal(user, depts);
  },

  async updateUser(id, data) {
    const res = await Auth.apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    if (!res) return;
    if (!res.ok) { const e = await res.json(); alert(e.error); return; }
    await this.loadUsers();
    closeModal('modalUser');
  },

  async toggleUser(id, currentlyActive) {
    if (!confirm(`${currentlyActive ? 'Nonaktifkan' : 'Aktifkan'} user ini?`)) return;
    await Auth.apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: !currentlyActive }) });
    await this.loadUsers();
  },

  async createDept(data) {
    const res = await Auth.apiFetch('/api/departments', { method: 'POST', body: JSON.stringify(data) });
    if (!res) return;
    if (!res.ok) { const e = await res.json(); alert(e.error); return; }
    await this.loadDepartments();
    closeModal('modalDept');
  },

  async editDept(id, name, description) {
    document.getElementById('deptModalTitle').textContent = 'Edit Bagian';
    document.getElementById('deptId').value = id;
    document.getElementById('deptName').value = name;
    document.getElementById('deptDesc').value = description;
    openModal('modalDept');
  },

  async deleteDept(id) {
    if (!confirm('Hapus bagian ini? Semua proyek di bagian ini akan terhapus!')) return;
    await Auth.apiFetch(`/api/departments/${id}`, { method: 'DELETE' });
    await this.loadDepartments();
  }
};
