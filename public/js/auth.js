// Auth utilities - included in index.html
const Auth = {
  getToken() { return localStorage.getItem('dpcd_token'); },
  getUser() {
    try { return JSON.parse(localStorage.getItem('dpcd_user')); }
    catch { return null; }
  },
  logout() {
    localStorage.removeItem('dpcd_token');
    localStorage.removeItem('dpcd_user');
    window.location.href = '/login.html';
  },
  isAdmin() { return this.getUser()?.role === 'admin'; },
  isManager() { return this.getUser()?.role === 'manager'; },
  canManage() { return ['admin', 'manager'].includes(this.getUser()?.role); },

  async apiFetch(url, opts = {}) {
    const token = this.getToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      this.logout();
      return;
    }
    return res;
  },

  init() {
    if (!this.getToken()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }
};
