// Offline queue — stores failed requests and retries when online
const OfflineQueue = {
  QUEUE_KEY: 'ya-deputat-offline-queue',

  getQueue() {
    try { return JSON.parse(localStorage.getItem(this.QUEUE_KEY) || '[]'); }
    catch { return []; }
  },

  saveQueue(q) {
    localStorage.setItem(this.QUEUE_KEY, JSON.stringify(q));
  },

  add(url, options, body) {
    const q = this.getQueue();
    q.push({ url, method: options.method || 'POST', body, timestamp: Date.now() });
    this.saveQueue(q);
    this.showBadge();
  },

  async flush() {
    const q = this.getQueue();
    if (!q.length) return;

    const token = localStorage.getItem('token');
    const failed = [];
    let sent = 0;

    for (const item of q) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(item.url, {
          method: item.method,
          headers,
          body: item.body ? JSON.stringify(item.body) : undefined
        });
        if (res.ok) sent++;
        else failed.push(item);
      } catch {
        failed.push(item);
      }
    }

    this.saveQueue(failed);
    if (sent > 0) showToast(`Отправлено ${sent} отложенных действий`, 'success');
    this.showBadge();
  },

  showBadge() {
    const q = this.getQueue();
    let badge = document.getElementById('offline-badge');
    if (q.length > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'offline-badge';
        badge.className = 'offline-badge';
        document.body.appendChild(badge);
      }
      badge.textContent = `${q.length} в очереди`;
      badge.classList.remove('hidden');
    } else if (badge) {
      badge.classList.add('hidden');
    }
  },

  init() {
    // Listen for online event
    window.addEventListener('online', () => {
      showToast('Соединение восстановлено', 'success');
      setTimeout(() => this.flush(), 1000);
    });

    window.addEventListener('offline', () => {
      showToast('Нет соединения. Данные сохраняются локально.', 'error');
    });

    // Try to flush on startup
    if (navigator.onLine) this.flush();
    this.showBadge();
  }
};

// Patch API to use offline queue on failure
const _originalRequest = API.request.bind(API);
API.request = async function(url, options = {}) {
  try {
    const result = await _originalRequest(url, options);
    return result;
  } catch (err) {
    // If offline and it's a write operation — queue it
    if (!navigator.onLine && options.method && options.method !== 'GET') {
      const body = options.body ? JSON.parse(options.body) : null;
      OfflineQueue.add(url, options, body);
      showToast('Сохранено в очередь (нет сети)', 'info');
      return { success: true, offline: true };
    }
    throw err;
  }
};

document.addEventListener('DOMContentLoaded', () => OfflineQueue.init());
