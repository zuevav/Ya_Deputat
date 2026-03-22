// API helper module
function _getCookie(name) {
  try {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}
function _safeParseUser() {
  try { const s = localStorage.getItem('user') || _getCookie('ya_user'); return s ? JSON.parse(s) : null; } catch { return null; }
}
const API = {
  token: localStorage.getItem('token') || _getCookie('ya_token'),
  user: _safeParseUser(),

  _setCookie(name, value, days) {
    const d = new Date(); d.setTime(d.getTime() + days*86400000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  },
  _getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  },
  _delCookie(name) { document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`; },

  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    this._setCookie('ya_token', token, 30);
    this._setCookie('ya_user', JSON.stringify(user), 30);
  },

  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this._delCookie('ya_token');
    this._delCookie('ya_user');
  },

  async request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    try {
      const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
      if (res.status === 401) {
        // Token expired or invalid — do NOT reload, just return null
        console.warn('401 on', url);
        return null;
      }
      // Auto-renew token
      const newToken = res.headers.get('X-New-Token');
      if (newToken) {
        this.token = newToken;
        localStorage.setItem('token', newToken);
        this._setCookie('ya_token', newToken, 30);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
      return data;
    } catch (err) {
      if (err.message !== 'Failed to fetch') showToast(err.message, 'error');
      throw err;
    }
  },

  get(url) { return this.request(url); },
  post(url, body) { return this.request(url, { method: 'POST', body: JSON.stringify(body) }); },
  put(url, body) { return this.request(url, { method: 'PUT', body: JSON.stringify(body) }); },
  del(url) { return this.request(url, { method: 'DELETE' }); },

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

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatDateInput(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 16);
}

const EVENT_TYPE_LABELS = { regular: 'Очередное заседание', extraordinary: 'Внеочередное заседание', field: 'Выездное заседание', commission: 'Комиссия' };

// XSS sanitize
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
const STATUS_LABELS = { pending: 'Новое', seen: 'Просмотрено', confirmed: 'Подтверждено', declined: 'Отклонено' };

// === WebAuthn helpers ===
function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - base64.length % 4) % 4;
  const binary = atob(base64 + '='.repeat(pad));
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startPasskeyRegistration(options) {
  const publicKeyOptions = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: { ...options.user, id: base64urlToBuffer(options.user.id) },
  };
  if (publicKeyOptions.excludeCredentials) {
    publicKeyOptions.excludeCredentials = publicKeyOptions.excludeCredentials.map(c => ({
      ...c, id: base64urlToBuffer(c.id)
    }));
  }

  const credential = await navigator.credentials.create({ publicKey: publicKeyOptions });

  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64url(credential.response.attestationObject),
      transports: credential.response.getTransports ? credential.response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

async function startPasskeyAuthentication(options) {
  const publicKeyOptions = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
  };
  if (publicKeyOptions.allowCredentials) {
    publicKeyOptions.allowCredentials = publicKeyOptions.allowCredentials.map(c => ({
      ...c, id: base64urlToBuffer(c.id)
    }));
  }

  const credential = await navigator.credentials.get({ publicKey: publicKeyOptions });

  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      authenticatorData: bufferToBase64url(credential.response.authenticatorData),
      signature: bufferToBase64url(credential.response.signature),
      userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}
