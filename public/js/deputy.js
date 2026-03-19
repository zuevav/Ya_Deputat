// Deputy app — mobile-first PWA view
const DeputyApp = {
  currentTab: 'events',
  events: [],
  unreadCount: 0,

  async init(hash) {
    document.body.className = 'deputy-view';

    // Check for event deep link
    if (hash && hash.startsWith('event-')) {
      const eventId = hash.replace('event-', '');
      this.renderShell();
      await this.showEventDetail(eventId);
      return;
    }

    this.renderShell();
    this.subscribePush();
    this.loadTab(this.currentTab);
    this.updateUnreadBadge();
  },

  renderShell() {
    document.getElementById('app').innerHTML = `
      <div class="header">
        <div style="display:flex;align-items:center">
          <button class="back-btn hidden" id="back-btn" onclick="DeputyApp.goBack()">&#x2190;</button>
          <h1>Я Депутат</h1>
        </div>
        <div class="header-right">
          <button class="btn-icon" onclick="App.logout()" title="Выйти">&#x2716;</button>
        </div>
      </div>
      <div class="container" id="deputy-content"></div>
      <div class="bottom-nav">
        <button class="nav-item active" data-tab="events" onclick="DeputyApp.loadTab('events')">
          <span class="nav-icon">&#x1F4C5;</span>
          <span>Мероприятия</span>
          <span class="nav-badge hidden" id="unread-badge">0</span>
        </button>
        <button class="nav-item" data-tab="calendar" onclick="DeputyApp.loadTab('calendar')">
          <span class="nav-icon">&#x1F4C6;</span>
          <span>Календарь</span>
        </button>
        <button class="nav-item" data-tab="profile" onclick="DeputyApp.loadTab('profile')">
          <span class="nav-icon">&#x1F464;</span>
          <span>Профиль</span>
        </button>
      </div>
    `;
  },

  loadTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
    document.getElementById('back-btn').classList.add('hidden');

    const tabs = {
      events: () => this.loadEvents(),
      calendar: () => this.loadCalendar(),
      profile: () => this.loadProfile()
    };
    (tabs[tab] || tabs.events)();
  },

  goBack() {
    this.loadTab(this.currentTab);
  },

  // === Events list ===
  async loadEvents() {
    this.events = await API.get('/api/deputy/events?filter=upcoming');
    const c = document.getElementById('deputy-content');

    if (!this.events.length) {
      c.innerHTML = '<div class="text-center text-gray mt-16"><p>Нет предстоящих мероприятий</p></div>';
      return;
    }

    c.innerHTML = `
      <div class="event-list">
        ${this.events.map(e => `
          <div class="event-card type-${e.event_type}" onclick="DeputyApp.showEventDetail(${e.id})">
            <div class="event-date">${formatDateTime(e.event_date)}</div>
            <div class="event-title">${e.title}</div>
            <div>
              <span class="event-type-badge badge-${e.event_type}">${EVENT_TYPE_LABELS[e.event_type]}</span>
              ${e.commission_name ? `<span class="text-sm text-gray" style="margin-left:8px">${e.commission_name}</span>` : ''}
            </div>
            <div class="event-status status-${e.my_status}">${STATUS_LABELS[e.my_status]}</div>
          </div>
        `).join('')}
      </div>
    `;
  },

  // === Event detail ===
  async showEventDetail(eventId) {
    const event = await API.get(`/api/deputy/events/${eventId}`);
    if (!event) return;

    // Mark as seen
    if (event.my_status === 'pending') {
      API.post(`/api/deputy/events/${eventId}/seen`);
      this.updateUnreadBadge();
    }

    document.getElementById('back-btn').classList.remove('hidden');
    const c = document.getElementById('deputy-content');

    const canRespond = ['pending', 'seen'].includes(event.my_status);

    c.innerHTML = `
      <div class="event-detail">
        <span class="event-type-badge badge-${event.event_type}">${EVENT_TYPE_LABELS[event.event_type]}</span>
        <h2 style="margin-top:8px">${event.title}</h2>

        <div class="event-meta">
          <div>&#x1F4C5; ${formatDateTime(event.event_date)}</div>
          ${event.location ? `<div>&#x1F4CD; ${event.location}</div>` : ''}
          ${event.commission_name ? `<div>&#x1F3DB; ${event.commission_name}</div>` : ''}
        </div>

        ${event.description ? `<div class="event-description">${event.description}</div>` : ''}

        ${event.files.length ? `
          <div class="event-files">
            <strong>Документы:</strong>
            ${event.files.map(f => `<a href="/uploads/${f.filename}" target="_blank">&#x1F4CE; ${f.original_name}</a>`).join('')}
          </div>
        ` : ''}

        <div class="event-status status-${event.my_status}" style="font-size:14px; margin:12px 0;">
          Статус: ${STATUS_LABELS[event.my_status]}
        </div>

        ${canRespond ? `
          <div class="event-actions">
            <button class="btn btn-success" onclick="DeputyApp.respondEvent(${eventId}, 'confirmed')">Приду</button>
            <button class="btn btn-danger" onclick="DeputyApp.respondEvent(${eventId}, 'declined')">Не смогу</button>
          </div>
        ` : ''}

        <div class="participants-list mt-16">
          <h4>Участники (${event.participants.length})</h4>
          ${event.participants.map(p => `
            <div class="participant-row">
              <span>${p.full_name}</span>
              <span class="status-${p.status}">${STATUS_LABELS[p.status]}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  async respondEvent(eventId, response) {
    await API.post(`/api/deputy/events/${eventId}/respond`, { response });
    showToast(response === 'confirmed' ? 'Вы подтвердили участие' : 'Вы отклонили участие', 'success');
    this.showEventDetail(eventId);
  },

  // === Calendar ===
  calendarDate: new Date(),

  async loadCalendar() {
    const allEvents = await API.get('/api/deputy/events?filter=all');
    const c = document.getElementById('deputy-content');

    const year = this.calendarDate.getFullYear();
    const month = this.calendarDate.getMonth();
    const monthName = this.calendarDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

    // Events by date
    const eventDates = {};
    allEvents.forEach(e => {
      const d = new Date(e.event_date).toDateString();
      if (!eventDates[d]) eventDates[d] = [];
      eventDates[d].push(e);
    });

    const firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay() || 7; // Monday = 1
    startDay--;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date().toDateString();

    let daysHtml = '';
    const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekdays.forEach(wd => { daysHtml += `<div class="calendar-weekday">${wd}</div>`; });

    // Fill empty cells before month start
    for (let i = 0; i < startDay; i++) {
      daysHtml += '<div class="calendar-day other-month"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = new Date(year, month, d).toDateString();
      const isToday = dateStr === today;
      const hasEvent = eventDates[dateStr];
      const classes = ['calendar-day'];
      if (isToday) classes.push('today');
      if (hasEvent) classes.push('has-event');
      daysHtml += `<div class="${classes.join(' ')}" onclick="DeputyApp.showCalendarDay('${dateStr}')">${d}</div>`;
    }

    c.innerHTML = `
      <div class="card">
        <div class="calendar-header">
          <button class="btn btn-outline btn-sm" onclick="DeputyApp.changeMonth(-1)">&#x25C0;</button>
          <strong style="text-transform:capitalize">${monthName}</strong>
          <button class="btn btn-outline btn-sm" onclick="DeputyApp.changeMonth(1)">&#x25B6;</button>
        </div>
        <div class="calendar-grid">${daysHtml}</div>
      </div>
      <div id="calendar-events"></div>
    `;

    // Show today's events
    this.showCalendarDayEvents(today, allEvents);
  },

  changeMonth(delta) {
    this.calendarDate.setMonth(this.calendarDate.getMonth() + delta);
    this.loadCalendar();
  },

  async showCalendarDay(dateStr) {
    const allEvents = await API.get('/api/deputy/events?filter=all');
    this.showCalendarDayEvents(dateStr, allEvents);
  },

  showCalendarDayEvents(dateStr, allEvents) {
    const dayEvents = allEvents.filter(e => new Date(e.event_date).toDateString() === dateStr);
    const container = document.getElementById('calendar-events');
    if (!container) return;

    if (!dayEvents.length) {
      container.innerHTML = '<p class="text-center text-gray mt-16">Нет мероприятий в этот день</p>';
      return;
    }

    container.innerHTML = `
      <div class="event-list mt-16">
        ${dayEvents.map(e => `
          <div class="event-card type-${e.event_type}" onclick="DeputyApp.showEventDetail(${e.id})">
            <div class="event-date">${formatDateTime(e.event_date)}</div>
            <div class="event-title">${e.title}</div>
            <span class="event-type-badge badge-${e.event_type}">${EVENT_TYPE_LABELS[e.event_type]}</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  // === Profile ===
  async loadProfile() {
    const profile = await API.get('/api/deputy/profile');
    const c = document.getElementById('deputy-content');

    c.innerHTML = `
      <div class="card">
        <h2 style="margin-bottom:16px">Мой профиль</h2>
        <div class="form-group">
          <label>ФИО</label>
          <div class="form-control" style="background:#f5f5f5">${profile.full_name}</div>
        </div>
        <div class="form-group">
          <label>Телефон</label>
          <div class="form-control" style="background:#f5f5f5">${profile.phone || '—'}</div>
        </div>
        <div class="form-group">
          <label>Email</label>
          <div class="form-control" style="background:#f5f5f5">${profile.email || '—'}</div>
        </div>
        <div class="mt-16">
          <button class="btn btn-primary btn-block" onclick="DeputyApp.togglePush()">
            Включить уведомления
          </button>
        </div>
        <div class="mt-16">
          <button class="btn btn-outline btn-block" onclick="App.logout()">Выйти</button>
        </div>
      </div>
    `;
  },

  // === Push notifications ===
  async subscribePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    try {
      const vapidData = await API.get('/api/deputy/vapid-key');
      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(vapidData.key)
      });

      await API.post('/api/deputy/push-subscribe', { subscription });
    } catch (err) {
      console.log('Push subscription failed:', err);
    }
  },

  async togglePush() {
    if (!('Notification' in window)) {
      showToast('Уведомления не поддерживаются', 'error');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await this.subscribePush();
      showToast('Уведомления включены', 'success');
    } else {
      showToast('Уведомления отклонены браузером', 'error');
    }
  },

  async updateUnreadBadge() {
    try {
      const data = await API.get('/api/deputy/unread-count');
      const badge = document.getElementById('unread-badge');
      if (badge) {
        badge.textContent = data.count;
        badge.classList.toggle('hidden', data.count === 0);
      }
    } catch { /* ignore */ }
  },

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
};
