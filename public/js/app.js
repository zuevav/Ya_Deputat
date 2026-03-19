// Main app — routing and initialization
const App = {
  currentView: null,

  init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('SW registered');
      }).catch(err => console.log('SW registration failed:', err));
    }

    // Listen for navigation from SW
    navigator.serviceWorker?.addEventListener('message', event => {
      if (event.data?.type === 'navigate') {
        window.location.hash = event.data.url.replace('/#', '');
      }
    });

    this.route();
    window.addEventListener('hashchange', () => this.route());
  },

  route() {
    const hash = location.hash.slice(1) || '';

    if (!API.token || !API.user) {
      this.showLogin();
      return;
    }

    if (API.user.role === 'admin') {
      AdminApp.init();
    } else if (API.user.role === 'deputy') {
      DeputyApp.init(hash);
    }
  },

  showLogin() {
    document.body.className = '';
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <h1>Я Депутат</h1>
          <p>Войдите в систему</p>

          <div class="login-tabs">
            <button class="login-tab active" onclick="App.switchLoginTab('admin')">Администратор</button>
            <button class="login-tab" onclick="App.switchLoginTab('deputy')">Депутат</button>
          </div>

          <div id="login-admin">
            <div class="form-group">
              <label>Логин</label>
              <input type="text" id="admin-username" class="form-control" placeholder="admin" value="admin">
            </div>
            <div class="form-group">
              <label>Пароль</label>
              <input type="password" id="admin-password" class="form-control" placeholder="Пароль">
            </div>
            <button class="btn btn-primary btn-block" onclick="App.loginAdmin()">Войти</button>
          </div>

          <div id="login-deputy" class="hidden">
            <div class="form-group">
              <label>Телефон</label>
              <input type="tel" id="deputy-phone" class="form-control" placeholder="+7 (999) 123-45-67">
            </div>
            <div id="deputy-code-group" class="form-group hidden">
              <label>Код из SMS</label>
              <input type="text" id="deputy-code" class="form-control" placeholder="1234" maxlength="4">
            </div>
            <button class="btn btn-primary btn-block" id="deputy-login-btn" onclick="App.loginDeputy()">Получить код</button>
          </div>
        </div>
      </div>
    `;
  },

  switchLoginTab(tab) {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('login-admin').classList.toggle('hidden', tab !== 'admin');
    document.getElementById('login-deputy').classList.toggle('hidden', tab !== 'deputy');
  },

  async loginAdmin() {
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    try {
      const data = await API.post('/api/auth/login', { username, password });
      API.setAuth(data.token, data.user);
      this.route();
    } catch (e) { /* toast shown by API */ }
  },

  async loginDeputy() {
    const phone = document.getElementById('deputy-phone').value;
    const codeGroup = document.getElementById('deputy-code-group');
    const codeInput = document.getElementById('deputy-code');
    const btn = document.getElementById('deputy-login-btn');

    if (codeGroup.classList.contains('hidden')) {
      // Step 1: request code
      try {
        const data = await API.post('/api/auth/deputy-login', { phone });
        codeGroup.classList.remove('hidden');
        btn.textContent = 'Войти';
        showToast(data.hint || 'Код отправлен');
      } catch (e) { /* toast shown by API */ }
    } else {
      // Step 2: verify code
      try {
        const data = await API.post('/api/auth/deputy-login', { phone, code: codeInput.value });
        API.setAuth(data.token, data.user);
        this.route();
      } catch (e) { /* toast shown by API */ }
    }
  },

  logout() {
    API.clearAuth();
    this.showLogin();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
