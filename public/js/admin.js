const AdminApp = {
  section: localStorage.getItem('adminSection') || 'dashboard',
  selectedDistrict: localStorage.getItem('selectedDistrict') || '',
  districts: [],

  staffMode: false,
  staffPermissions: {},

  async init() {
    document.body.className = '';
    this.staffMode = false;
    this.selectedDistrict = localStorage.getItem('selectedDistrict') || '';
    this.districts = await API.get('/api/admin/districts');
    this.render();
    this.navigate(this.section);
  },

  _staffSignature: '',

  async initAsStaff(permissions) {
    document.body.className = '';
    this.staffMode = true;
    this.staffPermissions = permissions || {};
    this.selectedDistrict = localStorage.getItem('selectedDistrict') || '';
    // Reset section if it's admin-only
    const adminOnlySections = ['admins','blocks','adminprofile','settings','staff'];
    if (adminOnlySections.includes(this.section)) this.section = 'dashboard';
    this.districts = await API.get('/api/admin/districts');
    // Load staff info
    try {
      const smtp = await API.get('/api/deputy/smtp-settings'); this._staffSignature = smtp.signature || ''; this._staffSmtpEnabled = !!smtp.enabled;
      const profile = await API.get('/api/deputy/profile'); this._isLeadStaff = profile.staff_role === 'lead';
    } catch(e) {}
    this.render();
    this.navigate(this.section);
    if (typeof Tutorial !== 'undefined') Tutorial.show('staff-desktop');
  },

  render() {
    const isSystem = API.user.adminRole === 'system_admin';
    const isStaff = this.staffMode;
    const sp = this.staffPermissions;
    const distName = localStorage.getItem('selectedDistrictName') || 'Все районы';
    const roleLabel = isStaff ? 'Сотрудник' : (isSystem ? 'Сис.админ' : 'Админ');

    // Build menu items based on role/permissions
    const menuItems = [
      { id: 'dashboard', icon: '&#x1F4CA;', label: 'Главная', show: true },
      { id: 'deputies', icon: '&#x1F465;', label: 'Депутаты', show: !isStaff || sp.can_manage_deputies },
      { id: 'staff', icon: '&#x1F464;', label: 'Сотрудники', show: !isStaff },
      { id: 'commissions', icon: '&#x1F3DB;', label: 'Комиссии', show: !isStaff || sp.can_manage_deputies },
      { id: 'events', icon: '&#x1F4C5;', label: 'Мероприятия', show: !isStaff || sp.can_create_events },
      { id: 'receptions', icon: '&#x1F4CB;', label: 'Приёмы', show: !isStaff || sp.can_manage_receptions },
      { id: 'rooms', icon: '&#x1F3E2;', label: 'Кабинеты', show: !isStaff || sp.can_create_events },
      { id: 'templates', icon: '&#x1F4D1;', label: 'Библиотека', show: true },
      { id: 'admins', icon: '&#x1F6E1;', label: 'Администраторы', show: isSystem },
      { id: 'blocks', icon: '&#x1F6AB;', label: 'Блокировки', show: isSystem },
      { id: 'chat', icon: '&#x1F4AC;', label: 'Чат', show: true },
      { id: 'staffmgmt', icon: '&#x1F465;', label: 'Сотрудники', show: isStaff && this._isLeadStaff },
      { id: 'myprofile', icon: '&#x1F464;', label: 'Мой профиль', show: isStaff },
      { id: 'adminprofile', icon: '&#x1F464;', label: 'Мой профиль', show: !isStaff },
      { id: 'settings', icon: '&#x2699;', label: 'Настройки', show: !isStaff },
      { id: 'changelog', icon: '', label: 'Обновления', show: true },
    ].filter(i => i.show);

    document.getElementById('app').innerHTML = `
      <div class="header">
        <h1>Я Депутат</h1>
        <div class="header-right">
          <button class="district-btn" onclick="AdminApp.switchDistrict()">&#x1F4CD; ${distName}</button>
          <span class="text-sm">${API.user.name} <span class="badge-role">${roleLabel}</span></span>
          <button class="btn-icon" onclick="App.logout()">&#x2716;</button>
        </div>
      </div>
      <div class="mobile-nav">
        ${menuItems.map(i => `<button data-section="${i.id}" onclick="AdminApp.navigate('${i.id}')">${i.label}</button>`).join('')}
      </div>
      <div class="admin-layout">
        <div class="sidebar">
          ${menuItems.map(i => `<button class="sidebar-item" data-section="${i.id}" onclick="AdminApp.navigate('${i.id}')">${i.icon} ${i.label}</button>`).join('')}
        </div>
        <div class="main-content" id="admin-content"></div>
      </div>`;
  },

  switchDistrict() { localStorage.removeItem('selectedDistrict'); localStorage.removeItem('selectedDistrictName'); App.showDistrictPicker(); },
  dp() { return this.selectedDistrict ? `district_id=${this.selectedDistrict}` : ''; },

  navigate(s) {
    this.section = s;
    localStorage.setItem('adminSection', s);
    document.querySelectorAll('.sidebar-item,.mobile-nav button').forEach(el => el.classList.toggle('active', el.dataset.section === s));
    const map = {
      dashboard:()=>this.loadDashboard(), deputies:()=>this.loadPeople('deputy'), staff:()=>this.loadPeople('staff'),
      commissions:()=>this.loadCommissions(), events:()=>this.loadEvents(), rooms:()=>this.loadRooms(), templates:()=>this.loadTemplatesPage(), receptions:()=>this.loadReceptions(), staffmgmt:()=>this.loadStaffMgmt(), myprofile:()=>this.loadMyProfile(),
      admins:()=>this.loadAdmins(), blocks:()=>this.loadBlocks(), chat:()=>this.loadAdminChats(), adminprofile:()=>this.loadAdminProfile(), changelog:()=>this.loadChangelog(), settings:()=>this.loadSettings()
    };
    (map[s] || map.dashboard)();
  },

  // === Dashboard ===
  async loadDashboard() {
    const [s, deps, events] = await Promise.all([
      API.get(`/api/admin/stats?${this.dp()}`),
      API.get(`/api/admin/deputies?user_type=deputy&${this.dp()}`),
      API.get(`/api/admin/events?${this.dp()}`)
    ]);
    const TYPE_LABELS = {regular:'Очередное',extraordinary:'Внеочередное',field:'Выездное',commission:'Комиссия'};
    const now = new Date();
    const sorted = (events||[]).sort((a,b) => {
      const ad = new Date(a.event_date), bd = new Date(b.event_date);
      const af = ad >= now, bf = bd >= now;
      if (af && !bf) return -1;
      if (!af && bf) return 1;
      if (af && bf) return ad - bd;
      return bd - ad;
    }).slice(0, 10);

    document.getElementById('admin-content').innerHTML = `<h2 style="margin-bottom:16px">Панель управления</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${s.deputyCount}</div><div class="stat-label">Депутатов</div></div>
        <div class="stat-card"><div class="stat-value">${s.staffCount}</div><div class="stat-label">Сотрудников</div></div>
        <div class="stat-card"><div class="stat-value">${s.commissionCount}</div><div class="stat-label">Комиссий</div></div>
        <div class="stat-card"><div class="stat-value">${s.upcomingEvents}</div><div class="stat-label">Предстоящих</div></div>
        <div class="stat-card"><div class="stat-value">${s.onVacation}</div><div class="stat-label">В отпуске</div></div>
      </div>

      <div class="card"><h3 class="card-title">Депутаты</h3>
        <div class="deputy-dashboard-grid">
          ${deps.map(d => `<div class="deputy-dash-item" onclick="AdminApp.showDeputyHistory(${d.id})">
            <div class="deputy-dash-avatar">${esc(d.full_name).split(' ').map(w=>w[0]).join('').substring(0,2)}</div>
            <div class="deputy-dash-info">
              <div class="deputy-dash-name">${esc(d.full_name)} ${d.deputy_role==='head'?'<span class="badge-head">ГСД</span>':''}</div>
              <div class="deputy-dash-sub">${d.is_registered?'Зарегистрирован':'Не зарегистрирован'}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <div class="card"><h3 class="card-title">Лента событий</h3>
        <div class="event-list">
          ${sorted.length ? sorted.map(e => {
            const ed = new Date(e.event_date);
            const isPast = ed < now;
            return `<div class="event-card type-${e.event_type}" style="${isPast?'opacity:0.5;':''}" onclick="AdminApp.showEvtDetail(${e.id})">
              <div class="event-date">${formatDateTime(e.event_date)}</div>
              <div class="event-title">${esc(e.title)}</div>
              <div><span class="event-type-badge badge-${e.event_type}">${TYPE_LABELS[e.event_type]||esc(e.event_type)}</span>
                ${e.status==='closed'?'<span class="badge-closed" style="margin-left:6px">Завершено</span>':''}</div>
            </div>`;
          }).join('') : '<p class="text-secondary">Нет событий</p>'}
        </div>
      </div>`;
  },

  async showDeputyHistory(depId) {
    const [h, savedReports] = await Promise.all([
      API.get(`/api/admin/deputies/${depId}/history`),
      API.get(`/api/admin/deputies/${depId}/reports`)
    ]);
    const d = h.deputy;
    const yr = new Date().getFullYear();
    const q = Math.ceil((new Date().getMonth()+1)/3);
    const PART_LABELS = {confirmed:'Присутствовал',declined:'Не присутствовал',seen:'Уведомлён',pending:'Не ответил'};
    const TYPE_LABELS_L = {regular:'Очередное',extraordinary:'Внеочередное',field:'Выездное',commission:'Комиссия'};

    document.getElementById('admin-content').innerHTML = `
      <div class="flex gap-8" style="align-items:center;margin-bottom:16px">
        <button class="btn btn-outline btn-sm" onclick="AdminApp.loadDashboard()">\u2190 Назад</button>
        <h2>${esc(d.full_name)}</h2>
        ${d.deputy_role==='head'?'<span class="badge-head">Глава СД</span>':''}
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${h.events.length}</div><div class="stat-label">Мероприятий</div></div>
        <div class="stat-card"><div class="stat-value">${h.events.filter(e=>e.participation==='confirmed').length}</div><div class="stat-label">Присутствовал</div></div>
        <div class="stat-card"><div class="stat-value">${h.receptions.length}</div><div class="stat-label">Приёмов</div></div>
        <div class="stat-card"><div class="stat-value">${h.vacations.length}</div><div class="stat-label">Отпусков</div></div>
      </div>

      <div class="card"><div class="card-header"><h3 class="card-title">Сформировать отчёт</h3></div>
        <div class="form-row">
          <div class="form-group" style="flex:1"><label>Период</label><select id="rpt-type" class="form-control" onchange="document.getElementById('rpt-q-wrap').classList.toggle('hidden',this.value==='year')">
            <option value="quarter">За квартал</option><option value="year">За год</option></select></div>
          <div class="form-group" style="flex:1" id="rpt-q-wrap"><label>Квартал</label><select id="rpt-q" class="form-control">
            <option value="1" ${q===1?'selected':''}>1 (янв-мар)</option><option value="2" ${q===2?'selected':''}>2 (апр-июн)</option>
            <option value="3" ${q===3?'selected':''}>3 (июл-сен)</option><option value="4" ${q===4?'selected':''}>4 (окт-дек)</option></select></div>
          <div class="form-group" style="flex:1"><label>Год</label><input type="number" id="rpt-yr" class="form-control" value="${yr}"></div>
        </div>
        <div class="form-group"><label>Шаблон отчёта <span class="text-tertiary">(необязательно — предыдущий отчёт депутата)</span></label>
          <input type="file" id="rpt-template" class="form-control" accept=".doc,.docx,.txt">
          <span class="field-hint">Загрузите предыдущий отчёт — ИИ сформирует новый в том же стиле и структуре, но с актуальными данными</span>
        </div>
        <button class="btn btn-primary" onclick="AdminApp.generatePeriodReport(${depId})">Сформировать отчёт</button>
        <div id="rpt-result"></div>
      </div>

      ${savedReports.length ? `<div class="card"><h3 class="card-title">Сохранённые отчёты</h3>
        ${savedReports.map(r => `<div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:500">${r.period} ${r.visible_to_deputy ? '<span class="badge-ai">Виден депутату</span>' : ''}</div>
            <div class="text-tertiary">${new Date(r.created_at).toLocaleDateString('ru-RU')}</div>
          </div>
          <div class="flex gap-8">
            <button class="btn btn-outline btn-sm" onclick="AdminApp.showSavedReport(${r.id})">Открыть</button>
            <button class="btn ${r.visible_to_deputy?'btn-warning':'btn-success'} btn-sm" onclick="AdminApp.toggleReportVisibility(${r.id},${depId})">${r.visible_to_deputy?'Скрыть':'Показать депутату'}</button>
            <button class="btn btn-danger btn-sm" onclick="API.del('/api/admin/reports/${r.id}');AdminApp.showDeputyHistory(${depId})">Удалить</button>
          </div>
        </div>`).join('')}
      </div>` : ''}

      <div class="card"><h3 class="card-title">История мероприятий</h3>
        ${h.events.length ? `<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Мероприятие</th><th>Тип</th><th>Участие</th></tr></thead>
          <tbody>${h.events.map(e => `<tr>
            <td>${new Date(e.event_date).toLocaleDateString('ru-RU')}</td>
            <td>${esc(e.title)}</td>
            <td>${TYPE_LABELS_L[e.event_type]||e.event_type}</td>
            <td><span class="status-${e.participation}">${PART_LABELS[e.participation]||e.participation}</span></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="text-gray">Нет мероприятий</p>'}
      </div>

      ${h.receptions.length ? `<div class="card"><h3 class="card-title">Приёмы населения</h3>
        <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Время</th><th>Место</th><th>Статус</th></tr></thead>
          <tbody>${h.receptions.map(r => `<tr>
            <td>${r.reception_date}</td><td>${r.time_start}-${r.time_end}</td><td>${esc(r.location)||'—'}</td>
            <td>${r.status==='confirmed'?'<span class="status-confirmed">Подтверждён</span>':'Ожидает'}</td>
          </tr>`).join('')}</tbody></table></div></div>` : ''}

      ${h.vacations.length ? `<div class="card"><h3 class="card-title">Отпуска</h3>
        ${h.vacations.map(v => `<div style="padding:6px 0;border-bottom:1px solid var(--border)">${v.vacation_start} — ${v.vacation_end}</div>`).join('')}
      </div>` : ''}`;
  },

  async downloadReportDocx() {
    const text = document.getElementById('rpt-text')?.innerText;
    if (!text) return;
    try {
      const res = await fetch('/api/admin/report/download-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API.token}` },
        body: JSON.stringify({ text, title: 'Отчёт' })
      });
      if (!res.ok) throw new Error('Ошибка');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'report.docx'; a.click();
      URL.revokeObjectURL(url);
      showToast('Word документ скачан', 'success');
    } catch (e) { showToast('Ошибка скачивания', 'error'); }
  },

  async saveReport(depId, period) {
    const text = document.getElementById('rpt-text')?.innerText;
    if (!text) return;
    await API.post(`/api/admin/deputies/${depId}/reports`, { period, report_text: text });
    showToast('Отчёт сохранён', 'success');
  },

  async toggleReportVisibility(reportId, depId) {
    const res = await API.post(`/api/admin/reports/${reportId}/toggle-visibility`);
    showToast(res.visible ? 'Отчёт виден депутату' : 'Отчёт скрыт', 'success');
    this.showDeputyHistory(depId);
  },

  async showSavedReport(reportId) {
    const r = await API.get(`/api/admin/reports/${reportId}`);
    if (!r) return;
    this._editReportId = reportId;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:700px">
      <h3>Отчёт: ${esc(r.full_name)}</h3>
      <div class="text-sm text-gray mb-16">${r.period} · ${new Date(r.created_at).toLocaleDateString('ru-RU')}</div>
      <textarea id="saved-rpt-text" class="form-control" style="white-space:pre-wrap;font-size:14px;line-height:1.6;min-height:300px;resize:vertical">${esc(r.report_text)}</textarea>
      <div class="modal-actions" style="flex-wrap:wrap">
        <button class="btn btn-success btn-sm" onclick="AdminApp.updateReport(${reportId})">Сохранить изменения</button>
        <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('saved-rpt-text').value);showToast('Скопировано','success')">Копировать</button>
        <button class="btn btn-outline btn-sm" onclick="AdminApp._savedReportText=document.getElementById('saved-rpt-text').value;document.querySelector('.modal-overlay').remove();AdminApp.downloadSavedDocx()">Скачать Word</button>
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть</button>
      </div>
    </div></div>`);
  },

  async updateReport(reportId) {
    const text = document.getElementById('saved-rpt-text')?.value;
    if (!text) return;
    await API.put(`/api/admin/reports/${reportId}`, { report_text: text });
    showToast('Отчёт сохранён', 'success');
  },

  async downloadSavedDocx() {
    const text = this._savedReportText;
    if (!text) return;
    try {
      const res = await fetch('/api/admin/report/download-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API.token}` },
        body: JSON.stringify({ text })
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'report.docx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { showToast('Ошибка', 'error'); }
  },

  async generatePeriodReport(depId) {
    const type = document.getElementById('rpt-type').value;
    const quarter = document.getElementById('rpt-q').value;
    const year = document.getElementById('rpt-yr').value;
    const templateFile = document.getElementById('rpt-template')?.files?.[0];
    const el = document.getElementById('rpt-result');
    el.innerHTML = '<p class="text-gray">\u{1F916} Генерация отчёта...</p>';

    try {
      let templateText = '';
      if (templateFile) {
        // Upload template to extract text
        const fd = new FormData();
        fd.append('files', templateFile);
        fd.append('title', 'template');
        const analysis = await API.upload('/api/admin/ai/analyze-files', fd);
        templateText = analysis.summary || '';
      }

      const r = await API.post(`/api/admin/deputies/${depId}/period-report`, {
        period: type, quarter: parseInt(quarter), year: parseInt(year), template_text: templateText
      });
      el.innerHTML = `<div class="card mt-16" style="background:var(--bg-input)">
        <div style="font-weight:600;margin-bottom:8px">Отчёт за ${r.period}</div>
        <p id="rpt-text" style="white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(r.report)}</p>
        <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('rpt-text').innerText);showToast('Скопировано','success')">Копировать</button>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.downloadReportDocx()">Скачать Word</button>
          <button class="btn btn-success btn-sm" onclick="AdminApp.saveReport(${depId},'${r.period.replace(/'/g,"\\'")}')">Сохранить в систему</button>
        </div>
      </div>`;
    } catch (e) {
      el.innerHTML = `<p style="color:var(--red)">${e.message||'Ошибка'}</p>`;
    }
  },

  // === People ===
  async loadPeople(ut) {
    const label = ut==='staff'?'Сотрудники':'Депутаты';
    const deps = await API.get(`/api/admin/deputies?user_type=${ut}&${this.dp()}`);
    const today = new Date().toISOString().split('T')[0];
    const isDeputyList = ut === 'deputy';
    // Fetch vacations for all deputies
    const vacMap = {};
    await Promise.all(deps.map(async d => {
      try { vacMap[d.id] = await API.get(`/api/admin/deputies/${d.id}/vacations`); } catch(e) { vacMap[d.id] = []; }
    }));
    document.getElementById('admin-content').innerHTML = `<div class="card"><div class="card-header"><h2>${label} (${deps.length})</h2>
      <div class="flex gap-8">
        ${ut==='deputy'?`<button class="btn btn-outline btn-sm" onclick="AdminApp.showAnnualReportPicker()">&#x1F4CA; Годовой отчёт</button>`:''}
        <button class="btn btn-primary btn-sm" onclick="AdminApp.showPersonModal('${ut}')">+ Добавить</button>
      </div></div>
      <p class="hint-text">${ut==='deputy'
        ?'&#x1F465; Управление депутатами района. Добавьте депутата, укажите email и отправьте приглашение (&#x2709;) — депутат получит ссылку для регистрации Passkey. Иконки: &#x270E; редактировать, &#x1F3D6; отпуск, &#x1F465; назначить заместителя (для главы в отпуске), &#x1F4CA; годовой отчёт — ИИ сгенерирует отчёт на основе всех мероприятий.'
        :'&#x1F464; Сотрудники — помощники депутатов. Получают уведомления о мероприятиях и могут участвовать. Регистрация аналогична депутатам — через email-приглашение и Passkey.'}</p>
      <div class="table-wrap"><table><thead><tr><th>ФИО</th><th>Роль</th><th>Район</th>${isDeputyList?'<th>Сотрудник</th>':''}<th>Статус</th><th>Вход</th><th></th></tr></thead>
        <tbody>${deps.map(d => {
          const vacs = vacMap[d.id] || [];
          const activeVacs = vacs.filter(v => v.vacation_start<=today && v.vacation_end>=today);
          const onVac = activeVacs.length > 0;
          const vacInfo = onVac ? activeVacs.map(v => `до ${v.vacation_end}`).join(', ') : '';
          const allVacStr = vacs.length > 0 ? vacs.map(v => `${v.vacation_start} — ${v.vacation_end}`).join('; ') : '';
          return `<tr><td>${esc(d.full_name)} ${d.deputy_role==='head'?'<span class="badge-head">Глава СД</span>':''}</td>
            <td>${d.user_type==='staff'?(d.staff_role==='lead'?'<span class="badge-head">Главный</span>':'Сотр.'):'Деп.'}</td><td>${esc(d.district_name)||'—'}</td>${isDeputyList?`<td>${esc(d.assigned_staff)||'<span class="text-gray">—</span>'}</td>`:''}
            <td>${onVac?`<span class="badge-vacation">Отпуск ${vacInfo}</span>`:''}${!onVac&&vacs.length?`<span class="text-gray text-sm">${allVacStr}</span>`:''}${d.substitute_for_id?`<span class="badge-sub">Замещает</span>`:''} ${!onVac&&!vacs.length&&!d.substitute_for_id?'—':''}</td>
            <td>${d.passkey_registered?'<span class="status-confirmed">&#x2714;</span>':'—'}</td>
            <td class="actions-cell">
              <button class="btn btn-outline btn-sm" onclick="AdminApp.invitePerson(${d.id})">${d.is_registered?'Напомнить':'Пригласить'}</button>
              <button class="btn btn-outline btn-sm" onclick="AdminApp.showPersonModal('${ut}',${d.id})">Изменить</button>
              <button class="btn btn-outline btn-sm" onclick="AdminApp.showPasswordModal(${d.id},'${d.full_name.replace(/'/g,"\\'")}','${(d.email||'').replace(/'/g,"\\'")}')">Пароль</button>
              <button class="btn btn-outline btn-sm" onclick="AdminApp.showVacationModal(${d.id},'${d.full_name.replace(/'/g,"\\'")}')">Отпуск</button>
              ${onVac?`<button class="btn btn-warning btn-sm" onclick="AdminApp.showSubstituteModal(${d.id},'${ut}')">Замещение</button>`:''}
              <button class="btn btn-danger btn-sm" onclick="AdminApp.deletePerson(${d.id},'${ut}')">Удалить</button>
            </td></tr>`;}).join('')}</tbody></table></div></div>`;
  },

  async showPersonModal(ut, id) {
    let n='',ph='',em='',di='',dr='deputy',perms={},linkedDeps=[],assignedStaffIds=[];
    if (id) {
      const ds=await API.get(`/api/admin/deputies?user_type=${ut}`); const d=ds.find(x=>x.id===id);
      if(d){n=d.full_name;ph=d.phone||'';em=d.email||'';di=d.district_id||'';dr=d.deputy_role||'deputy';}
      if (ut==='staff') {
        try { const sp=await API.get(`/api/admin/staff/${id}/permissions`); perms=sp.permissions||{}; linkedDeps=sp.deputy_ids||[]; } catch(e){}
        const allS = await API.get(`/api/admin/deputies?user_type=staff`);
        const sData = allS.find(x=>x.id===id);
        if (sData) perms._staffRole = sData.staff_role;
      }
      if (ut==='deputy') {
        try { const links=await API.get(`/api/admin/deputies/${id}/staff-links`); assignedStaffIds=links||[]; } catch(e){}
      }
    }
    const dOpts = this.districts.map(d => `<option value="${d.id}" ${di==d.id?'selected':''}>${esc(d.name)} (${esc(d.okrug)})</option>`).join('');
    let deputyStaffHtml = '';
    if (ut==='deputy') {
      const allStaff = await API.get(`/api/admin/deputies?user_type=staff&${this.dp()}`);
      const sSet = new Set(assignedStaffIds);
      deputyStaffHtml = `<div class="form-group"><label>Сотрудник</label>
        <select id="p-assigned-staff" class="form-control" multiple style="min-height:60px">
          ${(allStaff||[]).map(s => `<option value="${s.id}" ${sSet.has(s.id)?'selected':''}>${esc(s.full_name)}</option>`).join('')}
        </select>
        <span class="field-hint">Удерживайте Ctrl/Cmd для выбора нескольких</span></div>`;
    }
    let staffHtml = '';
    if (ut==='staff') {
      const allDeps = await API.get(`/api/admin/deputies?user_type=deputy&${this.dp()}`);
      const ls = new Set(linkedDeps);
      staffHtml = `<hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
        <div class="form-group"><label>Роль сотрудника</label>
          <select id="p-staff-role" class="form-control">
            <option value="regular" ${(id && perms._staffRole==='lead')?'':'selected'}>Обычный сотрудник</option>
            <option value="lead" ${(id && perms._staffRole==='lead')?'selected':''}>Главный сотрудник</option>
          </select>
          <span class="field-hint">Главный сотрудник может создавать и удалять других сотрудников в своём районе</span>
        </div>
        <h4 style="margin-bottom:8px">Права сотрудника</h4>
        <p class="hint-text">Настройте доступ этого сотрудника</p>
        <div class="pref-list">
          <label class="pref-item"><span>Управление депутатами</span><input type="checkbox" class="staff-perm" data-perm="can_manage_deputies" ${perms.can_manage_deputies?'checked':''}></label>
          <label class="pref-item"><span>Создание мероприятий</span><input type="checkbox" class="staff-perm" data-perm="can_create_events" ${perms.can_create_events?'checked':''}></label>
          <label class="pref-item"><span>Отправка уведомлений</span><input type="checkbox" class="staff-perm" data-perm="can_send_notifications" ${perms.can_send_notifications?'checked':''}></label>
          <label class="pref-item"><span>Управление приёмами</span><input type="checkbox" class="staff-perm" data-perm="can_manage_receptions" ${perms.can_manage_receptions?'checked':''}></label>
          <label class="pref-item"><span>Просмотр отчётов</span><input type="checkbox" class="staff-perm" data-perm="can_view_reports" ${perms.can_view_reports?'checked':''}></label>
        </div>
        <h4 style="margin:16px 0 4px">Привязанные депутаты</h4>
        <p class="field-hint" style="margin-bottom:8px">Какими депутатами может управлять этот сотрудник</p>
        <div class="deputy-select-list">${allDeps.map(d=>`<label class="deputy-select-item"><input type="checkbox" value="${d.id}" class="staff-dep-cb" ${ls.has(d.id)?'checked':''}> ${esc(d.full_name)} ${d.deputy_role==='head'?'(Глава СД)':''}</label>`).join('')}</div>`;
    }
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:550px">
      <h3>${id?'Редактировать':'Добавить'} ${ut==='staff'?'сотрудника':'депутата'}</h3>
      <div class="form-group"><label>ФИО *</label><input id="p-name" class="form-control" value="${n}"></div>
      <div class="form-group"><label>Район</label><select id="p-dist" class="form-control"><option value="">—</option>${dOpts}</select></div>
      <div class="form-group"><label>Email</label><input type="email" id="p-email" class="form-control" value="${em}" placeholder="Для приглашения и уведомлений"></div>
      <div class="form-group"><label>Телефон</label><input type="tel" id="p-phone" class="form-control" value="${ph}"></div>
      ${ut==='deputy'?`<div class="form-group"><label>Роль</label><select id="p-role" class="form-control"><option value="deputy" ${dr==='deputy'?'selected':''}>Муниципальный депутат</option><option value="head" ${dr==='head'?'selected':''}>Глава Совета депутатов</option></select></div>`:''}
      ${deputyStaffHtml}
      ${staffHtml}
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="AdminApp.savePerson(${id||'null'},'${ut}')">Сохранить</button></div></div></div>`);
    if (!id && this.selectedDistrict) document.getElementById('p-dist').value = this.selectedDistrict;
  },

  async savePerson(id, ut) {
    const b = { full_name:document.getElementById('p-name').value, phone:document.getElementById('p-phone').value, email:document.getElementById('p-email').value, district_id:document.getElementById('p-dist').value||null, user_type:ut, deputy_role:document.getElementById('p-role')?.value||'deputy' };
    if (!b.full_name) return showToast('ФИО','error');
    if (id) await API.put(`/api/admin/deputies/${id}`,b); else { const r = await API.post('/api/admin/deputies',b); id = r.id; }
    // Save staff permissions and role
    if (ut === 'staff' && id) {
      // Update staff_role
      const staffRole = document.getElementById('p-staff-role')?.value || 'regular';
      await API.put(`/api/admin/deputies/${id}`, { ...b, staff_role: staffRole });
      // Save permissions
      const permEls = document.querySelectorAll('.staff-perm');
      if (permEls.length) {
        const permissions = {};
        permEls.forEach(el => { permissions[el.dataset.perm] = el.checked; });
        const deputy_ids = Array.from(document.querySelectorAll('.staff-dep-cb:checked')).map(c => parseInt(c.value));
        await API.put(`/api/admin/staff/${id}/permissions`, { permissions, deputy_ids });
      }
    }
    // Save deputy-staff links
    if (ut === 'deputy' && id) {
      const sel = document.getElementById('p-assigned-staff');
      if (sel) {
        const staff_ids = Array.from(sel.selectedOptions).map(o => parseInt(o.value));
        await API.put(`/api/admin/deputies/${id}/staff-links`, { staff_ids });
      }
    }
    document.querySelector('.modal-overlay')?.remove(); showToast('Сохранено','success'); this.loadPeople(ut);
  },

  async deletePerson(id,ut) { if(!confirm('Удалить?'))return; await API.del(`/api/admin/deputies/${id}`); showToast('Удалено','success'); this.loadPeople(ut); },

  showPasswordModal(id, name, email) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:420px">
      <h3>Пароль: ${esc(name)}</h3>
      <div class="form-group"><label>Новый пароль</label>
        <input type="text" id="pw-new" class="form-control" placeholder="Мин. 8 символов, A-z, 0-9, !@#">
        <span class="field-hint">Заглавная + строчная буква, цифра, спецсимвол</span>
      </div>
      <div class="modal-actions" style="flex-direction:column;gap:8px">
        <button class="btn btn-primary btn-block" onclick="AdminApp.setPersonPassword(${id})">Установить пароль</button>
        ${email ? `<button class="btn btn-outline btn-block" onclick="AdminApp.sendPasswordReset(${id});document.querySelector('.modal-overlay').remove()">Сбросить и отправить на ${esc(email)}</button>` : '<p class="text-secondary text-sm">Email не указан — отправка ссылки невозможна</p>'}
      </div>
    </div></div>`);
  },
  async setPersonPassword(id) {
    const pw = document.getElementById('pw-new').value;
    if (!pw || pw.length < 8) return showToast('Минимум 8 символов', 'error');
    try {
      await API.post(`/api/admin/deputies/${id}/set-password`, { password: pw });
      document.querySelector('.modal-overlay')?.remove();
      showToast('Пароль установлен', 'success');
    } catch(e) {}
  },
  async sendPasswordReset(id) {
    try {
      await API.post(`/api/admin/deputies/${id}/send-reset`);
      showToast('Ссылка сброса отправлена', 'success');
    } catch(e) {}
  },

  async invitePerson(id) {
    try {
      const r = await API.post(`/api/admin/deputies/${id}/invite`);
      if (r.emailSent) showToast('Приглашение отправлено','success');
      else { document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Ссылка</h3><input class="form-control" value="${r.inviteUrl}" id="inv-l" readonly onclick="this.select()"><div class="modal-actions"><button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('inv-l').value);showToast('Скопировано','success')">Копировать</button><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть</button></div></div></div>`); }
    } catch(e) {}
  },

  async showVacationModal(id,name) {
    const vacs = await API.get(`/api/admin/deputies/${id}/vacations`);
    const today = new Date().toISOString().split('T')[0];
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Отпуск: ${name}</h3>
      ${vacs.length?`<div style="margin-bottom:12px">${vacs.map(v=>{
        const isActive=v.vacation_start<=today&&v.vacation_end>=today;
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px;margin-bottom:4px;background:${isActive?'#fff3e0':'#f5f5f5'};border-radius:8px">
          <span>${isActive?'<strong style="color:var(--warning)">Активен</strong> ':''}${v.vacation_start} — ${v.vacation_end}</span>
          <button class="btn btn-danger btn-sm" onclick="AdminApp.delSingleVac(${v.id},${id},'${name.replace(/'/g,"\\'")}')">Удалить</button>
        </div>`;}).join('')}</div>`:'<p class="text-gray" style="margin-bottom:12px">Нет отпусков</p>'}
      <h4 style="margin-bottom:8px">Добавить отпуск</h4>
      <div class="form-group"><label>С</label><input type="date" id="vac-s" class="form-control"></div>
      <div class="form-group"><label>По</label><input type="date" id="vac-e" class="form-control"></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="AdminApp.clearVac(${id})">Снять все</button><button class="btn btn-primary" onclick="AdminApp.saveVac(${id})">Добавить</button></div></div></div>`);
  },
  async saveVac(id) { const vs=document.getElementById('vac-s').value,ve=document.getElementById('vac-e').value;if(!vs||!ve)return showToast('Укажите даты','error');await API.post(`/api/admin/deputies/${id}/vacation`,{vacation_start:vs,vacation_end:ve}); document.querySelector('.modal-overlay')?.remove(); showToast('OK','success'); this.navigate(this.section); },
  async clearVac(id) { await API.del(`/api/admin/deputies/${id}/vacation`); document.querySelector('.modal-overlay')?.remove(); showToast('OK','success'); this.navigate(this.section); },
  async delSingleVac(vacId,depId,name) { await API.del(`/api/admin/vacations/${vacId}`); document.querySelector('.modal-overlay')?.remove(); showToast('OK','success'); this.showVacationModal(depId,name); },

  async showSubstituteModal(hid, userType) {
    const ut = userType || 'deputy';
    const ds=await API.get(`/api/admin/deputies?user_type=${ut}&${this.dp()}`);
    const others=ds.filter(d=>d.id!==hid);
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Назначить заместителя</h3>
      <select id="sub-d" class="form-control"><option value="">— Без —</option>${others.map(d=>`<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}</select>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="AdminApp.saveSub(${hid})">OK</button></div></div></div>`);
  },
  async saveSub(hid) { await API.post(`/api/admin/deputies/${hid}/substitute`,{substitute_id:document.getElementById('sub-d').value||null}); document.querySelector('.modal-overlay')?.remove(); showToast('OK','success'); this.navigate(this.section); },

  // Annual report
  async showAnnualReportPicker() {
    const deps = await API.get(`/api/admin/deputies?user_type=deputy&${this.dp()}`);
    const yr = new Date().getFullYear();
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Годовой отчёт</h3>
      <div class="form-group"><label>Депутат</label><select id="ar-dep" class="form-control">${deps.map(d=>`<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Год</label><input type="number" id="ar-year" class="form-control" value="${yr}"></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="AdminApp.genReport()">Сгенерировать</button></div></div></div>`);
  },
  async genReport() {
    const depId=document.getElementById('ar-dep').value, year=document.getElementById('ar-year').value;
    document.querySelector('.modal .btn-primary').textContent='Генерация...';
    try {
      const r = await API.post(`/api/admin/deputies/${depId}/annual-report`,{year});
      document.querySelector('.modal').innerHTML=`<h3>Годовой отчёт ${year}</h3><div class="event-description" style="white-space:pre-wrap">${esc(r.report)}</div><div class="modal-actions"><button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.querySelector('.event-description').innerText);showToast('Скопировано','success')">Копировать</button><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть</button></div>`;
    } catch(e) { showToast(e.message,'error'); document.querySelector('.modal-overlay')?.remove(); }
  },

  // === Admins ===
  async loadAdmins() {
    const admins = await API.get('/api/admin/admins');
    document.getElementById('admin-content').innerHTML = `<div class="card"><div class="card-header"><h2>Администраторы (${admins.length})</h2><button class="btn btn-primary btn-sm" onclick="AdminApp.showAdminModal()">+ Добавить</button></div>
      <div class="table-wrap"><table><thead><tr><th>Логин</th><th>ФИО</th><th>Роль</th><th>Районы</th><th>Вход</th><th></th></tr></thead>
        <tbody>${admins.map(a=>`<tr><td>${esc(a.username)}</td><td>${esc(a.full_name)}</td><td>${a.admin_role==='system_admin'?'Сис.':'Деп.'}</td>
          <td>${a.districts.map(d=>esc(d.name)).join(', ')||'—'}</td><td>${a.has_passkey?'&#x2714;':'—'}</td>
          <td><button class="btn btn-outline btn-sm" onclick="AdminApp.showAdminModal(${a.id})">&#x270E;</button>
          ${a.id!==API.user.id?`<button class="btn btn-danger btn-sm" onclick="AdminApp.delAdmin(${a.id})">&#x2716;</button>`:''}</td></tr>`).join('')}</tbody></table></div></div>`;
  },

  async showAdminModal(id) {
    let data={username:'',full_name:'',email:'',admin_role:'deputy_admin',districts:[]};
    if(id){const as=await API.get('/api/admin/admins');data=as.find(a=>a.id===id)||data;}
    const allDist=await API.get('/api/admin/districts'); const selIds=new Set(data.districts.map(d=>d.id));
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal">
      <h3>${id?'Ред.':'Добавить'} администратора</h3>
      <div class="form-group"><label>Логин</label><input id="adm-u" class="form-control" value="${data.username}" ${id?'readonly':''}></div>
      ${!id?'<div class="form-group"><label>Пароль</label><input type="password" id="adm-p" class="form-control"></div>':''}
      <div class="form-group"><label>ФИО</label><input id="adm-n" class="form-control" value="${esc(data.full_name)}"></div>
      <div class="form-group"><label>Email</label><input id="adm-e" class="form-control" value="${esc(data.email||'')}"></div>
      <div class="form-group"><label>Роль</label><select id="adm-r" class="form-control"><option value="deputy_admin" ${data.admin_role==='deputy_admin'?'selected':''}>Админ депутатов</option><option value="system_admin" ${data.admin_role==='system_admin'?'selected':''}>Сис.админ</option></select></div>
      <div class="form-group"><label>Районы</label><div class="deputy-select-list">${allDist.map(d=>`<label class="deputy-select-item"><input type="checkbox" value="${d.id}" class="adm-d-cb" ${selIds.has(d.id)?'checked':''}> ${esc(d.name)} (${esc(d.okrug)})</label>`).join('')}</div></div>
      ${id?'<div class="form-group"><label>Новый пароль</label><input type="password" id="adm-p" class="form-control" placeholder="Оставьте пустым"></div>':''}
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="AdminApp.saveAdmin(${id||'null'})">OK</button></div></div></div>`);
  },
  async saveAdmin(id) {
    const b={username:document.getElementById('adm-u').value,full_name:document.getElementById('adm-n').value,email:document.getElementById('adm-e').value,admin_role:document.getElementById('adm-r').value,district_ids:Array.from(document.querySelectorAll('.adm-d-cb:checked')).map(c=>parseInt(c.value)),password:document.getElementById('adm-p')?.value||undefined};
    if(!b.username)return showToast('Логин','error'); if(!id&&!b.password)return showToast('Пароль','error');
    if(id)await API.put(`/api/admin/admins/${id}`,b);else await API.post('/api/admin/admins',b);
    document.querySelector('.modal-overlay')?.remove();showToast('OK','success');this.loadAdmins();
  },
  async delAdmin(id){if(!confirm('Удалить?'))return;await API.del(`/api/admin/admins/${id}`);showToast('OK','success');this.loadAdmins();},

  // === Commissions ===
  async loadCommissions() {
    const cs=await API.get(`/api/admin/commissions?${this.dp()}`);
    document.getElementById('admin-content').innerHTML=`<div class="card"><div class="card-header"><h2>Комиссии (${cs.length})</h2><button class="btn btn-primary btn-sm" onclick="AdminApp.showComModal()">+ Добавить</button></div>
      <div class="table-wrap"><table><thead><tr><th>Название</th><th>Председатель</th><th>Уч.</th><th></th></tr></thead>
        <tbody>${cs.map(c=>`<tr><td style="max-width:300px"><div style="overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>${c.description?`<div class="text-sm text-gray" style="overflow:hidden;text-overflow:ellipsis">${esc(c.description)}</div>`:''}</td><td>${c.chair_name?esc(c.chair_name):'<span class="text-gray">—</span>'}</td><td>${c.member_count}</td><td>
          <div style="display:flex;gap:4px;white-space:nowrap"><button class="btn btn-outline btn-sm" onclick="AdminApp.showComMembers(${c.id},'${c.name.replace(/'/g,"\\'")}')">&#x1F465;</button>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.showComModal(${c.id},'${c.name.replace(/'/g,"\\'")}','${(c.description||'').replace(/'/g,"\\'")}')">&#x270E;</button>
          <button class="btn btn-danger btn-sm" style="margin-left:12px" onclick="AdminApp.delCom(${c.id})">&#x2716;</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  },
  showComModal(id,n,d){document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>${id?'Ред.':'Новая'} комиссия</h3><div class="form-group"><label>Название</label><input id="cm-n" class="form-control" value="${n||''}"></div><div class="form-group"><label>Описание</label><textarea id="cm-d" class="form-control">${d||''}</textarea></div><div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="AdminApp.saveCom(${id||'null'})">OK</button></div></div></div>`);},
  async saveCom(id){const b={name:document.getElementById('cm-n').value,description:document.getElementById('cm-d').value,district_id:this.selectedDistrict||null};if(!b.name)return showToast('Название','error');if(id)await API.put(`/api/admin/commissions/${id}`,b);else await API.post('/api/admin/commissions',b);document.querySelector('.modal-overlay')?.remove();showToast('OK','success');this.loadCommissions();},
  async delCom(id){if(!confirm('Удалить?'))return;await API.del(`/api/admin/commissions/${id}`);showToast('OK','success');this.loadCommissions();},
  async showComMembers(cid,n){
    const[m,all]=await Promise.all([API.get(`/api/admin/commissions/${cid}/members`),API.get(`/api/admin/deputies?${this.dp()}`)]);
    const roleMap = {};
    m.forEach(x => roleMap[x.id] = x.role || 'member');
    const ROLE_LABELS = {chair:'Председатель',vice_chair:'Зам. председателя',member:'Член комиссии'};
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:550px">
      <h3>${esc(n)}</h3>
      <p class="hint-text" style="margin-bottom:12px">Отметьте участников и выберите роль</p>
      <div class="deputy-select-list" id="com-members-list">
        ${all.filter(d=>d.user_type==='deputy').map(d => {
          const checked = d.id in roleMap;
          const role = roleMap[d.id] || 'member';
          return `<div class="com-member-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" class="com-m-cb" value="${d.id}" ${checked?'checked':''} onchange="this.closest('.com-member-row').querySelector('.com-m-role').disabled=!this.checked">
              <span>${esc(d.full_name)} ${d.deputy_role==='head'?'<span class="badge-head">ГСД</span>':''}</span>
            </label>
            <select class="form-control com-m-role" style="width:auto;min-width:140px;font-size:13px" ${checked?'':'disabled'}>
              <option value="member" ${role==='member'?'selected':''}>Член комиссии</option>
              <option value="chair" ${role==='chair'?'selected':''}>Председатель</option>
              <option value="vice_chair" ${role==='vice_chair'?'selected':''}>Зам. председателя</option>
            </select>
          </div>`;
        }).join('')}
      </div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="AdminApp.saveComM(${cid})">Сохранить</button></div></div></div>`);
  },
  async saveComM(cid){
    const rows = document.querySelectorAll('.com-member-row');
    const members = [];
    rows.forEach(row => {
      const cb = row.querySelector('.com-m-cb');
      if (cb && cb.checked) members.push({ id: parseInt(cb.value), role: row.querySelector('.com-m-role').value });
    });
    await API.post(`/api/admin/commissions/${cid}/members`, { members });
    document.querySelector('.modal-overlay')?.remove();
    showToast('OK','success');
    this.loadCommissions();
  },

  // === Events ===
  async loadEvents() {
    const es=await API.get(`/api/admin/events?${this.dp()}`);
    document.getElementById('admin-content').innerHTML=`<div class="card"><div class="card-header"><h2>Мероприятия (${es.length})</h2>
      <div class="flex gap-8">
        <button class="btn btn-outline btn-sm" onclick="AdminApp.createFromFile()">Создать из файла</button>
        <button class="btn btn-primary btn-sm" onclick="AdminApp.showEvtModal()">+ Создать</button>
      </div></div>
      <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Название</th><th>Тип</th><th>Статус</th><th>Уч.</th><th></th></tr></thead>
        <tbody>${es.map(e=>`<tr><td>${formatDateTime(e.event_date)}</td><td>${esc(e.title)}</td>
          <td><span class="event-type-badge badge-${e.event_type}">${EVENT_TYPE_LABELS[e.event_type]}</span></td>
          <td>${e.status==='closed'?'<span class="badge-closed">Завершено</span>':'<span class="badge-planned">Планируется</span>'}</td>
          <td>${e.confirmed_count}/${e.participant_count}</td>
          <td class="actions-cell">
            <button class="btn btn-outline btn-sm" onclick="AdminApp.showEvtDetail(${e.id})">Открыть</button>
            ${e.status!=='closed'?`<button class="btn btn-outline btn-sm" onclick="AdminApp.showEditEvtModal(${e.id})">Редактировать</button><button class="btn btn-warning btn-sm" onclick="AdminApp.remindEvt(${e.id})">Напомнить</button><button class="btn btn-success btn-sm" onclick="AdminApp.closeEvt(${e.id})">Закрыть</button>`:''}
            <button class="btn btn-danger btn-sm" onclick="AdminApp.delEvt(${e.id})">Удалить</button></td></tr>`).join('')}</tbody></table></div></div>`;
  },

  async showEvtModal(editId) {
    this._selectedFiles = [];
    this._initialFileCount = 0;
    this._notificationFromFile = false;
    this._existingSummary = '';
    this._agendaFileDeleted = false;
    const[cs,ds,rooms,tpls,evTypes]=await Promise.all([API.get(`/api/admin/commissions?${this.dp()}`),API.get(`/api/admin/deputies?${this.dp()}`),API.get(`/api/admin/rooms?${this.dp()}`),API.get(`/api/admin/event-templates?${this.dp()}`),API.get(`/api/admin/event-types?${this.dp()}`)]);
    const distName = localStorage.getItem('selectedDistrictName') || '';
    const distClean = distName.replace(/ \(.*\)/, '');

    // Build template options
    const localNames = new Set(tpls.filter(t=>t.district_id).map(t=>t.name));
    const filteredGlobal = tpls.filter(t=>!t.district_id && !localNames.has(t.name));
    const localTpls = tpls.filter(t=>t.district_id);
    const allTpls = [...localTpls, ...filteredGlobal];
    const tplSelect = allTpls.length ? `<select id="ev-tpl" class="form-control" onchange="AdminApp.onTplSelect()">
      <option value="">— Из библиотеки —</option>
      ${localTpls.length?`<optgroup label="Район">${localTpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`:''}
      ${filteredGlobal.length?`<optgroup label="Общие">${filteredGlobal.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`:''}
    </select>` : '';

    const typeSelect = `<select id="ev-tp" class="form-control" onchange="AdminApp.onEvtTp()">
      ${evTypes.map(t=>`<option value="${t.code}" data-days="${t.days_ahead||10}" data-name="${esc(t.name)}">${esc(t.name)}</option>`).join('')}
    </select>`;

    const comSelect = `<select id="ev-c" class="form-control" onchange="AdminApp.onCommissionChange()"><option value="">— Выберите —</option>${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`;

    const defaultRoom = rooms.find(r => r.is_default);
    const roomSelect = rooms.length ? `<select id="ev-room" class="form-control" onchange="AdminApp.onRoomChange()">
      <option value="">— Кабинет —</option>
      ${rooms.map(r=>`<option value="${r.id}" data-name="${esc(r.name)}" data-addr="${esc(r.address||'')}" ${r.is_default?'selected':''}>${esc(r.name)}${r.address?' — '+esc(r.address):''}${r.is_default?' \u2605':''}</option>`).join('')}
      <option value="__new">+ Новый кабинет</option>
    </select>` : '';

    const defDate = new Date(Date.now()+10*86400000).toISOString().split('T')[0];

    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay"><div class="modal evt-modal">

      <div class="evt-header">
        <h3>${editId ? 'Редактировать мероприятие' : 'Новое мероприятие'}</h3>
        <span class="text-tertiary">МО ${distClean}</span>
      </div>

      <div class="evt-form">
        <!-- Row 1: Template + Type + Commission -->
        <div class="evt-row-3">
          ${tplSelect ? `<div class="form-group"><label>Шаблон</label>${tplSelect}</div>` : ''}
          <div class="form-group"><label>Тип</label>${typeSelect}</div>
          <div class="form-group hidden" id="ev-cg"><label>Комиссия</label>${comSelect}</div>
        </div>

        <!-- Row 2: Date + Time -->
        <div class="evt-datetime">
          <div class="form-group"><label>Дата проведения</label>
            <input type="date" id="ev-date" class="form-control evt-date-input" value="${defDate}" onchange="AdminApp.autoTitle()">
          </div>
          <div class="form-group"><label>Время</label>
            <div class="time-options">
              <label class="time-opt"><input type="radio" name="ev-time-r" value="16:00" onchange="document.getElementById('ev-time-inp').classList.add('hidden');AdminApp.autoTitle()"> 16:00</label>
              <label class="time-opt"><input type="radio" name="ev-time-r" value="17:00" onchange="document.getElementById('ev-time-inp').classList.add('hidden');AdminApp.autoTitle()"> 17:00</label>
              <label class="time-opt"><input type="radio" name="ev-time-r" value="18:00" onchange="document.getElementById('ev-time-inp').classList.add('hidden');AdminApp.autoTitle()"> 18:00</label>
              <label class="time-opt"><input type="radio" name="ev-time-r" value="19:00" checked onchange="document.getElementById('ev-time-inp').classList.add('hidden');AdminApp.autoTitle()"> 19:00</label>
              <label class="time-opt"><input type="radio" name="ev-time-r" value="custom" onchange="document.getElementById('ev-time-inp').classList.remove('hidden');AdminApp.autoTitle()"> \u{1F552}</label>
            </div>
            <input type="time" id="ev-time-inp" class="form-control hidden mt-8" value="19:00" onchange="AdminApp.autoTitle()">
          </div>
        </div>

        <!-- Row 3: Title + Location -->
        <div class="evt-row-2">
          <div class="form-group"><label>Название</label><input id="ev-t" class="form-control" value="${evTypes[0]?.name||'Заседание'} СД МО ${distClean}"></div>
          <div class="form-group"><label>Место</label>
            ${roomSelect ? `<div style="margin-bottom:6px">${roomSelect}</div>` : ''}
            <input id="ev-loc" class="form-control" placeholder="Адрес" onchange="AdminApp.updateEvtPreview()">
            <div id="ev-loc-new" class="hidden mt-8">
              <div class="form-row"><div class="form-group" style="flex:1;margin:0"><input id="ev-loc-name" class="form-control" placeholder="Название"></div>
                <div class="form-group" style="flex:1;margin:0"><input id="ev-loc-addr" class="form-control" placeholder="Адрес"></div>
                <button class="btn btn-outline btn-sm" type="button" onclick="AdminApp.addRoom()" style="height:38px">OK</button></div>
            </div>
          </div>
        </div>

        ${!roomSelect ? '<input type="hidden" id="ev-room" value="">' : ''}

        <!-- Main content: 3 columns -->
        <div class="evt-content-3">
          <div>
            <div class="form-group" id="ev-dg"><label>Участники</label>
              <div class="flex gap-8" style="margin-bottom:4px">
                <button class="btn btn-outline btn-sm" onclick="document.querySelectorAll('.ev-dcb').forEach(c=>c.checked=true)">Все</button>
                <button class="btn btn-outline btn-sm" onclick="document.querySelectorAll('.ev-dcb').forEach(c=>c.checked=false)">Никто</button>
              </div>
              <div class="deputy-select-list" style="max-height:200px">${ds.map(d=>`<label class="deputy-select-item"><input type="checkbox" value="${d.id}" class="ev-dcb" checked> ${esc(d.full_name)} ${d.deputy_role==='head'?'<span class="badge-head">ГСД</span>':''} ${d.user_type==='staff'?'<span class="text-tertiary">(сотр.)</span>':''}</label>`).join('')}</div>
            </div>
          </div>

          <div>
            <div class="form-group"><label>Повестка дня</label>
              <div id="ag-list"></div>
              <button class="btn btn-outline btn-sm mt-8" onclick="AdminApp.addAgenda()">+ Пункт</button>
            </div>
            <div class="form-group"><label>Описание</label>
              <textarea id="ev-desc" class="form-control" rows="3" placeholder="Дополнительно..."></textarea>
            </div>
          </div>

          <div>
            <div class="form-group"><label>Документы</label>
              <div id="ev-dropzone" class="dropzone" ondrop="AdminApp.onFileDrop(event)" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')">
                <input type="file" id="ev-f" multiple onchange="AdminApp.onFileSelect()" style="display:none">
                <div class="dropzone-content" onclick="document.getElementById('ev-f').click()">
                  <div style="font-size:20px">\u{1F4CE}</div>
                  <div style="font-size:12px">Перетащите или <span style="color:var(--blue)">выберите</span></div>
                </div>
              </div>
              <div id="ev-existing-files"></div>
              <div id="ev-file-list"></div>
              <div id="ev-ai-analyze" class="hidden mt-8">
                <button class="btn btn-primary btn-sm btn-block" onclick="AdminApp.analyzeFiles()">\u2714 Проанализировать добавленные документы</button>
              </div>
            </div>
            <div id="ev-ai-summary" class="hidden">
              <div class="card" style="background:var(--blue-light);padding:12px">
                <div style="font-weight:600;font-size:12px;margin-bottom:4px">\u{1F916} Анализ документов</div>
                <div id="ev-ai-summary-text" style="font-size:12px;white-space:pre-wrap;line-height:1.4;max-height:150px;overflow-y:auto"></div>
                <label class="pref-item" style="border:none;padding:6px 0 0;font-size:12px"><span>Показать анализ депутатам</span><input type="checkbox" id="ev-show-ai" checked></label>
              </div>
            </div>
          </div>
        </div>

        <!-- Preview -->
        <div class="form-group mt-16"><label>Текст уведомления <span class="text-tertiary">(можно редактировать)</span></label>
          <textarea id="ev-preview" class="form-control" rows="6" style="font-size:13px;line-height:1.5"></textarea>
        </div>

        <!-- Bottom bar -->
        <div class="evt-bottom">
          <label class="pref-item" style="border:none;padding:0;flex:1;font-size:13px"><input type="checkbox" id="ev-email" checked> Отправить уведомление на email с файлами</label>
          ${this.staffMode ? `<select id="ev-sender" class="form-control" style="width:auto;flex:0 0 auto;font-size:13px"><option value="system" ${!this._staffSmtpEnabled?'selected':''}>Системная</option><option value="staff" ${this._staffSmtpEnabled?'selected':''}>Моя почта</option></select>` : ''}
          <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
          <button class="btn btn-primary" onclick="AdminApp.saveEvt(${editId||'null'})">${editId ? 'Сохранить' : 'Создать и отправить'}</button>
        </div>
      </div>
    </div></div>`);

    this._evtTemplates = tpls;
    // Auto-fill default room address
    if (defaultRoom) {
      const loc = defaultRoom.address ? `${defaultRoom.address}, ${defaultRoom.name}` : defaultRoom.name;
      document.getElementById('ev-loc').value = loc;
    }
    // Auto-generate preview on changes
    ['ev-tp','ev-t','ev-date','ev-room'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => AdminApp.updateEvtPreview());
    });
    // If editing — prefill form with existing event data
    if (editId) {
      const ev = await API.get(`/api/admin/events/${editId}`);
      if (ev) {
        document.getElementById('ev-t').value = ev.title || '';
        document.getElementById('ev-desc').value = ev.description || '';
        document.getElementById('ev-loc').value = ev.location || '';
        if (ev.event_type) { const tp = document.getElementById('ev-tp'); if (tp) tp.value = ev.event_type; }
        if (ev.event_type === 'commission') {
          const cg = document.getElementById('ev-cg'); if (cg) cg.classList.remove('hidden');
          const cm = document.getElementById('ev-c'); if (cm && ev.commission_id) cm.value = ev.commission_id;
        }
        if (ev.event_date) {
          const [d, t] = ev.event_date.split('T');
          document.getElementById('ev-date').value = d;
          const timeStr = t ? t.substring(0, 5) : '19:00';
          const radios = document.querySelectorAll('input[name="ev-time-r"]');
          let matched = false;
          radios.forEach(r => { if (r.value === timeStr) { r.checked = true; matched = true; } });
          if (!matched) {
            radios.forEach(r => { if (r.value === 'custom') r.checked = true; });
            const ti = document.getElementById('ev-time-inp');
            if (ti) { ti.value = timeStr; ti.classList.remove('hidden'); }
          }
        }
        // Uncheck all, then check only current participants
        document.querySelectorAll('.ev-dcb').forEach(cb => cb.checked = false);
        if (ev.participants) ev.participants.forEach(p => {
          const cb = document.querySelector(`.ev-dcb[value="${p.id}"]`);
          if (cb) cb.checked = true;
        });
        // Fill agenda
        const agList = document.getElementById('ag-list');
        if (agList && ev.agenda_items && ev.agenda_items.length) {
          agList.innerHTML = '';
          ev.agenda_items.forEach(a => {
            agList.insertAdjacentHTML('beforeend', `<div class="agenda-item"><input class="form-control ag-t" value="${a.title.replace(/"/g,'&quot;')}" style="margin-bottom:4px"><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" style="position:absolute;right:4px;top:4px">&#x2716;</button></div>`);
          });
        }
        // Show existing files
        if (ev.files && ev.files.length) {
          const fileList = document.getElementById('ev-existing-files');
          if (fileList) {
            const icons = {doc:'&#x1F4C4;',docx:'&#x1F4C4;',xls:'&#x1F4CA;',xlsx:'&#x1F4CA;',pdf:'&#x1F4D5;',photo:'&#x1F4F7;',audio:'&#x1F3A4;'};
            fileList.innerHTML = `<div style="margin-top:8px"><div style="font-size:12px;font-weight:600;margin-bottom:6px">Прикреплённые файлы:</div><div class="file-chips">${ev.files.map(f => {
              const ext = f.original_name.split('.').pop().toUpperCase();
              const icon = icons[ext.toLowerCase()] || (f.file_type==='photo'?'&#x1F4F7;':f.file_type==='audio'?'&#x1F3A4;':'&#x1F4CE;');
              return `<div class="file-chip" title="${esc(f.original_name)}">
                <button class="file-chip-remove" onclick="event.stopPropagation();AdminApp.deleteEventFile(${editId},${f.id},this)">&#x2716;</button>
                <a href="/uploads/${f.filename}" target="_blank" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;align-items:center">
                  <div class="file-chip-icon">${icon}</div>
                  <div class="file-chip-ext">${ext}</div>
                  <div class="file-chip-name">${esc(f.original_name.length>18?f.original_name.substring(0,15)+'...':f.original_name)}</div>
                </a>
              </div>`;
            }).join('')}</div></div>`;
          }
        }
        // Show existing AI summary
        if (ev.ai_summary) {
          this._existingSummary = ev.ai_summary;
          document.getElementById('ev-ai-summary').classList.remove('hidden');
          document.getElementById('ev-ai-summary-text').textContent = ev.ai_summary;
        }
      }
    }
    this.updateEvtPreview();
  },

  _existingSummary: '',

  onRoomChange() {
    const sel = document.getElementById('ev-room');
    if (!sel) return;
    const opt = sel.options[sel.selectedIndex];
    if (sel.value === '__new') {
      document.getElementById('ev-loc-new').classList.remove('hidden');
      document.getElementById('ev-loc').value = '';
    } else {
      document.getElementById('ev-loc-new').classList.add('hidden');
      if (sel.value) {
        const name = opt.dataset.name || '';
        const addr = opt.dataset.addr || '';
        document.getElementById('ev-loc').value = addr ? `${addr}, ${name}` : name;
      }
    }
    this.updateEvtPreview();
  },

  _prevDate: '', _prevTime: '', _prevLoc: '',

  updateEvtPreview() {
    const el = document.getElementById('ev-preview');
    if (!el) return;

    const title = document.getElementById('ev-t')?.value || '';
    const date = document.getElementById('ev-date')?.value || '';
    const timeRadio = document.querySelector('input[name="ev-time-r"]:checked')?.value || '19:00';
    const time = timeRadio === 'custom' ? (document.getElementById('ev-time-inp')?.value || '19:00') : timeRadio;
    const locValue = document.getElementById('ev-loc')?.value || '';
    const dateStr = date ? new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '__.__.____';

    if (this._notificationFromFile && el.value) {
      // Text from file — only replace date/time/location in existing text
      let text = el.value;
      if (this._prevDate && dateStr !== this._prevDate) {
        text = text.replace(this._prevDate, dateStr);
      }
      if (this._prevTime && time !== this._prevTime) {
        text = text.replace(new RegExp('в ' + this._prevTime.replace(':','\\:'), 'g'), 'в ' + time);
        text = text.replace(this._prevTime, time);
      }
      if (this._prevLoc && locValue && locValue !== this._prevLoc) {
        text = text.replace(this._prevLoc, locValue);
      }
      el.value = text;
    } else {
      // Standard template
      let preview = `Добрый день!\n\nУведомляем вас, что ${dateStr} в ${time}${locValue ? ` по адресу: ${locValue}` : ''} состоится:\n${title}\n\nПрошу подтвердить получение и ваше участие.`;
      if (this._staffSignature) preview += `\n\n${this._staffSignature}`;
      el.value = preview;
    }

    this._prevDate = dateStr;
    this._prevTime = time;
    this._prevLoc = locValue;
  },

  _selectedFiles: [],
  _notificationFromFile: false,

  onFileDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files);
    this._selectedFiles.push(...files);
    this.renderFileList();
  },

  onFileSelect() {
    const input = document.getElementById('ev-f');
    this._selectedFiles.push(...Array.from(input.files));
    this.renderFileList();
  },

  _initialFileCount: 0, // files loaded from "create from file"

  renderFileList() {
    const list = document.getElementById('ev-file-list');
    const btn = document.getElementById('ev-ai-analyze');
    if (!this._selectedFiles.length) { list.innerHTML = ''; btn?.classList.add('hidden'); return; }
    // Show analyze button only if NEW files added (beyond initial from "create from file")
    const hasNewFiles = this._selectedFiles.length > this._initialFileCount;
    list.innerHTML = `<div class="file-chips mt-8">${this._selectedFiles.map((f, i) => {
      const ext = f.name.split('.').pop().toUpperCase();
      const icon = f.name.match(/\.(doc|docx)$/i)?'&#x1F4C4;':f.name.match(/\.(xls|xlsx)$/i)?'&#x1F4CA;':f.name.match(/\.(pdf)$/i)?'&#x1F4D5;':'&#x1F4CE;';
      const shortName = f.name.length > 18 ? f.name.substring(0, 15) + '...' : f.name;
      return `<div class="file-chip" title="${esc(f.name)}">
        <button class="file-chip-remove" onclick="event.stopPropagation();AdminApp.removeFile(${i})">&#x2716;</button>
        <div class="file-chip-icon">${icon}</div>
        <div class="file-chip-ext">${ext}</div>
        <div class="file-chip-name">${shortName}</div>
      </div>`;
    }).join('')}</div>`;
    if (hasNewFiles) btn?.classList.remove('hidden'); else btn?.classList.add('hidden');
  },

  removeFile(i) {
    this._selectedFiles.splice(i, 1);
    this.renderFileList();
  },

  async analyzeFiles() {
    if (!this._selectedFiles.length) return showToast('Нет файлов', 'error');
    const btn = document.querySelector('#ev-ai-analyze button');
    btn.disabled = true;
    const analyzeSteps = ['Загрузка файлов...', 'Извлечение текста...', 'OCR распознавание...', 'Анализ через ИИ...', 'Извлечение повестки...'];
    let aStep = 0;
    btn.textContent = analyzeSteps[0];
    const aInterval = setInterval(() => { aStep++; if (aStep < analyzeSteps.length) btn.textContent = analyzeSteps[aStep]; }, 3000);

    const fd = new FormData();
    for (const f of this._selectedFiles) fd.append('files', f);
    fd.append('title', document.getElementById('ev-t').value);
    fd.append('agenda', Array.from(document.querySelectorAll('.ag-t')).filter(i=>i.value).map(i=>i.value).join(', '));

    try {
      const r = await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', '/api/admin/ai/analyze-files');
        if (API.token) x.setRequestHeader('Authorization', 'Bearer ' + API.token);
        x.timeout = 120000;
        x.onload = function() { try { resolve(JSON.parse(x.responseText)); } catch(e) { reject(new Error(x.responseText.substring(0,100))); } };
        x.onerror = function() { reject(new Error('Сетевая ошибка')); };
        x.ontimeout = function() { reject(new Error('Таймаут — файлы слишком большие или сервер занят')); };
        x.send(fd);
      });

      // Show summary only if there's actual content
      if (r.error) { showToast(r.error, 'error'); return; }
      if (!r.summary && (!r.agenda_items || !r.agenda_items.length)) { showToast('ИИ не нашёл данных в файлах', 'error'); return; }
      document.getElementById('ev-ai-summary').classList.remove('hidden');
      const newSummary = r.summary || '';
      if (this._existingSummary && newSummary) {
        this._existingSummary = this._existingSummary + '\n\n--- Дополнение ---\n' + newSummary;
      } else if (newSummary) {
        this._existingSummary = newSummary;
      }
      document.getElementById('ev-ai-summary-text').textContent = this._existingSummary || 'Анализ не содержит данных';

      // Auto-fill agenda if empty or agenda file was replaced
      const existingAgenda = document.querySelectorAll('.ag-t');
      const shouldFillAgenda = !existingAgenda.length || this._agendaFileDeleted;
      if (r.agenda_items && r.agenda_items.length && shouldFillAgenda) {
        this._agendaFileDeleted = false;
        const agList = document.getElementById('ag-list');
        agList.innerHTML = '';
        r.agenda_items.forEach((item, i) => {
          agList.insertAdjacentHTML('beforeend', `<div class="agenda-item"><input class="form-control ag-t" value="${item.replace(/"/g, '&quot;')}" style="margin-bottom:4px"><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" style="position:absolute;right:4px;top:4px">&#x2716;</button></div>`);
        });
        showToast(`Найдено ${r.agenda_items.length} пунктов повестки`, 'success');
      } else {
        showToast('Анализ завершён', 'success');
      }
    } catch (e) {
      showToast(e.message || 'Ошибка анализа', 'error');
    }
    clearInterval(aInterval);
    btn.disabled = false; btn.textContent = '\u2714 Проанализировать добавленные документы';
  },

  createFromFile() {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal">
      <h3>Создать мероприятие из файла</h3>
      <p class="hint-text">Загрузите документ (письмо, приглашение, повестку) — ИИ проанализирует его и автоматически заполнит все поля мероприятия: название, дату, время, место, повестку.</p>
      <div class="form-group">
        <div class="dropzone" id="cff-drop" ondrop="AdminApp.onCffDrop(event)" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')">
          <input type="file" id="cff-file" accept=".doc,.docx,.txt,.pdf,.xlsx,.xls,.csv,.pptx,.html,.rtf,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tiff" style="display:none" onchange="AdminApp.processCffFile()">
          <div class="dropzone-content" onclick="document.getElementById('cff-file').click()">
            <div style="font-size:24px">\u{1F4C4}</div>
            <div>Перетащите файл или <span style="color:var(--blue)">выберите</span></div>
            <div class="text-tertiary mt-8">Word, PDF, Excel, PowerPoint, изображения, текст</div>
          </div>
        </div>
      </div>
      <div id="cff-status"></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button></div>
    </div></div>`);
  },

  onCffDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) { this._cffFile = file; this.processCffFile(); }
  },

  async processCffFile() {
    const file = this._cffFile || document.getElementById('cff-file')?.files?.[0];
    if (!file) return;
    this._cffFile = file;

    const status = document.getElementById('cff-status');
    const steps = [
      'Загрузка файла на сервер...',
      'Извлечение текста из документа...',
      'Распознавание содержимого (OCR)...',
      'Это может занять до минуты...',
      'Анализ текста через ИИ...',
      'Извлечение данных...',
      'Формирование мероприятия...',
      'Почти готово, ещё немного...',
      'Завершаем обработку...'
    ];
    let stepIdx = 0;
    status.innerHTML = `<div class="cff-progress"><div class="cff-spinner"></div><p id="cff-step">${steps[0]}</p></div>`;
    const stepInterval = setInterval(() => {
      stepIdx++;
      const el = document.getElementById('cff-step');
      if (el && stepIdx < steps.length) el.textContent = steps[stepIdx];
    }, 6000);

    const fd = new FormData();
    fd.append('file', file);

    try {
      const r = await API.upload('/api/admin/ai/create-from-file', fd);

      clearInterval(stepInterval);
      document.querySelector('.modal-overlay')?.remove();

      // Open event creation form with pre-filled data
      await this.showEvtModal();

      // Fill in parsed data
      setTimeout(() => {
        // Title
        if (r.title) document.getElementById('ev-t').value = r.title;

        // Date
        if (r.event_date) document.getElementById('ev-date').value = r.event_date;

        // Time
        if (r.event_time) {
          const radio = document.querySelector(`input[name="ev-time-r"][value="${r.event_time}"]`);
          if (radio) { radio.checked = true; document.getElementById('ev-time-inp').classList.add('hidden'); }
          else {
            const custom = document.querySelector('input[name="ev-time-r"][value="custom"]');
            if (custom) { custom.checked = true; document.getElementById('ev-time-inp').classList.remove('hidden'); document.getElementById('ev-time-inp').value = r.event_time; }
          }
        }

        // Type
        if (r.event_type) {
          const sel = document.getElementById('ev-tp');
          for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].value === r.event_type) { sel.selectedIndex = i; break; } }
        }

        // Location — write to text field, do NOT select from room dropdown
        if (r.location) {
          document.getElementById('ev-loc').value = r.location;
          const roomSel = document.getElementById('ev-room');
          if (roomSel) roomSel.selectedIndex = 0; // reset to "— Кабинет —"
        }

        // Description
        if (r.description) document.getElementById('ev-desc').value = r.description;

        // Agenda
        if (r.agenda_items?.length) {
          const agList = document.getElementById('ag-list');
          r.agenda_items.forEach(item => {
            agList.insertAdjacentHTML('beforeend', `<div class="agenda-item"><input class="form-control ag-t" value="${item.replace(/"/g,'&quot;')}" style="margin-bottom:4px"><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" style="position:absolute;right:4px;top:4px">\u2716</button></div>`);
          });
        }

        // Participants — match by mentioned names
        if (r.mentioned_names?.length) {
          const names = r.mentioned_names.map(n => n.toLowerCase());
          document.querySelectorAll('.ev-dcb').forEach(cb => {
            const label = cb.parentElement.textContent.toLowerCase();
            const matched = names.some(n => label.includes(n));
            cb.checked = matched;
          });
        } else {
          // No names found — uncheck all, user picks manually
          document.querySelectorAll('.ev-dcb').forEach(cb => cb.checked = false);
        }

        // Notification text — use AI-generated, don't overwrite with template
        this._notificationFromFile = !!r.notification_text;
        // Remember initial values for smart replace
        const curDate = document.getElementById('ev-date')?.value || '';
        const curTimeR = document.querySelector('input[name="ev-time-r"]:checked')?.value || '19:00';
        const curTime = curTimeR === 'custom' ? (document.getElementById('ev-time-inp')?.value || '19:00') : curTimeR;
        this._prevDate = curDate ? new Date(curDate).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
        this._prevTime = curTime;
        this._prevLoc = document.getElementById('ev-loc')?.value || '';
        if (r.notification_text) {
          const preview = document.getElementById('ev-preview');
          if (preview) {
            let text = r.notification_text;
            if (this._staffSignature) text += '\n\n' + this._staffSignature;
            preview.value = text;
          }
        } else {
          this.updateEvtPreview();
        }

        // Add original file (mark as initial — no analyze button needed)
        if (r.file) {
          this._selectedFiles.push(file);
          this._initialFileCount = this._selectedFiles.length;
          this.renderFileList();
        }

        // If date or time not found — ask user
        if (!r.event_date || !r.event_time) {
          const missing = [];
          if (!r.event_date) missing.push('дата');
          if (!r.event_time) missing.push('время');
          document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" style="z-index:300" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:400px">
            <h3>Не удалось распознать</h3>
            <p class="text-sm text-gray mb-16">Из документа не удалось извлечь: <strong>${missing.join(', ')}</strong>. Пожалуйста, укажите вручную.</p>
            ${!r.event_date ? `<div class="form-group"><label>Дата мероприятия</label><input type="date" id="cff-fix-date" class="form-control"></div>` : ''}
            ${!r.event_time ? `<div class="form-group"><label>Время</label><input type="time" id="cff-fix-time" class="form-control" value="19:00"></div>` : ''}
            <div class="modal-actions"><button class="btn btn-primary" onclick="AdminApp.applyCffFix()">Применить</button></div>
          </div></div>`);
        } else {
          showToast('Данные из файла заполнены. Проверьте и отправьте.', 'success');
        }
      }, 300);
    } catch (e) {
      clearInterval(stepInterval);
      status.innerHTML = `<p style="color:var(--red)">${e.message || 'Ошибка анализа'}</p>`;
    }
  },

  applyCffFix() {
    const dateEl = document.getElementById('cff-fix-date');
    const timeEl = document.getElementById('cff-fix-time');
    if (dateEl?.value) document.getElementById('ev-date').value = dateEl.value;
    if (timeEl?.value) {
      const radio = document.querySelector(`input[name="ev-time-r"][value="${timeEl.value}"]`);
      if (radio) { radio.checked = true; document.getElementById('ev-time-inp').classList.add('hidden'); }
      else {
        const custom = document.querySelector('input[name="ev-time-r"][value="custom"]');
        if (custom) { custom.checked = true; document.getElementById('ev-time-inp').classList.remove('hidden'); document.getElementById('ev-time-inp').value = timeEl.value; }
      }
    }
    document.querySelector('.modal-overlay[style*="z-index:300"]')?.remove();
    this.updateEvtPreview();
    showToast('Данные заполнены. Проверьте и отправьте.', 'success');
  },

  onTplSelect() {
    const sel = document.getElementById('ev-tpl');
    if (sel.value) this.applyTemplate(parseInt(sel.value));
  },

  applyTemplate(id) {
    const t = this._evtTemplates?.find(x => x.id === id);
    if (!t) return;
    document.getElementById('ev-t').value = t.name;
    document.getElementById('ev-tp').value = t.event_type;
    // Set date based on days_ahead
    const days = t.days_ahead || 10;
    document.getElementById('ev-date').value = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
    // Set time radio
    const timeRadio = document.querySelector(`input[name="ev-time-r"][value="${t.default_time}"]`);
    if (timeRadio) { timeRadio.checked = true; document.getElementById('ev-time-inp').classList.add('hidden'); }
    else { document.querySelector('input[name="ev-time-r"][value="custom"]').checked = true; document.getElementById('ev-time-inp').classList.remove('hidden'); document.getElementById('ev-time-inp').value = t.default_time; }
    // Highlight active tab
    document.querySelectorAll('[data-tpl-id]').forEach(b => b.classList.toggle('active', b.dataset.tplId == id));
    this.onEvtTp();
    this.updateEvtPreview();
    showToast(`${esc(t.name)} — дата через ${days} дн.`, 'success');
  },

  async onEvtTp(){
    const sel=document.getElementById('ev-tp');
    const t=sel.value;
    const opt=sel.options[sel.selectedIndex];
    document.getElementById('ev-cg').classList.toggle('hidden',t!=='commission');
    // Participants always visible
    // Auto-set date based on days_ahead
    const days = parseInt(opt.dataset.days) || 10;
    document.getElementById('ev-date').value = new Date(Date.now()+days*86400000).toISOString().split('T')[0];
    // If commission — set time to 18:00; otherwise all deputies checked
    if (t === 'commission') {
      const r18 = document.querySelector('input[name="ev-time-r"][value="18:00"]');
      if (r18) r18.checked = true;
    } else {
      document.querySelectorAll('.ev-dcb').forEach(c => c.checked = true);
    }
    this.autoTitle();
    this.updateEvtPreview();
  },

  async onCommissionChange() {
    const comId = document.getElementById('ev-c')?.value;
    if (!comId) return;
    // Get commission members
    try {
      const members = await API.get(`/api/admin/commissions/${comId}/members`);
      const memberIds = new Set(members.map(m => m.id));
      document.querySelectorAll('.ev-dcb').forEach(cb => {
        cb.checked = memberIds.has(parseInt(cb.value));
      });
    } catch(e) {}
  },

  autoTitle() {
    const sel=document.getElementById('ev-tp');
    const opt=sel.options[sel.selectedIndex];
    const typeName = opt.dataset.name || opt.text;
    const date = document.getElementById('ev-date').value;
    const timeRadio = document.querySelector('input[name="ev-time-r"]:checked')?.value || '19:00';
    const time = timeRadio === 'custom' ? (document.getElementById('ev-time-inp')?.value || '19:00') : timeRadio;
    const dateStr = date ? new Date(date).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';
    const distName = localStorage.getItem('selectedDistrictName')?.replace(/ \(.*\)/,'') || '';
    document.getElementById('ev-t').value = `${typeName} СД МО ${distName}`.trim();
    this.updateEvtPreview();
  },
  addAgenda(){const l=document.getElementById('ag-list');l.insertAdjacentHTML('beforeend',`<div class="agenda-item"><input class="form-control ag-t" placeholder="Пункт ${l.children.length+1}" style="margin-bottom:4px"><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" style="position:absolute;right:4px;top:4px">&#x2716;</button></div>`);},

  saveEvt(editId) {
    var tp = document.getElementById('ev-tp');
    var evType = tp ? tp.value : 'regular';
    if (!evType) evType = 'regular';
    var loc = document.getElementById('ev-loc');
    var location = loc ? loc.value : '';
    var dateEl = document.getElementById('ev-date');
    var date = dateEl ? dateEl.value : '';
    var timeRadio = document.querySelector('input[name="ev-time-r"]:checked');
    var timeVal = timeRadio ? timeRadio.value : '19:00';
    if (timeVal === 'custom') {
      var timeInp = document.getElementById('ev-time-inp');
      timeVal = timeInp ? timeInp.value : '19:00';
    }
    var titleEl = document.getElementById('ev-t');
    var title = titleEl ? titleEl.value : '';
    var descEl = document.getElementById('ev-desc');
    var desc = descEl ? descEl.value : '';

    if (!title) { showToast('Укажите название', 'error'); return; }
    if (!date) { showToast('Укажите дату', 'error'); return; }

    var eventDate = date + 'T' + timeVal;
    var agendaEls = document.querySelectorAll('.ag-t');
    var agenda = [];
    for (var i = 0; i < agendaEls.length; i++) {
      if (agendaEls[i].value) agenda.push({ title: agendaEls[i].value });
    }

    var deputyCbs = document.querySelectorAll('.ev-dcb:checked');
    var deputyIds = [];
    for (var i = 0; i < deputyCbs.length; i++) {
      deputyIds.push(parseInt(deputyCbs[i].value));
    }

    var body = {
      title: title,
      description: desc,
      event_type: evType,
      event_date: eventDate,
      location: location,
      district_id: this.selectedDistrict || null,
      agenda_items: agenda,
      send_email: document.getElementById('ev-email') ? document.getElementById('ev-email').checked : true,
      send_as_staff: document.getElementById('ev-sender') ? document.getElementById('ev-sender').value === 'staff' : false
    };

    if (evType === 'commission') {
      var comEl = document.getElementById('ev-c');
      body.commission_id = comEl ? parseInt(comEl.value) : null;
      if (!body.commission_id) { showToast('Выберите комиссию', 'error'); return; }
    } else {
      body.deputy_ids = deputyIds;
      if (!deputyIds.length) { showToast('Выберите участников', 'error'); return; }
    }

    var previewEl = document.getElementById('ev-preview');
    if (previewEl) body.custom_notification = previewEl.value;

    // Send via XMLHttpRequest (bypass Service Worker)
    var self = this;
    var xhr = new XMLHttpRequest();
    var isEdit = !!editId;
    xhr.open(isEdit ? 'PUT' : 'POST', isEdit ? '/api/admin/events/' + editId : '/api/admin/events');
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (API.token) xhr.setRequestHeader('Authorization', 'Bearer ' + API.token);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        var result;
        try { result = JSON.parse(xhr.responseText); } catch(e) { showToast('Ошибка ответа сервера', 'error'); return; }
        var evId = isEdit ? editId : result.id;
        // Update agenda for edit
        if (isEdit) {
          var xhr5 = new XMLHttpRequest();
          xhr5.open('POST', '/api/admin/events/' + evId + '/agenda');
          xhr5.setRequestHeader('Content-Type', 'application/json');
          if (API.token) xhr5.setRequestHeader('Authorization', 'Bearer ' + API.token);
          xhr5.send(JSON.stringify({ items: body.agenda_items }));
          // Update participants
          if (body.deputy_ids) {
            var xhr6 = new XMLHttpRequest();
            xhr6.open('POST', '/api/admin/events/' + evId + '/participants');
            xhr6.setRequestHeader('Content-Type', 'application/json');
            if (API.token) xhr6.setRequestHeader('Authorization', 'Bearer ' + API.token);
            xhr6.send(JSON.stringify({ deputy_ids: body.deputy_ids }));
          }
        }
        // Upload files if any
        if (self._selectedFiles && self._selectedFiles.length && evId) {
          var fd = new FormData();
          for (var i = 0; i < self._selectedFiles.length; i++) fd.append('files', self._selectedFiles[i]);
          var xhr2 = new XMLHttpRequest();
          xhr2.open('POST', '/api/admin/events/' + evId + '/files');
          if (API.token) xhr2.setRequestHeader('Authorization', 'Bearer ' + API.token);
          xhr2.send(fd);
        }
        // Save AI summary
        var aiText = document.getElementById('ev-ai-summary-text');
        var showAi = document.getElementById('ev-show-ai');
        if (aiText && aiText.textContent && (!showAi || showAi.checked)) {
          var xhr3 = new XMLHttpRequest();
          xhr3.open('POST', '/api/admin/events/' + evId + '/ai-summary');
          xhr3.setRequestHeader('Content-Type', 'application/json');
          if (API.token) xhr3.setRequestHeader('Authorization', 'Bearer ' + API.token);
          xhr3.send(JSON.stringify({ summary: aiText.textContent }));
        }
        self._selectedFiles = [];
        self._notificationFromFile = false;
        var overlay = document.querySelector('.modal-overlay');
        if (overlay) overlay.remove();
        showToast(isEdit ? 'Мероприятие обновлено' : 'Мероприятие создано', 'success');
        self.loadEvents();
      } else if (xhr.status === 0) {
        showToast('Нет связи с сервером', 'error');
      } else {
        var errMsg = 'Ошибка ' + xhr.status;
        try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch(e) {}
        showToast(errMsg, 'error');
      }
    };
    xhr.onerror = function() { showToast('Сетевая ошибка', 'error'); };
    xhr.timeout = 30000;
    xhr.ontimeout = function() { showToast('Сервер не отвечает', 'error'); };
    xhr.send(JSON.stringify(body));
    showToast('Отправка...', 'info');
  },

  async showEvtDetail(eid) {
    const e=await API.get(`/api/admin/events/${eid}`);
    const photos=e.files.filter(f=>f.file_type==='photo'), docs=e.files.filter(f=>f.file_type==='document'), audio=e.files.filter(f=>f.file_type==='audio');
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:650px">
      <h3>${esc(e.title)} ${e.status==='closed'?'<span class="badge-closed">Завершено</span>':''}</h3>
      <div class="event-meta"><div><strong>Дата:</strong> ${formatDateTime(e.event_date)}</div>${e.location?`<div><strong>Место:</strong> ${esc(e.location)}</div>`:''}</div>
      ${e.description?`<div class="event-description">${esc(e.description)}</div>`:''}
      ${e.ai_summary?`<div class="card" style="background:#e8eaf6"><strong>&#x1F916; Саммари:</strong><p>${esc(e.ai_summary)}</p></div>`:''}
      ${e.audio_transcription?`<div class="card" style="background:#fff3e0"><strong>&#x1F399; Расшифровка:</strong><p style="white-space:pre-wrap;max-height:200px;overflow-y:auto">${esc(e.audio_transcription)}</p></div>`:''}
      ${e.agenda_items.length?`<h4>Повестка</h4><ol>${e.agenda_items.map(a=>`<li>${esc(a.title)}</li>`).join('')}</ol>`:''}
      ${docs.length?`<div class="event-files"><strong>Документы:</strong>${docs.map(f=>`<a href="/uploads/${f.filename}" target="_blank">&#x1F4CE; ${esc(f.original_name)}</a>`).join('')}</div>`:''}
      ${photos.length?`<div><strong>Фото (${photos.length}):</strong><div class="photo-grid">${photos.map(f=>`<a href="/uploads/${f.filename}" target="_blank"><img src="/uploads/${f.filename}" loading="lazy"></a>`).join('')}</div></div>`:''}
      ${audio.length?`<div class="event-files"><strong>Аудио:</strong>${audio.map(f=>`<a href="/uploads/${f.filename}" target="_blank">&#x1F3A4; ${esc(f.original_name)}</a>`).join('')}</div>`:''}
      <h4 style="margin:12px 0 8px">Участники (${e.participants.length})</h4>
      <p class="field-hint">Если депутат не смог отметиться — отметьте вручную кнопками</p>
      <div class="participants-list">${e.participants.sort((a,b)=>{const o={head:0,vice_head:1};return (o[a.deputy_role]??2)-(o[b.deputy_role]??2)||a.full_name.localeCompare(b.full_name)}).map(p=>`<div class="participant-row">
        <span>${esc(p.full_name)} ${p.deputy_role==='head'?'<span class="badge-head">Глава СД</span>':''} ${p.user_type==='staff'?'<span class="text-gray">(сотр.)</span>':''}</span>
        <div class="flex gap-8" style="align-items:center">
          <span class="status-${p.status}">${STATUS_LABELS[p.status]}</span>
          ${e.status!=='closed'&&p.status!=='confirmed'?`<button class="btn btn-success btn-sm" onclick="AdminApp.markAttendance(${eid},${p.id},'confirmed')">Был</button>`:''}
          ${e.status!=='closed'&&p.status!=='declined'?`<button class="btn btn-danger btn-sm" onclick="AdminApp.markAttendance(${eid},${p.id},'declined')">Не был</button>`:''}
        </div>
      </div>`).join('')}</div>
      ${e.status==='closed' && e.participants.some(p=>p.ai_post_text) ? `<details style="margin-top:16px"><summary style="font-weight:600;cursor:pointer;padding:4px 0">Посты депутатов (${e.participants.filter(p=>p.ai_post_text).length})</summary>
        ${e.participants.filter(p=>p.ai_post_text).map(p=>`<div class="card mt-8" style="background:var(--green-light)">
          <div style="font-weight:600;margin-bottom:4px">${esc(p.full_name)}</div>
          <p style="white-space:pre-wrap;font-size:13px;line-height:1.5">${esc(p.ai_post_text)}</p>
        </div>`).join('')}</details>` : ''}
      <hr style="margin:16px 0">
      <h4>Действия</h4>
      <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
        ${e.status!=='closed' ? `
          <button class="btn btn-outline btn-sm" onclick="document.querySelector('.modal-overlay').remove();AdminApp.showEditEvtModal(${eid})">Редактировать</button>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.editParticipants(${eid})">Участники</button>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.uploadPhotos(${eid})">Загрузить фото</button>
          <button class="btn btn-outline btn-sm" onclick="document.querySelector('.modal-overlay').remove();AdminApp.showRecorder(${eid})">Записать аудио</button>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.showBlockEditor(${eid})">Блок для депутатов</button>
          <button class="btn btn-warning btn-sm" onclick="AdminApp.remindEvt(${eid})">Напомнить всем</button>
          <button class="btn btn-success btn-sm" onclick="document.querySelector('.modal-overlay').remove();AdminApp.closeEvt(${eid})">Закрыть заседание</button>
        ` : `
          <button class="btn btn-outline btn-sm" onclick="AdminApp.uploadPhotos(${eid})">Добавить фото</button>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.uploadAudioFile(${eid})">Добавить аудио</button>
          ${e.audio_transcription ? '' : `<button class="btn btn-outline btn-sm" onclick="document.querySelector('.modal-overlay').remove();AdminApp.showRecorder(${eid})">Записать аудио</button>`}
        `}
      </div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть окно</button></div></div></div>`);
  },

  uploadPhotos(eid) {
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Загрузить фото</h3>
      <input type="file" id="up-ph" multiple accept="image/*"><div class="modal-actions"><button class="btn btn-primary" onclick="AdminApp.doUpPhotos(${eid})">Загрузить</button><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button></div></div></div>`);
  },
  uploadAudioFile(eid) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Добавить аудиозапись</h3>
      <div class="form-group"><input type="file" id="up-audio" accept="audio/*,.mp3,.wav,.ogg,.m4a,.webm"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="AdminApp.doUpAudio(${eid})">Загрузить</button>
      </div></div></div>`);
  },

  async doUpAudio(eid) {
    const fi = document.getElementById('up-audio');
    if (!fi.files.length) return showToast('Выберите файл', 'error');
    const fd = new FormData();
    fd.append('files', fi.files[0]);
    await API.upload(`/api/admin/events/${eid}/files?type=audio`, fd);
    document.querySelector('.modal-overlay')?.remove();
    showToast('Аудио загружено', 'success');
    this.showEvtDetail(eid);
  },

  async deleteEventFile(eid,fid,btn){
    if(!confirm('Удалить файл?'))return;
    const name = btn.closest('.file-chip')?.getAttribute('title')||'';
    await API.del(`/api/admin/events/${eid}/files/${fid}`);
    btn.closest('.file-chip').remove();
    if (/повестк/i.test(name)) this._agendaFileDeleted = true;
    showToast('Файл удалён','success');
  },
  async doUpPhotos(eid){const fi=document.getElementById('up-ph');if(!fi.files.length)return;const fd=new FormData();for(const f of fi.files)fd.append('files',f);await API.upload(`/api/admin/events/${eid}/files?type=photo`,fd);showToast('Загружено','success');document.querySelector('.modal-overlay')?.remove();},

  // === Recorder ===
  _mediaRecorder: null, _audioChunks: [], _recognition: null, _transcript: '',

  showRecorder(eid) {
    document.getElementById('admin-content').innerHTML=`<div class="card"><h2>&#x1F399; Диктофон</h2>
      <p class="hint-text">Записывайте аудио заседания прямо в браузере. Во время записи работает автоматическое распознавание речи (на русском языке). После остановки аудио сохраняется к мероприятию, а расшифровку можно отредактировать. Если настроен DeepSeek — текст автоматически очищается от ошибок распознавания.</p>
      <div id="rec-status" class="text-center mb-16" style="font-size:18px">Готов к записи</div>
      <div id="rec-timer" class="text-center mb-16" style="font-size:32px;font-weight:700;color:var(--primary)">00:00</div>
      <div class="flex gap-8" style="justify-content:center">
        <button class="btn btn-danger btn-block" id="rec-btn" onclick="AdminApp.toggleRec(${eid})">&#x23FA; Начать запись</button>
      </div>
      <div class="form-group mt-16"><label>Расшифровка (редактируемая)</label><textarea id="rec-text" class="form-control" style="min-height:200px" placeholder="Текст появится во время записи..."></textarea></div>
      <div class="flex gap-8 mt-8"><button class="btn btn-primary" onclick="AdminApp.saveTranscript(${eid})" id="save-tr-btn" disabled>Сохранить расшифровку</button><button class="btn btn-outline" onclick="AdminApp.navigate('events')">Назад</button></div></div>`;
  },

  _recStart: 0, _recInterval: null,

  async toggleRec(eid) {
    const btn = document.getElementById('rec-btn');
    if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
      // Stop
      this._mediaRecorder.stop();
      if (this._recognition) try { this._recognition.stop(); } catch(e) {}
      clearInterval(this._recInterval);
      btn.innerHTML = '&#x23FA; Начать запись';
      document.getElementById('rec-status').textContent = 'Остановлено';
      document.getElementById('save-tr-btn').disabled = false;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._audioChunks = [];
      this._mediaRecorder = new MediaRecorder(stream);
      this._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this._audioChunks.push(e.data); };
      this._mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(this._audioChunks, { type: 'audio/webm' });
        // Upload audio
        const fd = new FormData();
        fd.append('files', blob, `recording-${Date.now()}.webm`);
        await API.upload(`/api/admin/events/${eid}/files?type=audio`, fd);
        showToast('Аудио сохранено', 'success');
      };
      this._mediaRecorder.start(1000);
      this._recStart = Date.now();
      this._recInterval = setInterval(() => {
        const s = Math.floor((Date.now() - this._recStart) / 1000);
        document.getElementById('rec-timer').textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
      }, 1000);
      btn.innerHTML = '&#x23F9; Остановить';
      document.getElementById('rec-status').innerHTML = '<span style="color:var(--danger)">&#x1F534; Запись...</span>';

      // Speech recognition
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        this._recognition = new SR();
        this._recognition.lang = 'ru-RU';
        this._recognition.continuous = true;
        this._recognition.interimResults = true;
        this._transcript = '';
        this._recognition.onresult = (e) => {
          let interim = '', final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
            else interim += e.results[i][0].transcript;
          }
          if (final) this._transcript += final;
          document.getElementById('rec-text').value = this._transcript + interim;
        };
        this._recognition.onerror = () => {};
        this._recognition.onend = () => { if (this._mediaRecorder?.state === 'recording') try { this._recognition.start(); } catch(e) {} };
        this._recognition.start();
      }
    } catch (e) { showToast('Нет доступа к микрофону', 'error'); }
  },

  async saveTranscript(eid) {
    const text = document.getElementById('rec-text').value;
    if (!text) return showToast('Нет текста', 'error');
    const r = await API.post(`/api/admin/events/${eid}/transcribe`, { transcription: text });
    showToast('Расшифровка сохранена', 'success');
    if (r.transcription !== text) document.getElementById('rec-text').value = r.transcription;
  },

  // === Deputy block ===
  async showBlockEditor(eid) {
    const ev = await API.get(`/api/admin/events/${eid}`);
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:600px"><h3>Блок для депутатов</h3>
      <p class="hint-text">Заполните информацию для каждого депутата. Они увидят ваш текст и смогут либо подтвердить его, либо предложить свою версию. Используйте для предзаполнения отчётов, позиций по голосованию или любой информации, которую депутат должен согласовать.</p>
      ${ev.participants.filter(p=>p.user_type!=='staff').map(p=>`<div class="form-group"><label>${esc(p.full_name)} ${p.block_confirmed?'<span class="status-confirmed">подтв.</span>':''}</label>
        <textarea class="form-control block-text" data-did="${p.id}" style="min-height:60px">${esc(p.admin_block_text||'')}</textarea></div>`).join('')}
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="AdminApp.saveBlocks(${eid})">Отправить</button></div></div></div>`);
  },

  async saveBlocks(eid) {
    const blocks = Array.from(document.querySelectorAll('.block-text')).filter(t=>t.value).map(t=>({deputy_id:parseInt(t.dataset.did),text:t.value}));
    await API.post(`/api/admin/events/${eid}/deputy-block`,{blocks});
    document.querySelector('.modal-overlay')?.remove();
    showToast('Отправлено','success');
  },

  async closeEvt(eid) {
    const comment=prompt('Комментарий к закрытию (для ИИ):');
    await API.post(`/api/admin/events/${eid}/close`,{admin_comment:comment||''});
    showToast('Заседание закрыто','success'); this.loadEvents();
  },
  async showEditEvtModal(eid) {
    return this.showEvtModal(eid);
  },

  saveEditEvt(eid) {
    var date = document.getElementById('ed-date').value;
    var time = document.getElementById('ed-time').value;
    var title = document.getElementById('ed-title').value;
    var b = {
      title: title,
      event_type: document.getElementById('ed-type').value || 'regular',
      event_date: date ? date + 'T' + (time || '19:00') : '',
      location: document.getElementById('ed-loc').value,
      description: document.getElementById('ed-desc').value,
      commission_id: document.getElementById('ed-com') ? document.getElementById('ed-com').value : null
    };
    var notify = document.getElementById('ed-notify') ? document.getElementById('ed-notify').checked : false;
    var agItems = Array.from(document.querySelectorAll('.ed-ag-t')).filter(function(i){return i.value}).map(function(i){return {title:i.value}});
    var fileInput = document.getElementById('ed-files');
    var self = this;

    // Save event via XHR
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/admin/events/' + eid);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (API.token) xhr.setRequestHeader('Authorization', 'Bearer ' + API.token);
    xhr.onload = function() {
      if (xhr.status < 300) {
        // Update agenda
        var xhr2 = new XMLHttpRequest();
        xhr2.open('POST', '/api/admin/events/' + eid + '/agenda');
        xhr2.setRequestHeader('Content-Type', 'application/json');
        if (API.token) xhr2.setRequestHeader('Authorization', 'Bearer ' + API.token);
        xhr2.send(JSON.stringify({ items: agItems }));

        // Upload files
        if (fileInput && fileInput.files.length) {
          var fd = new FormData();
          for (var i = 0; i < fileInput.files.length; i++) fd.append('files', fileInput.files[i]);
          var xhr3 = new XMLHttpRequest();
          xhr3.open('POST', '/api/admin/events/' + eid + '/files');
          if (API.token) xhr3.setRequestHeader('Authorization', 'Bearer ' + API.token);
          xhr3.send(fd);
        }

        // Notify participants
        if (notify) {
          var xhr4 = new XMLHttpRequest();
          xhr4.open('POST', '/api/admin/events/' + eid + '/notify-update');
          xhr4.setRequestHeader('Content-Type', 'application/json');
          if (API.token) xhr4.setRequestHeader('Authorization', 'Bearer ' + API.token);
          xhr4.send(JSON.stringify({ title: title }));
        }

        document.querySelector('.modal-overlay').remove();
        showToast('Мероприятие обновлено', 'success');
        self.loadEvents();
      } else {
        showToast('Ошибка сохранения', 'error');
      }
    };
    xhr.onerror = function() { showToast('Сетевая ошибка', 'error'); };
    xhr.send(JSON.stringify(b));
    showToast('Сохранение...', 'info');
  },

  async editParticipants(eid) {
    const [e, allDeps] = await Promise.all([
      API.get(`/api/admin/events/${eid}`),
      API.get(`/api/admin/deputies?${this.dp()}`)
    ]);
    const partIds = new Set(e.participants.map(p => p.id));

    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal">
      <h3>Участники: ${esc(e.title)}</h3>
      <div class="flex gap-8 mb-16">
        <button class="btn btn-outline btn-sm" onclick="document.querySelectorAll('.ep-cb').forEach(c=>c.checked=true)">Выбрать всех</button>
        <button class="btn btn-outline btn-sm" onclick="document.querySelectorAll('.ep-cb').forEach(c=>c.checked=false)">Снять всех</button>
      </div>
      <div class="deputy-select-list" style="max-height:300px">
        ${allDeps.map(d => `<label class="deputy-select-item">
          <input type="checkbox" value="${d.id}" class="ep-cb" ${partIds.has(d.id)?'checked':''}>
          ${esc(d.full_name)} ${d.deputy_role==='head'?'<span class="badge-head">ГСД</span>':''} ${d.user_type==='staff'?'<span class="text-tertiary">(сотр.)</span>':''}
          ${partIds.has(d.id) ? `<span class="status-${e.participants.find(p=>p.id===d.id)?.status}" style="margin-left:auto;font-size:11px">${STATUS_LABELS[e.participants.find(p=>p.id===d.id)?.status]||''}</span>` : ''}
        </label>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="AdminApp.saveParticipants(${eid})">Сохранить</button>
      </div>
    </div></div>`);
  },

  async saveParticipants(eid) {
    const ids = Array.from(document.querySelectorAll('.ep-cb:checked')).map(c => parseInt(c.value));
    await API.post(`/api/admin/events/${eid}/participants`, { deputy_ids: ids });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Участники обновлены', 'success');
    this.showEvtDetail(eid);
  },

  async markAttendance(eid,depId,status) {
    await API.post(`/api/admin/events/${eid}/mark-attendance`,{deputy_id:depId,status});
    showToast(status==='confirmed'?'Отмечен как присутствовал':'Отмечен как отсутствовал','success');
    document.querySelector('.modal-overlay')?.remove();
    this.showEvtDetail(eid);
  },

  async addRoom() {
    const name = document.getElementById('ev-loc-name').value;
    const address = document.getElementById('ev-loc-addr').value;
    if (!name) return showToast('Укажите название кабинета', 'error');
    const r = await API.post('/api/admin/rooms', { name, address, district_id: this.selectedDistrict || null });
    // Set location and close new room form
    const loc = name + (address ? ' (' + address + ')' : '');
    document.getElementById('ev-loc').value = loc;
    document.getElementById('ev-loc-new').classList.add('hidden');
    // Add to select
    const sel = document.getElementById('ev-room');
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = name + (address ? ' — ' + address : '');
    opt.selected = true;
    sel.insertBefore(opt, sel.lastElementChild);
    showToast('Кабинет добавлен', 'success');
  },

  // === Rooms management ===
  async loadRooms() {
    const rooms = await API.get(`/api/admin/rooms?${this.dp()}`);
    document.getElementById('admin-content').innerHTML = `<div class="card"><div class="card-header"><h2>Кабинеты (${rooms.length})</h2>
      <button class="btn btn-primary btn-sm" onclick="AdminApp.showRoomModal()">+ Добавить</button></div>
      <p class="hint-text">Кабинеты используются при создании мероприятий. Кабинет по умолчанию выбирается автоматически.</p>
      <div class="table-wrap"><table><thead><tr><th>Название</th><th>Адрес</th><th>По умолч.</th><th></th></tr></thead>
        <tbody>${rooms.map(r => `<tr>
          <td>${esc(r.name)}</td><td>${esc(r.address) || '—'}</td>
          <td>${r.is_default ? '<span class="status-confirmed">\u2714 По умолчанию</span>' : `<button class="btn btn-outline btn-sm" onclick="AdminApp.setDefaultRoom(${r.id})">Сделать</button>`}</td>
          <td><button class="btn btn-danger btn-sm" onclick="AdminApp.delRoom(${r.id})">Удалить</button></td>
        </tr>`).join('')}</tbody></table></div></div>`;
  },

  showRoomModal() {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Добавить кабинет</h3>
      <div class="form-group"><label>Название</label><input id="rm-name" class="form-control" placeholder="Зал заседаний №1"></div>
      <div class="form-group"><label>Адрес</label><input id="rm-addr" class="form-control" placeholder="ул. Примерная, д.1"></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="AdminApp.saveRoom()">Добавить</button></div></div></div>`);
  },

  async saveRoom() {
    const name = document.getElementById('rm-name').value;
    const address = document.getElementById('rm-addr').value;
    if (!name) return showToast('Укажите название', 'error');
    await API.post('/api/admin/rooms', { name, address, district_id: this.selectedDistrict || null });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Добавлено', 'success');
    this.loadRooms();
  },

  async setDefaultRoom(id) { await API.put(`/api/admin/rooms/${id}/default`); showToast('Кабинет по умолчанию установлен', 'success'); this.loadRooms(); },
  async delRoom(id) { if (!confirm('Удалить кабинет?')) return; await API.del(`/api/admin/rooms/${id}`); showToast('Удалено', 'success'); this.loadRooms(); },

  async remindEvt(id){const r=await API.post(`/api/admin/events/${id}/remind`);showToast(`Push: ${r.sent}`,'success');},
  async delEvt(id){if(!confirm('Удалить?'))return;await API.del(`/api/admin/events/${id}`);showToast('OK','success');this.loadEvents();},

  // === Receptions ===
  _recFilterDep: 'all',

  async loadReceptions() {
    const now=new Date(), month=now.getMonth(); // 0-indexed
    const curQ=Math.ceil((month+1)/3);
    // Last month of quarter (2,5,8,11) → suggest next quarter
    const isLastMonth = (month % 3 === 2);
    let q = isLastMonth ? curQ + 1 : curQ;
    let yr = now.getFullYear();
    if (q > 4) { q = 1; yr++; }
    const deps = await API.get(`/api/admin/deputies?user_type=deputy&${this.dp()}`);
    const filterDep = this._recFilterDep || 'all';
    const recsUrl = filterDep !== 'all' ? `/api/admin/receptions?${this.dp()}&year=${yr}&deputy_id=${filterDep}` : `/api/admin/receptions?${this.dp()}&year=${yr}`;
    const recs = await API.get(recsUrl);
    const rooms = await API.get(`/api/admin/rooms?${this.dp()}`);
    const roomOpts = rooms.map(r => `<option value="${esc(r.name)}${r.address?' ('+esc(r.address)+')':''}">${esc(r.name)}</option>`).join('');
    this._recRoomOpts = roomOpts;

    // Group by quarter
    const quarters = {};
    recs.forEach(r => { const k = `${r.quarter||'?'} кв. ${r.year||yr}`; if(!quarters[k]) quarters[k]=[]; quarters[k].push(r); });

    document.getElementById('admin-content').innerHTML = `
      <p class="hint-text">Создайте расписание приёмов населения для каждого депутата. Используйте вкладки для переключения между депутатами.</p>

      <div class="dep-tabs">
        <button class="dep-tab ${filterDep==='all'?'active':''}" onclick="AdminApp._recFilterDep='all';AdminApp.loadReceptions()">Все депутаты</button>
        ${deps.map(d => `<button class="dep-tab ${filterDep==d.id?'active':''}" onclick="AdminApp._recFilterDep=${d.id};AdminApp.loadReceptions()">${esc(d.full_name.split(' ')[0])} ${d.full_name.split(' ')[1]?esc(d.full_name.split(' ')[1][0])+'.':''}</button>`).join('')}
      </div>

      <details class="card"><summary style="font-weight:600;cursor:pointer;padding:4px 0;font-size:16px">+ Создать приёмы</summary>
        <div class="form-row" style="margin-bottom:12px;margin-top:12px">
          <div class="form-group" style="flex:1"><label>Квартал</label>
            <select id="rec-q" class="form-control" onchange="AdminApp.fillRecQuarter()"><option value="1" ${q===1?'selected':''}>1 (янв-мар)</option><option value="2" ${q===2?'selected':''}>2 (апр-июн)</option><option value="3" ${q===3?'selected':''}>3 (июл-сен)</option><option value="4" ${q===4?'selected':''}>4 (окт-дек)</option></select></div>
          <div class="form-group" style="flex:1"><label>Год</label><input type="number" id="rec-yr" class="form-control" value="${yr}" onchange="AdminApp.fillRecQuarter()"></div>
          <div class="form-group" style="flex:2"><label>Депутат</label>
            <select id="rec-dep" class="form-control">${deps.map(d=>`<option value="${d.id}" ${filterDep==d.id?'selected':''}>${esc(d.full_name)}</option>`).join('')}</select></div>
        </div>
        <div id="rec-items"></div>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-outline btn-sm" onclick="AdminApp.addRecRow()">+ Ещё дату</button>
          <button class="btn btn-primary" onclick="AdminApp.saveReceptions()">Сохранить приёмы</button>
        </div>
      </details>

      ${Object.keys(quarters).length ? Object.entries(quarters).map(([label, items]) => `
        <div class="card"><div class="card-header"><h2>${label}</h2>
          <button class="btn btn-primary btn-sm" onclick="AdminApp.sendRecConfirm(${items[0]?.quarter},${items[0]?.year})">Отправить на подтверждение</button></div>
          <div class="table-wrap"><table><thead><tr>${filterDep==='all'?'<th>Депутат</th>':''}<th>Дата</th><th>День</th><th>Время</th><th>Место</th><th>Статус</th><th></th></tr></thead>
            <tbody>${(() => {
              // Sort by deputy name, then by date
              const sorted = filterDep==='all' ? [...items].sort((a,b) => a.full_name.localeCompare(b.full_name) || a.reception_date.localeCompare(b.reception_date)) : items;
              let lastDep = '', colorIdx = 0;
              return sorted.map(r => {
                const d=new Date(r.reception_date);
                const day=d.toLocaleDateString('ru-RU',{weekday:'short'});
                if (filterDep==='all' && r.full_name !== lastDep) { if (lastDep) colorIdx++; lastDep = r.full_name; }
                const bg = filterDep==='all' && colorIdx % 2 === 1 ? 'background:var(--bg-input)' : '';
                const byDeputy = r.created_by_staff === null;
                return `<tr style="${bg}${byDeputy?'border-left:3px solid var(--purple);':''}">
                  ${filterDep==='all'?`<td style="font-weight:500">${esc(r.full_name)}</td>`:''}
                  <td>${r.reception_date}</td><td>${day}</td><td>${r.time_start}–${r.time_end}</td><td>${esc(r.location)||'—'}</td>
                  <td>${byDeputy?'<span style="font-size:10px;color:var(--purple);font-weight:500;white-space:nowrap">добавлено депутатом</span>':(r.status==='confirmed'?'<span class="status-confirmed">Подтверждён</span>':'<span class="status-pending">Ожидает</span>')}</td>
                  <td><button class="btn btn-danger btn-sm" onclick="AdminApp.delReception(${r.id})">Удалить</button></td></tr>`;
              }).join('');
            })()}</tbody></table></div></div>
      `).join('') : '<div class="card"><p class="text-center text-gray">Приёмов пока нет</p></div>'}`;
    this.fillRecQuarter();
  },

  _recRoomOpts: '',

  fillRecQuarter() {
    const q = parseInt(document.getElementById('rec-q')?.value || '1');
    const yr = parseInt(document.getElementById('rec-yr')?.value || new Date().getFullYear());
    const months = [(q-1)*3, (q-1)*3+1, (q-1)*3+2]; // 0-indexed
    const container = document.getElementById('rec-items');
    if (!container) return;
    const roomOpts = this._recRoomOpts || (document.querySelector('.rec-loc')?.innerHTML || '');
    this._recRoomOpts = roomOpts;
    const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    container.innerHTML = months.map(m => {
      const firstDay = `${yr}-${String(m+1).padStart(2,'0')}-15`;
      return `<div class="rec-row form-row" style="margin-bottom:8px;align-items:end">
        <div class="form-group" style="flex:2;margin:0"><label>${MONTH_NAMES[m]}</label><input type="date" class="form-control rec-date" value="${firstDay}"></div>
        <div class="form-group" style="flex:1;margin:0"><label>С</label><input type="time" class="form-control rec-ts" value="16:00"></div>
        <div class="form-group" style="flex:1;margin:0"><label>По</label><input type="time" class="form-control rec-te" value="18:00"></div>
        <div class="form-group" style="flex:2;margin:0"><label>Место</label><select class="form-control rec-loc">${roomOpts}<option value="">Другое</option></select></div>
      </div>`;
    }).join('');
  },

  addRecRow() {
    const rooms = this._recRoomOpts || (document.querySelector('.rec-loc')?.innerHTML || '');
    document.getElementById('rec-items').insertAdjacentHTML('beforeend', `<div class="rec-row form-row" style="margin-bottom:8px;align-items:end">
      <div class="form-group" style="flex:2;margin:0"><input type="date" class="form-control rec-date"></div>
      <div class="form-group" style="flex:1;margin:0"><input type="time" class="form-control rec-ts" value="16:00"></div>
      <div class="form-group" style="flex:1;margin:0"><input type="time" class="form-control rec-te" value="18:00"></div>
      <div class="form-group" style="flex:2;margin:0"><select class="form-control rec-loc">${rooms}<option value="">Другое</option></select></div>
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" style="margin-bottom:0;height:38px">&#x2716;</button>
    </div>`);
  },

  async saveReceptions() {
    const depId = parseInt(document.getElementById('rec-dep').value);
    const quarter = parseInt(document.getElementById('rec-q').value);
    const year = parseInt(document.getElementById('rec-yr').value);
    const rows = document.querySelectorAll('.rec-row');
    const items = [];
    rows.forEach(row => {
      const date = row.querySelector('.rec-date').value;
      const ts = row.querySelector('.rec-ts').value;
      const te = row.querySelector('.rec-te').value;
      const loc = row.querySelector('.rec-loc').value;
      if (date && ts && te) items.push({ deputy_id: depId, reception_date: date, time_start: ts, time_end: te, location: loc, district_id: this.selectedDistrict || null, quarter, year });
    });
    if (!items.length) return showToast('Заполните хотя бы одну дату', 'error');
    await API.post('/api/admin/receptions', { items });
    showToast(`Создано ${items.length} приёмов`, 'success');
    this.loadReceptions();
  },

  async sendRecConfirm(quarter, year) {
    const r = await API.post('/api/admin/receptions/send-confirmation', { quarter, year, district_id: this.selectedDistrict || null });
    showToast(`Уведомление отправлено (${r.notified} депутатов)`, 'success');
  },

  async delReception(id) { await API.del(`/api/admin/receptions/${id}`); showToast('Удалено','success'); this.loadReceptions(); },

  // === Templates page ===
  async loadTemplatesPage() {
    const types = await API.get(`/api/admin/event-types?${this.dp()}`);
    const TYPE_L = {}; types.forEach(t => TYPE_L[t.code] = t.name);
    const typeOpts = types.map(t => `<option value="${t.code}">${esc(t.name)}</option>`).join('');
    const tpls = this.staffMode
      ? await API.get(`/api/admin/event-templates?${this.dp()}`)
      : await API.get('/api/admin/event-templates');
    const globalTpls = tpls.filter(t => !t.district_id);
    const localTpls = tpls.filter(t => t.district_id);

    document.getElementById('admin-content').innerHTML = `
      <h2 style="margin-bottom:16px">Библиотека мероприятий</h2>
      <p class="hint-text">Шаблоны для быстрого создания мероприятий. ${this.staffMode ? 'Глобальные шаблоны от администратора доступны всем. Здесь добавляйте свои для района.' : 'Глобальные шаблоны видны во всех районах.'}</p>

      ${globalTpls.length ? `<div class="card"><h3 class="card-title">${this.staffMode ? 'Глобальные шаблоны (от администратора)' : 'Шаблоны мероприятий'}</h3>
        <div class="table-wrap"><table><thead><tr><th>Название</th><th>Тип</th><th>Время</th><th>Уведомить за</th>${!this.staffMode?'<th></th>':''}</tr></thead>
          <tbody>${globalTpls.map(t => `<tr><td>${esc(t.name)}</td><td>${TYPE_L[t.event_type]||t.event_type}</td><td>${t.default_time}</td><td>${t.days_ahead||10} дн.</td>
            ${!this.staffMode?`<td><button class="btn btn-danger btn-sm" onclick="AdminApp.delTemplate(${t.id})">Удалить</button></td>`:''}</tr>`).join('')}</tbody></table></div></div>` : ''}

      ${this.staffMode ? `<div class="card"><h3 class="card-title">Шаблоны района</h3>
        ${localTpls.length ? `<div class="table-wrap"><table><thead><tr><th>Название</th><th>Тип</th><th>Время</th><th>Уведомить за</th><th></th></tr></thead>
          <tbody>${localTpls.map(t => `<tr><td>${esc(t.name)}</td><td>${TYPE_L[t.event_type]||t.event_type}</td><td>${t.default_time}</td><td>${t.days_ahead||10} дн.</td>
            <td><button class="btn btn-danger btn-sm" onclick="AdminApp.delTemplate(${t.id})">Удалить</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="text-gray text-sm">Нет шаблонов района</p>'}
      </div>` : ''}

      <div class="card"><h3 class="card-title">Добавить шаблон мероприятия</h3>
        <p class="hint-text">«Уведомить за» — за сколько дней автоматически подставится дата. Пример: очередное — 10 дней, внеочередное — 2 дня.</p>
        <div class="form-row">
          <div class="form-group" style="flex:3;margin:0"><label>Название</label><input id="tpl-name" class="form-control" placeholder="Заседание Совета депутатов МО ..."></div>
          <div class="form-group" style="flex:2;margin:0"><label>Тип</label><select id="tpl-type" class="form-control">${typeOpts}</select></div>
          <div class="form-group" style="flex:1;margin:0"><label>Время</label><select id="tpl-time" class="form-control"><option value="19:00">19:00</option><option value="18:00">18:00</option><option value="17:00">17:00</option><option value="16:00">16:00</option></select></div>
          <div class="form-group" style="flex:1.5;margin:0"><label>Уведомить за</label><select id="tpl-days" class="form-control"><option value="2">2 дня</option><option value="3">3 дня</option><option value="5">5 дней</option><option value="7">7 дней</option><option value="10" selected>10 дней</option><option value="14">14 дней</option><option value="21">21 день</option><option value="30">30 дней</option></select></div>
          <button class="btn btn-primary" style="height:38px;align-self:end" onclick="AdminApp.addTemplate();AdminApp.loadTemplatesPage()">Добавить</button>
        </div>
      </div>

      <div class="card"><h3 class="card-title">Типы мероприятий</h3>
        <p class="hint-text">Системные типы нельзя удалить. Добавляйте свои для специфических мероприятий.</p>
        <div class="table-wrap"><table><thead><tr><th style="width:40px">Цвет</th><th>Название</th><th>Код</th><th></th></tr></thead>
          <tbody>${types.map(t => `<tr>
            <td><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${t.color}"></span></td>
            <td>${esc(t.name)}</td><td class="text-gray">${t.code}</td>
            <td>${t.is_system ? '<span class="text-tertiary">Системный</span>' : `<button class="btn btn-danger btn-sm" onclick="AdminApp.delEventType(${t.id})">Удалить</button>`}</td>
          </tr>`).join('')}</tbody></table></div>
        <div class="form-row mt-16">
          <div class="form-group" style="flex:3;margin:0"><label>Название нового типа</label><input id="et-name" class="form-control" placeholder="Рабочая группа, Круглый стол..."></div>
          <div class="form-group" style="flex:1;margin:0"><label>Цвет</label><input type="color" id="et-color" class="form-control" value="#007AFF" style="height:38px;padding:4px"></div>
          <button class="btn btn-primary" style="height:38px;align-self:end" onclick="AdminApp.addEventType()">Добавить тип</button>
        </div>
      </div>`;
  },

  // === Staff management (lead staff) ===
  async loadStaffMgmt() {
    try {
      const staff = await API.get('/api/deputy/managed-staff');
      const me = await API.get('/api/deputy/profile');
      document.getElementById('admin-content').innerHTML = `<div class="card"><div class="card-header"><h2>Сотрудники района (${staff.length})</h2>
        <button class="btn btn-primary btn-sm" onclick="AdminApp.showAddStaffModal()">+ Добавить сотрудника</button></div>
        <p class="hint-text">Как главный сотрудник, вы можете добавлять, редактировать и удалять сотрудников в своём районе. Для передачи полномочий назначьте нового сотрудника главным.</p>
        <div class="table-wrap"><table><thead><tr><th>ФИО</th><th>Email</th><th>Телефон</th><th>Роль</th><th>Вход</th><th></th></tr></thead>
          <tbody>${staff.map(s => `<tr>
            <td>${esc(s.full_name)} ${s.id===me.id?'<span class="badge-head">Вы</span>':''}</td>
            <td>${esc(s.email)||'—'}</td><td>${esc(s.phone)||'—'}</td>
            <td>${s.staff_role==='lead'?'<span class="badge-head">Главный</span>':'Обычный'}</td>
            <td>${s.passkey_registered?'&#x2714;':'—'}</td>
            <td class="actions-cell">${s.id!==me.id?`
              <button class="btn btn-outline btn-sm" onclick="AdminApp.editManagedStaff(${s.id},'${s.full_name.replace(/'/g,"\\'")}','${s.email||''}','${s.phone||''}','${s.staff_role}')">Изменить</button>
              <button class="btn btn-outline btn-sm" onclick="AdminApp.invitePerson(${s.id})">Пригласить</button>
              <button class="btn btn-danger btn-sm" onclick="AdminApp.delManagedStaff(${s.id})">Удалить</button>`:''}</td>
          </tr>`).join('')}</tbody></table></div></div>`;
    } catch(e) { document.getElementById('admin-content').innerHTML = '<div class="card"><p class="text-gray">Нет доступа</p></div>'; }
  },

  // === Staff profile (desktop) ===
  async loadMyProfile() {
    const p = await API.get('/api/deputy/profile');
    let smtp = {};
    try { smtp = await API.get('/api/deputy/smtp-settings'); } catch(e) {}
    const isLead = p.staff_role === 'lead';

    let staffMgmtHtml = '';
    if (isLead) {
      try {
        const staff = await API.get('/api/deputy/managed-staff');
        staffMgmtHtml = `<div class="card"><div class="card-header"><h2>Сотрудники района</h2>
          <button class="btn btn-primary btn-sm" onclick="AdminApp.showAddStaffModal()">+ Добавить сотрудника</button></div>
          <p class="hint-text">Как главный сотрудник, вы можете добавлять и удалять сотрудников в своём районе</p>
          <div class="table-wrap"><table><thead><tr><th>ФИО</th><th>Email</th><th>Роль</th><th>Вход</th><th></th></tr></thead>
            <tbody>${staff.map(s => `<tr>
              <td>${esc(s.full_name)} ${s.id===p.id?'<span class="badge-head">Вы</span>':''}</td>
              <td>${esc(s.email)||'—'}</td>
              <td>${s.staff_role==='lead'?'Главный':'Обычный'}</td>
              <td>${s.passkey_registered?'&#x2714;':'—'}</td>
              <td>${s.id!==p.id?`<button class="btn btn-outline btn-sm" onclick="AdminApp.editManagedStaff(${s.id},'${s.full_name.replace(/'/g,"\\'")}','${s.email||''}','${s.phone||''}','${s.staff_role}')">Изменить</button>
                <button class="btn btn-outline btn-sm" onclick="AdminApp.invitePerson(${s.id})">Пригласить</button>
                <button class="btn btn-danger btn-sm" onclick="AdminApp.delManagedStaff(${s.id})">Удалить</button>`:''}</td>
            </tr>`).join('')}</tbody></table></div></div>`;
      } catch(e) {}
    }

    const roleName = p.staff_role==='lead' ? 'Главный сотрудник' : 'Сотрудник';
    const distLabel = p.district_name ? `${esc(p.district_name)} (${esc(p.okrug)})` : '—';

    document.getElementById('admin-content').innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar">${esc(p.full_name).split(' ').map(w=>w[0]).join('').substring(0,2)}</div>
        <div>
          <h2>${esc(p.full_name)}</h2>
          <div class="text-secondary">${roleName} · ${distLabel}</div>
        </div>
      </div>

      <div class="profile-grid">
        <div class="profile-col">
          <div class="card">
            <h3 class="card-title">Личные данные</h3>
            <div class="form-group"><label>ФИО</label><input id="mp-name" class="form-control" value="${esc(p.full_name)}"></div>
            <div class="form-group"><label>Email</label><input type="email" id="mp-email" class="form-control" value="${esc(p.email||'')}"></div>
            <div class="form-group"><label>Телефон</label><input type="tel" id="mp-phone" class="form-control" value="${esc(p.phone||'')}"></div>
            <button class="btn btn-primary" onclick="AdminApp.saveMyProfile()">Сохранить данные</button>
          </div>

          <div class="card">
            <h3 class="card-title">Безопасность</h3>
            <p class="text-sm text-secondary" style="margin-bottom:12px">Passkey — вход по отпечатку или Face ID, без пароля</p>
            <button class="btn btn-outline btn-block" onclick="AdminApp.registerStaffPasskey()">Зарегистрировать Passkey</button>
          </div>
        </div>

        <div class="profile-col">
          <div class="card">
            <h3 class="card-title">Подпись письма</h3>
            <div class="form-group">
              <textarea id="mp-sig" class="form-control" style="overflow:hidden;resize:vertical" placeholder="С уважением, ФИО&#10;Администрация МО ...&#10;тел. ...&#10;e-mail: ..." oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${smtp.signature||''}</textarea>
            </div>
            <label class="pref-item" style="border:none;padding:8px 0"><span>Отправлять от моего имени</span>
              <input type="checkbox" id="mp-smtp-on" ${smtp.enabled?'checked':''} onchange="document.getElementById('mp-smtp-f').classList.toggle('hidden',!this.checked)"></label>
            <div id="mp-smtp-f" class="${smtp.enabled?'':'hidden'}">
              <div class="form-row">
                <div class="form-group" style="flex:2"><label>SMTP</label><input id="mp-h" class="form-control" value="${smtp.host||''}" placeholder="smtp.yandex.ru"></div>
                <div class="form-group" style="flex:1"><label>Порт</label><input type="number" id="mp-p" class="form-control" value="${smtp.port||'465'}"></div>
                <div class="form-group" style="flex:1"><label>SSL</label><select id="mp-s" class="form-control"><option value="false" ${smtp.secure!=='true'?'selected':''}>Нет</option><option value="true" ${smtp.secure==='true'?'selected':''}>Да</option></select></div>
              </div>
              <div class="form-row">
                <div class="form-group" style="flex:1"><label>Логин</label><input id="mp-u" class="form-control" value="${smtp.user||''}"></div>
                <div class="form-group" style="flex:1"><label>Пароль</label><input type="password" id="mp-pw" class="form-control" value="${smtp.pass||''}"></div>
              </div>
              <div class="form-group"><label>От кого (email)</label><input id="mp-f" class="form-control" value="${smtp.from||''}"></div>
            </div>
            <button class="btn btn-primary" onclick="AdminApp.saveMySmtp()">Сохранить почту</button>
          </div>
        </div>
      </div>

      ${staffMgmtHtml}
      `;
    const sig = document.getElementById('mp-sig');
    if (sig) { sig.style.height = 'auto'; sig.style.height = sig.scrollHeight + 'px'; }
  },

  async saveMyProfile() {
    await API.put('/api/deputy/profile', {
      full_name: document.getElementById('mp-name').value,
      email: document.getElementById('mp-email').value,
      phone: document.getElementById('mp-phone').value
    });
    showToast('Профиль сохранён', 'success');
  },

  async saveMySmtp() {
    const settings = {
      enabled: document.getElementById('mp-smtp-on').checked,
      signature: document.getElementById('mp-sig').value,
      host: document.getElementById('mp-h')?.value||'', port: document.getElementById('mp-p')?.value||'465',
      secure: document.getElementById('mp-s')?.value||'true', user: document.getElementById('mp-u')?.value||'',
      pass: document.getElementById('mp-pw')?.value||'', from: document.getElementById('mp-f')?.value||'',
    };
    await API.put('/api/deputy/smtp-settings', { settings });
    this._staffSignature = settings.signature;
    showToast('Сохранено', 'success');
  },

  async registerStaffPasskey() {
    try {
      // Use deputy passkey registration via invite
      showToast('Обратитесь к администратору для регистрации Passkey', 'info');
    } catch(e) {}
  },

  showAddStaffModal() {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Добавить сотрудника</h3>
      <div class="form-group"><label>ФИО</label><input id="ms-name" class="form-control"></div>
      <div class="form-group"><label>Email</label><input type="email" id="ms-email" class="form-control"></div>
      <div class="form-group"><label>Телефон</label><input type="tel" id="ms-phone" class="form-control"></div>
      <div class="form-group"><label>Роль</label><select id="ms-role" class="form-control">
        <option value="regular">Обычный сотрудник</option>
        <option value="lead">Главный сотрудник</option></select></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="AdminApp.saveNewStaff()">Добавить</button></div></div></div>`);
  },

  async saveNewStaff() {
    const b = { full_name: document.getElementById('ms-name').value, email: document.getElementById('ms-email').value, phone: document.getElementById('ms-phone').value, staff_role: document.getElementById('ms-role').value };
    if (!b.full_name) return showToast('Укажите ФИО', 'error');
    await API.post('/api/deputy/managed-staff', b);
    document.querySelector('.modal-overlay')?.remove();
    showToast('Сотрудник добавлен', 'success');
    this.loadMyProfile();
  },

  editManagedStaff(id, name, email, phone, role) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Редактировать сотрудника</h3>
      <div class="form-group"><label>ФИО</label><input id="ms-name" class="form-control" value="${name}"></div>
      <div class="form-group"><label>Email</label><input type="email" id="ms-email" class="form-control" value="${email}"></div>
      <div class="form-group"><label>Телефон</label><input type="tel" id="ms-phone" class="form-control" value="${phone}"></div>
      <div class="form-group"><label>Роль</label><select id="ms-role" class="form-control">
        <option value="regular" ${role!=='lead'?'selected':''}>Обычный сотрудник</option>
        <option value="lead" ${role==='lead'?'selected':''}>Главный сотрудник</option></select></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="AdminApp.updateManagedStaff(${id})">Сохранить</button></div></div></div>`);
  },

  async updateManagedStaff(id) {
    await API.put(`/api/deputy/managed-staff/${id}`, {
      full_name: document.getElementById('ms-name').value, email: document.getElementById('ms-email').value,
      phone: document.getElementById('ms-phone').value, staff_role: document.getElementById('ms-role').value
    });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Сохранено', 'success');
    this.loadMyProfile();
  },

  async delManagedStaff(id) {
    if (!confirm('Удалить сотрудника?')) return;
    await API.del(`/api/deputy/managed-staff/${id}`);
    showToast('Удалено', 'success');
    this.loadMyProfile();
  },

  // === Changelog ===
  async loadChangelog() {
    const log = await fetch('/api/auth/changelog').then(r=>r.json());
    document.getElementById('admin-content').innerHTML=`<div class="card"><h2 style="margin-bottom:16px">История изменений</h2>
      ${log.map(e=>`<div class="changelog-entry"><div class="changelog-version">v${e.version}</div><div class="changelog-title">${esc(e.title)}</div><div class="changelog-desc">${esc(e.description)}</div></div>`).join('')}</div>`;
  },

  // === Chat (admin/staff) ===
  _adminChatPolling: null,
  _adminOpenChatId: null,
  _adminReplyTo: null,

  async loadAdminChats() {
    const chats = await API.get('/api/chat/list');
    if (!chats) return;
    const isStaff = this.staffMode;
    const shortName = (n) => { const p=n.split(' '); return p[0]+(p[1]?' '+p[1][0]+'.':'')+(p[2]?p[2][0]+'.':''); };
    document.getElementById('admin-content').innerHTML = `
      ${isStaff ? `<button class="btn btn-primary" style="margin-bottom:16px" onclick="AdminApp.showAdminCreateChat()">+ Новый чат</button>` : ''}
      ${chats.length ? chats.map(ch => {
        const isMy = ch.created_by === API.user.id;
        return `<div class="card" style="cursor:pointer;border-left:4px solid var(--blue)" onclick="AdminApp.openAdminChat(${ch.id})">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:600">${esc(ch.display_name)} ${ch.is_group?'<span class="badge-role">группа</span>':''}</div>
          <div style="display:flex;align-items:center;gap:6px">
            ${ch.unread?`<span style="background:var(--blue);color:#fff;font-size:11px;padding:2px 7px;border-radius:980px;font-weight:600">${ch.unread}</span>`:''}
            ${isMy?`<button class="btn btn-danger btn-sm" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();AdminApp.deleteAdminChat(${ch.id})">&#x2716;</button>`:''}
          </div>
        </div>
        ${ch.last_message?`<div class="text-sm text-gray" style="margin-top:4px">${ch.last_sender_name?'<b>'+esc(shortName(ch.last_sender_name))+':</b> ':''}${esc(ch.last_message)}</div>`:'<div class="text-sm text-gray" style="margin-top:4px">Нет сообщений</div>'}
        ${ch.last_msg_at?`<div class="text-tertiary" style="font-size:11px;margin-top:2px">${new Date(ch.last_msg_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>`:''}
      </div>`;}).join('') : '<p class="text-center text-gray">Нет чатов</p>'}`;
  },

  async showAdminCreateChat() {
    const [deps, comms] = await Promise.all([API.get('/api/deputy/linked-deputies'), API.get('/api/admin/commissions')]);
    if (!deps||!deps.length) { showToast('Нет привязанных депутатов','error'); return; }
    const commOpts = comms&&comms.length ? `<div class="form-group"><label>Из комиссии</label><select id="achat-com" class="form-control" onchange="AdminApp.onAdminChatComSelect()"><option value="">— Вручную —</option>${comms.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>` : '';
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal">
      <h3>Новый чат</h3>
      <div class="form-group"><label>Тип</label><select id="achat-type" class="form-control" onchange="document.getElementById('achat-name-g').classList.toggle('hidden',this.value==='personal')"><option value="personal">Личный</option><option value="group">Групповой</option></select></div>
      <div class="form-group hidden" id="achat-name-g"><label>Название</label><input id="achat-name" class="form-control" placeholder="Название чата"></div>
      ${commOpts}
      <div class="form-group"><label>Участники</label><div class="deputy-select-list">${deps.map(d=>`<label class="deputy-select-item"><input type="checkbox" value="${d.id}" class="achat-cb"> ${esc(d.full_name)}</label>`).join('')}</div></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="AdminApp.createAdminChat()">Создать</button></div>
    </div></div>`);
  },

  async onAdminChatComSelect() {
    const comId = document.getElementById('achat-com')?.value;
    if (!comId) { document.querySelectorAll('.achat-cb').forEach(c=>c.checked=false); return; }
    const members = await API.get(`/api/admin/commissions/${comId}/members`);
    if (!members) return;
    const ids = new Set(members.map(m=>m.id));
    document.querySelectorAll('.achat-cb').forEach(c=>c.checked=ids.has(parseInt(c.value)));
    document.getElementById('achat-type').value='group';
    document.getElementById('achat-name-g').classList.remove('hidden');
    const n=document.getElementById('achat-name');
    if(n&&!n.value) n.value=document.getElementById('achat-com').selectedOptions[0]?.text||'';
  },

  async createAdminChat() {
    const isGroup=document.getElementById('achat-type').value==='group';
    const name=document.getElementById('achat-name')?.value||'';
    const ids=Array.from(document.querySelectorAll('.achat-cb:checked')).map(c=>parseInt(c.value));
    if(!ids.length) return showToast('Выберите участников','error');
    if(isGroup&&!name) return showToast('Название','error');
    await API.post('/api/chat/create',{name:isGroup?name:null,member_ids:ids,is_group:isGroup});
    document.querySelector('.modal-overlay')?.remove();
    showToast('Чат создан','success');
    this.loadAdminChats();
  },

  async deleteAdminChat(chatId) {
    if (!confirm('Удалить чат и все сообщения?')) return;
    await API.del(`/api/chat/${chatId}`);
    showToast('Чат удалён', 'success');
    this.loadAdminChats();
  },

  async clearAdminChat(chatId) {
    if (!confirm('Очистить все сообщения?')) return;
    await API.post(`/api/chat/${chatId}/clear`);
    showToast('Чат очищен', 'success');
    this.loadAdminMsgs(chatId);
  },

  async openAdminChat(chatId) {
    this._adminOpenChatId = chatId;
    const chatList = await API.get('/api/chat/list');
    const chatInfo = (chatList||[]).find(ch => ch.id === chatId);
    const isCreator = chatInfo && chatInfo.created_by === API.user.id;
    const shortName = (n) => { const p=n.split(' '); return p[0]+(p[1]?' '+p[1][0]+'.':'')+(p[2]?p[2][0]+'.':''); };
    document.getElementById('admin-content').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <button class="btn btn-outline btn-sm" onclick="AdminApp._adminOpenChatId=null;AdminApp.loadAdminChats()">&#x2190; Назад</button>
        ${isCreator ? `<button class="btn btn-outline btn-sm" style="color:var(--text-tertiary)" onclick="AdminApp.clearAdminChat(${chatId})">Очистить чат</button>` : ''}
      </div>
      <div id="admin-chat-msgs" style="max-height:calc(100vh - 250px);overflow-y:auto;padding:8px 0"></div>
      <div style="display:flex;gap:8px;padding:12px 0;border-top:1px solid var(--border)">
        <input id="admin-chat-input" class="form-control" placeholder="Сообщение..." style="flex:1" onkeydown="if(event.key==='Enter')AdminApp.sendAdminMsg()">
        <button class="btn btn-primary" onclick="AdminApp.sendAdminMsg()">&#x27A4;</button>
      </div>`;
    await this.loadAdminMsgs(chatId);
    if(this._adminChatPolling) clearInterval(this._adminChatPolling);
    this._adminChatPolling = setInterval(()=>{if(this._adminOpenChatId===chatId)this.loadAdminMsgs(chatId,true);},3000);
  },

  async loadAdminMsgs(chatId, silent) {
    const msgs = await API.get(`/api/chat/${chatId}/messages`);
    if(!msgs) return;
    const el = document.getElementById('admin-chat-msgs');
    if(!el) return;
    const wasBottom = el.scrollHeight-el.scrollTop-el.clientHeight<50;
    const myId = API.user.id;
    const shortName = (n) => { const p=n.split(' '); return p[0]+(p[1]?' '+p[1][0]+'.':'')+(p[2]?p[2][0]+'.':''); };
    el.innerHTML = msgs.map(m=>{
      const isMine = m.sender_id===myId;
      const time = new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;justify-content:${isMine?'flex-end':'flex-start'};margin-bottom:4px">
        <div style="max-width:70%;padding:8px 12px;border-radius:${isMine?'16px 16px 4px 16px':'16px 16px 16px 4px'};background:${isMine?'var(--blue)':'var(--bg-input)'};color:${isMine?'#fff':'var(--text)'};font-size:14px;line-height:1.4;word-break:break-word" onclick="AdminApp.setAdminReply(${m.id},'${esc(shortName(m.sender_name))}','${esc(m.text.replace(/'/g,"\\'").substring(0,50))}')" style="cursor:pointer">
          ${!isMine?`<div style="font-size:11px;font-weight:600;color:var(--blue);margin-bottom:2px">${esc(shortName(m.sender_name))}</div>`:''}
          ${m.reply_to_text?`<div style="border-left:2px solid ${isMine?'rgba(255,255,255,.4)':'var(--blue)'};padding-left:8px;margin-bottom:4px;font-size:12px;opacity:.7">${esc(m.reply_to_text.length>50?m.reply_to_text.substring(0,50)+'...':m.reply_to_text)}</div>`:''}
          <div>${esc(m.text)}</div>
          <div style="font-size:10px;text-align:right;margin-top:2px;opacity:.6">${time}</div>
        </div></div>`;
    }).join('');
    if(!silent||wasBottom) el.scrollTop=el.scrollHeight;
  },

  setAdminReply(id,name,text) {
    this._adminReplyTo={id,name,text};
    let bar=document.getElementById('admin-reply-bar');
    const inp=document.getElementById('admin-chat-input');
    if(!bar&&inp) { inp.parentElement.insertAdjacentHTML('beforebegin','<div id="admin-reply-bar" style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px"></div>'); bar=document.getElementById('admin-reply-bar'); }
    if(bar) bar.innerHTML=`<div style="flex:1;border-left:2px solid var(--blue);padding-left:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>${esc(name)}</b>: ${esc(text)}</div><button class="btn-icon" onclick="AdminApp.cancelAdminReply()">&#x2716;</button>`;
    inp?.focus();
  },

  cancelAdminReply() { this._adminReplyTo=null; const b=document.getElementById('admin-reply-bar'); if(b)b.remove(); },

  async sendAdminMsg() {
    const inp=document.getElementById('admin-chat-input');
    if(!inp||!inp.value.trim()) return;
    const body={text:inp.value.trim()};
    if(this._adminReplyTo){body.reply_to_id=this._adminReplyTo.id;this.cancelAdminReply();}
    inp.value='';
    await API.post(`/api/chat/${this._adminOpenChatId}/send`,body);
    this.loadAdminMsgs(this._adminOpenChatId);
  },

  // === Admin Profile ===
  async loadAdminProfile() {
    const p = await API.get('/api/admin/profile');
    if (!p) return;
    const roleLabel = p.admin_role === 'system_admin' ? 'Системный администратор' : 'Администратор района';
    document.getElementById('admin-content').innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar">${esc(p.full_name||p.username).split(' ').map(w=>w[0]).join('').substring(0,2)}</div>
        <div>
          <h2>${esc(p.full_name||p.username)}</h2>
          <div class="text-secondary">${roleLabel}</div>
        </div>
      </div>

      <div class="profile-grid">
        <div class="profile-col">
          <div class="card">
            <h3 class="card-title">Личные данные</h3>
            <div class="form-group"><label>ФИО</label><input id="ap-name" class="form-control" value="${esc(p.full_name||'')}"></div>
            <div class="form-group"><label>Email</label><input type="email" id="ap-email" class="form-control" value="${esc(p.email||'')}"></div>
            <div class="form-group"><label>Логин</label><input id="ap-login" class="form-control" value="${esc(p.username)}"></div>
            <button class="btn btn-primary" onclick="AdminApp.saveAdminProfile()">Сохранить</button>
          </div>
        </div>

        <div class="profile-col">
          <div class="card">
            <h3 class="card-title">Сменить пароль</h3>
            <div class="form-group"><label>Текущий пароль</label><input type="password" id="ap-cp" class="form-control"></div>
            <div class="form-group"><label>Новый пароль</label><input type="password" id="ap-np" class="form-control" placeholder="Мин. 8 символов, A-z, 0-9, !@#">
              <span class="field-hint">Заглавная + строчная буква, цифра, спецсимвол</span></div>
            <button class="btn btn-primary" onclick="AdminApp.changeAdminPassword()">Сменить пароль</button>
          </div>

          <div class="card">
            <h3 class="card-title">Безопасность</h3>
            <p class="text-sm text-secondary" style="margin-bottom:12px">Passkey — вход по отпечатку или Face ID, без пароля</p>
            <button class="btn btn-outline btn-block" onclick="AdminApp.registerAdminPasskey()">Зарегистрировать Passkey</button>
          </div>
        </div>
      </div>`;
  },
  async saveAdminProfile() {
    await API.put('/api/admin/profile', {
      full_name: document.getElementById('ap-name').value,
      email: document.getElementById('ap-email').value,
      username: document.getElementById('ap-login').value
    });
    showToast('Профиль сохранён', 'success');
  },
  async changeAdminPassword() {
    const cp = document.getElementById('ap-cp').value;
    const np = document.getElementById('ap-np').value;
    if (!cp || !np || np.length < 8) return showToast('Минимум 8 символов', 'error');
    try {
      await API.post('/api/admin/change-password', { currentPassword: cp, newPassword: np });
      showToast('Пароль изменён', 'success');
      document.getElementById('ap-cp').value = '';
      document.getElementById('ap-np').value = '';
    } catch(e) {}
  },

  // === Settings ===
  async loadSettings() {
    const s=await API.get('/api/admin/settings');
    let balanceHtml='';
    try{const b=await API.get('/api/admin/ai/balance');balanceHtml=`<div class="stat-card" style="display:inline-block;margin-bottom:16px"><div class="stat-label">Баланс DeepSeek</div><div class="stat-value" style="font-size:20px">${b.balance_infos?b.balance_infos.map(i=>`${i.currency}: ${i.total_balance}`).join(', '):'Нет данных'}</div></div>`;}catch(e){balanceHtml=`<p class="text-sm text-gray">Баланс: ${s.deepseek_api_key?'ошибка загрузки':'ключ не указан'}</p>`;}

    let modelsHtml='<option value="deepseek-chat">deepseek-chat</option>';
    try{if(s.deepseek_api_key){const m=await API.get('/api/admin/ai/models');if(m.data)modelsHtml=m.data.map(x=>`<option value="${x.id}" ${s.deepseek_model===x.id?'selected':''}>${x.id}</option>`).join('');}}catch{}

    document.getElementById('admin-content').innerHTML=`
      <div class="card"><h2 style="margin-bottom:4px">DeepSeek AI</h2>
        <p class="hint-text">Искусственный интеллект используется для: генерации саммари заседаний, создания уникальных постов для соцсетей каждого депутата, подсказок по голосованию для депутатов в отпуске, очистки расшифровок аудио и генерации годовых отчётов.</p>
        ${balanceHtml}
        <div class="form-group"><label>API ключ</label>
          <input type="password" id="ds-k" class="form-control" value="${s.deepseek_api_key||''}" placeholder="sk-...">
          <span class="field-hint">Получите ключ на <a href="https://platform.deepseek.com/api_keys" target="_blank">platform.deepseek.com</a> → API Keys → Create. Скопируйте ключ (начинается с sk-).</span></div>
        <div class="form-group"><label>Модель</label>
          <select id="ds-m" class="form-control">${modelsHtml}</select>
          <span class="field-hint">deepseek-chat — основная модель для текстов. deepseek-reasoner — для сложного анализа (дороже).</span></div>
        <button class="btn btn-primary" onclick="AdminApp.saveAi()">Сохранить</button></div>

      <div class="card"><h2 style="margin-bottom:4px">Почта (SMTP)</h2>
        <p class="hint-text">Email используется для: отправки приглашений депутатам (ссылка регистрации Passkey), уведомлений о мероприятиях и напоминаний, сброса пароля администратора.</p>
        <div class="form-row">
          <div class="form-group" style="flex:2"><label>SMTP сервер</label><input id="sm-h" class="form-control" value="${s.smtp_host||''}" placeholder="smtp.yandex.ru">
            <span class="field-hint">Яндекс: smtp.yandex.ru, Mail.ru: smtp.mail.ru, Gmail: smtp.gmail.com</span></div>
          <div class="form-group" style="flex:1"><label>Порт</label><input type="number" id="sm-p" class="form-control" value="${s.smtp_port||'587'}">
            <span class="field-hint">587 (STARTTLS) или 465 (SSL)</span></div></div>
        <div class="form-group"><label>Шифрование</label>
          <select id="sm-s" class="form-control"><option value="false" ${s.smtp_secure!=='true'?'selected':''}>Нет (STARTTLS, порт 587)</option><option value="true" ${s.smtp_secure==='true'?'selected':''}>Да (SSL/TLS, порт 465)</option></select>
          <span class="field-hint">Для порта 587 выберите «Нет», для 465 — «Да»</span></div>
        <div class="form-group"><label>Логин</label><input id="sm-u" class="form-control" value="${s.smtp_user||''}" placeholder="noreply@example.com">
          <span class="field-hint">Обычно совпадает с email-адресом. Для Яндекс: ваш@yandex.ru</span></div>
        <div class="form-group"><label>Пароль</label><input type="password" id="sm-pw" class="form-control" value="${s.smtp_pass||''}">
          <span class="field-hint">Для Яндекс и Gmail используйте пароль приложения (не основной пароль аккаунта)</span></div>
        <div class="form-group"><label>От кого (email)</label><input id="sm-f" class="form-control" value="${s.smtp_from||''}" placeholder="noreply@example.com">
          <span class="field-hint">Адрес отправителя. Должен совпадать с логином или быть разрешённым на почтовом сервере</span></div>
        <div class="flex gap-8"><button class="btn btn-primary" onclick="AdminApp.saveSmtp()">Сохранить</button><button class="btn btn-outline" onclick="AdminApp.testSmtp()">Отправить тестовое письмо</button></div></div>

      <div class="card"><h2 style="margin-bottom:4px">Библиотека мероприятий</h2>
        <p class="hint-text">Шаблоны мероприятий — при создании заседания можно быстро выбрать из списка вместо ручного ввода</p>
        <div id="tpl-list">Загрузка...</div>
        <div class="flex gap-8 mt-16">
          <input id="tpl-name" class="form-control" placeholder="Название шаблона" style="flex:2">
          <select id="tpl-type" class="form-control" style="flex:1">
            <option value="regular">Очередное</option><option value="extraordinary">Внеочередное</option>
            <option value="field">Выездное</option><option value="commission">Комиссия</option></select>
          <select id="tpl-time" class="form-control" style="flex:1">
            <option value="19:00">19:00</option><option value="18:00">18:00</option>
            <option value="17:00">17:00</option><option value="16:00">16:00</option></select>
          <button class="btn btn-primary" onclick="AdminApp.addTemplate()">Добавить</button>
        </div>
      </div>`;
    // Load templates
    AdminApp.loadTemplateList();
  },

  async loadTemplateList() {
    // In settings (admin) — show global only. If staff, show district.
    const isStaffSettings = this.staffMode;
    const tpls = isStaffSettings
      ? await API.get(`/api/admin/event-templates?district_id=${this.selectedDistrict}`)
      : await API.get('/api/admin/event-templates');
    const TYPE_L = {regular:'Очередное',extraordinary:'Внеочередное',field:'Выездное',commission:'Комиссия'};
    const globalTpls = tpls.filter(t => !t.district_id);
    const localTpls = tpls.filter(t => t.district_id);

    let html = '';
    if (!isStaffSettings && globalTpls.length) {
      html += `<div class="table-wrap"><table><thead><tr><th>Название</th><th>Тип</th><th>Время</th><th></th></tr></thead>
        <tbody>${globalTpls.map(t => `<tr><td>${esc(t.name)}</td><td>${TYPE_L[t.event_type]||t.event_type}</td><td>${t.default_time}</td>
          <td><button class="btn btn-danger btn-sm" onclick="AdminApp.delTemplate(${t.id})">Удалить</button></td></tr>`).join('')}</tbody></table></div>`;
    }
    if (isStaffSettings) {
      if (globalTpls.length) html += `<p class="text-sm text-gray mt-8">Глобальные (от администратора):</p><div class="table-wrap"><table>
        <tbody>${globalTpls.map(t => `<tr><td>${esc(t.name)}</td><td>${TYPE_L[t.event_type]||''}</td><td>${t.default_time}</td><td></td></tr>`).join('')}</tbody></table></div>`;
      html += `<p class="text-sm mt-16" style="font-weight:600">Мои шаблоны (только для этого района):</p>`;
      if (localTpls.length) html += `<div class="table-wrap"><table>
        <tbody>${localTpls.map(t => `<tr><td>${esc(t.name)}</td><td>${TYPE_L[t.event_type]||''}</td><td>${t.default_time}</td>
          <td><button class="btn btn-danger btn-sm" onclick="AdminApp.delTemplate(${t.id})">Удалить</button></td></tr>`).join('')}</tbody></table></div>`;
      else html += '<p class="text-gray text-sm">Нет своих шаблонов</p>';
    }
    if (!isStaffSettings && !globalTpls.length) html = '<p class="text-gray text-sm">Нет шаблонов</p>';

    document.getElementById('tpl-list').innerHTML = html;
  },

  async addTemplate() {
    const name = document.getElementById('tpl-name').value;
    if (!name) return showToast('Укажите название', 'error');
    const district_id = this.staffMode ? (this.selectedDistrict || null) : null;
    await API.post('/api/admin/event-templates', {
      name, event_type: document.getElementById('tpl-type').value,
      default_time: document.getElementById('tpl-time').value,
      days_ahead: parseInt(document.getElementById('tpl-days')?.value || '10'),
      district_id
    });
    document.getElementById('tpl-name').value = '';
    showToast('Шаблон добавлен', 'success');
    this.loadTemplateList();
  },

  async delTemplate(id) { await API.del(`/api/admin/event-templates/${id}`); showToast('Удалено', 'success'); this.loadTemplateList(); },

  async addEventType() {
    const name = document.getElementById('et-name').value;
    if (!name) return showToast('Укажите название', 'error');
    const district_id = this.staffMode ? (this.selectedDistrict || null) : null;
    await API.post('/api/admin/event-types', { name, color: document.getElementById('et-color').value, district_id });
    showToast('Тип добавлен', 'success');
    this.loadTemplatesPage();
  },

  async delEventType(id) { if (!confirm('Удалить тип?')) return; await API.del(`/api/admin/event-types/${id}`); showToast('Удалено', 'success'); this.loadTemplatesPage(); },

  async saveAi(){await API.post('/api/admin/settings',{settings:{deepseek_api_key:document.getElementById('ds-k').value,deepseek_model:document.getElementById('ds-m').value}});showToast('OK','success');this.loadSettings();},
  async saveSmtp(){await API.post('/api/admin/settings',{settings:{smtp_host:document.getElementById('sm-h').value,smtp_port:document.getElementById('sm-p').value,smtp_user:document.getElementById('sm-u').value,smtp_pass:document.getElementById('sm-pw').value,smtp_from:document.getElementById('sm-f').value,smtp_secure:document.getElementById('sm-s').value}});showToast('OK','success');},
  async testSmtp(){const e=prompt('Email для теста:');if(!e)return;const r=await API.post('/api/admin/settings/test-email',{email:e});showToast(r.success?'Отправлено':'Ошибка',r.success?'success':'error');},
  async changePw(){try{await API.post('/api/admin/change-password',{currentPassword:document.getElementById('cp-c').value,newPassword:document.getElementById('cp-n').value});showToast('OK','success');}catch(e){}},
  async loadBlocks() {
    const list = await API.get('/api/admin/blocked-logins');
    if (!list) return;
    const blocked = list.filter(e => e.blocked);
    const attempts = list.filter(e => !e.blocked);
    document.getElementById('admin-content').innerHTML = `
      <h2 style="margin-bottom:12px">Блокировки входа</h2>
      <p class="hint-text" style="margin-bottom:16px">При 10 неудачных попытках входа за 15 минут IP-адрес блокируется. Здесь можно снять блокировку.</p>
      ${blocked.length ? blocked.map(e => `<div class="card" style="border-left:4px solid var(--red)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:600;font-size:1.05em">${esc(e.login)}</div>
            <div class="text-secondary text-sm">IP: ${esc(e.ip)} · ${e.attempts} попыток · ${e.blockedAt ? new Date(e.blockedAt).toLocaleString('ru-RU') : ''}</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.unblockIp('${esc(e.ip)}')">Разблокировать</button>
        </div>
      </div>`).join('') : '<div class="card"><p class="text-secondary">Нет заблокированных пользователей</p></div>'}
      ${attempts.length ? `<h3 style="margin:20px 0 12px">Неудачные попытки</h3>
        ${attempts.map(e => `<div class="card" style="border-left:4px solid var(--orange)">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-weight:600">${esc(e.login)}</div>
              <div class="text-secondary text-sm">IP: ${esc(e.ip)} · ${e.attempts} из 10 попыток</div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="AdminApp.unblockIp('${esc(e.ip)}')">Сбросить</button>
          </div>
        </div>`).join('')}` : ''}`;
  },
  async unblockIp(ip) {
    await API.post('/api/admin/unblock-ip', { ip });
    showToast('Разблокирован', 'success');
    this.loadBlocks();
  },

  async registerAdminPasskey() {
    try {
      const {options}=await API.post('/api/auth/admin-passkey/register-options');
      const response=await startPasskeyRegistration(options);
      await API.post('/api/auth/admin-passkey/register-verify',{response});
      showToast('Passkey зарегистрирован!','success');
    } catch(e) { showToast(e.name==='NotAllowedError'?'Отменено':(e.message||'Ошибка'),'error'); }
  }
};
