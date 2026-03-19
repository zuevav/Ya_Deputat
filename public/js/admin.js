// Admin panel
const AdminApp = {
  section: 'dashboard',

  init() {
    document.body.className = '';
    this.render();
    this.navigate(this.section);
  },

  render() {
    document.getElementById('app').innerHTML = `
      <div class="header">
        <h1>Я Депутат — Админ</h1>
        <div class="header-right">
          <span class="text-sm">${API.user.name}</span>
          <button class="btn-icon" onclick="App.logout()" title="Выйти">&#x2716;</button>
        </div>
      </div>
      <div class="mobile-nav">
        <button onclick="AdminApp.navigate('dashboard')" data-section="dashboard">Главная</button>
        <button onclick="AdminApp.navigate('deputies')" data-section="deputies">Депутаты</button>
        <button onclick="AdminApp.navigate('commissions')" data-section="commissions">Комиссии</button>
        <button onclick="AdminApp.navigate('events')" data-section="events">Мероприятия</button>
      </div>
      <div class="admin-layout">
        <div class="sidebar">
          <button class="sidebar-item active" data-section="dashboard" onclick="AdminApp.navigate('dashboard')">&#x1F4CA; Главная</button>
          <button class="sidebar-item" data-section="deputies" onclick="AdminApp.navigate('deputies')">&#x1F465; Депутаты</button>
          <button class="sidebar-item" data-section="commissions" onclick="AdminApp.navigate('commissions')">&#x1F3DB; Комиссии</button>
          <button class="sidebar-item" data-section="events" onclick="AdminApp.navigate('events')">&#x1F4C5; Мероприятия</button>
        </div>
        <div class="main-content" id="admin-content"></div>
      </div>
    `;
  },

  navigate(section) {
    this.section = section;
    document.querySelectorAll('.sidebar-item, .mobile-nav button').forEach(el => {
      el.classList.toggle('active', el.dataset.section === section);
    });

    const loaders = {
      dashboard: () => this.loadDashboard(),
      deputies: () => this.loadDeputies(),
      commissions: () => this.loadCommissions(),
      events: () => this.loadEvents()
    };

    (loaders[section] || loaders.dashboard)();
  },

  // === Dashboard ===
  async loadDashboard() {
    const stats = await API.get('/api/admin/stats');
    document.getElementById('admin-content').innerHTML = `
      <h2 style="margin-bottom:16px">Панель управления</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.deputyCount}</div>
          <div class="stat-label">Депутатов</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.commissionCount}</div>
          <div class="stat-label">Комиссий</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.upcomingEvents}</div>
          <div class="stat-label">Предстоящих мероприятий</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.pendingResponses}</div>
          <div class="stat-label">Ожидают ответа</div>
        </div>
      </div>
    `;
  },

  // === Deputies ===
  async loadDeputies() {
    const deputies = await API.get('/api/admin/deputies');
    const c = document.getElementById('admin-content');
    c.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Депутаты (${deputies.length})</h2>
          <button class="btn btn-primary btn-sm" onclick="AdminApp.showDeputyModal()">+ Добавить</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ФИО</th><th>Телефон</th><th>Email</th><th>Код входа</th><th></th></tr></thead>
            <tbody>
              ${deputies.map(d => `
                <tr>
                  <td>${d.full_name}</td>
                  <td>${d.phone || '—'}</td>
                  <td>${d.email || '—'}</td>
                  <td>${d.login_code || '—'}</td>
                  <td>
                    <button class="btn btn-outline btn-sm" onclick="AdminApp.showDeputyModal(${d.id}, '${d.full_name.replace(/'/g, "\\'")}', '${d.phone || ''}', '${d.email || ''}')">&#x270E;</button>
                    <button class="btn btn-danger btn-sm" onclick="AdminApp.deleteDeputy(${d.id})">&#x2716;</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  showDeputyModal(id, name, phone, email) {
    const isEdit = !!id;
    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>${isEdit ? 'Редактировать' : 'Добавить'} депутата</h3>
          <div class="form-group">
            <label>ФИО</label>
            <input type="text" id="dep-name" class="form-control" value="${name || ''}">
          </div>
          <div class="form-group">
            <label>Телефон</label>
            <input type="tel" id="dep-phone" class="form-control" value="${phone || ''}">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="dep-email" class="form-control" value="${email || ''}">
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
            <button class="btn btn-primary" onclick="AdminApp.saveDeputy(${id || 'null'})">Сохранить</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  },

  async saveDeputy(id) {
    const body = {
      full_name: document.getElementById('dep-name').value,
      phone: document.getElementById('dep-phone').value,
      email: document.getElementById('dep-email').value
    };

    if (!body.full_name) return showToast('Укажите ФИО', 'error');

    if (id) {
      await API.put(`/api/admin/deputies/${id}`, body);
    } else {
      await API.post('/api/admin/deputies', body);
    }

    document.querySelector('.modal-overlay')?.remove();
    showToast('Сохранено', 'success');
    this.loadDeputies();
  },

  async deleteDeputy(id) {
    if (!confirm('Удалить депутата?')) return;
    await API.del(`/api/admin/deputies/${id}`);
    showToast('Удалено', 'success');
    this.loadDeputies();
  },

  // === Commissions ===
  async loadCommissions() {
    const commissions = await API.get('/api/admin/commissions');
    const c = document.getElementById('admin-content');
    c.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Комиссии (${commissions.length})</h2>
          <button class="btn btn-primary btn-sm" onclick="AdminApp.showCommissionModal()">+ Добавить</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Название</th><th>Описание</th><th>Участников</th><th></th></tr></thead>
            <tbody>
              ${commissions.map(c => `
                <tr>
                  <td>${c.name}</td>
                  <td>${c.description || '—'}</td>
                  <td>${c.member_count}</td>
                  <td>
                    <button class="btn btn-outline btn-sm" onclick="AdminApp.showCommissionMembers(${c.id}, '${c.name.replace(/'/g, "\\'")}')">&#x1F465;</button>
                    <button class="btn btn-outline btn-sm" onclick="AdminApp.showCommissionModal(${c.id}, '${c.name.replace(/'/g, "\\'")}', '${(c.description || '').replace(/'/g, "\\'")}')">&#x270E;</button>
                    <button class="btn btn-danger btn-sm" onclick="AdminApp.deleteCommission(${c.id})">&#x2716;</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  showCommissionModal(id, name, description) {
    const isEdit = !!id;
    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>${isEdit ? 'Редактировать' : 'Добавить'} комиссию</h3>
          <div class="form-group">
            <label>Название</label>
            <input type="text" id="com-name" class="form-control" value="${name || ''}">
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea id="com-desc" class="form-control">${description || ''}</textarea>
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
            <button class="btn btn-primary" onclick="AdminApp.saveCommission(${id || 'null'})">Сохранить</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  },

  async saveCommission(id) {
    const body = {
      name: document.getElementById('com-name').value,
      description: document.getElementById('com-desc').value
    };
    if (!body.name) return showToast('Укажите название', 'error');

    if (id) {
      await API.put(`/api/admin/commissions/${id}`, body);
    } else {
      await API.post('/api/admin/commissions', body);
    }

    document.querySelector('.modal-overlay')?.remove();
    showToast('Сохранено', 'success');
    this.loadCommissions();
  },

  async deleteCommission(id) {
    if (!confirm('Удалить комиссию?')) return;
    await API.del(`/api/admin/commissions/${id}`);
    showToast('Удалено', 'success');
    this.loadCommissions();
  },

  async showCommissionMembers(commissionId, name) {
    const [members, allDeputies] = await Promise.all([
      API.get(`/api/admin/commissions/${commissionId}/members`),
      API.get('/api/admin/deputies')
    ]);

    const memberIds = new Set(members.map(m => m.id));

    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Члены комиссии: ${name}</h3>
          <div class="deputy-select-list">
            ${allDeputies.map(d => `
              <label class="deputy-select-item">
                <input type="checkbox" value="${d.id}" ${memberIds.has(d.id) ? 'checked' : ''}>
                ${d.full_name}
              </label>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
            <button class="btn btn-primary" onclick="AdminApp.saveCommissionMembers(${commissionId})">Сохранить</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  },

  async saveCommissionMembers(commissionId) {
    const checkboxes = document.querySelectorAll('.deputy-select-list input:checked');
    const deputy_ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

    await API.post(`/api/admin/commissions/${commissionId}/members`, { deputy_ids });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Состав обновлён', 'success');
    this.loadCommissions();
  },

  // === Events ===
  async loadEvents() {
    const events = await API.get('/api/admin/events');
    const c = document.getElementById('admin-content');
    c.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Мероприятия (${events.length})</h2>
          <button class="btn btn-primary btn-sm" onclick="AdminApp.showEventModal()">+ Создать</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Название</th><th>Тип</th><th>Участники</th><th>Подтв.</th><th></th></tr></thead>
            <tbody>
              ${events.map(e => `
                <tr>
                  <td>${formatDateTime(e.event_date)}</td>
                  <td>${e.title}</td>
                  <td><span class="event-type-badge badge-${e.event_type}">${EVENT_TYPE_LABELS[e.event_type]}</span></td>
                  <td>${e.participant_count}</td>
                  <td>${e.confirmed_count} / ${e.participant_count}</td>
                  <td>
                    <button class="btn btn-outline btn-sm" onclick="AdminApp.showEventDetail(${e.id})">&#x1F441;</button>
                    <button class="btn btn-warning btn-sm" onclick="AdminApp.remindEvent(${e.id})" title="Напомнить">&#x1F514;</button>
                    <button class="btn btn-danger btn-sm" onclick="AdminApp.deleteEvent(${e.id})">&#x2716;</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async showEventModal() {
    const [commissions, deputies] = await Promise.all([
      API.get('/api/admin/commissions'),
      API.get('/api/admin/deputies')
    ]);

    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Создать мероприятие</h3>
          <div class="form-group">
            <label>Название</label>
            <input type="text" id="evt-title" class="form-control" placeholder="Заседание комиссии по...">
          </div>
          <div class="form-group">
            <label>Тип</label>
            <select id="evt-type" class="form-control" onchange="AdminApp.onEventTypeChange()">
              <option value="commission">Комиссия</option>
              <option value="session">Заседание</option>
              <option value="external">Выездное мероприятие</option>
            </select>
          </div>
          <div class="form-group" id="evt-commission-group">
            <label>Комиссия</label>
            <select id="evt-commission" class="form-control">
              <option value="">Выберите комиссию</option>
              ${commissions.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group hidden" id="evt-deputies-group">
            <label>Депутаты</label>
            <div class="deputy-select-list">
              ${deputies.map(d => `
                <label class="deputy-select-item">
                  <input type="checkbox" value="${d.id}" class="evt-deputy-cb">
                  ${d.full_name}
                </label>
              `).join('')}
            </div>
          </div>
          <div class="form-group">
            <label>Дата и время</label>
            <input type="datetime-local" id="evt-date" class="form-control">
          </div>
          <div class="form-group">
            <label>Место</label>
            <input type="text" id="evt-location" class="form-control" placeholder="Адрес или зал">
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea id="evt-desc" class="form-control" placeholder="Повестка дня..."></textarea>
          </div>
          <div class="form-group">
            <label>Файлы</label>
            <input type="file" id="evt-files" multiple>
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
            <button class="btn btn-primary" onclick="AdminApp.saveEvent()">Создать</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  },

  onEventTypeChange() {
    const type = document.getElementById('evt-type').value;
    document.getElementById('evt-commission-group').classList.toggle('hidden', type !== 'commission');
    document.getElementById('evt-deputies-group').classList.toggle('hidden', type !== 'external');
  },

  async saveEvent() {
    const type = document.getElementById('evt-type').value;
    const body = {
      title: document.getElementById('evt-title').value,
      description: document.getElementById('evt-desc').value,
      event_type: type,
      event_date: document.getElementById('evt-date').value,
      location: document.getElementById('evt-location').value
    };

    if (!body.title || !body.event_date) return showToast('Укажите название и дату', 'error');

    if (type === 'commission') {
      body.commission_id = parseInt(document.getElementById('evt-commission').value);
      if (!body.commission_id) return showToast('Выберите комиссию', 'error');
    } else if (type === 'external') {
      body.deputy_ids = Array.from(document.querySelectorAll('.evt-deputy-cb:checked')).map(cb => parseInt(cb.value));
      if (!body.deputy_ids.length) return showToast('Выберите депутатов', 'error');
    }

    const result = await API.post('/api/admin/events', body);

    // Upload files if any
    const fileInput = document.getElementById('evt-files');
    if (fileInput.files.length > 0) {
      const formData = new FormData();
      for (const file of fileInput.files) {
        formData.append('files', file);
      }
      await API.upload(`/api/admin/events/${result.id}/files`, formData);
    }

    document.querySelector('.modal-overlay')?.remove();
    showToast('Мероприятие создано', 'success');
    this.loadEvents();
  },

  async showEventDetail(eventId) {
    const event = await API.get(`/api/admin/events/${eventId}`);

    const html = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>${event.title}</h3>
          <div class="event-meta">
            <div><strong>Тип:</strong> ${EVENT_TYPE_LABELS[event.event_type]}</div>
            <div><strong>Дата:</strong> ${formatDateTime(event.event_date)}</div>
            ${event.location ? `<div><strong>Место:</strong> ${event.location}</div>` : ''}
            ${event.commission_name ? `<div><strong>Комиссия:</strong> ${event.commission_name}</div>` : ''}
          </div>
          ${event.description ? `<div class="event-description">${event.description}</div>` : ''}
          ${event.files.length ? `
            <div class="event-files">
              <strong>Файлы:</strong>
              ${event.files.map(f => `<a href="/uploads/${f.filename}" target="_blank">${f.original_name}</a>`).join('')}
            </div>
          ` : ''}
          <h4 style="margin:12px 0 8px">Участники (${event.participants.length})</h4>
          <div class="participants-list">
            ${event.participants.map(p => `
              <div class="participant-row">
                <span>${p.full_name}</span>
                <span class="status-${p.status}">${STATUS_LABELS[p.status]}</span>
              </div>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn btn-warning" onclick="AdminApp.remindEvent(${eventId}); document.querySelector('.modal-overlay').remove();">Напомнить всем</button>
            <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  },

  async remindEvent(eventId) {
    const result = await API.post(`/api/admin/events/${eventId}/remind`);
    showToast(`Напоминание отправлено (${result.sent} депутатов)`, 'success');
  },

  async deleteEvent(id) {
    if (!confirm('Удалить мероприятие?')) return;
    await API.del(`/api/admin/events/${id}`);
    showToast('Удалено', 'success');
    this.loadEvents();
  }
};
