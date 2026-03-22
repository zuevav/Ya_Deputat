// Main app — routing and initialization
const App = {
  init() {
    // Apply saved font size
    const savedFontSize = localStorage.getItem('ya-deputat-font-size');
    if (savedFontSize) document.documentElement.style.fontSize = savedFontSize;
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
      navigator.serviceWorker?.addEventListener('message', event => {
        if (event.data?.type === 'navigate') {
          window.location.hash = event.data.url.replace('/#', '');
        }
      });
    } catch(e) { console.log('SW init:', e); }
    this.route();
    window.addEventListener('hashchange', () => this.route());
  },

  route() {
    const hash = location.hash.slice(1) || '';

    if (hash.startsWith('register/')) { this.showRegisterPage(hash.replace('register/', '')); return; }
    if (hash.startsWith('reset-password/')) { this.showResetPasswordPage(hash.replace('reset-password/', '')); return; }
    if (hash.startsWith('deputy-reset/')) { this.showDeputyResetPage(hash.replace('deputy-reset/', '')); return; }

    if (!API.token || !API.user) { this.showLogin(); return; }

    if (API.user.role === 'admin') {
      const sd = localStorage.getItem('selectedDistrict');
      if (!sd) {
        // deputy_admin with single district — auto-select
        if (API.user.adminRole === 'deputy_admin') {
          this.autoSelectAdminDistrict();
          return;
        }
        this.showDistrictPicker();
      } else AdminApp.init();
    } else if (API.user.role === 'deputy') {
      // Staff with permissions on desktop → admin-like interface
      if (API.user.userType === 'staff' && window.innerWidth > 768) {
        this.checkStaffPermissions(hash);
      } else if (window.innerWidth > 768) {
        // Deputy on desktop — desktop layout
        DeputyApp.initDesktop(hash);
      } else {
        DeputyApp.init(hash);
      }
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
            <button class="login-tab" onclick="App.switchLoginTab('admin')">Администратор</button>
            <button class="login-tab active" onclick="App.switchLoginTab('deputy')">Депутат / Сотрудник</button>
          </div>

          <div id="login-admin" class="hidden">
            <div class="form-group">
              <label>Логин</label>
              <input type="text" id="admin-username" class="form-control" placeholder="admin" autocomplete="username">
            </div>
            <div class="form-group">
              <label>Пароль</label>
              <input type="password" id="admin-password" class="form-control" placeholder="Пароль" autocomplete="current-password"
                onkeydown="if(event.key==='Enter')App.loginAdmin()">
            </div>
            <button class="btn btn-primary btn-block" onclick="App.loginAdmin()">Войти</button>
            <button class="btn btn-outline btn-block mt-8 passkey-btn" onclick="App.loginWithPasskey()">&#x1F511; Войти с Passkey</button>
            <div class="mt-8 text-center">
              <a href="#" class="link-sm" onclick="event.preventDefault();App.showForgotPassword()">Забыли пароль?</a>
              &nbsp;|&nbsp;
              <a href="#" class="link-sm" onclick="event.preventDefault();App.showChangelog()">v0.2.1</a>
            </div>
          </div>

          <div id="login-deputy">
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="deputy-email" class="form-control" placeholder="email@example.com" autocomplete="email">
            </div>
            <div class="form-group">
              <label>Пароль</label>
              <input type="password" id="deputy-password" class="form-control" placeholder="Пароль" autocomplete="current-password"
                onkeydown="if(event.key==='Enter')App.loginDeputy()">
            </div>
            <button class="btn btn-primary btn-block" onclick="App.loginDeputy()">Войти</button>
            <div class="login-divider"><span>или</span></div>
            <button class="btn btn-outline btn-block passkey-btn" onclick="App.loginWithPasskey()">
              &#x1F511; Войти с Passkey
            </button>
            <div class="mt-8 text-center">
              <a href="#" class="link-sm" onclick="event.preventDefault();App.showDeputyForgotPassword()">Забыли пароль?</a>
            </div>
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
    if (!username || !password) return showToast('Заполните все поля', 'error');
    try {
      const data = await API.post('/api/auth/login', { username, password });
      if (!data) return showToast('Неверный логин или пароль', 'error');
      API.setAuth(data.token, data.user);
      // Clear district selection so picker shows
      localStorage.removeItem('selectedDistrict');
      this.route();
    } catch (e) {
      showToast(e.message || 'Ошибка входа', 'error');
    }
  },

  async loginWithPasskey(silent) {
    try {
      const { options, sessionId } = await API.post('/api/auth/passkey/auth-options', {});
      if (!options) { if (!silent) showToast('Passkey не настроен', 'error'); return; }
      const response = await startPasskeyAuthentication(options);
      const data = await API.post('/api/auth/passkey/auth-verify', { sessionId, response });
      API.setAuth(data.token, data.user);
      showToast(`Добро пожаловать, ${data.user.name}!`, 'success');
      this.route();
    } catch (err) {
      if (silent) return; // Don't show errors for auto-try
      if (err.name === 'NotAllowedError') showToast('Аутентификация отменена', 'error');
      else if (err.message) showToast(err.message, 'error');
    }
  },

  // === District Picker (after admin login) ===
  async showDistrictPicker() {
    document.body.className = '';
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card" style="max-width:460px">
          <h1>Я Депутат</h1>
          <p>Выберите район</p>
          <div class="form-group">
            <input type="text" id="district-search" class="form-control" placeholder="Поиск района..."
              oninput="App.filterDistricts(this.value)" autofocus>
          </div>
          <div id="district-list" class="district-picker-list">
            <div class="text-center text-gray">Загрузка...</div>
          </div>
        </div>
      </div>
    `;

    try {
      this._allDistricts = await API.get('/api/admin/districts');
      this.renderDistrictList('');

      // Focus search and pre-select Арбат
      document.getElementById('district-search').focus();
    } catch (err) {
      document.getElementById('district-list').innerHTML = '<div class="text-center text-danger">Ошибка загрузки</div>';
    }
  },

  filterDistricts(query) {
    this.renderDistrictList(query.toLowerCase());
  },

  renderDistrictList(query) {
    const list = document.getElementById('district-list');
    if (!this._allDistricts) return;

    let districts = this._allDistricts;
    if (query) {
      districts = districts.filter(d =>
        d.name.toLowerCase().includes(query) || d.okrug.toLowerCase().includes(query)
      );
    }

    // Group by okrug
    const grouped = {};
    districts.forEach(d => {
      if (!grouped[d.okrug]) grouped[d.okrug] = [];
      grouped[d.okrug].push(d);
    });

    if (!districts.length) {
      list.innerHTML = '<div class="text-center text-gray" style="padding:20px">Ничего не найдено</div>';
      return;
    }

    // Find Арбат for default highlight
    const arbat = districts.find(d => d.name === 'Арбат');

    let html = '';
    for (const [okrug, dists] of Object.entries(grouped)) {
      html += `<div class="district-group-label">${okrug}</div>`;
      dists.forEach(d => {
        const isArbat = d.name === 'Арбат' && !query;
        html += `<div class="district-pick-item ${isArbat ? 'highlighted' : ''}" onclick="App.selectDistrict(${d.id},'${d.name.replace(/'/g,"\\'")}','${d.okrug}')">
          <span class="district-pick-name">${d.name}</span>
          <span class="district-pick-okrug">${d.okrug}</span>
        </div>`;
      });
    }

    list.innerHTML = html;

    // Scroll to Арбат if no search
    if (!query && arbat) {
      const highlighted = list.querySelector('.highlighted');
      if (highlighted) highlighted.scrollIntoView({ block: 'center' });
    }
  },

  selectDistrict(id, name, okrug) {
    localStorage.setItem('selectedDistrict', id);
    localStorage.setItem('selectedDistrictName', `${name} (${okrug})`);
    showToast(`Район: ${name}`, 'success');
    this.route();
  },

  async loginDeputy() {
    const email = document.getElementById('deputy-email').value;
    const password = document.getElementById('deputy-password').value;
    if (!email || !password) return showToast('Заполните все поля', 'error');
    try {
      const data = await API.post('/api/auth/deputy-login', { email, password });
      if (!data) return showToast('Неверный email или пароль', 'error');
      API.setAuth(data.token, data.user);
      showToast(`Добро пожаловать, ${data.user.name}!`, 'success');
      this.route();
    } catch (e) {
      showToast(e.message || 'Ошибка входа', 'error');
    }
  },

  showDeputyForgotPassword() {
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <h1>Сброс пароля</h1>
          <p>Введите email, указанный при регистрации</p>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="dep-reset-email" class="form-control" placeholder="email@example.com"
              onkeydown="if(event.key==='Enter')App.requestDeputyReset()">
          </div>
          <button class="btn btn-primary btn-block" onclick="App.requestDeputyReset()">Отправить ссылку</button>
          <div class="mt-8 text-center">
            <a href="#" class="link-sm" onclick="event.preventDefault();App.showLogin()">Назад</a>
          </div>
        </div>
      </div>`;
  },

  async requestDeputyReset() {
    const email = document.getElementById('dep-reset-email').value;
    if (!email) return showToast('Укажите email', 'error');
    try { await API.post('/api/auth/deputy-forgot-password', { email }); showToast('Ссылка отправлена', 'success'); } catch (e) {}
  },

  // === Forgot Password ===
  showForgotPassword() {
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <h1>Сброс пароля</h1>
          <p>Введите email, указанный в вашей учётной записи</p>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="reset-email" class="form-control" placeholder="admin@example.com"
              onkeydown="if(event.key==='Enter')App.requestPasswordReset()">
          </div>
          <button class="btn btn-primary btn-block" onclick="App.requestPasswordReset()">Отправить ссылку</button>
          <div class="mt-8 text-center">
            <a href="#" class="link-sm" onclick="event.preventDefault();App.showLogin()">Назад к входу</a>
          </div>
        </div>
      </div>
    `;
  },

  async requestPasswordReset() {
    const email = document.getElementById('reset-email').value;
    if (!email) return showToast('Укажите email', 'error');
    try {
      await API.post('/api/auth/forgot-password', { email });
      showToast('Если email найден, ссылка для сброса отправлена', 'success');
    } catch (e) {}
  },

  showResetPasswordPage(token) {
    document.body.className = '';
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <h1>Новый пароль</h1>
          <p>Установите новый пароль для входа</p>
          <div class="form-group">
            <label>Новый пароль</label>
            <input type="password" id="new-password" class="form-control" placeholder="Минимум 6 символов">
          </div>
          <div class="form-group">
            <label>Подтвердите пароль</label>
            <input type="password" id="new-password-confirm" class="form-control"
              onkeydown="if(event.key==='Enter')App.resetPassword('${token}')">
          </div>
          <button class="btn btn-primary btn-block" onclick="App.resetPassword('${token}')">Сохранить</button>
        </div>
      </div>
    `;
  },

  async resetPassword(token) {
    const password = document.getElementById('new-password').value;
    const confirm = document.getElementById('new-password-confirm').value;
    if (!password || password.length < 6) return showToast('Пароль минимум 6 символов', 'error');
    if (password !== confirm) return showToast('Пароли не совпадают', 'error');
    try {
      await API.post('/api/auth/reset-password', { token, password });
      showToast('Пароль обновлён!', 'success');
      location.hash = '';
      this.showLogin();
    } catch (e) {}
  },

  // === Deputy Reset Password Page ===
  showDeputyResetPage(token) {
    document.body.className = '';
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <h1>Новый пароль</h1>
          <p>Установите новый пароль</p>
          <div class="form-group">
            <label>Новый пароль</label>
            <input type="password" id="drp-pw" class="form-control" placeholder="Минимум 6 символов">
          </div>
          <div class="form-group">
            <label>Подтвердите</label>
            <input type="password" id="drp-pw2" class="form-control"
              onkeydown="if(event.key==='Enter')App.deputyResetPassword('${token}')">
          </div>
          <button class="btn btn-primary btn-block" onclick="App.deputyResetPassword('${token}')">Сохранить</button>
        </div>
      </div>`;
  },

  async deputyResetPassword(token) {
    const pw = document.getElementById('drp-pw').value;
    const pw2 = document.getElementById('drp-pw2').value;
    if (!pw || pw.length < 6) return showToast('Пароль минимум 6 символов', 'error');
    if (pw !== pw2) return showToast('Пароли не совпадают', 'error');
    try {
      await API.post('/api/auth/deputy-reset-password', { token, password: pw });
      showToast('Пароль обновлён!', 'success');
      location.hash = '';
      this.showLogin();
    } catch (e) {}
  },

  // === Passkey Registration ===
  async showRegisterPage(token) {
    document.body.className = '';
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <h1>Я Депутат</h1>
          <p>Загрузка...</p>
        </div>
      </div>
    `;

    try {
      const { options, deputyName } = await API.post('/api/auth/passkey/register-options', { token });
      document.getElementById('app').innerHTML = `
        <div class="login-page">
          <div class="login-card">
            <h1>Я Депутат</h1>
            <h3>Регистрация</h3>
            <p>Здравствуйте, <strong>${deputyName}</strong>!</p>
            <p class="text-gray text-sm mb-16">Выберите способ входа в систему:</p>

            <div class="form-group">
              <label>Задать пароль</label>
              <input type="password" id="reg-password" class="form-control" placeholder="Минимум 6 символов">
            </div>
            <div class="form-group">
              <label>Подтвердите пароль</label>
              <input type="password" id="reg-password2" class="form-control" placeholder="Повторите пароль">
            </div>
            <button class="btn btn-primary btn-block" onclick="App.registerWithPassword('${token}')">Зарегистрироваться с паролем</button>

            <div class="login-divider"><span>или</span></div>

            <button class="btn btn-outline btn-block passkey-btn" id="register-passkey-btn"
              onclick="App.registerPasskey('${token}')">
              &#x1F511; Зарегистрироваться с Passkey
            </button>
            <p class="text-gray text-sm mt-8">Passkey — вход по отпечатку пальца, Face ID или PIN без пароля</p>
          </div>
        </div>
      `;
      this._regOptions = options;
    } catch (err) {
      document.getElementById('app').innerHTML = `
        <div class="login-page">
          <div class="login-card">
            <h1>Я Депутат</h1>
            <p class="text-danger">${err.message || 'Недействительная или истёкшая ссылка'}</p>
            <div class="mt-16">
              <a href="#" class="link-sm" onclick="event.preventDefault();location.hash='';App.showLogin()">На страницу входа</a>
            </div>
          </div>
        </div>
      `;
    }
  },

  async registerWithPassword(token) {
    const pw = document.getElementById('reg-password').value;
    const pw2 = document.getElementById('reg-password2').value;
    if (!pw || pw.length < 6) return showToast('Пароль минимум 6 символов', 'error');
    if (pw !== pw2) return showToast('Пароли не совпадают', 'error');
    try {
      const data = await API.post('/api/auth/deputy-register-password', { token, password: pw });
      API.setAuth(data.token, data.user);
      showToast('Регистрация завершена!', 'success');
      location.hash = '';
      this.route();
    } catch (e) {}
  },

  async registerPasskey(token) {
    const btn = document.getElementById('register-passkey-btn');
    btn.disabled = true;
    btn.textContent = 'Регистрация...';
    try {
      const response = await startPasskeyRegistration(this._regOptions);
      const data = await API.post('/api/auth/passkey/register-verify', { token, response });
      if (data.verified) {
        API.setAuth(data.token, data.user);
        showToast('Passkey создан! Добро пожаловать!', 'success');
        location.hash = '';
        this.route();
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '\u{1F511} Создать Passkey';
      showToast(err.name === 'NotAllowedError' ? 'Отменено' : (err.message || 'Ошибка'), 'error');
    }
  },

  async checkStaffPermissions(hash) {
    try {
      const permData = await API.get('/api/deputy/my-permissions');
      if (!permData) { this.showLogin(); return; }
      const { permissions } = permData;
      if (permissions && Object.values(permissions).some(v => v)) {
        // Check staff's district
        const profile = await API.get('/api/deputy/profile');
        if (profile.district_id) {
          // Single district — auto-select, no picker
          localStorage.setItem('selectedDistrict', profile.district_id);
          localStorage.setItem('selectedDistrictName', `${profile.district_name} (${profile.okrug})`);
          AdminApp.initAsStaff(permissions);
        } else {
          // No district or multiple — show picker
          const sd = localStorage.getItem('selectedDistrict');
          if (!sd) this.showDistrictPicker();
          else AdminApp.initAsStaff(permissions);
        }
      } else {
        DeputyApp.init(hash);
      }
    } catch (e) {
      DeputyApp.init(hash);
    }
  },

  async autoSelectAdminDistrict() {
    try {
      const districts = await API.get('/api/admin/districts');
      if (districts.length === 1) {
        localStorage.setItem('selectedDistrict', districts[0].id);
        localStorage.setItem('selectedDistrictName', `${districts[0].name} (${districts[0].okrug})`);
        AdminApp.init();
      } else {
        this.showDistrictPicker();
      }
    } catch (e) { this.showDistrictPicker(); }
  },

  // === Changelog ===
  async showChangelog() {
    document.getElementById('app').innerHTML = `<div class="login-page"><div class="login-card" style="max-width:500px;text-align:left"><h2 style="text-align:center;margin-bottom:16px">История изменений</h2><div id="changelog-list">Загрузка...</div><div class="mt-16 text-center"><a href="#" class="link-sm" onclick="event.preventDefault();App.showLogin()">Назад</a></div></div></div>`;
    try {
      const log = await fetch('/api/auth/changelog').then(r => r.json());
      document.getElementById('changelog-list').innerHTML = log.map(e => `
        <div class="changelog-entry">
          <div class="changelog-version">v${e.version}</div>
          <div class="changelog-title">${e.title}</div>
          <div class="changelog-desc">${e.description}</div>
        </div>
      `).join('');
    } catch { document.getElementById('changelog-list').innerHTML = 'Ошибка загрузки'; }
  },

  logout() {
    API.clearAuth();
    localStorage.removeItem('selectedDistrict');
    localStorage.removeItem('selectedDistrictName');
    location.hash = '';
    this.showLogin();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
