// API helper module
const API = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),

  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },

  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  async request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    try {
      const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });

      if (res.status === 401) {
        this.clearAuth();
        location.reload();
        return null;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
      return data;
    } catch (err) {
      if (err.message !== 'Failed to fetch') {
        showToast(err.message, 'error');
      }
      throw err;
    }
  },

  get(url) { return this.request(url); },

  post(url, body) {
    return this.request(url, { method: 'POST', body: JSON.stringify(body) });
  },

  put(url, body) {
    return this.request(url, { method: 'PUT', body: JSON.stringify(body) });
  },

  del(url) {
    return this.request(url, { method: 'DELETE' });
  },

  async upload(url, formData) {
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(url, { method: 'POST', headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
    return data;
  }
};

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  if (type === 'error') toast.style.background = '#c62828';
  if (type === 'success') toast.style.background = '#2e7d32';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Date formatting helpers
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDateInput(dateStr) {
  const d = new Date(dateStr);
  return d.toISOString().slice(0, 16);
}

const EVENT_TYPE_LABELS = {
  commission: 'Комиссия',
  session: 'Заседание',
  external: 'Выездное'
};

const STATUS_LABELS = {
  pending: 'Новое',
  seen: 'Просмотрено',
  confirmed: 'Подтверждено',
  declined: 'Отклонено'
};
