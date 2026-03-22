const DeputyApp = {
  currentTab: localStorage.getItem('deputyTab') || 'events',

  isDesktop: false,

  async initDesktop(hash) {
    this.isDesktop = true;
    document.body.className = '';
    const savedFontSize = localStorage.getItem('ya-deputat-font-size');
    if (savedFontSize) document.documentElement.style.fontSize = savedFontSize;
    if (API.user.userType === 'staff') {
      try { const r = await API.get('/api/deputy/my-permissions'); this.staffPerms = r.permissions; } catch(e) {}
    }

    const isStaff = API.user.userType==='staff';
    const rl = API.user.deputyRole==='head'?'Глава СД МО':(isStaff?'Сотрудник':'Муниципальный депутат');
    const appName = isStaff ? 'Мой Депутат' : 'Я Депутат';
    document.getElementById('app').innerHTML = `
      <div class="header">
        <h1>${appName}</h1>
        <div class="header-right"><span class="text-sm">${API.user.name} <span class="badge-role">${rl}</span></span>
          <button class="btn-icon" onclick="App.logout()">&#x2716;</button></div>
      </div>
      <div class="admin-layout">
        <div class="sidebar">
          <button class="sidebar-item active" data-section="events" onclick="DeputyApp.desktopNav('events')">&#x1F4C5; Лента</button>
          <button class="sidebar-item" data-section="calendar" onclick="DeputyApp.desktopNav('calendar')">&#x1F4C6; Календарь</button>
          <button class="sidebar-item" data-section="receptions" onclick="DeputyApp.desktopNav('receptions')">&#x1F4CB; Приёмы <span class="nav-badge hidden" id="rec-badge-desk">0</span></button>
          <button class="sidebar-item" data-section="chat" onclick="DeputyApp.desktopNav('chat')">&#x1F4AC; Чат <span class="nav-badge hidden" id="chat-badge-desk">0</span></button>
          <button class="sidebar-item" data-section="profile" onclick="DeputyApp.desktopNav('profile')">&#x1F464; Профиль</button>
        </div>
        <div class="main-content" id="deputy-content"></div>
      </div>`;

    const section = localStorage.getItem('deputyTab') || 'events';
    this.desktopNav(hash?.startsWith('event-') ? 'events' : section);
    if (hash?.startsWith('event-')) this.showEventDetail(hash.replace('event-',''));
    this.updateUnreadBadge();
    Tutorial.show('deputy-desktop');
  },

  desktopNav(section) {
    this.currentTab = section;
    localStorage.setItem('deputyTab', section);
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.toggle('active', el.dataset.section === section));
    ({events:()=>this.loadEvents(), calendar:()=>this.loadCalendar(), receptions:()=>this.loadReceptions(), chat:()=>this.loadChats(), profile:()=>this.loadProfile()}[section] || this.loadEvents)();
  },

  _swipeStartX: 0,
  _swiping: false,

  initSwipeBack() {
    var self = this;
    var content = null;

    document.addEventListener('touchstart', function(e) {
      var backBtn = document.getElementById('back-btn');
      if (!backBtn || backBtn.classList.contains('hidden')) return;
      if (e.touches[0].clientX < 200) {
        self._swipeStartX = e.touches[0].clientX;
        self._swiping = true;
        content = document.getElementById('deputy-content');
        if (content) content.style.transition = 'none';
      }
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
      if (!self._swiping || !content) return;
      var dx = e.touches[0].clientX - self._swipeStartX;
      if (dx < 0) dx = 0;
      if (dx > 0) {
        content.style.transform = 'translateX(' + dx + 'px)';
        content.style.opacity = Math.max(0.3, 1 - dx / 400);
      }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      if (!self._swiping || !content) return;
      self._swiping = false;
      var dx = e.changedTouches[0].clientX - self._swipeStartX;

      if (dx > 100) {
        // Animate out
        content.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        content.style.transform = 'translateX(100%)';
        content.style.opacity = '0';
        setTimeout(function() {
          content.style.transform = '';
          content.style.opacity = '';
          content.style.transition = '';
          self.goBack();
        }, 250);
      } else {
        // Snap back
        content.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        content.style.transform = '';
        content.style.opacity = '';
        setTimeout(function() { if (content) content.style.transition = ''; }, 200);
      }
      self._swipeStartX = 0;
    }, { passive: true });
  },

  async init(hash) {
    this.isDesktop = false;
    document.body.className = 'deputy-view';
    const savedFontSize = localStorage.getItem('ya-deputat-font-size');
    if (savedFontSize) document.documentElement.style.fontSize = savedFontSize;
    // Load staff permissions
    if (API.user.userType === 'staff') {
      try { const r = await API.get('/api/deputy/my-permissions'); this.staffPerms = r.permissions; } catch(e) {}
    }
    if (hash?.startsWith('event-')) { this.renderShell(); await this.showEventDetail(hash.replace('event-','')); return; }
    this.renderShell(); this.subscribePush(); this.loadTab(this.currentTab); this.updateUnreadBadge(); this.initSwipeBack();
    const tutMode = API.user.userType === 'staff' ? 'staff-mobile' : 'deputy-mobile';
    Tutorial.show(tutMode);
  },

  staffPerms: null,

  renderShell() {
    const rl = API.user.deputyRole==='head'?'Глава СД МО':(API.user.userType==='staff'?'Сотрудник':'Муниципальный депутат');
    const isStaffWithPerms = API.user.userType==='staff' && this.staffPerms && Object.values(this.staffPerms).some(v=>v);

    const svgEvents = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    const svgCal = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>';
    const svgMgmt = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    const svgUser = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

    document.getElementById('app').innerHTML = `
      <div class="header"><div style="display:flex;align-items:center"><button class="back-btn hidden" id="back-btn" onclick="DeputyApp.goBack()">&#x2190;</button><h1>${API.user.userType==='staff'?'Мой Депутат':'Я Депутат'}</h1></div>
        <div class="header-right"><span class="text-sm">${rl}</span></div></div>
      <div class="container" id="deputy-content"></div>
      <div class="bottom-nav">
        <button class="nav-item active" data-tab="events" onclick="DeputyApp.loadTab('events')"><span class="nav-icon">${svgEvents}</span><span>Лента</span><span class="nav-badge hidden" id="unread-badge">0</span></button>
        <button class="nav-item" data-tab="calendar" onclick="DeputyApp.loadTab('calendar')"><span class="nav-icon">${svgCal}</span><span>Календарь</span></button>
        ${isStaffWithPerms ? `<button class="nav-item" data-tab="manage" onclick="DeputyApp.loadTab('manage')"><span class="nav-icon">${svgMgmt}</span><span>Депутаты</span></button>` : `<button class="nav-item" data-tab="receptions" onclick="DeputyApp.loadTab('receptions')"><span class="nav-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg></span><span>Приёмы</span><span class="nav-badge hidden" id="rec-badge">0</span></button>`}
        <button class="nav-item" data-tab="chat" onclick="DeputyApp.loadTab('chat')"><span class="nav-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span>Чат</span><span class="nav-badge hidden" id="chat-badge">0</span></button>
        <button class="nav-item" data-tab="profile" onclick="DeputyApp.loadTab('profile')"><span class="nav-icon">${svgUser}</span><span>Профиль</span></button>
      </div>`;
  },

  loadTab(t) { this._stopMobRec(); this.currentTab=t; this._lastDetailId=null; this._lastReceptionId=null; localStorage.setItem('deputyTab',t); document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.tab===t)); document.getElementById('back-btn').classList.add('hidden'); window.scrollTo({top:0,behavior:'instant'}); document.body.scrollTop=0; document.documentElement.scrollTop=0; ({events:()=>this.loadEvents(),calendar:()=>this.loadCalendar(),receptions:()=>this.loadReceptions(),chat:()=>this.loadChats(),manage:()=>this.loadManage(),profile:()=>this.loadProfile()}[t]||this.loadEvents)(); },
  goBack() {
    // Stop recorder if active
    this._stopMobRec();
    // Close gallery first if open
    const gallery = document.getElementById('photo-gallery-modal');
    if (gallery) { this._closeGallery(); return; }
    // Close any modal overlay
    const modal = document.querySelector('.modal-overlay');
    if (modal) { modal.remove(); return; }
    this._lastDetailId = null;
    this._lastReceptionId = null;
    this._openChatId = null;
    if (this._chatPolling) { clearInterval(this._chatPolling); this._chatPolling = null; }
    // Restore body scroll and bottom nav
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    if (this._chatScrollY) window.scrollTo(0, this._chatScrollY);
    const nav = document.querySelector('.bottom-nav');
    if (nav) nav.style.display = '';
    // Remove viewport handler
    if (this._chatViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._chatViewportHandler);
      window.visualViewport.removeEventListener('scroll', this._chatViewportHandler);
      this._chatViewportHandler = null;
    }
    // Remove chat wrap
    const cw = document.getElementById('chat-wrap');
    if (cw) cw.remove();
    this.loadTab(this.currentTab);
  },

  // === Feed ===
  _feedData: [],
  _feedShown: 0,
  _feedPageSize: 10,

  async loadEvents() {
    const isStaff = API.user.userType === 'staff';
    let es, recs, personalEvts;

    if (isStaff) {
      const [feed, myEvents] = await Promise.all([
        API.get('/api/deputy/staff-feed'),
        API.get('/api/deputy/events?filter=all')
      ]);
      if (!feed) return;
      // Merge: staff-feed events + own events (with my_status), dedup by id
      const myMap = {};
      if (myEvents) myEvents.forEach(e => myMap[e.id] = e);
      es = (feed.events||[]).map(e => myMap[e.id] ? {...e, my_status: myMap[e.id].my_status, ai_post_text: myMap[e.id].ai_post_text} : e);
      recs = feed.receptions; personalEvts = feed.personalEvents || [];
    } else {
      [es, recs] = await Promise.all([
        API.get('/api/deputy/events?filter=all'),
        API.get('/api/deputy/receptions')
      ]);
      personalEvts = [];
    }

    const c = document.getElementById('deputy-content');
    if (!c) return;

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);

    // Merge and sort: upcoming first, then recent past
    const feed = [];
    if (es && Array.isArray(es)) es.forEach(e => feed.push({ type: 'event', date: new Date(e.event_date), data: e }));
    // Only include receptions from last 30 days and future
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const showRecs = !isStaff || localStorage.getItem('ya-deputat-show-receptions') !== 'false';
    if (showRecs && recs && Array.isArray(recs)) recs.filter(r => isStaff || r.status === 'confirmed').forEach(r => {
      const rd = new Date(r.reception_date + 'T' + (r.time_start||'00:00'));
      if (rd >= thirtyDaysAgo) feed.push({ type: 'reception', date: rd, data: r });
    });
    if (personalEvts && personalEvts.length) personalEvts.forEach(pe => {
      feed.push({ type: 'personal', date: new Date(pe.event_date), data: pe });
    });
    // Sort: all by date, closest to now first (future ascending, past descending)
    feed.sort((a, b) => {
      const aDiff = Math.abs(a.date - now);
      const bDiff = Math.abs(b.date - now);
      const aFuture = a.date >= now;
      const bFuture = b.date >= now;
      // Future events first
      if (aFuture && !bFuture) return -1;
      if (!aFuture && bFuture) return 1;
      // Both future: nearest first
      if (aFuture && bFuture) return a.date - b.date;
      // Both past: most recent first
      return b.date - a.date;
    });

    this._feedData = feed;
    this._feedShown = 0;
    this._pastSeparatorShown = false;

    if (!feed.length) { c.innerHTML = '<div class="text-center text-gray mt-16">Нет событий</div>'; return; }

    c.innerHTML = '<div class="event-list" id="feed-list"></div>';
    this.renderFeedPage();

    // Infinite scroll
    var self = this;
    var scrollHandler = function() {
      if (self.currentTab !== 'events') return;
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 200) {
        self.renderFeedPage();
      }
    };
    window.removeEventListener('scroll', self._feedScrollHandler);
    self._feedScrollHandler = scrollHandler;
    window.addEventListener('scroll', scrollHandler, { passive: true });
  },

  _pastSeparatorShown: false,

  renderFeedPage() {
    const list = document.getElementById('feed-list');
    if (!list) return;
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
    const start = this._feedShown;
    const end = Math.min(start + this._feedPageSize, this._feedData.length);
    if (start >= end) return;

    let html = '';
    for (let i = start; i < end; i++) {
      const item = this._feedData[i];
      const isPast = item.date < threeDaysAgo;
      const pastStyle = isPast ? 'opacity:0.5;' : '';

      // Separator before past events
      if (isPast && !this._pastSeparatorShown) {
        html += '<div style="text-align:center;padding:16px 0;color:var(--text-tertiary);font-size:13px;border-top:1px solid var(--border);margin-top:8px">Прошедшие события</div>';
        this._pastSeparatorShown = true;
      }

      const _isStaff = API.user.userType === 'staff';

      if (item.type === 'personal') {
        const pe = item.data;
        const d = new Date(pe.event_date);
        html += `<div class="event-card" style="border-left-color:var(--purple);${pastStyle}">
          <div class="event-date">${d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}, ${d.toLocaleDateString('ru-RU',{weekday:'short'})}</div>
          <div class="event-title">${esc(pe.title)}</div>
          ${pe.deputy_name ? `<div class="text-sm" style="color:var(--blue)">${esc(pe.deputy_name)}</div>` : ''}
        </div>`;
      } else if (item.type === 'reception') {
        const r = item.data;
        const d = new Date(r.reception_date);
        const recIsPast = new Date(r.reception_date) < now;
        const recPostBtn = _isStaff && recIsPast ? (r.post_text
          ? `<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="event.stopPropagation();DeputyApp._showPostContent(decodeURIComponent('${encodeURIComponent(r.post_text)}'))">Посмотреть пост</button>`
          : `<div class="text-sm text-gray" style="margin-top:6px">Нет текста для поста</div>`) : '';
        html += `<div class="event-card reception-card" style="border-left-color:var(--purple);${pastStyle}" onclick="DeputyApp.showReceptionDetail(${r.id})">
          <div class="reception-date">${d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}, ${d.toLocaleDateString('ru-RU',{weekday:'short'})}</div>
          <div class="reception-time" style="font-size:0.9em">${r.time_start}\u2013${r.time_end}</div>
          <div class="event-title">Приём населения</div>
          ${_isStaff && r.deputy_name ? `<div class="text-sm" style="color:var(--blue)">${esc(r.deputy_name)}</div>` : ''}
          ${r.location ? `<div class="text-sm text-gray">${esc(r.location)}</div>` : ''}
          ${recPostBtn}
        </div>`;
      } else {
        const e = item.data;
        const postBtn = (!_isStaff && e.status==='closed') ? (e.ai_post_text
          ? `<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="event.stopPropagation();DeputyApp.showPostModal(${e.id})">Посмотреть пост</button>`
          : `<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="event.stopPropagation();DeputyApp.generateEventPost(${e.id},this)">Создать пост</button>`) : '';
        const isNew = e.my_status === 'pending';
        html += `<div class="event-card type-${e.event_type}" style="${pastStyle}${isNew?'border-left-width:5px;':''}" onclick="DeputyApp.showEventDetail(${e.id})">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-date">${formatDateTime(e.event_date)}</div>
            ${isNew ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--blue);flex-shrink:0"></span>' : ''}
          </div>
          <div class="event-title">${esc(e.title)}</div>
          ${_isStaff && e.deputy_names && e.event_type !== 'regular' ? `<div class="text-sm" style="color:var(--blue)">${esc(e.deputy_names)}</div>` : ''}
          <div><span class="event-type-badge badge-${e.event_type}">${EVENT_TYPE_LABELS[e.event_type]||esc(e.event_type)}</span>
            ${e.status==='closed'?'<span class="badge-closed" style="margin-left:6px">Завершено</span>':''}
            ${isNew?'<span style="margin-left:6px;color:var(--blue);font-size:11px;font-weight:600">Новое</span>':''}
            ${!_isStaff && e.admin_block_text&&!e.block_confirmed?'<span class="badge-vacation" style="margin-left:6px">Подтвердите</span>':''}</div>
          ${!_isStaff ? `<div class="event-status status-${e.my_status}">${STATUS_LABELS[e.my_status]}</div>` : ''}
          ${postBtn}
        </div>`;
      }
    }
    list.insertAdjacentHTML('beforeend', html);
    this._feedShown = end;
  },

  async showEventDetail(eid) {
    const e=await API.get(`/api/deputy/events/${eid}`);if(!e)return;
    if(e.my_status==='pending'){API.post(`/api/deputy/events/${eid}/seen`);this.updateUnreadBadge();}
    this._lastDetailId = eid;
    this._lastReceptionId = null;
    document.getElementById('back-btn').classList.remove('hidden');

    const isClosed = e.status === 'closed';
    const canResp = !isClosed && ['pending','seen'].includes(e.my_status);
    const VL={support:'За',abstain:'Воздержался',oppose:'Против'};
    const photos = e.files.filter(f=>f.file_type==='photo');
    const docs = e.files.filter(f=>f.file_type==='document');
    const audio = e.files.filter(f=>f.file_type==='audio');

    // Agenda
    let agendaH = '';
    if (e.agenda_items.length) {
      agendaH = `<div class="card mt-16"><h4>Повестка дня</h4><ol class="agenda-list">${e.agenda_items.map(a =>
        `<li>${esc(a.title)}</li>`).join('')}</ol></div>`;
    }

    // Voting (only if on vacation or declined)
    let votingH = '';
    if (e.agenda_items.length && e.can_vote) {
      votingH = `<div class="card mt-16"><h4>Голосование</h4>${e.agenda_items.map(a=>{
        const mv=e.my_votes.find(v=>v.agenda_item_id===a.id);
        return`<div class="vote-item"><div class="vote-title">${a.item_order+1}. ${esc(a.title)}</div>
          ${mv?.ai_suggestion?`<div class="ai-hint">\u{1F916} ИИ: <strong>${VL[mv.ai_suggestion]}</strong>${mv.ai_reasoning?' — '+esc(mv.ai_reasoning):''}</div>`:''}
          ${!isClosed?`<div class="vote-btns">
            <button class="btn btn-sm ${mv?.vote==='support'?'btn-success':'btn-outline'}" onclick="DeputyApp.vote(${eid},${a.id},'support')">За</button>
            <button class="btn btn-sm ${mv?.vote==='abstain'?'btn-warning':'btn-outline'}" onclick="DeputyApp.vote(${eid},${a.id},'abstain')">Воздержался</button>
            <button class="btn btn-sm ${mv?.vote==='oppose'?'btn-danger':'btn-outline'}" onclick="DeputyApp.vote(${eid},${a.id},'oppose')">Против</button>
          </div>`:`<div class="text-sm" style="margin-top:4px">${mv?.vote?VL[mv.vote]:'Не голосовал'}</div>`}
        </div>`;}).join('')}</div>`;
    }

    // Admin block
    let blockH = '';
    if (e.admin_block_text) {
      blockH = `<div class="card mt-16" style="background:${e.block_confirmed?'var(--green-light)':'var(--orange-light)'}">
        <h4>${e.block_confirmed?'\u2714 Подтверждено':'\u26A0 Требуется подтверждение'}</h4>
        <p style="white-space:pre-wrap">${esc(e.admin_block_text)}</p>
        ${!isClosed && !e.block_confirmed?`<div class="flex gap-8 mt-8">
          <button class="btn btn-success btn-sm" onclick="DeputyApp.confirmBlock(${eid})">Подтвердить</button>
          <button class="btn btn-outline btn-sm" onclick="DeputyApp.editBlock(${eid})">Изменить</button>
        </div>`:''}
        ${e.deputy_response_text?`<div class="mt-8"><strong>Ваша версия:</strong><p>${esc(e.deputy_response_text)}</p></div>`:''}
      </div>`;
    }

    document.getElementById('deputy-content').innerHTML=`<div class="event-detail">
      <div class="flex gap-8" style="align-items:center;flex-wrap:wrap">
        <span class="event-type-badge badge-${e.event_type}">${EVENT_TYPE_LABELS[e.event_type] || e.event_type}</span>
        ${isClosed?'<span class="badge-closed">Завершено</span>':''}
        <span class="status-${e.my_status}" style="font-size:13px">${STATUS_LABELS[e.my_status]}</span>
      </div>
      <h2 style="margin-top:8px">${esc(e.title)}</h2>
      <div class="event-meta">
        <div>\u{1F4C5} ${formatDateTime(e.event_date)}</div>
        ${e.location?`<div>\u{1F4CD} ${esc(e.location)}</div>`:''}
        ${e.commission_name?`<div>\u{1F3DB} ${esc(e.commission_name)}</div>`:''}
      </div>

      ${e.description?`<div class="event-description">${esc(e.description)}</div>`:''}

      ${!isClosed && canResp ? `<div class="event-actions">
        <button class="btn btn-success" onclick="DeputyApp.respond(${eid},'confirmed')">Подтвердить участие</button>
        <button class="btn btn-danger" onclick="DeputyApp.respond(${eid},'declined')">Не смогу</button>
      </div>` : ''}

      ${!isClosed && API.user.userType==='staff' ? `<div style="margin-top:12px"><button class="btn btn-outline btn-block" onclick="DeputyApp.staffRemindFromDetail(${eid})">Напомнить участникам</button></div>` : ''}

      ${isClosed && API.user.userType!=='staff' ? `<div class="card mt-16" style="background:var(--green-light)">
        <h4>\u{1F4DD} Пост для соцсетей</h4>
        ${e.ai_post_text ? `<p id="pt" style="white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(e.ai_post_text)}</p>
          <div class="flex gap-8 mt-8">
            <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('pt').innerText);showToast('Скопировано','success')">Копировать текст</button>
            ${e.post_gen_count < 3 ? `<button class="btn btn-outline btn-sm" onclick="DeputyApp.regeneratePost(${eid})">Сгенерировать заново (${3 - e.post_gen_count} из 3)</button>` : '<span class="text-tertiary text-sm">Лимит генераций исчерпан</span>'}
          </div>`
          : `<p class="text-gray">Текст ещё не сгенерирован</p>
          <button class="btn btn-primary mt-8" onclick="DeputyApp.generatePost(${eid})">Сгенерировать пост через ИИ</button>`}
      </div>` : ''}

      ${(() => {
        const docsHtml = docs.length ? `<div class="file-chips mt-8">${docs.map(f => {
          const ext = f.original_name.split('.').pop().toUpperCase();
          const icon = f.original_name.match(/\.(doc|docx)$/i)?'\u{1F4C4}':f.original_name.match(/\.(xls|xlsx)$/i)?'\u{1F4CA}':f.original_name.match(/\.(pdf)$/i)?'\u{1F4D5}':'\u{1F4CE}';
          const isPdf = f.original_name.match(/\.pdf$/i);
          return `<div class="file-chip" style="cursor:pointer" onclick="${isPdf ? `DeputyApp.openPdfViewer('/uploads/${f.filename}','${f.original_name.replace(/'/g,"\\'")}')` : `DeputyApp.downloadFile('/uploads/${f.filename}','${f.original_name.replace(/'/g,"\\'")}')` }">
            <div class="file-chip-icon">${icon}</div>
            <div class="file-chip-ext">${ext}</div>
            <div class="file-chip-name">${f.original_name.length>18?esc(f.original_name.substring(0,15))+'...':esc(f.original_name)}</div>
          </div>`;}).join('')}</div>` : '';
        const photosHtml = photos.length ? `<div class="card mt-16"><h4>\u{1F4F7} Фото (${photos.length})</h4>
          <p class="field-hint" style="margin-bottom:8px">Фото хранятся 1 год с даты мероприятия. Сохраните нужные заранее.</p>
          <p class="field-hint" style="margin-bottom:8px">Нажмите на фото для просмотра. Зажмите для сохранения.</p>
          <div class="photo-grid mt-8">${photos.map((f,i)=>`<div class="photo-item">
            <input type="checkbox" class="photo-cb" data-url="/uploads/${f.filename}" data-name="${esc(f.original_name)}" checked style="display:none">
            <img src="/uploads/${f.filename}" loading="lazy" style="cursor:pointer;border-radius:8px" onclick="DeputyApp._galleryPhotos=[${photos.map(p=>`{url:'/uploads/${p.filename}',name:'${p.original_name.replace(/'/g,"\\'")}'}`).join(',')}];DeputyApp._showGalleryPhoto(${i})">
          </div>`).join('')}</div></div>` : '';
        const audioHtml = audio.length ? `<div class="card mt-16"><h4>\u{1F399} Аудиозаписи</h4>${audio.map(f=>`<div style="margin:8px 0"><audio controls src="/uploads/${f.filename}" style="width:100%"></audio><div class="text-sm text-gray">${esc(f.original_name)}</div></div>`).join('')}</div>` : '';
        const transcriptHtml = e.audio_transcription ? `<details class="card mt-16" style="cursor:pointer"><summary style="font-weight:600;padding:2px 0">\u{1F4DD} Расшифровка</summary><p style="white-space:pre-wrap;font-size:14px;line-height:1.6;max-height:300px;overflow-y:auto;margin-top:8px">${esc(e.audio_transcription)}</p></details>` : '';

        if (isClosed) {
          // Closed: photos on top, rest collapsible
          return `${photosHtml}
            ${agendaH ? `<details class="card mt-16" style="cursor:pointer"><summary style="font-weight:600;padding:2px 0">Повестка дня (${e.agenda_items.length})</summary><ol class="agenda-list mt-8">${e.agenda_items.map(a=>`<li>${esc(a.title)}</li>`).join('')}</ol></details>` : ''}
            ${e.ai_summary ? `<details class="card mt-16" style="cursor:pointer"><summary style="font-weight:600;padding:2px 0">\u{1F916} Анализ документов</summary><p style="white-space:pre-wrap;font-size:14px;line-height:1.6;margin-top:8px">${esc(e.ai_summary)}</p></details>` : ''}
            ${docs.length ? `<details class="card mt-16" style="cursor:pointer"><summary style="font-weight:600;padding:2px 0">\u{1F4CE} Документы (${docs.length})</summary>${docsHtml}</details>` : ''}
            ${blockH}
            ${audio.length ? `<details class="card mt-16" style="cursor:pointer"><summary style="font-weight:600;padding:2px 0">\u{1F399} Аудиозаписи (${audio.length})</summary><div style="margin-top:8px">${audio.map(f=>`<div style="margin:8px 0"><audio controls src="/uploads/${f.filename}" style="width:100%"></audio><div class="text-sm text-gray">${esc(f.original_name)}</div></div>`).join('')}</div></details>` : ''}
            ${transcriptHtml}`;
        } else {
          // Open: agenda, docs, summary prominent
          return `${agendaH}
            ${e.ai_summary?`<div class="card mt-16" style="background:var(--blue-light)"><h4>\u{1F916} Анализ документов</h4><p style="white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(e.ai_summary)}</p></div>`:''}
            ${docs.length ? `<div class="card mt-16"><h4>\u{1F4CE} Документы (${docs.length})</h4>${docsHtml}</div>` : ''}
            ${blockH}
            ${photosHtml}
            ${audioHtml}
            ${transcriptHtml}`;
        }
      })()}

      ${votingH}

      <div class="participants-list mt-16"><h4>Участники (${e.participants.length})</h4>
        ${e.participants.sort((a,b)=>{const o={head:0,vice_head:1};return (o[a.deputy_role]??2)-(o[b.deputy_role]??2)||a.full_name.localeCompare(b.full_name)}).map(p=>`<div class="participant-row">
          <span>${esc(p.full_name)} ${p.deputy_role==='head'?'<span class="badge-head">Глава СД</span>':''} ${p.user_type==='staff'?'<span class="text-tertiary">(сотр.)</span>':''} ${p.on_vacation?'<span class="badge-vacation">в отпуске</span>':''}</span>
          <span class="status-${p.status}">${STATUS_LABELS[p.status]}</span>
        </div>`).join('')}
      </div>
    </div>`;
  },

  async _sharePhoto(url, name) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch(e) {
      if (e.name === 'AbortError') return; // user cancelled share
    }
    // Fallback
    this._savePhoto(url, name);
  },

  async _savePhoto(url, name) {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = name || 'photo.jpg';
    a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 1000);
  },

  async downloadAllPhotos(eid) {
    const cbs = document.querySelectorAll('.photo-cb');
    if (!cbs.length) return;
    showToast(`Сохранение ${cbs.length} фото...`, 'info');
    for (let i = 0; i < cbs.length; i++) {
      try { await this._savePhoto(cbs[i].dataset.url, cbs[i].dataset.name); } catch(e) {}
      await new Promise(r => setTimeout(r, 500));
    }
    showToast(`${cbs.length} фото сохранено`, 'success');
  },

  async downloadSelectedPhotos(eid) {
    const cbs = document.querySelectorAll('.photo-cb:checked');
    if (!cbs.length) return showToast('Выберите фото', 'error');
    showToast(`Сохранение ${cbs.length} фото...`, 'info');
    for (let i = 0; i < cbs.length; i++) {
      try { await this._savePhoto(cbs[i].dataset.url, cbs[i].dataset.name); } catch(e) {}
      await new Promise(r => setTimeout(r, 500));
    }
    showToast(`${cbs.length} фото сохранено`, 'success');
  },

  openPhotoGallery(eid) {
    const cbs = document.querySelectorAll('.photo-cb');
    const photos = Array.from(cbs).map(cb => ({ url: cb.dataset.url, name: cb.dataset.name }));
    if (!photos.length) return;
    this._galleryPhotos = photos;
    this._galleryIndex = 0;
    this._showGalleryPhoto(0);
  },

  editMessage(msgId, currentText) {
    const newText = prompt('Редактировать сообщение:', currentText);
    if (newText === null || newText.trim() === '' || newText === currentText) return;
    API.put(`/api/chat/${this._openChatId}/messages/${msgId}`, { text: newText.trim() }).then(() => {
      this.loadMessages(this._openChatId);
    });
  },

  async deleteMessage(msgId) {
    if (!confirm('Удалить сообщение?')) return;
    await API.del(`/api/chat/${this._openChatId}/messages/${msgId}`);
    this.loadMessages(this._openChatId);
  },

  async deleteChat(chatId) {
    if (!confirm('Удалить чат и все сообщения?')) return;
    await API.del(`/api/chat/${chatId}`);
    showToast('Чат удалён', 'success');
    this.loadChats();
  },

  async clearChat(chatId) {
    if (!confirm('Очистить все сообщения в чате?')) return;
    await API.post(`/api/chat/${chatId}/clear`);
    showToast('Чат очищен', 'success');
    this.loadMessages(chatId);
  },

  _closeChatAndBack() {
    this._openChatId = null;
    if (this._chatPolling) { clearInterval(this._chatPolling); this._chatPolling = null; }
    if (this._chatViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._chatViewportHandler);
      window.visualViewport.removeEventListener('scroll', this._chatViewportHandler);
      this._chatViewportHandler = null;
    }
    // Restore body
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    const nav = document.querySelector('.bottom-nav');
    if (nav) nav.style.display = '';
    const cw = document.getElementById('chat-wrap');
    if (cw) cw.remove();
    this.loadChats();
  },

  _closeGallery() {
    const g = document.getElementById('photo-gallery-modal');
    if (g) g.remove();
    document.body.style.overflow = '';
  },

  _showGalleryPhoto(idx) {
    const photos = this._galleryPhotos;
    if (!photos || idx < 0 || idx >= photos.length) return;
    this._galleryIndex = idx;
    const existing = document.getElementById('photo-gallery-modal');
    if (!existing) document.body.style.overflow = 'hidden';
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="photo-gallery-modal" class="modal-overlay" style="z-index:250;padding:0;background:rgba(0,0,0,.9);flex-direction:column;touch-action:none;overscroll-behavior:none">
      <div style="position:absolute;top:0;left:0;right:0;padding-top:env(safe-area-inset-top);background:rgba(0,0,0,.6);z-index:2">
        <div style="height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 16px">
          <span style="color:#fff;font-size:14px;font-weight:500">${idx+1} / ${photos.length}</span>
          <div style="display:flex;gap:8px">
            <button style="color:#fff;font-size:20px;background:none;border:none;cursor:pointer;padding:6px 12px" onclick="DeputyApp._closeGallery()">&#x2716;</button>
          </div>
        </div>
      </div>
      <div id="gallery-track" style="display:flex;align-items:center;flex:1;overflow:visible;position:relative">
        <a href="${photos[idx].url}" style="display:flex;align-items:center;justify-content:center;width:100%;flex-shrink:0;-webkit-touch-callout:default" onclick="event.preventDefault()">
          <img src="${photos[idx].url}" style="max-width:92%;max-height:calc(100vh - 130px);object-fit:contain;-webkit-touch-callout:default;-webkit-user-select:auto" id="gallery-img">
        </a>
        ${idx > 0 ? `<img src="${photos[idx-1].url}" style="position:absolute;left:-88%;width:80%;max-height:calc(100vh - 160px);object-fit:contain;opacity:.25;border-radius:8px;pointer-events:none">` : ''}
        ${idx < photos.length-1 ? `<img src="${photos[idx+1].url}" style="position:absolute;right:-88%;width:80%;max-height:calc(100vh - 160px);object-fit:contain;opacity:.25;border-radius:8px;pointer-events:none">` : ''}
      </div>
      <div style="position:absolute;bottom:0;left:0;right:0;padding-bottom:env(safe-area-inset-bottom);background:rgba(0,0,0,.6)">
        <div style="height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 16px">
          ${idx > 0 ? `<button class="btn btn-outline btn-sm" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="event.stopPropagation();DeputyApp._showGalleryPhoto(${idx-1})">&#x2190;</button>` : '<span style="width:36px"></span>'}
          <button style="color:#fff;font-size:14px;padding:8px 20px;border:1px solid rgba(255,255,255,.4);border-radius:980px;background:rgba(255,255,255,.1);cursor:pointer" onclick="event.stopPropagation();DeputyApp._sharePhoto('${photos[idx].url}','${(photos[idx].name||'photo.jpg').replace(/'/g,"\\'")}')">Сохранить</button>
          ${idx < photos.length-1 ? `<button class="btn btn-outline btn-sm" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="event.stopPropagation();DeputyApp._showGalleryPhoto(${idx+1})">&#x2192;</button>` : '<span style="width:36px"></span>'}
        </div>
      </div>
    </div>`);
    const modal = document.getElementById('photo-gallery-modal');
    const track = document.getElementById('gallery-track');
    modal.addEventListener('click', (e) => { if (e.target.id === 'photo-gallery-modal') DeputyApp._closeGallery(); });
    let sx = 0, sy = 0, moving = false;
    modal.addEventListener('touchstart', (e) => {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; moving = true;
      if (track) track.style.transition = 'none';
    }, { passive: true });
    modal.addEventListener('touchmove', (e) => {
      if (!moving || !track) return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
        track.style.transform = `translateX(${dx}px)`;
      }
    }, { passive: false });
    modal.addEventListener('touchend', (e) => {
      moving = false;
      if (!track) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        const nextIdx = dx < 0 ? idx + 1 : idx - 1;
        if (nextIdx >= 0 && nextIdx < photos.length) {
          track.style.transition = 'transform .25s ease';
          track.style.transform = `translateX(${dx < 0 ? '-100%' : '100%'})`;
          setTimeout(() => DeputyApp._showGalleryPhoto(nextIdx), 250);
        } else {
          track.style.transition = 'transform .2s ease';
          track.style.transform = '';
        }
      } else {
        track.style.transition = 'transform .2s ease';
        track.style.transform = '';
      }
    }, { passive: true });
  },

  openPdfViewer(url, name) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" style="z-index:250;padding:0">
      <div style="position:absolute;top:0;left:0;right:0;height:50px;background:var(--bg-card);display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--border);z-index:2">
        <span style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${name}</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="DeputyApp.downloadFile('${url}','${name.replace(/'/g,"\\'")}')">Скачать</button>
          <button class="btn btn-outline btn-sm" onclick="this.closest('.modal-overlay').remove()">Закрыть</button>
        </div>
      </div>
      <iframe src="${url}" style="width:100%;height:100%;border:none;margin-top:50px"></iframe>
    </div>`);
  },

  async downloadFile(url, name) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = name || 'document';
      a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 1000);
      showToast('Скачивание: ' + name, 'success');
    } catch(e) {
      // Fallback — open in new tab
      window.open(url, '_blank');
    }
  },

  async generatePost(eid) {
    showToast('Генерация поста...', 'info');
    try {
      const r = await API.post(`/api/deputy/events/${eid}/generate-post`);
      showToast('Пост сгенерирован', 'success');
      this.showEventDetail(eid);
    } catch(e) { showToast(e.message || 'Ошибка', 'error'); }
  },

  async regeneratePost(eid) {
    if (!confirm('Сгенерировать текст заново?')) return;
    this.generatePost(eid);
  },

  async respond(id,r){await API.post(`/api/deputy/events/${id}/respond`,{response:r});showToast(r==='confirmed'?'Подтверждено':'Отклонено','success');this.showEventDetail(id);},

  async generateEventPost(eid, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Генерация...'; }
    try {
      const res = await API.post(`/api/deputy/events/${eid}/generate-post`);
      if (!res || !res.post) { showToast('Ошибка генерации', 'error'); return; }
      if (btn) {
        btn.className = 'btn btn-outline btn-sm';
        btn.style.marginTop = '8px';
        btn.disabled = false;
        btn.textContent = 'Посмотреть пост';
        btn.onclick = (e) => { e.stopPropagation(); this.showPostModal(eid); };
      }
      this.showPostModal(eid, res.post);
      showToast('Пост создан', 'success');
    } catch(e) {
      showToast(e.message || 'Ошибка', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Создать пост'; }
    }
  },

  showPostModal(eid, text) {
    if (text) {
      this._lastPost = text;
      this._showPostContent(text);
    } else {
      API.get(`/api/deputy/events/${eid}`).then(e => {
        if (e && e.ai_post_text) this._showPostContent(e.ai_post_text);
        else showToast('Пост не найден', 'error');
      });
    }
  },

  _showPostContent(text) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:500px">
      <h3>Пост для соцсети</h3>
      <div style="white-space:pre-wrap;line-height:1.6;font-size:14px;padding:16px;background:var(--bg-input);border-radius:var(--radius-sm);max-height:50vh;overflow-y:auto" id="post-modal-text">${esc(text)}</div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть</button>
        <button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('post-modal-text').textContent);showToast('Скопировано','success')">Копировать</button>
      </div>
    </div></div>`);
  },
  async vote(eid,aid,v){await API.post(`/api/deputy/events/${eid}/vote`,{agenda_item_id:aid,vote:v});this.showEventDetail(eid);},
  async confirmBlock(eid){await API.post(`/api/deputy/events/${eid}/confirm-block`);showToast('Подтверждено','success');this.showEventDetail(eid);},
  editBlock(eid) {
    const cur=document.querySelector('.card p[style]')?.innerText||'';
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Ваша версия</h3><textarea id="bl-txt" class="form-control" style="min-height:120px">${cur}</textarea><div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="DeputyApp.saveBlock(${eid})">Сохранить</button></div></div></div>`);
  },
  async saveBlock(eid){await API.post(`/api/deputy/events/${eid}/edit-block`,{text:document.getElementById('bl-txt').value});document.querySelector('.modal-overlay')?.remove();showToast('Сохранено','success');this.showEventDetail(eid);},

  // === Calendar ===
  calendarDate: new Date(),
  calendarView: 'month', // month, quarter, year
  _calData: null,

  _calDeputyFilter: 'all',

  async loadCalendar() {
    const isStaff = API.user.userType === 'staff';
    let all, recs, vacs, personal, linkedDeps = [];

    if (isStaff) {
      linkedDeps = await API.get('/api/deputy/linked-deputies') || [];
      const depFilter = this._calDeputyFilter;
      if (depFilter && depFilter !== 'all') {
        const data = await API.get(`/api/deputy/staff-calendar/${depFilter}`);
        all = (data.events||[]).map(e => ({...e, event_date: e.event_date}));
        recs = data.receptions||[];
        vacs = data.vacations||[];
        personal = data.personal||[];
      } else {
        const feed = await API.get('/api/deputy/staff-feed');
        all = feed?.events||[]; personal = feed?.personalEvents||[];
        const showR = localStorage.getItem('ya-deputat-show-receptions') !== 'false';
        recs = showR ? (feed?.receptions||[]) : [];
        vacs = [];
      }
    } else {
      [all, recs, vacs, personal] = await Promise.all([
        API.get('/api/deputy/events?filter=all'),
        API.get('/api/deputy/receptions'),
        API.get('/api/deputy/vacations'),
        API.get('/api/deputy/personal-events')
      ]);
    }

    // Build lookup maps
    const evtDates={}, recDates={}, vacDates={}, persDates={};
    all.forEach(e => { const d=new Date(e.event_date).toDateString(); if(!evtDates[d])evtDates[d]=[]; evtDates[d].push(e); });
    recs.forEach(r => { const d=new Date(r.reception_date).toDateString(); if(!recDates[d])recDates[d]=[]; recDates[d].push(r); });
    if (vacs) vacs.forEach(v => { let c=new Date(v.vacation_start); const end=new Date(v.vacation_end); while(c<=end){vacDates[c.toDateString()]=true;c.setDate(c.getDate()+1);} });
    if (personal) personal.forEach(p => { const d=new Date(p.event_date).toDateString(); if(!persDates[d])persDates[d]=[]; persDates[d].push(p); });

    this._calData = { all, evtDates, recDates, vacDates, persDates, personal };

    const c = document.getElementById('deputy-content');
    const y = this.calendarDate.getFullYear(), m = this.calendarDate.getMonth();
    const v = this.calendarView;

    // Deputy filter for staff
    const depFilterHtml = isStaff && linkedDeps.length ? `<div class="dep-tabs" style="margin-bottom:8px">
      <button class="dep-tab ${this._calDeputyFilter==='all'?'active':''}" onclick="DeputyApp._calDeputyFilter='all';DeputyApp.loadCalendar()">Все</button>
      ${linkedDeps.map(d => `<button class="dep-tab ${this._calDeputyFilter==d.id?'active':''}" onclick="DeputyApp._calDeputyFilter=${d.id};DeputyApp.loadCalendar()">${esc(d.full_name.split(' ')[0])} ${d.full_name.split(' ')[1]?d.full_name.split(' ')[1][0]+'.':''}</button>`).join('')}
    </div>` : '';

    // View switcher
    const viewBtns = `${depFilterHtml}<div class="dep-tabs" style="margin-bottom:12px">
      <button class="dep-tab ${v==='month'?'active':''}" onclick="DeputyApp.calendarView='month';DeputyApp.loadCalendar()">Месяц</button>
      <button class="dep-tab ${v==='quarter'?'active':''}" onclick="DeputyApp.calendarView='quarter';DeputyApp.loadCalendar()">Квартал</button>
      <button class="dep-tab ${v==='year'?'active':''}" onclick="DeputyApp.calendarView='year';DeputyApp.loadCalendar()">Год</button>
    </div>`;

    let calHtml = '';
    if (v === 'month') {
      calHtml = this.renderMonth(y, m, evtDates, recDates, vacDates, persDates);
    } else if (v === 'quarter') {
      const qStart = Math.floor(m / 3) * 3;
      calHtml = `<div class="cal-multi">${[0,1,2].map(i => this.renderMonth(y, qStart+i, evtDates, recDates, vacDates, persDates, true)).join('')}</div>`;
    } else {
      calHtml = `<div class="cal-multi cal-year">${[0,1,2,3,4,5,6,7,8,9,10,11].map(i => this.renderMonth(y, i, evtDates, recDates, vacDates, persDates, true)).join('')}</div>`;
    }

    const legend = `<div class="flex gap-8 mt-8" style="flex-wrap:wrap;font-size:12px">
      <span><span class="calendar-legend has-event-dot"></span> Мероприятие</span>
      <span><span class="calendar-legend has-reception-dot"></span> Приём</span>
      <span><span class="calendar-legend" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff9800"></span> Отпуск</span>
      <span><span class="calendar-legend" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--purple)"></span> Личное</span>
    </div>`;

    c.innerHTML = `${viewBtns}${calHtml}${legend}<div id="cal-evts"></div>`;
    if (v === 'month') this.showCalDayEvts(new Date().toDateString());
  },

  renderMonth(y, m, evtDates, recDates, vacDates, persDates, compact) {
    const mn = new Date(y, m).toLocaleDateString('ru-RU', { month: 'long', year: compact ? undefined : 'numeric' });
    let sd = (new Date(y, m, 1).getDay() || 7) - 1;
    const dim = new Date(y, m + 1, 0).getDate();
    const today = new Date().toDateString();
    const sz = compact ? 'cal-compact' : '';

    let h = '';
    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(w => h += `<div class="calendar-weekday">${w}</div>`);
    for (let i = 0; i < sd; i++) h += '<div class="calendar-day other-month"></div>';
    for (let d = 1; d <= dim; d++) {
      const ds = new Date(y, m, d).toDateString();
      const dateStr = new Date(y, m, d).toISOString().split('T')[0];
      const cls = ['calendar-day'];
      if (ds === today) cls.push('today');
      if (evtDates[ds]) cls.push('has-event');
      if (recDates[ds]) cls.push('has-reception');
      if (vacDates[ds]) cls.push('has-vacation');
      if (persDates[ds]) cls.push('has-personal');
      h += `<div class="${cls.join(' ')}" onclick="DeputyApp.onCalDayClick(event,'${ds}','${dateStr}')">${d}</div>`;
    }

    if (compact) {
      return `<div class="cal-month-block"><div class="cal-month-title">${mn}</div><div class="calendar-grid ${sz}">${h}</div></div>`;
    }
    return `<div class="card"><div class="calendar-header">
      <button class="btn btn-outline btn-sm" onclick="DeputyApp.chMo(-1)">\u25C0</button>
      <strong style="text-transform:capitalize">${mn} ${y}</strong>
      <button class="btn btn-outline btn-sm" onclick="DeputyApp.chMo(1)">\u25B6</button>
    </div><div class="calendar-grid">${h}</div></div>`;
  },

  chMo(d) { this.calendarDate.setMonth(this.calendarDate.getMonth() + d); this.loadCalendar(); },

  onCalDayClick(evt, ds, dateStr) {
    this._selectedCalDate = dateStr;
    // Remove previous popup
    document.querySelector('.cal-day-popup')?.remove();
    // Show mini popup near the clicked day
    const rect = evt.target.getBoundingClientRect();
    const d = new Date(dateStr);
    const dayLabel = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    const popup = document.createElement('div');
    popup.className = 'cal-day-popup';
    popup.innerHTML = `<div class="cal-popup-header">${dayLabel}</div>
      <button class="btn btn-primary btn-sm btn-block" onclick="document.querySelector('.cal-day-popup')?.remove();DeputyApp.showCreatePersonalEvent('${dateStr}')">+ Создать событие</button>`;
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
    document.body.appendChild(popup);
    // Close on outside click
    setTimeout(() => document.addEventListener('click', function h(e) { if (!popup.contains(e.target) && e.target !== evt.target) { popup.remove(); document.removeEventListener('click', h); } }, { once: false }), 100);
    // Also show events below
    this.showCalDayEvts(ds);
  },

  async showCalDayEvts(ds) {
    const el = document.getElementById('cal-evts');
    if (!el) return;
    const cd = this._calData;
    if (!cd) return;

    const events = cd.evtDates[ds] || [];
    const recs = cd.recDates?.[ds] || [];
    const pers = cd.persDates?.[ds] || [];
    const dateStr = this._selectedCalDate || new Date().toISOString().split('T')[0];

    let html = '';
    if (events.length) {
      html += events.map(e => `<div class="event-card type-${e.event_type}" onclick="DeputyApp.showEventDetail(${e.id})">
        <div class="event-date">${formatDateTime(e.event_date)}</div>
        <div class="event-title">${esc(e.title)}</div></div>`).join('');
    }
    if (recs.length) {
      html += recs.map(r => `<div class="event-card" style="border-left-color:var(--green);cursor:pointer" onclick="DeputyApp.showReceptionDetail(${r.id})">
        <div class="event-date">${r.time_start}\u2013${r.time_end}</div>
        <div class="event-title">Приём населения</div>
        ${r.location?`<div class="text-sm text-gray">${esc(r.location)}</div>`:''}
      </div>`).join('');
    }
    if (pers.length) {
      html += pers.map(p => `<div class="event-card" style="border-left-color:var(--purple)">
        <div class="event-date">${formatDateTime(p.event_date)}</div>
        <div class="event-title">${esc(p.title)} <span class="text-tertiary">${p.visibility==='private'?'(личное)':'(открытое)'}</span></div>
        ${p.description?`<div class="text-sm text-gray">${esc(p.description)}</div>`:''}
        <button class="btn btn-danger btn-sm mt-8" onclick="DeputyApp.delPersonalEvent(${p.id})" style="padding:2px 10px">Удалить</button>
      </div>`).join('');
    }

    if (!html) html = '<p class="text-center text-gray">Нет событий в этот день</p>';

    el.innerHTML = `<div class="event-list mt-16">${html}</div>`;
  },

  showCreatePersonalEvent(dateStr) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal">
      <h3>Новое событие</h3>
      <div class="form-group"><label>Название</label><input id="pe-title" class="form-control" placeholder="Встреча, приём, мероприятие..."></div>
      <div class="form-group"><label>Дата и время</label><input type="datetime-local" id="pe-date" class="form-control" value="${dateStr}T10:00"></div>
      <div class="form-group"><label>Место</label><input id="pe-loc" class="form-control" placeholder="Необязательно"></div>
      <div class="form-group"><label>Описание</label><textarea id="pe-desc" class="form-control" rows="3" placeholder="Что обсуждали, с кем встречались..."></textarea></div>
      <div class="form-group"><label>Видимость</label>
        <select id="pe-vis" class="form-control">
          <option value="private">Личное — вижу только я</option>
          <option value="shared">Открытое — видит сотрудник, попадает в отчёты</option>
        </select>
        <span class="field-hint">Личное: только для вашего календаря, никуда не попадает.<br>Открытое: видит ваш сотрудник, учитывается в квартальных и годовых отчётах.</span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="DeputyApp.savePersonalEvent()">Создать</button>
      </div>
    </div></div>`);
  },

  async savePersonalEvent() {
    const title = document.getElementById('pe-title').value;
    const event_date = document.getElementById('pe-date').value;
    if (!title) return showToast('Укажите название', 'error');
    await API.post('/api/deputy/personal-events', {
      title, event_date,
      location: document.getElementById('pe-loc').value,
      description: document.getElementById('pe-desc').value,
      visibility: document.getElementById('pe-vis').value
    });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Событие создано', 'success');
    this.loadCalendar();
  },

  async delPersonalEvent(id) {
    if (!confirm('Удалить?')) return;
    await API.del(`/api/deputy/personal-events/${id}`);
    showToast('Удалено', 'success');
    this.loadCalendar();
  },

  // === Staff Mobile Management ===
  async loadManage() {
    const sp = this.staffPerms || {};
    const c = document.getElementById('deputy-content');
    // Directly show deputies list
    this.staffViewDeputies();
  },

  async staffQuickEvent() {
    try {
      const events = await API.get('/api/admin/events?'+AdminApp?.dp?.() || '');
      const upcoming = events.filter(e => e.status !== 'closed');
      if (!upcoming.length) return showToast('Нет активных мероприятий', 'error');
      document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Напомнить о мероприятии</h3>
        ${upcoming.map(e => `<div class="event-card" style="margin-bottom:8px" onclick="DeputyApp.staffRemind(${e.id});document.querySelector('.modal-overlay').remove()">
          <div class="event-date">${formatDateTime(e.event_date)}</div>
          <div class="event-title">${esc(e.title)}</div>
        </div>`).join('')}
        <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button></div></div></div>`);
    } catch (e) { showToast('Нет доступа', 'error'); }
  },

  async staffRemindFromDetail(eid) {
    try {
      const r = await API.post(`/api/admin/events/${eid}/remind`);
      showToast(`Напоминание отправлено (${r.sent})`, 'success');
    } catch (e) { showToast('Ошибка', 'error'); }
  },

  async staffRemind(eid) {
    try {
      const r = await API.post(`/api/admin/events/${eid}/remind`);
      showToast(`Напоминание отправлено (${r.sent})`, 'success');
    } catch (e) { showToast('Ошибка', 'error'); }
  },

  staffRecorder() {
    this._stopMobRec();
    const c = document.getElementById('deputy-content');
    const bb = document.getElementById('back-btn');
    if (bb) bb.classList.remove('hidden');
    // Restore saved transcript if exists
    const saved = localStorage.getItem('ya-deputat-rec-text') || '';
    c.innerHTML = `<div class="card"><h2>&#x1F399; Диктофон</h2>
      <p class="hint-text">Записывайте аудио заседания. Расшифровка идёт в реальном времени. Текст автоматически сохраняется локально — вы не потеряете запись при закрытии приложения.</p>
      <div id="rec-timer" class="text-center" style="font-size:32px;font-weight:700;color:var(--blue);margin:16px 0">00:00</div>
      <button class="btn btn-danger btn-block" id="mob-rec-btn" onclick="DeputyApp.toggleMobRec()" style="padding:16px;font-size:16px">Начать запись</button>
      <div id="rec-status" class="text-center text-sm text-gray mt-8"></div>
      <div class="form-group mt-16"><label>Расшифровка</label><textarea id="rec-text" class="form-control" style="min-height:200px;overflow:hidden;resize:vertical" placeholder="Текст появится при записи..." oninput="localStorage.setItem('ya-deputat-rec-text',this.value);this.style.height='auto';this.style.height=this.scrollHeight+'px'">${esc(saved)}</textarea></div>
      <div class="flex gap-8 mt-8">
        <button class="btn btn-primary btn-sm" style="flex:1" onclick="DeputyApp.saveMobTranscript()" ${saved?'':'disabled'} id="mob-save-tr">Сохранить</button>
        ${saved ? `<button class="btn btn-outline btn-sm" onclick="if(confirm('Очистить?')){document.getElementById('rec-text').value='';localStorage.removeItem('ya-deputat-rec-text');document.getElementById('mob-save-tr').disabled=true}">Очистить</button>` : ''}
      </div></div>`;
    // Auto-resize textarea
    const ta = document.getElementById('rec-text');
    if (ta && saved) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  },

  _mobRecorder: null, _mobRecStart: 0, _mobRecInterval: null, _mobTranscript: '', _mobRecognition: null,

  _stopMobRec() {
    if (this._mobRecorder && this._mobRecorder.state === 'recording') {
      try { this._mobRecorder.stop(); } catch(e) {}
    }
    this._mobRecorder = null;
    if (this._mobRecognition) { try { this._mobRecognition.stop(); } catch(e) {} this._mobRecognition = null; }
    if (this._mobRecInterval) { clearInterval(this._mobRecInterval); this._mobRecInterval = null; }
  },

  async toggleMobRec() {
    const btn = document.getElementById('mob-rec-btn');
    if (this._mobRecorder && this._mobRecorder.state === 'recording') {
      this._mobRecorder.stop();
      if (this._mobRecognition) try { this._mobRecognition.stop(); } catch(e) {}
      clearInterval(this._mobRecInterval);
      btn.textContent = 'Начать запись';
      btn.className = 'btn btn-danger btn-block';
      btn.style.padding = '16px'; btn.style.fontSize = '16px';
      document.getElementById('mob-save-tr').disabled = false;
      const st = document.getElementById('rec-status');
      if (st) st.textContent = 'Запись остановлена. Текст сохранён локально.';
      // Save to localStorage
      const rt = document.getElementById('rec-text');
      if (rt) localStorage.setItem('ya-deputat-rec-text', rt.value);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      this._mobRecorder = new MediaRecorder(stream);
      this._mobRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      this._mobRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); };
      this._mobRecorder.start(1000);
      this._mobRecStart = Date.now();
      this._mobRecInterval = setInterval(() => {
        const s = Math.floor((Date.now() - this._mobRecStart) / 1000);
        const el = document.getElementById('rec-timer');
        if (el) el.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
        else { clearInterval(this._mobRecInterval); this._stopMobRec(); }
      }, 1000);
      btn.textContent = 'Остановить запись';
      btn.className = 'btn btn-warning btn-block';
      btn.style.padding = '16px'; btn.style.fontSize = '16px';
      const st = document.getElementById('rec-status');
      if (st) st.innerHTML = '<span style="color:var(--red)">&#x25CF;</span> Идёт запись...';

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        this._mobRecognition = new SR();
        this._mobRecognition.lang = 'ru-RU';
        this._mobRecognition.continuous = true;
        this._mobRecognition.interimResults = true;
        this._mobTranscript = '';
        this._mobRecognition.onresult = (e) => {
          let interim = '', final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
            else interim += e.results[i][0].transcript;
          }
          if (final) this._mobTranscript += final;
          const rt = document.getElementById('rec-text');
          if (rt) {
            rt.value = this._mobTranscript + interim;
            rt.style.height = 'auto'; rt.style.height = rt.scrollHeight + 'px';
            // Auto-save every final result
            if (final) localStorage.setItem('ya-deputat-rec-text', this._mobTranscript);
          }
        };
        this._mobRecognition.onend = () => { if (this._mobRecorder?.state === 'recording') try { this._mobRecognition.start(); } catch(e) {} };
        this._mobRecognition.start();
      }
    } catch (e) { showToast('Нет доступа к микрофону', 'error'); }
  },

  async saveMobTranscript() {
    const text = document.getElementById('rec-text').value;
    if (!text) return showToast('Нет текста', 'error');
    // Ask which event to attach to
    try {
      const events = await API.get('/api/admin/events');
      const active = events.filter(e => e.status !== 'closed');
      if (!active.length) return showToast('Нет активных мероприятий', 'error');
      document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>К какому мероприятию?</h3>
        ${active.map(e => `<div class="event-card" style="margin-bottom:8px;cursor:pointer" onclick="DeputyApp.attachTranscript(${e.id})"><div class="event-title">${esc(e.title)}</div><div class="event-date">${formatDateTime(e.event_date)}</div></div>`).join('')}
        <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button></div></div></div>`);
    } catch (e) { showToast('Ошибка', 'error'); }
  },

  async attachTranscript(eid) {
    const text = document.getElementById('rec-text').value;
    document.querySelector('.modal-overlay')?.remove();
    await API.post(`/api/admin/events/${eid}/transcribe`, { transcription: text });
    localStorage.removeItem('ya-deputat-rec-text');
    showToast('Расшифровка сохранена к мероприятию', 'success');
    this.loadTab('manage');
  },

  async staffViewDeputies() {
    try {
      const deps = await API.get('/api/admin/deputies?user_type=deputy');
      const c = document.getElementById('deputy-content');
      document.getElementById('back-btn').classList.remove('hidden');
      c.innerHTML = `<h2 style="margin-bottom:16px">Мои депутаты</h2>
        <div class="event-list">${deps.map(d => `<div class="card">
          <div style="font-weight:600;font-size:17px;margin-bottom:6px">${esc(d.full_name)} ${d.deputy_role==='head'?'<span class="badge-head">Глава СД</span>':''}</div>
          <div class="text-sm text-gray" style="margin-bottom:8px">${esc(d.district_name)||'—'}</div>
          ${d.phone?`<div style="margin-bottom:6px"><a href="tel:${esc(d.phone)}" style="color:var(--text);font-size:16px;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;gap:6px">&#x1F4DE; ${esc(d.phone)}</a></div>`:''}
          ${d.email?`<div><a href="mailto:${esc(d.email)}" style="color:var(--text);font-size:15px;text-decoration:none;display:inline-flex;align-items:center;gap:6px">&#x2709; ${esc(d.email)}</a></div>`:''}
        </div>`).join('')}</div>`;
    } catch (e) { showToast('Нет доступа', 'error'); }
  },

  async staffSendNotification() {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Отправить уведомление</h3>
      <p class="hint-text">Выберите мероприятие для напоминания</p>
      <div id="staff-notif-list">Загрузка...</div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button></div></div></div>`);
    try {
      const events = await API.get('/api/admin/events');
      document.getElementById('staff-notif-list').innerHTML = events.filter(e=>e.status!=='closed').map(e => `<div class="event-card" style="margin-bottom:8px;cursor:pointer" onclick="DeputyApp.staffRemind(${e.id});document.querySelector('.modal-overlay').remove()">
        <div class="event-title">${esc(e.title)}</div><div class="event-date">${formatDateTime(e.event_date)}</div></div>`).join('') || '<p class="text-gray">Нет мероприятий</p>';
    } catch (e) { document.getElementById('staff-notif-list').innerHTML = 'Ошибка'; }
  },

  // === Receptions ===
  async loadReceptions() {
    const recs = await API.get('/api/deputy/receptions');
    if (!recs || !Array.isArray(recs)) return;
    const yr = new Date().getFullYear(), q = Math.ceil((new Date().getMonth()+1)/3);
    const today = new Date().toISOString().split('T')[0];
    const pending = recs.filter(r => r.status === 'pending');
    const upcoming = recs.filter(r => r.status === 'confirmed' && r.reception_date >= today);
    const past = recs.filter(r => r.status === 'confirmed' && r.reception_date < today);
    const c = document.getElementById('deputy-content');
    if (!c) return;

    c.innerHTML = `
      <button class="btn btn-primary btn-block" onclick="DeputyApp.showOwnReceptionForm()">+ Записать приём</button>

      ${pending.length ? (() => {
        const byQ = {};
        pending.forEach(r => { const k = `${r.quarter||'?'}_${r.year||yr}`; if(!byQ[k]) byQ[k]=[]; byQ[k].push(r); });
        return Object.entries(byQ).map(([k, items]) => {
          const [qn, yn] = k.split('_');
          const MONTH_RANGES = {1:'январь\u2013март',2:'апрель\u2013июнь',3:'июль\u2013сентябрь',4:'октябрь\u2013декабрь'};
          return `<div class="card mt-16" style="border-left:4px solid var(--orange)">
            <h3 style="margin-bottom:4px">Подтвердите приёмы</h3>
            <p style="margin-bottom:12px;font-size:15px;font-weight:600">${qn} квартал ${yn} г. (${MONTH_RANGES[qn]||''})</p>
            <div class="event-list">${items.map(r => {
              const d = new Date(r.reception_date);
              return `<div class="event-card" style="border-left-color:var(--orange)">
                <div class="flex-between">
                  <div>
                    <div class="event-date">${d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}, ${d.toLocaleDateString('ru-RU',{weekday:'short'})} \u00B7 ${r.time_start}\u2013${r.time_end}</div>
                    ${r.location ? `<div class="text-sm text-gray">${esc(r.location)}</div>` : ''}
                  </div>
                  <div class="flex gap-8">
                    <button class="btn btn-success btn-sm" onclick="DeputyApp.confirmOneReception(${r.id})">OK</button>
                    <button class="btn btn-outline btn-sm" onclick="DeputyApp.editReception(${r.id})">Изменить</button>
                  </div>
                </div>
              </div>`;}).join('')}</div>
            <button class="btn btn-success btn-block mt-16" onclick="DeputyApp.confirmReceptions(${qn},${yn})">Подтвердить все за ${qn} квартал</button>
          </div>`;
        }).join('');
      })() : ''}

      ${upcoming.length ? (() => {
        const first = upcoming[0];
        const rest = upcoming.slice(1);
        const fd = new Date(first.reception_date);
        const renderCard = (r) => {
          const d = new Date(r.reception_date);
          return `<div class="event-card reception-card" style="border-left-color:var(--green)" onclick="DeputyApp.showReceptionDetail(${r.id})">
            <div class="reception-date">${d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}, ${d.toLocaleDateString('ru-RU',{weekday:'short'})}</div>
            <div class="reception-time" style="font-size:0.9em">${r.time_start}\u2013${r.time_end}</div>
            ${r.location ? `<div class="text-sm text-gray">${esc(r.location)}</div>` : ''}
          </div>`;
        };
        return `<div class="card mt-16"><h3 style="margin-bottom:12px">Ближайший приём</h3>
          <div class="event-list">${renderCard(first)}</div>
        </div>
        ${rest.length ? `<details class="card mt-16" style="cursor:pointer">
          <summary style="font-weight:600;padding:2px 0">Ещё ${rest.length} предстоящих</summary>
          <div class="event-list mt-8">${rest.map(renderCard).join('')}</div>
        </details>` : ''}`;
      })() : ''}

      ${past.length ? `<div class="card mt-16"><h3 style="margin-bottom:12px">Состоявшиеся</h3>
        <div class="event-list">${past.map(r => {
          const d = new Date(r.reception_date);
          const postBtn = r.post_text
            ? `<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="event.stopPropagation();DeputyApp.showRecPostModal(${r.id})">Посмотреть пост</button>`
            : `<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="event.stopPropagation();DeputyApp.generateReceptionPost(${r.id},this)">Создать пост</button>`;
          return `<div class="event-card" style="border-left-color:var(--text-tertiary);opacity:0.7" onclick="DeputyApp.showReceptionDetail(${r.id})">
            <div style="font-weight:600">${d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</div>
            <div class="text-sm text-gray">${r.time_start}\u2013${r.time_end}</div>
            ${r.location ? `<div class="text-sm text-gray">${esc(r.location)}</div>` : ''}
            ${postBtn}
          </div>`;}).join('')}</div>
      </div>` : ''}`;
  },

  showOwnReceptionForm() {
    const today = new Date().toISOString().split('T')[0];
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay"><div class="modal">
      <h3>Записать приём</h3>
      <p class="text-sm text-gray mb-16">Ваш сотрудник увидит этот приём и он попадёт в отчёты.</p>
      <div class="form-group"><label>Тип</label><select id="own-rec-type" class="form-control">
        <option value="past">Состоявшийся приём</option>
        <option value="future">Запланированный приём</option>
      </select></div>
      <div class="form-group"><label>Дата</label><input type="date" id="own-rec-d" class="form-control" value="${today}"></div>
      <div class="form-group" style="display:flex;gap:8px">
        <div style="flex:1"><label>С</label><input type="time" id="own-rec-ts" class="form-control" value="10:00"></div>
        <div style="flex:1"><label>По</label><input type="time" id="own-rec-te" class="form-control" value="11:00"></div>
      </div>
      <div class="form-group"><label>Место</label><input id="own-rec-loc" class="form-control" placeholder="Где проходил/будет приём"></div>
      <div class="form-group"><label>Описание</label><textarea id="own-rec-desc" class="form-control" rows="3" placeholder="С кем встречались, что обсуждали, обращения граждан..."></textarea></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="DeputyApp.saveOwnReception()">Записать</button>
      </div>
    </div></div>`);
  },

  async saveOwnReception() {
    var d = document.getElementById('own-rec-d').value;
    var ts = document.getElementById('own-rec-ts').value;
    var te = document.getElementById('own-rec-te').value;
    if (!d || !ts || !te) return showToast('Укажите дату и время', 'error');
    await API.post('/api/deputy/own-reception', {
      reception_date: d, time_start: ts, time_end: te,
      location: document.getElementById('own-rec-loc').value,
      description: document.getElementById('own-rec-desc').value
    });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Приём записан', 'success');
    this.loadReceptions();
  },

  addReception() {
    const yr=new Date().getFullYear(),q=Math.ceil((new Date().getMonth()+1)/3);
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>Новый приём</h3>
      <div class="form-group"><label>Дата</label><input type="date" id="rec-d" class="form-control"></div>
      <div class="form-row"><div class="form-group" style="flex:1"><label>С</label><input type="time" id="rec-ts" class="form-control"></div><div class="form-group" style="flex:1"><label>По</label><input type="time" id="rec-te" class="form-control"></div></div>
      <div class="form-group"><label>Место</label><input id="rec-l" class="form-control" placeholder="Адрес приёма"></div>
      <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button><button class="btn btn-primary" onclick="DeputyApp.saveReception(${q},${yr})">Добавить</button></div></div></div>`);
  },
  async saveReception(q,yr){
    await API.post('/api/deputy/receptions',{reception_date:document.getElementById('rec-d').value,time_start:document.getElementById('rec-ts').value,time_end:document.getElementById('rec-te').value,location:document.getElementById('rec-l').value,quarter:q,year:yr});
    document.querySelector('.modal-overlay')?.remove();showToast('Добавлено','success');this.loadReceptions();
  },
  async markReceptionOutcome(id, outcome) {
    await API.post(`/api/deputy/receptions/${id}/outcome`, { outcome });
    showToast(outcome === 'held' ? 'Приём отмечен как состоявшийся' : 'Приём отмечен как не состоявшийся', 'success');
    this.showReceptionDetail(id);
  },

  async delReception(id){await API.del(`/api/deputy/receptions/${id}`);showToast('Удалено','success');this.loadReceptions();},
  async confirmReceptions(q,yr){
    await API.post('/api/deputy/receptions/confirm-quarter',{quarter:q,year:yr});
    showToast('Все приёмы подтверждены','success');
    if (localStorage.getItem('ya-deputat-auto-calendar') === 'true') {
      // Download all newly confirmed as ICS
      const recs = await API.get('/api/deputy/receptions');
      recs.filter(r=>r.status==='confirmed'&&r.quarter==q&&r.year==yr).forEach(r=>this.addToCalendar(r.id));
    }
    this.loadReceptions();
  },
  async confirmOneReception(id){
    await API.post(`/api/deputy/receptions/${id}/confirm`);
    showToast('Приём подтверждён','success');
    if (localStorage.getItem('ya-deputat-auto-calendar') === 'true') this.addToCalendar(id);
    this.loadReceptions();
  },

  editReception(id) {
    API.get('/api/deputy/receptions').then(recs => {
      if (!recs) return;
      const r = recs.find(x => x.id === id);
      if (!r) return;
      document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay"><div class="modal"><h3>Изменить приём</h3>
        <div class="form-group"><label>Дата</label><input type="date" id="er-d" class="form-control" value="${r.reception_date}"></div>
        <div class="form-group" style="display:flex;gap:8px">
          <div style="flex:1"><label>С</label><input type="time" id="er-ts" class="form-control" value="${r.time_start}"></div>
          <div style="flex:1"><label>По</label><input type="time" id="er-te" class="form-control" value="${r.time_end}"></div>
        </div>
        <div class="form-group"><label>Место</label><input id="er-l" class="form-control" value="${esc(r.location||'')}"></div>
        <div class="form-group"><label>Описание</label><textarea id="er-desc" class="form-control" rows="3">${esc(r.description||'')}</textarea></div>
        <div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
          <button class="btn btn-primary" onclick="DeputyApp.saveEditReception(${id})">Сохранить</button></div></div></div>`);
    });
  },

  showReceptionDetail(id) {
    this._lastReceptionId = id;
    this._lastDetailId = null;
    API.get('/api/deputy/receptions').then(recs => {
      if (!recs) return;
      const r = recs.find(x => x.id === id);
      if (!r) return;
      const d = new Date(r.reception_date);
      const today = new Date().toISOString().split('T')[0];
      const isPast = r.reception_date < today;
      const dateStr = d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',weekday:'long'});

      document.getElementById('back-btn').classList.remove('hidden');

      const outcomeLabel = r.outcome === 'held' ? '\u2714 Состоялся' : r.outcome === 'cancelled' ? '\u2716 Не состоялся' : '';
      const needOutcome = isPast && !r.outcome && r.created_by_staff === null;

      document.getElementById('deputy-content').innerHTML = `
        <div class="event-detail" style="padding-top:8px">
          <span class="event-type-badge" style="background:${isPast?'var(--text-tertiary)':'var(--purple)'}">
            ${isPast ? (r.outcome==='held'?'Состоявшийся приём':r.outcome==='cancelled'?'Отменённый приём':'Прошедший приём') : 'Приём населения'}
          </span>
          ${outcomeLabel ? `<div style="margin-top:8px;font-weight:600;color:${r.outcome==='held'?'var(--green)':'var(--red)'}">${outcomeLabel}</div>` : ''}
          <div class="reception-time" style="margin-top:12px">${r.time_start} \u2013 ${r.time_end}</div>
          <div class="reception-date">${dateStr}</div>
          ${r.location ? `<div class="event-meta" style="margin-top:12px"><div>\u{1F4CD} ${esc(r.location)}</div></div>` : ''}
          ${r.description ? `<div class="card mt-16" style="background:var(--bg-input)">
            <h4 style="margin-bottom:8px">Описание</h4>
            <p style="white-space:pre-wrap">${esc(r.description)}</p>
          </div>` : ''}

          ${needOutcome ? `<div class="card mt-16" style="border-left:4px solid var(--orange)">
            <h4 style="margin-bottom:8px">Приём состоялся?</h4>
            <div class="flex gap-8">
              <button class="btn btn-success" style="flex:1" onclick="DeputyApp.markReceptionOutcome(${r.id},'held')">Да, состоялся</button>
              <button class="btn btn-danger" style="flex:1" onclick="DeputyApp.markReceptionOutcome(${r.id},'cancelled')">Не состоялся</button>
            </div>
          </div>` : ''}

          ${r.post_text ? `<div style="margin-top:16px">
            <button class="btn btn-outline btn-block" onclick="DeputyApp.showRecPostModal(${r.id})">Посмотреть пост</button>
          </div>` : (isPast ? `<div style="margin-top:16px">
            <button class="btn btn-primary btn-block" onclick="DeputyApp.generateReceptionPost(${r.id},this)">Создать пост</button>
          </div>` : '')}

          <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
            ${!isPast ? `<button class="btn btn-primary btn-block" onclick="DeputyApp.addToCalendar(${r.id})">Добавить в календарь</button>` : ''}
            <button class="btn btn-outline btn-block" onclick="DeputyApp.editReception(${r.id})">Изменить</button>
            <button class="btn btn-danger btn-block" onclick="DeputyApp.delReception(${r.id})">Удалить приём</button>
          </div>
        </div>`;
    });
  },

  async generateReceptionPost(id, btn) {
    if (!btn) btn = document.getElementById('btn-gen-post');
    if (btn) { btn.disabled = true; btn.textContent = 'Генерация...'; }
    try {
      const res = await API.post(`/api/deputy/receptions/${id}/generate-post`);
      if (!res || !res.post) { showToast('Ошибка генерации', 'error'); return; }
      if (btn) {
        btn.className = 'btn btn-outline btn-sm';
        btn.style.marginTop = '8px';
        btn.disabled = false;
        btn.textContent = 'Посмотреть пост';
        btn.onclick = (e) => { e.stopPropagation(); this.showRecPostModal(id); };
      }
      this.showRecPostModal(id, res.post);
      showToast('Пост создан', 'success');
    } catch(e) {
      showToast('Ошибка: ' + (e.message||''), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Создать пост'; }
    }
  },

  showRecPostModal(id, text) {
    if (text) {
      this._showPostContent(text);
    } else {
      API.get('/api/deputy/receptions').then(recs => {
        const r = (recs||[]).find(x => x.id === id);
        if (r && r.post_text) this._showPostContent(r.post_text);
        else showToast('Пост не найден', 'error');
      });
    }
  },

  addToCalendar(id) {
    API.get('/api/deputy/receptions').then(recs => {
      const r = recs.find(x => x.id === id);
      if (!r) return;
      const start = r.reception_date.replace(/-/g,'') + 'T' + r.time_start.replace(':','') + '00';
      const end = r.reception_date.replace(/-/g,'') + 'T' + r.time_end.replace(':','') + '00';
      const ics = [
        'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//YaDeputat//RU',
        'BEGIN:VEVENT',
        `DTSTART:${start}`,`DTEND:${end}`,
        `SUMMARY:Приём населения`,
        `LOCATION:${r.location||''}`,
        `DESCRIPTION:Приём населения муниципального депутата`,
        'END:VEVENT','END:VCALENDAR'
      ].join('\r\n');
      const blob = new Blob([ics], {type:'text/calendar;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `reception-${r.reception_date}.ics`;
      a.click(); URL.revokeObjectURL(url);
      showToast('Файл календаря скачан','success');
    });
  },

  async saveEditReception(id) {
    await API.put(`/api/deputy/receptions/${id}`, {
      reception_date: document.getElementById('er-d').value,
      time_start: document.getElementById('er-ts').value,
      time_end: document.getElementById('er-te').value,
      location: document.getElementById('er-l').value,
      description: document.getElementById('er-desc')?.value || ''
    });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Приём сохранён', 'success');
    this.loadReceptions();
  },

  // === Chat ===
  async loadChats() {
    const c = document.getElementById('deputy-content');
    if (!c) return;
    const chats = await API.get('/api/chat/list');
    if (!chats) return;
    const isStaff = API.user.userType === 'staff';

    c.innerHTML = `
      ${isStaff ? `<button class="btn btn-primary btn-block" onclick="DeputyApp.showCreateChat()">+ Новый чат</button>` : ''}
      ${chats.length ? `<div class="event-list mt-16">${chats.map(ch => {
        const isMy = ch.created_by === API.user.id;
        return `<div class="event-card" style="border-left-color:var(--blue);cursor:pointer" onclick="DeputyApp.openChat(${ch.id})">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-weight:600">${esc(ch.display_name)} ${ch.is_group?'<span class="badge-role">группа</span>':''}</div>
            <div style="display:flex;align-items:center;gap:6px">
              ${ch.unread ? `<span style="background:var(--blue);color:#fff;font-size:11px;padding:2px 7px;border-radius:980px;font-weight:600">${ch.unread}</span>` : ''}
              ${isMy ? `<button class="btn btn-danger btn-sm" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();DeputyApp.deleteChat(${ch.id})">&#x2716;</button>` : ''}
            </div>
          </div>
          ${ch.last_message ? `<div class="text-sm text-gray" style="margin-top:4px">${ch.last_sender_name ? '<b>'+esc(ch.last_sender_name.split(' ')[0])+':</b> ' : ''}${esc(ch.last_message)}</div>` : '<div class="text-sm text-gray" style="margin-top:4px">Нет сообщений</div>'}
          ${ch.last_msg_at ? `<div class="text-tertiary" style="font-size:11px;margin-top:2px">${new Date(ch.last_msg_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>` : ''}
        </div>`;}).join('')}</div>` : '<div class="text-center text-gray mt-16">Нет чатов</div>'}`;
  },

  async showCreateChat() {
    const [deps, comms] = await Promise.all([
      API.get('/api/deputy/linked-deputies'),
      API.get('/api/admin/commissions')
    ]);
    if (!deps || !deps.length) { showToast('Нет привязанных депутатов', 'error'); return; }
    const commOpts = (comms && comms.length) ? `<div class="form-group"><label>Из комиссии</label>
      <select id="chat-commission" class="form-control" onchange="DeputyApp.onChatCommissionSelect()">
        <option value="">— Выбрать вручную —</option>
        ${comms.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select></div>` : '';
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal">
      <h3>Новый чат</h3>
      <div class="form-group"><label>Тип</label>
        <select id="chat-type" class="form-control" onchange="document.getElementById('chat-name-g').classList.toggle('hidden',this.value==='personal')">
          <option value="personal">Личный</option>
          <option value="group">Групповой</option>
        </select></div>
      <div class="form-group hidden" id="chat-name-g"><label>Название группы</label><input id="chat-name" class="form-control" placeholder="Название чата"></div>
      ${commOpts}
      <div class="form-group"><label>Участники</label>
        <div class="deputy-select-list" id="chat-dep-list">${deps.map(d => `<label class="deputy-select-item"><input type="checkbox" value="${d.id}" class="chat-dep-cb"> ${esc(d.full_name)} ${d.deputy_role==='head'?'<span class="badge-head">ГСД</span>':''}</label>`).join('')}</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="DeputyApp.createChat()">Создать</button>
      </div>
    </div></div>`);
  },

  async onChatCommissionSelect() {
    const comId = document.getElementById('chat-commission')?.value;
    if (!comId) {
      document.querySelectorAll('.chat-dep-cb').forEach(cb => cb.checked = false);
      return;
    }
    const members = await API.get(`/api/admin/commissions/${comId}/members`);
    if (!members) return;
    const memberIds = new Set(members.map(m => m.id));
    document.querySelectorAll('.chat-dep-cb').forEach(cb => {
      cb.checked = memberIds.has(parseInt(cb.value));
    });
    // Auto-fill group name and switch to group type
    const commName = document.getElementById('chat-commission').selectedOptions[0]?.text || '';
    document.getElementById('chat-type').value = 'group';
    document.getElementById('chat-name-g').classList.remove('hidden');
    const nameInput = document.getElementById('chat-name');
    if (nameInput && !nameInput.value) nameInput.value = commName;
  },

  async createChat() {
    const isGroup = document.getElementById('chat-type').value === 'group';
    const name = document.getElementById('chat-name')?.value || '';
    const ids = Array.from(document.querySelectorAll('.chat-dep-cb:checked')).map(c => parseInt(c.value));
    if (!ids.length) return showToast('Выберите участников', 'error');
    if (isGroup && !name) return showToast('Укажите название', 'error');
    await API.post('/api/chat/create', { name: isGroup ? name : null, member_ids: ids, is_group: isGroup });
    document.querySelector('.modal-overlay')?.remove();
    showToast('Чат создан', 'success');
    this.loadChats();
  },

  _chatPolling: null,

  async openChat(chatId) {
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.classList.remove('hidden');
    this._lastDetailId = null; this._lastReceptionId = null;
    this._openChatId = chatId;
    // Check if current user is chat creator
    const chatList = await API.get('/api/chat/list');
    const chatInfo = (chatList||[]).find(ch => ch.id === chatId);
    this._chatIsCreator = chatInfo && chatInfo.created_by === API.user.id;
    const c = document.getElementById('deputy-content');
    const isMobile = !!document.querySelector('.bottom-nav');

    if (isMobile) {
      // Mobile: fullscreen chat, hide nav, lock body scroll
      const nav = document.querySelector('.bottom-nav');
      if (nav) nav.style.display = 'none';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${window.scrollY}px`;
      this._chatScrollY = window.scrollY;
      c.innerHTML = `
        <div id="chat-wrap" style="display:flex;flex-direction:column;position:fixed;top:calc(44px + var(--sat,0px));left:0;right:0;bottom:env(safe-area-inset-bottom);z-index:10;background:var(--bg);overscroll-behavior:none">
          ${this._chatIsCreator ? `<div style="display:flex;align-items:center;justify-content:flex-end;padding:8px 12px;background:var(--bg-card);border-bottom:1px solid var(--border)"><button class="btn btn-outline btn-sm" style="font-size:0.73em;color:var(--text-tertiary)" onclick="DeputyApp.clearChat(${chatId})">Очистить чат</button></div>` : ''}
          <div id="chat-messages" style="flex:1;overflow-y:auto;overflow-x:hidden;padding:8px 12px;display:flex;flex-direction:column;overscroll-behavior:contain;-webkit-overflow-scrolling:touch"></div>
          <div id="chat-reply-wrap"></div>
          <div id="chat-input-bar" style="flex-shrink:0;display:flex;gap:8px;padding:10px 12px;background:var(--bg-card);border-top:1px solid var(--border)">
            <input id="chat-input" class="form-control" placeholder="Сообщение..." style="flex:1;font-size:1em" onkeydown="if(event.key==='Enter'){event.preventDefault();DeputyApp.sendMessage()}">
            <button class="btn btn-primary" onclick="DeputyApp.sendMessage()" style="flex-shrink:0">&#x27A4;</button>
          </div>
        </div>`;
    } else {
      // Desktop: chat inside main-content
      c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <button class="btn btn-outline btn-sm" onclick="DeputyApp._closeChatAndBack()">&#x2190; Назад к чатам</button>
          ${this._chatIsCreator ? `<button class="btn btn-outline btn-sm" style="color:var(--text-tertiary)" onclick="DeputyApp.clearChat(${chatId})">Очистить чат</button>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;height:calc(100vh - 180px);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-card)">
          <div id="chat-messages" style="flex:1;overflow-y:auto;overflow-x:hidden;padding:12px 16px;display:flex;flex-direction:column"></div>
          <div id="chat-reply-wrap"></div>
          <div id="chat-input-bar" style="flex-shrink:0;display:flex;gap:8px;padding:10px 16px;background:var(--bg-card);border-top:1px solid var(--border)">
            <input id="chat-input" class="form-control" placeholder="Сообщение..." style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();DeputyApp.sendMessage()}">
            <button class="btn btn-primary" onclick="DeputyApp.sendMessage()" style="flex-shrink:0">&#x27A4;</button>
          </div>
        </div>`;
    }

    // iOS visualViewport fix
    if (window.visualViewport) {
      const onResize = () => {
        const wrap = document.getElementById('chat-wrap');
        if (!wrap) return;
        const offset = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
        wrap.style.bottom = Math.max(0, offset) + 'px';
        // Scroll to bottom when keyboard opens
        const msgs = document.getElementById('chat-messages');
        if (msgs) setTimeout(() => msgs.scrollTop = msgs.scrollHeight, 50);
      };
      window.visualViewport.addEventListener('resize', onResize);
      window.visualViewport.addEventListener('scroll', onResize);
      this._chatViewportHandler = onResize;
    }

    await this.loadMessages(chatId);
    if (this._chatPolling) clearInterval(this._chatPolling);
    this._chatPolling = setInterval(() => { if (this._openChatId === chatId) this.loadMessages(chatId, true); }, 3000);
  },

  async loadMessages(chatId, silent) {
    const msgs = await API.get(`/api/chat/${chatId}/messages`);
    if (!msgs) return;
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const wasBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    const myId = API.user.id;
    const shortName = (name) => { const p = name.split(' '); return p[0] + (p[1] ? ' ' + p[1][0] + '.' : '') + (p[2] ? p[2][0] + '.' : ''); };
    el.innerHTML = '<div style="flex:1"></div>' + msgs.map(m => {
      const isMine = m.sender_id === myId;
      const time = new Date(m.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
      const replyData = m.is_deleted ? '' : `${m.id},'${esc(shortName(m.sender_name)).replace(/'/g,"\\'")}','${esc(m.text.replace(/'/g,"\\'").substring(0,50))}'`;
      const editedMark = m.is_edited ? `<span style="font-size:0.6em;opacity:.5;margin-left:4px">ред.</span>` : '';
      if (m.is_deleted) {
        return `<div style="display:flex;justify-content:${isMine?'flex-end':'flex-start'};margin-bottom:0.4em;max-width:100%">
          <div style="padding:0.4em 0.8em;border-radius:12px;background:var(--bg-input);color:var(--text-tertiary);font-size:0.87em;font-style:italic">Сообщение удалено</div>
        </div>`;
      }
      return `<div style="display:flex;flex-direction:column;align-items:${isMine?'flex-end':'flex-start'};margin-bottom:0.4em;max-width:100%">
        <div style="max-width:75%;padding:0.5em 0.8em;border-radius:${isMine?'16px 16px 4px 16px':'16px 16px 16px 4px'};background:${isMine?'var(--blue)':'var(--bg-input)'};color:${isMine?'#fff':'var(--text)'};font-size:0.93em;line-height:1.4;word-break:break-word;overflow-wrap:break-word">
          ${!isMine ? `<div style="font-size:0.73em;font-weight:600;color:var(--blue);margin-bottom:2px">${esc(shortName(m.sender_name))}</div>` : ''}
          ${m.reply_to_text ? `<div style="border-left:2px solid ${isMine?'rgba(255,255,255,.4)':'var(--blue)'};padding-left:0.5em;margin-bottom:4px;font-size:0.8em;opacity:.7">${esc(m.reply_to_text.length>50?m.reply_to_text.substring(0,50)+'...':m.reply_to_text)}</div>` : ''}
          <div>${esc(m.text)}</div>
          <div style="font-size:0.67em;text-align:right;margin-top:2px;opacity:.6">${time}${editedMark}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button style="background:none;border:none;color:var(--text-tertiary);font-size:0.73em;cursor:pointer;padding:2px 4px" onclick="DeputyApp.setReply(${replyData})">Ответить</button>
          ${isMine ? `<button style="background:none;border:none;color:var(--text-tertiary);font-size:0.73em;cursor:pointer;padding:2px 4px" onclick="DeputyApp.editMessage(${m.id},'${esc(m.text.replace(/'/g,"\\'"))}')">Изменить</button>` : ''}
          ${isMine || DeputyApp._chatIsCreator ? `<button style="background:none;border:none;color:var(--red);font-size:0.73em;cursor:pointer;padding:2px 4px;opacity:.6" onclick="DeputyApp.deleteMessage(${m.id})">Удалить</button>` : ''}
        </div>
      </div>`;
    }).join('');
    if (!silent || wasBottom) el.scrollTop = el.scrollHeight;
    this.updateChatBadge();
  },

  _replyTo: null,

  setReply(msgId, name, text) {
    this._replyTo = { id: msgId, name, text };
    let bar = document.getElementById('chat-reply-bar');
    const wrap = document.getElementById('chat-reply-wrap');
    if (!bar && wrap) {
      wrap.innerHTML = `<div id="chat-reply-bar" style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-input);border-top:1px solid var(--border);font-size:13px;flex-shrink:0"></div>`;
      bar = document.getElementById('chat-reply-bar');
    }
    if (bar) bar.innerHTML = `<div style="flex:1;border-left:2px solid var(--blue);padding-left:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>${esc(name)}</b>: ${esc(text)}</div><button style="background:none;border:none;font-size:16px;cursor:pointer;color:var(--text-secondary)" onclick="DeputyApp.cancelReply()">&#x2716;</button>`;
    document.getElementById('chat-input')?.focus();
  },

  cancelReply() {
    this._replyTo = null;
    const wrap = document.getElementById('chat-reply-wrap');
    if (wrap) wrap.innerHTML = '';
  },

  async sendMessage() {
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    const body = { text };
    if (this._replyTo) { body.reply_to_id = this._replyTo.id; this.cancelReply(); }
    await API.post(`/api/chat/${this._openChatId}/send`, body);
    this.loadMessages(this._openChatId);
  },

  async updateChatBadge() {
    try {
      const d = await API.get('/api/chat/unread-total');
      ['chat-badge','chat-badge-desk'].forEach(id => {
        const b = document.getElementById(id);
        if (b) { b.textContent = d.count; b.classList.toggle('hidden', d.count === 0); }
      });
    } catch {}
  },

  // === Profile ===
  async loadProfile() {
    const p=await API.get('/api/deputy/profile');const pr=JSON.parse(p.notification_preferences||'{}');const hp=!!p.push_subscription;
    const rl=p.deputy_role==='head'?'Глава Совета депутатов муниципального округа':(p.user_type==='staff'?'Сотрудник':'Муниципальный депутат');
    const vacations = p.vacations || [];
    const today = new Date().toISOString().split('T')[0];
    let smtpHtml = '';
    if (p.user_type === 'staff') {
      let smtp = {};
      try { smtp = await API.get('/api/deputy/smtp-settings'); } catch(e) {}
      smtpHtml = `
      <div class="card"><h2 style="margin-bottom:4px">Настройка почты</h2>
        <p class="hint-text">Включите отправку писем от вашего имени. Когда вы создаёте мероприятие, письмо депутатам уйдёт с вашей почты.
          <br><strong>Яндекс:</strong> smtp.yandex.ru, порт 465, SSL — да, пароль приложения
          <br><strong>Gmail:</strong> smtp.gmail.com, порт 465, SSL — да, пароль приложения
          <br><strong>Mail.ru:</strong> smtp.mail.ru, порт 465, SSL — да, пароль приложения</p>
        <label class="pref-item" style="border:none;padding:0;margin-bottom:12px"><span>Отправлять письма от моего имени</span>
          <input type="checkbox" id="smtp-enabled" ${smtp.enabled?'checked':''} onchange="document.getElementById('smtp-fields').classList.toggle('hidden',!this.checked)"></label>
        <div class="form-group"><label>Подпись письма</label>
          <textarea id="my-smtp-sig" class="form-control" style="overflow:hidden;resize:vertical" placeholder="С уважением, ФИО&#10;Администрация МО&#10;телефон: ...&#10;e-mail: ..." oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${smtp.signature||''}</textarea>
          <span class="field-hint">Добавляется в конец каждого письма. Пример:<br>С уважением, Чайкина Ксения Владимировна<br>Администрация МО Арбат<br>тел. 8 925 077 87 71<br>e-mail: ksenia562@mail.ru</span>
        </div>
        <div id="smtp-fields" class="${smtp.enabled?'':'hidden'}">
          <div class="form-row"><div class="form-group" style="flex:2"><label>SMTP сервер</label><input id="my-smtp-h" class="form-control" value="${smtp.host||''}" placeholder="smtp.yandex.ru"></div>
            <div class="form-group" style="flex:1"><label>Порт</label><input type="number" id="my-smtp-p" class="form-control" value="${smtp.port||'465'}"></div></div>
          <div class="form-group"><label>SSL/TLS</label><select id="my-smtp-s" class="form-control"><option value="false" ${smtp.secure!=='true'?'selected':''}>Нет</option><option value="true" ${smtp.secure==='true'?'selected':''}>Да</option></select></div>
          <div class="form-group"><label>Логин (email)</label><input id="my-smtp-u" class="form-control" value="${smtp.user||''}"></div>
          <div class="form-group"><label>Пароль приложения</label><input type="password" id="my-smtp-pw" class="form-control" value="${smtp.pass||''}"></div>
          <div class="form-group"><label>От кого</label><input id="my-smtp-f" class="form-control" value="${smtp.from||''}" placeholder="Совпадает с логином"></div>
        </div>
        <button class="btn btn-primary" onclick="DeputyApp.saveSmtp()">Сохранить</button>
      </div>`;
    }
    const curSize = parseInt(localStorage.getItem('ya-deputat-font-size') || '15');

    // Categorize vacations
    const pastVacs = vacations.filter(v => v.vacation_end < today);
    const activeVacs = vacations.filter(v => v.vacation_start <= today && v.vacation_end >= today);
    const futureVacs = vacations.filter(v => v.vacation_start > today);

    document.getElementById('deputy-content').innerHTML=`
      <div class="card"><h2 style="margin-bottom:16px">Профиль</h2>
        <div id="profile-fields-view">
          <div class="form-group"><label>ФИО</label><div class="form-control readonly">${esc(p.full_name)}</div></div>
          <div class="form-group"><label>Email</label><div class="form-control readonly">${esc(p.email)||'—'}</div></div>
          <div class="form-group"><label>Телефон</label><div class="form-control readonly">${esc(p.phone)||'—'}</div></div>
          <div class="form-group"><label>Роль</label><div class="form-control readonly">${rl}</div></div>
          ${p.district_name?`<div class="form-group"><label>Район</label><div class="form-control readonly">${esc(p.district_name)} (${esc(p.okrug)})</div></div>`:''}
          ${p.substituting_for?`<div class="form-group"><label>Замещает</label><div class="form-control readonly">${esc(p.substituting_for)}</div></div>`:''}
          <button class="btn btn-outline" onclick="DeputyApp.enableProfileEdit('${p.full_name.replace(/'/g,"\\'")}','${(p.email||'').replace(/'/g,"\\'")}','${(p.phone||'').replace(/'/g,"\\'")}')">Редактировать</button>
        </div>
        <div id="profile-fields-edit" class="hidden">
          <div class="form-group"><label>ФИО</label><input id="prf-name" class="form-control" value="${esc(p.full_name)}"></div>
          <div class="form-group"><label>Email</label><input type="email" id="prf-email" class="form-control" value="${esc(p.email||'')}"></div>
          <div class="form-group"><label>Телефон</label><input type="tel" id="prf-phone" class="form-control" value="${esc(p.phone||'')}"></div>
          <div class="form-group"><label>Роль</label><div class="form-control readonly">${rl}</div></div>
          ${p.district_name?`<div class="form-group"><label>Район</label><div class="form-control readonly">${esc(p.district_name)} (${esc(p.okrug)})</div></div>`:''}
          ${p.substituting_for?`<div class="form-group"><label>Замещает</label><div class="form-control readonly">${esc(p.substituting_for)}</div></div>`:''}
          <button class="btn btn-primary" onclick="DeputyApp.saveProfile()">Сохранить</button>
        </div>
      </div>

      ${p.assigned_staff?.length?`<div class="card">
        <h2 style="margin-bottom:12px">Ваш сотрудник</h2>
        ${p.assigned_staff.map(s => `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:600;font-size:17px;margin-bottom:8px">${esc(s.full_name)}</div>
          ${s.phone?`<div style="margin-bottom:6px"><a href="tel:${esc(s.phone)}" style="color:var(--text);font-size:16px;font-weight:500;text-decoration:none">\u{1F4DE} ${esc(s.phone)}</a></div>`:''}
          ${s.email?`<div><a href="mailto:${esc(s.email)}" style="color:var(--blue);font-size:15px;text-decoration:none">\u{2709} ${esc(s.email)}</a></div>`:''}
        </div>`).join('')}
      </div>`:''}

      <div class="card"><h2 style="margin-bottom:12px">Отпуск</h2>
        ${activeVacs.length?activeVacs.map(v=>{
          const s=new Date(v.vacation_start), e2=new Date(v.vacation_end);
          return `<div class="vac-card vac-active">
            <div><div class="vac-label">Сейчас в отпуске</div>
              <div>с ${s.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</div>
              <div>по ${e2.toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'})}</div></div>
            <button class="btn btn-danger btn-sm" onclick="DeputyApp.delVac(${v.id})">Удалить</button>
          </div>`;}).join(''):''}
        ${futureVacs.length?futureVacs.map(v=>{
          const s=new Date(v.vacation_start), e2=new Date(v.vacation_end);
          return `<div class="vac-card vac-future">
            <div><div class="vac-label">Запланирован</div>
              <div>с ${s.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</div>
              <div>по ${e2.toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'})}</div></div>
            <button class="btn btn-danger btn-sm" onclick="DeputyApp.delVac(${v.id})">Удалить</button>
          </div>`;}).join(''):''}
        ${pastVacs.length?`<details style="margin-top:8px"><summary class="text-tertiary" style="cursor:pointer;font-size:13px">Прошедшие (${pastVacs.length})</summary>
          ${pastVacs.map(v=>`<div class="vac-card vac-past"><div>с ${new Date(v.vacation_start).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})} по ${new Date(v.vacation_end).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'})}</div></div>`).join('')}</details>`:''}
        ${!vacations.length?'<p class="text-gray" style="margin-bottom:12px">Нет отпусков</p>':''}
        <div style="margin-top:16px">
          <div style="font-weight:500;margin-bottom:8px">Добавить отпуск</div>
          <div style="margin-bottom:8px">
            <label style="font-size:12px;display:block;margin-bottom:4px">Начало отпуска</label>
            <input type="date" id="mv-s" class="form-control vac-date-input" value="${today}">
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:12px;display:block;margin-bottom:4px">Конец отпуска</label>
            <input type="date" id="mv-e" class="form-control vac-date-input" value="${new Date(Date.now()+14*86400000).toISOString().split('T')[0]}">
          </div>
          <button class="btn btn-primary btn-block" onclick="DeputyApp.saveVac()">Добавить отпуск</button>
        </div>
      </div>

      <div class="card"><h2 style="margin-bottom:12px">Уведомления</h2>
        <div class="pref-list">
          <label class="pref-item"><span>Push-уведомления</span><input type="checkbox" id="push-toggle" ${hp?'checked':''} onchange="DeputyApp.togglePush()"></label>
          <label class="pref-item"><span>Новые мероприятия (push)</span><input type="checkbox" id="pf-pne" ${pr.push_new_event!==false?'checked':''} onchange="DeputyApp.savePr()"></label>
          <label class="pref-item"><span>Напоминания (push)</span><input type="checkbox" id="pf-pr" ${pr.push_reminder!==false?'checked':''} onchange="DeputyApp.savePr()"></label>
        </div>
        <div class="field-hint" style="margin-top:8px">Если уведомления не приходят — проверьте разрешения в настройках устройства: iOS — Настройки \u2192 Уведомления \u2192 Я Депутат. Android — Настройки \u2192 Приложения \u2192 Браузер \u2192 Уведомления.</div>
        <div class="text-tertiary" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:12px">
          Email-уведомления приходят автоматически
        </div>
      </div>

      ${smtpHtml}

      ${p.user_type!=='staff' ? `<div class="card" id="my-reports-card"><h2 style="margin-bottom:16px">Мои отчёты</h2>
        <div id="my-reports-list">Загрузка...</div>
      </div>` : ''}

      ${p.user_type==='staff' ? `<div class="card"><h2 style="margin-bottom:12px">Лента</h2>
        <label class="pref-item"><span>Показывать приёмы депутатов</span>
          <input type="checkbox" ${localStorage.getItem('ya-deputat-show-receptions')!=='false'?'checked':''}
            onchange="localStorage.setItem('ya-deputat-show-receptions',this.checked);showToast('OK','success')">
        </label>
      </div>` : ''}

      <div class="card"><h2 style="margin-bottom:12px">Календарь</h2>
        <label class="pref-item"><span>Автоскачивание .ics при подтверждении приёмов</span>
          <input type="checkbox" id="pf-auto-cal" ${localStorage.getItem('ya-deputat-auto-calendar')==='true'?'checked':''}
            onchange="localStorage.setItem('ya-deputat-auto-calendar',this.checked);showToast('OK','success')">
        </label>
      </div>

      <div class="card"><h2 style="margin-bottom:12px">Оформление</h2>
        <div style="font-weight:500;margin-bottom:8px">Тема</div>
        <div class="font-size-btns" style="margin-bottom:16px">
          <button class="btn ${(localStorage.getItem('ya-deputat-theme')||'light')==='light'?'btn-primary':'btn-outline'}" data-theme="light" onclick="DeputyApp.setTheme('light')">Светлая</button>
          <button class="btn ${localStorage.getItem('ya-deputat-theme')==='dark'?'btn-primary':'btn-outline'}" data-theme="dark" onclick="DeputyApp.setTheme('dark')">Тёмная</button>
          <button class="btn ${localStorage.getItem('ya-deputat-theme')==='auto'?'btn-primary':'btn-outline'}" data-theme="auto" onclick="DeputyApp.setTheme('auto')">Авто</button>
        </div>
        <div style="font-weight:500;margin-bottom:8px">Размер шрифта</div>
        <div class="font-size-btns">
          <button class="btn ${curSize<=14?'btn-primary':'btn-outline'}" data-size="14px" onclick="DeputyApp.setFontSize('14px')" style="font-size:12px">А<span class="text-tertiary" style="display:block;font-size:10px">мелкий</span></button>
          <button class="btn ${curSize===15||curSize===16?'btn-primary':'btn-outline'}" data-size="15px" onclick="DeputyApp.setFontSize('15px')" style="font-size:15px">А<span class="text-tertiary" style="display:block;font-size:10px">обычный</span></button>
          <button class="btn ${curSize===18?'btn-primary':'btn-outline'}" data-size="18px" onclick="DeputyApp.setFontSize('18px')" style="font-size:19px">А<span class="text-tertiary" style="display:block;font-size:10px">крупный</span></button>
          <button class="btn ${curSize>=20?'btn-primary':'btn-outline'}" data-size="20px" onclick="DeputyApp.setFontSize('20px')" style="font-size:23px">А<span class="text-tertiary" style="display:block;font-size:10px">макс</span></button>
        </div>
      </div>

      <div class="mt-16"><button class="btn btn-outline btn-block" onclick="App.logout()">Выйти</button></div>

      <button class="btn btn-outline btn-block mt-16" onclick="DeputyApp.updateApp()" style="color:var(--text-tertiary);border-color:var(--border)">
        Обновить приложение
      </button>

      <div class="brand-inline mt-16">
        <a href="https://zetit.ru" target="_blank" class="brand-link">
          <img src="/icons/zetit-logo.png" alt="ЗЕТИТ" style="height:16px;opacity:.5;margin-bottom:2px" onerror="this.style.display='none'">
          <div style="font-size:9px;color:var(--text-tertiary)">Разработано в лаборатории креативных идей</div>
        </a>
        <div style="font-size:9px;color:var(--text-tertiary);opacity:.5">v2.5.0</div>
        <a href="#" class="text-tertiary" style="font-size:10px;display:block;margin-top:4px" onclick="event.preventDefault();DeputyApp.showChangelog()">История обновлений</a>
      </div>`;
    const sig = document.getElementById('my-smtp-sig');
    if (sig) { sig.style.height = 'auto'; sig.style.height = sig.scrollHeight + 'px'; }
    // Load reports
    this.loadMyReports();
  },

  async saveVac(){const vs=document.getElementById('mv-s').value,ve=document.getElementById('mv-e').value;if(!vs||!ve)return showToast('Укажите даты','error');await API.post('/api/deputy/vacation',{vacation_start:vs,vacation_end:ve});showToast('Отпуск добавлен','success');this.loadProfile();},
  async delVac(id){await API.del(`/api/deputy/vacation?vacation_id=${id}`);showToast('Удалено','success');this.loadProfile();},
  async saveProfile() {
    await API.put('/api/deputy/profile', {
      full_name: document.getElementById('prf-name').value,
      email: document.getElementById('prf-email').value,
      phone: document.getElementById('prf-phone').value
    });
    showToast('Профиль сохранён', 'success');
    this.loadProfile();
  },

  enableProfileEdit(name, email, phone) {
    document.getElementById('profile-fields-view').classList.add('hidden');
    document.getElementById('profile-fields-edit').classList.remove('hidden');
  },

  async loadMyReports() {
    const reports = await API.get('/api/deputy/reports');
    const el = document.getElementById('my-reports-list');
    if (!el) return;
    if (!reports.length) { el.innerHTML = '<p class="text-gray">Нет сохранённых отчётов</p>'; return; }
    el.innerHTML = reports.map(r => `<div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:500">${r.period}</div>
        <div class="text-tertiary">${new Date(r.created_at).toLocaleDateString('ru-RU')}</div>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-outline btn-sm" onclick="DeputyApp.showReport(${r.id})">Открыть</button>
        <button class="btn btn-outline btn-sm" onclick="DeputyApp.downloadReport(${r.id})">Word</button>
      </div>
    </div>`).join('');
  },

  async showReport(id) {
    const r = await API.get(`/api/deputy/reports/${id}`);
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:700px">
      <h3>Отчёт: ${r.period}</h3>
      <div class="text-tertiary mb-16">${new Date(r.created_at).toLocaleDateString('ru-RU')}</div>
      <p id="dep-rpt-text" style="white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(r.report_text)}</p>
      <div class="modal-actions">
        <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('dep-rpt-text').innerText);showToast('Скопировано','success')">Копировать</button>
        <button class="btn btn-outline btn-sm" onclick="DeputyApp.downloadReport(${r.id})">Скачать Word</button>
        <button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть</button>
      </div>
    </div></div>`);
  },

  async downloadReport(id) {
    const r = await API.get(`/api/deputy/reports/${id}`);
    try {
      const res = await fetch('/api/admin/report/download-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API.token}` },
        body: JSON.stringify({ text: r.report_text })
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `otchet-${r.period.replace(/\s/g,'-')}.docx`; a.click();
      URL.revokeObjectURL(url);
      showToast('Скачано', 'success');
    } catch (e) { showToast('Ошибка', 'error'); }
  },

  async deleteReport(id) {
    if (!confirm('Удалить отчёт?')) return;
    await API.del(`/api/deputy/reports/${id}`);
    showToast('Удалено', 'success');
    this.loadMyReports();
  },

  async saveSmtp() {
    const settings = {
      enabled: document.getElementById('smtp-enabled').checked,
      signature: document.getElementById('my-smtp-sig')?.value || '',
      host: document.getElementById('my-smtp-h')?.value || '',
      port: document.getElementById('my-smtp-p')?.value || '465',
      secure: document.getElementById('my-smtp-s')?.value || 'true',
      user: document.getElementById('my-smtp-u')?.value || '',
      pass: document.getElementById('my-smtp-pw')?.value || '',
      from: document.getElementById('my-smtp-f')?.value || '',
    };
    await API.put('/api/deputy/smtp-settings', { settings });
    showToast('Настройки почты сохранены', 'success');
  },

  async updateApp() {
    showToast('Обновление...', 'info');
    // Unregister SW
    if ('serviceWorker' in navigator) {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var r of regs) await r.unregister();
    }
    // Clear all caches
    if ('caches' in window) {
      var keys = await caches.keys();
      for (var k of keys) await caches.delete(k);
    }
    // Reload
    setTimeout(function() { location.reload(true); }, 500);
  },

  setTheme(theme) {
    localStorage.setItem('ya-deputat-theme', theme);
    document.documentElement.className = theme === 'dark' ? 'theme-dark' : theme === 'auto' ? 'theme-auto' : '';
    document.querySelectorAll('[data-theme]').forEach(b => b.className = b.dataset.theme === theme ? 'btn btn-primary' : 'btn btn-outline');
    showToast(theme === 'light' ? 'Светлая тема' : theme === 'dark' ? 'Тёмная тема' : 'Авто', 'success');
  },

  setFontSize(size){
    localStorage.setItem('ya-deputat-font-size',size);
    document.documentElement.style.fontSize=size;
    // Apply to all text elements
    document.querySelectorAll('body,p,span,div,label,input,select,textarea,button,a,h1,h2,h3,h4,td,th').forEach(el=>{
      if(!el.style.fontSize || el.closest('.font-size-btns')) return;
    });
    document.body.style.fontSize=size;
    showToast('Размер: '+size,'success');
    document.querySelectorAll('.font-size-btns .btn').forEach(b=>{
      b.className=b.dataset.size===size?'btn btn-primary':'btn btn-outline';
    });
  },
  async savePr(){await API.put('/api/deputy/notification-preferences',{preferences:{push_new_event:document.getElementById('pf-pne').checked,push_reminder:document.getElementById('pf-pr').checked,email_new_event:document.getElementById('pf-ene').checked,email_reminder:document.getElementById('pf-er').checked}});showToast('OK','success');},

  async showChangelog(){
    const log=await fetch('/api/auth/changelog').then(r=>r.json());
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><h3>История изменений</h3>${log.map(e=>`<div class="changelog-entry"><div class="changelog-version">v${e.version}</div><div class="changelog-title">${esc(e.title)}</div><div class="changelog-desc">${esc(e.description)}</div></div>`).join('')}<div class="modal-actions"><button class="btn btn-outline" onclick="document.querySelector('.modal-overlay').remove()">Закрыть</button></div></div></div>`);
  },

  // Push
  async subscribePush(){if(!('Notification' in window)||!('serviceWorker' in navigator))return;if(await Notification.requestPermission()!=='granted')return;try{const vk=await API.get('/api/deputy/vapid-key');const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:this.u2a(vk.key)});await API.post('/api/deputy/push-subscribe',{subscription:sub});}catch(e){console.log('Push failed:',e);}},
  async togglePush(){
    if(!('Notification' in window)){showToast('Push не поддерживается на этом устройстве','error');return;}
    var toggle = document.getElementById('push-toggle');
    var wantOn = toggle ? toggle.checked : true;

    if (wantOn) {
      // Включаем
      var perm = await Notification.requestPermission();
      if (perm === 'granted') {
        await this.subscribePush();
        showToast('Push-уведомления включены','success');
      } else {
        showToast('Разрешение на уведомления отклонено. Разрешите в настройках браузера.','error');
        if (toggle) toggle.checked = false;
        return;
      }
    } else {
      // Выключаем
      try { var reg = await navigator.serviceWorker.ready; var s = await reg.pushManager.getSubscription(); if(s) await s.unsubscribe(); } catch(e){}
      await API.post('/api/deputy/push-unsubscribe');
      showToast('Push-уведомления выключены','success');
    }
    // Подождать сохранение и обновить
    await new Promise(r => setTimeout(r, 500));
    this.loadProfile();
  },
  async updateUnreadBadge(){try{const d=await API.get('/api/deputy/unread-count');const b=document.getElementById('unread-badge');if(b){b.textContent=d.count;b.classList.toggle('hidden',d.count===0);}}catch{}this.updateRecBadge();this.updateChatBadge();},
  async updateRecBadge(){try{const recs=await API.get('/api/deputy/receptions');const cnt=(recs||[]).filter(r=>r.status==='pending').length;['rec-badge','rec-badge-desk'].forEach(id=>{const b=document.getElementById(id);if(b){b.textContent=cnt;b.classList.toggle('hidden',cnt===0);}});}catch{}},
  u2a(b64){const pad='='.repeat((4-b64.length%4)%4);const b=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');const r=atob(b);const a=new Uint8Array(r.length);for(let i=0;i<r.length;i++)a[i]=r.charCodeAt(i);return a;}
};

// === Tutorial / Onboarding System ===
const Tutorial = {
  _step: 0,
  _steps: [],
  _mode: '', // 'deputy-mobile', 'staff-mobile', 'staff-desktop', 'deputy-desktop'
  _storageKey: 'ya-deputat-tutorial-done',

  _configs: {
    'deputy-mobile': [
      { tab: 'events', selector: '.nav-item[data-tab="events"]', title: 'Лента', desc: 'Здесь отображаются все ваши мероприятия и приёмы' },
      { tab: 'calendar', selector: '.nav-item[data-tab="calendar"]', title: 'Календарь', desc: 'Просматривайте расписание по месяцам, кварталам и годам' },
      { tab: 'receptions', selector: '.nav-item[data-tab="receptions"]', title: 'Приёмы', desc: 'Управляйте приёмами населения, подтверждайте расписание' },
      { tab: 'chat', selector: '.nav-item[data-tab="chat"]', title: 'Чат', desc: 'Общайтесь с сотрудниками и другими депутатами' },
      { tab: 'profile', selector: '.nav-item[data-tab="profile"]', title: 'Профиль', desc: 'Настройки, размер шрифта, тема, push-уведомления' },
    ],
    'staff-mobile': [
      { tab: 'events', selector: '.nav-item[data-tab="events"]', title: 'Лента', desc: 'События всех ваших депутатов в одном месте' },
      { tab: 'calendar', selector: '.nav-item[data-tab="calendar"]', title: 'Календарь', desc: 'Расписание с фильтром по депутатам' },
      { tab: 'manage', selector: '.nav-item[data-tab="manage"]', title: 'Депутаты', desc: 'Контакты привязанных депутатов' },
      { tab: 'chat', selector: '.nav-item[data-tab="chat"]', title: 'Чат', desc: 'Создавайте чаты, общайтесь с депутатами' },
      { tab: 'profile', selector: '.nav-item[data-tab="profile"]', title: 'Профиль', desc: 'Настройки почты, подпись, тема' },
    ],
    'deputy-desktop': [
      { section: 'events', selector: '.sidebar-item[data-section="events"]', title: 'Лента', desc: 'Здесь отображаются все ваши мероприятия и приёмы' },
      { section: 'calendar', selector: '.sidebar-item[data-section="calendar"]', title: 'Календарь', desc: 'Просматривайте расписание по месяцам, кварталам и годам' },
      { section: 'receptions', selector: '.sidebar-item[data-section="receptions"]', title: 'Приёмы', desc: 'Управляйте приёмами населения, подтверждайте расписание' },
      { section: 'chat', selector: '.sidebar-item[data-section="chat"]', title: 'Чат', desc: 'Общайтесь с сотрудниками и другими депутатами' },
      { section: 'profile', selector: '.sidebar-item[data-section="profile"]', title: 'Профиль', desc: 'Настройки, размер шрифта, тема, push-уведомления' },
    ],
    'staff-desktop': [
      { section: 'dashboard', selector: '.sidebar-item[data-section="dashboard"]', title: 'Главная', desc: 'Статистика и лента событий' },
      { section: 'events', selector: '.sidebar-item[data-section="events"]', title: 'Мероприятия', desc: 'Создание и управление заседаниями' },
      { section: 'receptions', selector: '.sidebar-item[data-section="receptions"]', title: 'Приёмы', desc: 'Планирование приёмов по кварталам' },
      { section: 'chat', selector: '.sidebar-item[data-section="chat"]', title: 'Чат', desc: 'Зашифрованные чаты с депутатами' },
      { section: 'myprofile', selector: '.sidebar-item[data-section="myprofile"]', title: 'Мой профиль', desc: 'Настройки SMTP и подпись' },
    ],
  },

  shouldShow() {
    return !localStorage.getItem(this._storageKey);
  },

  show(mode) {
    if (!this.shouldShow()) return;
    this._mode = mode;
    this._steps = this._configs[mode];
    if (!this._steps || !this._steps.length) return;
    this._step = 0;
    // Small delay so the DOM is ready
    setTimeout(() => this._render(), 400);
  },

  _render() {
    const step = this._steps[this._step];
    if (!step) { this.dismiss(); return; }
    const total = this._steps.length;
    const isLast = this._step === total - 1;

    // Remove previous highlight
    document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));

    // Add highlight to current element
    const target = document.querySelector(step.selector);
    if (target) target.classList.add('tutorial-highlight');

    // Add active class to body for z-index management
    document.body.classList.add('tutorial-active');

    // Build dots
    let dots = '';
    for (let i = 0; i < total; i++) {
      dots += '<div class="tutorial-dot' + (i === this._step ? ' active' : '') + '"></div>';
    }

    // Remove existing overlay/card
    this._removeElements();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'tutorial-overlay';
    overlay.id = 'tutorial-overlay';
    overlay.onclick = () => {}; // block clicks
    document.body.appendChild(overlay);

    // Create card
    const card = document.createElement('div');
    card.className = 'tutorial-card';
    card.id = 'tutorial-card';
    card.innerHTML =
      '<div class="tutorial-progress">' + dots + '</div>' +
      '<div class="tutorial-step-counter">' + (this._step + 1) + ' / ' + total + '</div>' +
      '<div class="tutorial-title">' + step.title + '</div>' +
      '<div class="tutorial-desc">' + step.desc + '</div>' +
      '<div class="tutorial-actions">' +
        '<button class="tutorial-dismiss-btn" onclick="Tutorial.dismiss()">' +
          (this._step === 0 ? 'Больше не показывать' : 'Пропустить') +
        '</button>' +
        '<button class="tutorial-next-btn" onclick="Tutorial.nextStep()">' +
          (isLast ? 'Готово' : 'Далее') +
        '</button>' +
      '</div>';
    document.body.appendChild(card);
  },

  nextStep() {
    this._step++;
    if (this._step >= this._steps.length) {
      this._finish();
    } else {
      this._render();
    }
  },

  dismiss() {
    localStorage.setItem(this._storageKey, '1');
    this._cleanup();
  },

  _finish() {
    localStorage.setItem(this._storageKey, '1');
    this._cleanup();
    showToast('Готово! Приятной работы!', 'success');
  },

  _cleanup() {
    this._removeElements();
    document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    document.body.classList.remove('tutorial-active');
  },

  _removeElements() {
    const overlay = document.getElementById('tutorial-overlay');
    const card = document.getElementById('tutorial-card');
    if (overlay) overlay.remove();
    if (card) card.remove();
  }
};
