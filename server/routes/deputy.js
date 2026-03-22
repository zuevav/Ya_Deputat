const express = require('express');
const path = require('path');
const archiver = require('archiver');
const db = require('../db/init');
const { authDeputy } = require('../middleware/auth');
const { vapidKeys } = require('../push');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const router = express.Router();
router.use(authDeputy);

// Events
router.get('/events', (req, res) => {
  const { filter } = req.query;
  let df = '';
  if (filter === 'past') df = "AND e.event_date < datetime('now')";
  else if (filter !== 'all') df = "AND e.event_date >= datetime('now')";
  res.json(db.prepare(`SELECT e.*, ep.status as my_status, ep.ai_post_text, ep.admin_block_text, ep.deputy_response_text, ep.block_confirmed, COALESCE(ep.post_gen_count,0) as post_gen_count, c.name as commission_name
    FROM events e JOIN event_participants ep ON ep.event_id=e.id AND ep.deputy_id=?
    LEFT JOIN commissions c ON e.commission_id=c.id ${df} ORDER BY e.event_date ASC`).all(req.user.id));
});

// Staff feed — all linked deputies' events + receptions
router.get('/staff-feed', (req, res) => {
  if (req.user.userType !== 'staff') return res.status(403).json({ error: 'Только для сотрудников' });
  const links = db.prepare('SELECT deputy_id FROM staff_deputy_links WHERE staff_id=?').all(req.user.id).map(r => r.deputy_id);
  if (!links.length) return res.json({ events: [], receptions: [], personalEvents: [] });
  const ph = links.map(() => '?').join(',');

  const events = db.prepare(`SELECT DISTINCT e.*, c.name as commission_name,
    (SELECT GROUP_CONCAT(d2.full_name, ', ') FROM event_participants ep2 JOIN deputies d2 ON d2.id=ep2.deputy_id WHERE ep2.event_id=e.id AND d2.id IN (${ph})) as deputy_names
    FROM events e LEFT JOIN commissions c ON e.commission_id=c.id
    WHERE e.id IN (SELECT event_id FROM event_participants WHERE deputy_id IN (${ph}))
    ORDER BY e.event_date ASC`).all(...links, ...links);

  const receptions = db.prepare(`SELECT r.*, d.full_name as deputy_name FROM receptions r
    JOIN deputies d ON d.id=r.deputy_id WHERE r.deputy_id IN (${ph}) AND r.status='confirmed'
    ORDER BY r.reception_date ASC`).all(...links);

  const personalEvents = db.prepare(`SELECT pe.*, d.full_name as deputy_name FROM personal_events pe
    JOIN deputies d ON d.id=pe.deputy_id WHERE pe.deputy_id IN (${ph}) AND pe.visibility='shared'
    ORDER BY pe.event_date ASC`).all(...links);

  res.json({ events, receptions, personalEvents });
});

// Staff calendar data for specific deputy
router.get('/staff-calendar/:deputyId', (req, res) => {
  if (req.user.userType !== 'staff') return res.status(403).json({ error: 'Только для сотрудников' });
  const depId = parseInt(req.params.deputyId);
  const linked = db.prepare('SELECT 1 FROM staff_deputy_links WHERE staff_id=? AND deputy_id=?').get(req.user.id, depId);
  if (!linked) return res.status(403).json({ error: 'Нет доступа к этому депутату' });
  const events = db.prepare(`SELECT e.event_date, e.title, e.event_type FROM events e
    JOIN event_participants ep ON ep.event_id=e.id AND ep.deputy_id=? ORDER BY e.event_date`).all(depId);
  const receptions = db.prepare('SELECT reception_date, time_start, time_end, location FROM receptions WHERE deputy_id=? AND status=? ORDER BY reception_date').all(depId, 'confirmed');
  const vacations = db.prepare('SELECT vacation_start, vacation_end FROM vacations WHERE deputy_id=?').all(depId);
  const personal = db.prepare("SELECT event_date, title FROM personal_events WHERE deputy_id=? AND visibility='shared'").all(depId);
  res.json({ events, receptions, vacations, personal });
});

// Linked deputies list for staff
router.get('/linked-deputies', (req, res) => {
  if (req.user.userType !== 'staff') return res.json([]);
  const deps = db.prepare(`SELECT d.id, d.full_name, d.deputy_role FROM deputies d
    JOIN staff_deputy_links sdl ON sdl.deputy_id=d.id WHERE sdl.staff_id=? ORDER BY d.full_name`).all(req.user.id);
  res.json(deps);
});

router.get('/events/:id', (req, res) => {
  const ev = db.prepare(`SELECT e.*, ep.status as my_status, ep.ai_post_text, ep.admin_block_text, ep.deputy_response_text, ep.block_confirmed, COALESCE(ep.post_gen_count,0) as post_gen_count, c.name as commission_name
    FROM events e JOIN event_participants ep ON ep.event_id=e.id AND ep.deputy_id=?
    LEFT JOIN commissions c ON e.commission_id=c.id WHERE e.id=?`).get(req.user.id, req.params.id);
  if (!ev) return res.status(404).json({ error: 'Не найдено' });
  ev.files = db.prepare('SELECT * FROM event_files WHERE event_id=?').all(req.params.id);
  ev.participants = db.prepare(`SELECT d.full_name, d.user_type, d.deputy_role, ep.status,
    (SELECT COUNT(*) FROM vacations v WHERE v.deputy_id=d.id AND v.vacation_start<=date('now') AND v.vacation_end>=date('now')) as on_vacation
    FROM event_participants ep JOIN deputies d ON d.id=ep.deputy_id WHERE ep.event_id=? ORDER BY d.full_name`).all(req.params.id);
  ev.agenda_items = db.prepare('SELECT * FROM event_agenda_items WHERE event_id=? ORDER BY item_order').all(req.params.id);
  ev.my_votes = db.prepare('SELECT * FROM event_votes WHERE event_id=? AND deputy_id=?').all(req.params.id, req.user.id);
  // Check if deputy is on vacation
  const today = new Date().toISOString().split('T')[0];
  const onVacation = db.prepare("SELECT COUNT(*) as c FROM vacations WHERE deputy_id=? AND vacation_start<=? AND vacation_end>=?").get(req.user.id, today, today);
  ev.im_on_vacation = onVacation.c > 0;
  ev.can_vote = ev.im_on_vacation || ev.my_status === 'declined';
  res.json(ev);
});

router.post('/events/:id/seen', (req, res) => { db.prepare("UPDATE event_participants SET status='seen', seen_at=datetime('now') WHERE event_id=? AND deputy_id=? AND status='pending'").run(req.params.id, req.user.id); res.json({ success: true }); });

router.post('/events/:id/respond', (req, res) => {
  const { response } = req.body;
  if (!['confirmed','declined'].includes(response)) return res.status(400).json({ error: 'Неверно' });
  db.prepare("UPDATE event_participants SET status=?, responded_at=datetime('now') WHERE event_id=? AND deputy_id=?").run(response, req.params.id, req.user.id);
  res.json({ success: true });
});

// Voting
router.post('/events/:eid/vote', (req, res) => {
  const { agenda_item_id, vote } = req.body;
  if (!['support','abstain','oppose'].includes(vote)) return res.status(400).json({ error: 'Неверно' });
  const ex = db.prepare('SELECT id FROM event_votes WHERE agenda_item_id=? AND deputy_id=?').get(agenda_item_id, req.user.id);
  if (ex) db.prepare('UPDATE event_votes SET vote=? WHERE id=?').run(vote, ex.id);
  else db.prepare('INSERT INTO event_votes (event_id, agenda_item_id, deputy_id, vote) VALUES (?,?,?,?)').run(req.params.eid, agenda_item_id, req.user.id, vote);
  res.json({ success: true });
});

// Generate post for self
// Download event photos as ZIP
router.get('/events/:id/photos-zip', (req, res) => {
  const photos = db.prepare("SELECT filename, original_name FROM event_files WHERE event_id=? AND file_type='photo'").all(req.params.id);
  if (!photos.length) return res.status(404).json({ error: 'Нет фото' });
  const event = db.prepare('SELECT title FROM events WHERE id=?').get(req.params.id);
  const zipName = `photos-${(event?.title || 'event').replace(/[^a-zA-Zа-яА-Я0-9]/g, '_').substring(0, 30)}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(res);
  photos.forEach(p => {
    const filePath = path.join(UPLOADS_DIR, p.filename);
    archive.file(filePath, { name: p.original_name || p.filename });
  });
  archive.finalize();
});

// Update writing style profile after generating a post
async function updateWritingStyle(deputyId, newPost) {
  const ai = require('../ai');
  if (!ai.isAiConfigured()) return;
  const dep = db.prepare('SELECT writing_style FROM deputies WHERE id=?').get(deputyId);
  const currentStyle = dep?.writing_style || '';
  try {
    const style = await ai.callDeepSeek(
      'Ты анализируешь стиль текстов. Ответ — краткое описание стиля автора (3-5 предложений): длина постов, тон, структура, типичные обороты, использует ли эмодзи/хештеги, обращается ли к аудитории, формальность. Только описание стиля, ничего больше.',
      `${currentStyle ? 'Текущий профиль стиля автора:\n' + currentStyle + '\n\nНовый пост автора:\n' : 'Пост автора:\n'}${newPost}\n\nОбнови профиль стиля автора. Сохрани ключевые черты, добавь новые если появились.`
    );
    db.prepare('UPDATE deputies SET writing_style=? WHERE id=?').run(style, deputyId);
  } catch(e) { console.error('Style update failed:', e.message); }
}

router.post('/events/:id/generate-post', async (req, res) => {
  const ai = require('../ai');
  if (!ai.isAiConfigured()) return res.status(400).json({ error: 'ИИ не настроен' });

  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event || event.status !== 'closed') return res.status(400).json({ error: 'Мероприятие не завершено' });

  // Check regeneration limit
  const ep = db.prepare('SELECT post_gen_count FROM event_participants WHERE event_id=? AND deputy_id=?').get(req.params.id, req.user.id);
  const genCount = ep?.post_gen_count || 0;
  if (genCount >= 3) return res.status(400).json({ error: 'Достигнут лимит генераций (3 из 3)' });

  const deputy = db.prepare('SELECT * FROM deputies WHERE id=?').get(req.user.id);
  const items = db.prepare('SELECT * FROM event_agenda_items WHERE event_id=? ORDER BY item_order').all(req.params.id);
  const styleProfile = deputy.writing_style || '';

  try {
    const agenda = items.map((a, i) => `${i+1}. ${a.title}`).join('\n');
    const post = await ai.callDeepSeek(
      `Ты пишешь короткие посты для соцсетей от имени муниципального депутата. Максимум 20 строк. На русском языке.${styleProfile ? ' Соблюдай стиль автора.' : ' Стиль: сдержанный, информативный.'}`,
      `Напиши пост от имени депутата ${deputy.full_name}.\nМероприятие: ${event.title}\nДата: ${event.event_date}\nМесто: ${event.location || ''}\nПовестка:\n${agenda}\n${event.admin_comment ? 'Итоги: ' + event.admin_comment : ''}${styleProfile ? '\n\nПрофиль стиля автора:\n' + styleProfile : ''}\n\nНапиши пост от первого лица. Только факты.`
    );

    db.prepare('UPDATE event_participants SET ai_post_text=?, post_gen_count=? WHERE event_id=? AND deputy_id=?')
      .run(post, genCount + 1, req.params.id, req.user.id);

    res.json({ post, remaining: 3 - genCount - 1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin block confirm/edit
router.post('/events/:id/confirm-block', (req, res) => {
  db.prepare('UPDATE event_participants SET block_confirmed=1 WHERE event_id=? AND deputy_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

router.post('/events/:id/edit-block', (req, res) => {
  db.prepare('UPDATE event_participants SET deputy_response_text=?, block_confirmed=1 WHERE event_id=? AND deputy_id=?').run(req.body.text, req.params.id, req.user.id);
  res.json({ success: true });
});

// Receptions
router.get('/receptions', (req, res) => {
  res.json(db.prepare('SELECT * FROM receptions WHERE deputy_id=? ORDER BY reception_date, time_start').all(req.user.id));
});

// Upcoming receptions for feed
router.get('/upcoming-receptions', (req, res) => {
  res.json(db.prepare("SELECT * FROM receptions WHERE deputy_id=? AND reception_date>=date('now') AND status='confirmed' ORDER BY reception_date LIMIT 5").all(req.user.id));
});

router.post('/receptions', (req, res) => {
  const { reception_date, time_start, time_end, location, quarter, year } = req.body;
  if (!reception_date) return res.status(400).json({ error: 'Укажите дату' });
  const r = db.prepare('INSERT INTO receptions (deputy_id, reception_date, time_start, time_end, location, quarter, year) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, reception_date, time_start||null, time_end||null, location||null, quarter||null, year||null);
  res.json({ id: r.lastInsertRowid });
});

router.delete('/receptions/:id', (req, res) => {
  db.prepare('DELETE FROM receptions WHERE id=? AND deputy_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Generate post for reception
router.post('/receptions/:id/generate-post', async (req, res) => {
  const r = db.prepare('SELECT * FROM receptions WHERE id=? AND deputy_id=?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Не найден' });
  if (r.post_text) return res.json({ post: r.post_text, already: true });

  const ai = require('../ai');
  if (!ai.isAiConfigured()) return res.status(400).json({ error: 'ИИ не настроен' });

  const dep = db.prepare('SELECT full_name, writing_style FROM deputies WHERE id=?').get(req.user.id);
  const styleProfile = dep.writing_style || '';

  try {
    const post = await ai.callDeepSeek(
      `Напиши короткий пост для соцсетей от имени муниципального депутата. Максимум 15 строк. На русском.${styleProfile ? ' Соблюдай стиль автора.' : ' Сдержанный информативный стиль.'}`,
      `Депутат ${dep.full_name} провёл приём населения.\nДата: ${r.reception_date}\nВремя: ${r.time_start}–${r.time_end}\nМесто: ${r.location || 'не указано'}\n${r.description ? 'Описание: ' + r.description : ''}${styleProfile ? '\n\nПрофиль стиля автора:\n' + styleProfile : ''}\n\nНапиши короткий пост от первого лица. Только факты.`
    );
    db.prepare('UPDATE receptions SET post_text=? WHERE id=?').run(post, r.id);
    res.json({ post });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save edited post
router.put('/receptions/:id/post', (req, res) => {
  db.prepare('UPDATE receptions SET post_text=? WHERE id=? AND deputy_id=?').run(req.body.post, req.params.id, req.user.id);
  res.json({ success: true });
  // If deputy edited the post manually — learn their edits
  if (req.body.post && req.body.post.length > 30) {
    updateWritingStyle(req.user.id, req.body.post);
  }
});

// Mark reception outcome
router.post('/receptions/:id/outcome', (req, res) => {
  const { outcome } = req.body;
  if (!['held', 'cancelled'].includes(outcome)) return res.status(400).json({ error: 'held или cancelled' });
  db.prepare('UPDATE receptions SET outcome=? WHERE id=? AND deputy_id=?').run(outcome, req.params.id, req.user.id);
  res.json({ success: true });
});

router.post('/receptions/confirm-quarter', (req, res) => {
  const { quarter, year } = req.body;
  db.prepare("UPDATE receptions SET status='confirmed' WHERE deputy_id=? AND quarter=? AND year=?").run(req.user.id, quarter, year);
  res.json({ success: true });
});

// Confirm single reception
router.post('/receptions/:id/confirm', (req, res) => {
  db.prepare("UPDATE receptions SET status='confirmed' WHERE id=? AND deputy_id=?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Edit reception (deputy changes date/time/location/description)
router.put('/receptions/:id', (req, res) => {
  const { reception_date, time_start, time_end, location, description } = req.body;
  db.prepare('UPDATE receptions SET reception_date=?, time_start=?, time_end=?, location=?, description=? WHERE id=? AND deputy_id=?')
    .run(reception_date, time_start, time_end, location || null, description || null, req.params.id, req.user.id);
  res.json({ success: true });
  // Update writing style if description is substantial (>50 chars)
  if (description && description.length > 50) {
    updateWritingStyle(req.user.id, description);
  }
});

// Push
router.post('/push-subscribe', (req, res) => { db.prepare('UPDATE deputies SET push_subscription=? WHERE id=?').run(JSON.stringify(req.body.subscription), req.user.id); res.json({ success: true }); });
router.post('/push-unsubscribe', (req, res) => { db.prepare('UPDATE deputies SET push_subscription=NULL WHERE id=?').run(req.user.id); res.json({ success: true }); });
router.get('/vapid-key', (req, res) => { res.json({ key: vapidKeys.publicKey }); });

// Profile
router.get('/profile', (req, res) => {
  const d = db.prepare('SELECT d.*, dist.name as district_name, dist.okrug FROM deputies d LEFT JOIN districts dist ON d.district_id=dist.id WHERE d.id=?').get(req.user.id);
  if (d.substitute_for_id) { const h = db.prepare('SELECT full_name FROM deputies WHERE id=?').get(d.substitute_for_id); d.substituting_for = h?.full_name; }
  // Assigned staff with contacts
  d.assigned_staff = db.prepare(`SELECT s.full_name, s.email, s.phone FROM deputies s JOIN staff_deputy_links sdl ON sdl.staff_id=s.id WHERE sdl.deputy_id=?`).all(req.user.id);
  // Vacations
  d.vacations = db.prepare('SELECT * FROM vacations WHERE deputy_id=? ORDER BY vacation_start').all(req.user.id);
  res.json(d);
});

// Update own profile (name, email, phone — NOT district)
router.put('/profile', (req, res) => {
  const { full_name, email, phone } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Укажите ФИО' });
  db.prepare('UPDATE deputies SET full_name=?, email=?, phone=? WHERE id=?')
    .run(full_name, email || null, phone || null, req.user.id);
  res.json({ success: true });
});

// Vacations (multiple)
router.get('/vacations', (req, res) => {
  res.json(db.prepare('SELECT * FROM vacations WHERE deputy_id=? ORDER BY vacation_start').all(req.user.id));
});
router.post('/vacation', (req, res) => {
  const { vacation_start, vacation_end } = req.body;
  if (!vacation_start || !vacation_end) return res.status(400).json({ error: 'Укажите даты' });
  const r = db.prepare('INSERT INTO vacations (deputy_id, vacation_start, vacation_end) VALUES (?,?,?)').run(req.user.id, vacation_start, vacation_end);
  res.json({ success: true, id: r.lastInsertRowid });
});
router.delete('/vacation', (req, res) => {
  const { vacation_id } = req.query;
  if (vacation_id) {
    db.prepare('DELETE FROM vacations WHERE id=? AND deputy_id=?').run(vacation_id, req.user.id);
  } else {
    db.prepare('DELETE FROM vacations WHERE deputy_id=?').run(req.user.id);
    db.prepare('UPDATE deputies SET substitute_for_id=NULL WHERE substitute_for_id=?').run(req.user.id);
  }
  res.json({ success: true });
});

// Notification prefs
router.get('/notification-preferences', (req, res) => { res.json(JSON.parse(db.prepare('SELECT notification_preferences FROM deputies WHERE id=?').get(req.user.id).notification_preferences||'{}')); });
router.put('/notification-preferences', (req, res) => { db.prepare('UPDATE deputies SET notification_preferences=? WHERE id=?').run(JSON.stringify(req.body.preferences), req.user.id); res.json({ success: true }); });

// === Lead staff: manage staff in own district ===
router.get('/managed-staff', (req, res) => {
  if (req.user.userType !== 'staff') return res.status(403).json({ error: 'Нет доступа' });
  const me = db.prepare('SELECT district_id, staff_role FROM deputies WHERE id=?').get(req.user.id);
  if (me.staff_role !== 'lead') return res.status(403).json({ error: 'Только для главного сотрудника' });
  const staff = db.prepare(`SELECT d.id, d.full_name, d.email, d.phone, d.staff_role, d.passkey_registered,
    d.permissions FROM deputies d WHERE d.user_type='staff' AND d.district_id=? ORDER BY d.staff_role DESC, d.full_name`)
    .all(me.district_id);
  res.json(staff);
});

router.post('/managed-staff', (req, res) => {
  if (req.user.userType !== 'staff') return res.status(403).json({ error: 'Нет доступа' });
  const me = db.prepare('SELECT district_id, staff_role FROM deputies WHERE id=?').get(req.user.id);
  if (me.staff_role !== 'lead') return res.status(403).json({ error: 'Только для главного сотрудника' });
  const { full_name, email, phone, staff_role } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Укажите ФИО' });
  const r = db.prepare('INSERT INTO deputies (full_name, email, phone, district_id, user_type, staff_role) VALUES (?,?,?,?,?,?)')
    .run(full_name, email || null, phone || null, me.district_id, 'staff', staff_role || 'regular');
  res.json({ id: r.lastInsertRowid });
});

router.put('/managed-staff/:id', (req, res) => {
  if (req.user.userType !== 'staff') return res.status(403).json({ error: 'Нет доступа' });
  const me = db.prepare('SELECT district_id, staff_role FROM deputies WHERE id=?').get(req.user.id);
  if (me.staff_role !== 'lead') return res.status(403).json({ error: 'Только для главного сотрудника' });
  const target = db.prepare('SELECT district_id FROM deputies WHERE id=? AND user_type=?').get(req.params.id, 'staff');
  if (!target || target.district_id !== me.district_id) return res.status(403).json({ error: 'Нет доступа' });
  const { full_name, email, phone, staff_role } = req.body;
  db.prepare('UPDATE deputies SET full_name=?, email=?, phone=?, staff_role=? WHERE id=?')
    .run(full_name, email || null, phone || null, staff_role || 'regular', req.params.id);
  res.json({ success: true });
});

router.delete('/managed-staff/:id', (req, res) => {
  if (req.user.userType !== 'staff') return res.status(403).json({ error: 'Нет доступа' });
  const me = db.prepare('SELECT district_id, staff_role FROM deputies WHERE id=?').get(req.user.id);
  if (me.staff_role !== 'lead') return res.status(403).json({ error: 'Только для главного сотрудника' });
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  const target = db.prepare('SELECT district_id FROM deputies WHERE id=? AND user_type=?').get(req.params.id, 'staff');
  if (!target || target.district_id !== me.district_id) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('DELETE FROM deputies WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Staff SMTP settings
router.get('/smtp-settings', (req, res) => {
  const dep = db.prepare('SELECT smtp_settings FROM deputies WHERE id=?').get(req.user.id);
  res.json(JSON.parse(dep?.smtp_settings || '{}'));
});

router.put('/smtp-settings', (req, res) => {
  db.prepare('UPDATE deputies SET smtp_settings=? WHERE id=?').run(JSON.stringify(req.body.settings), req.user.id);
  res.json({ success: true });
});

// My reports — only visible ones
router.get('/reports', (req, res) => {
  res.json(db.prepare('SELECT id, period, created_at FROM reports WHERE deputy_id=? AND visible_to_deputy=1 ORDER BY created_at DESC').all(req.user.id));
});

router.get('/reports/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=? AND deputy_id=? AND visible_to_deputy=1').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Не найден' });
  res.json(r);
});

router.delete('/reports/:id', (req, res) => {
  db.prepare('DELETE FROM reports WHERE id=? AND deputy_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Personal events
router.get('/personal-events', (req, res) => {
  res.json(db.prepare('SELECT * FROM personal_events WHERE deputy_id=? ORDER BY event_date').all(req.user.id));
});

router.post('/personal-events', (req, res) => {
  const { title, description, event_date, location, visibility } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'Укажите название и дату' });
  const r = db.prepare('INSERT INTO personal_events (deputy_id, title, description, event_date, location, visibility) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, title, description || null, event_date, location || null, visibility || 'private');
  res.json({ id: r.lastInsertRowid });
});

router.delete('/personal-events/:id', (req, res) => {
  db.prepare('DELETE FROM personal_events WHERE id=? AND deputy_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Deputy creates own reception (visible to staff, included in reports)
router.post('/own-reception', (req, res) => {
  const { reception_date, time_start, time_end, location, description } = req.body;
  if (!reception_date || !time_start || !time_end) return res.status(400).json({ error: 'Укажите дату и время' });
  const dep = db.prepare('SELECT district_id FROM deputies WHERE id=?').get(req.user.id);
  const r = db.prepare('INSERT INTO receptions (deputy_id, reception_date, time_start, time_end, location, description, district_id, status, quarter, year) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, reception_date, time_start, time_end, location || null, description || null, dep?.district_id || null, 'confirmed',
      Math.ceil((new Date(reception_date).getMonth()+1)/3), new Date(reception_date).getFullYear());
  res.json({ id: r.lastInsertRowid });
});

// Staff permissions (for UI routing)
router.get('/my-permissions', (req, res) => {
  if (req.user.userType !== 'staff') return res.json({ permissions: {}, deputy_ids: [] });
  const dep = db.prepare('SELECT permissions FROM deputies WHERE id=?').get(req.user.id);
  const links = db.prepare('SELECT deputy_id FROM staff_deputy_links WHERE staff_id=?').all(req.user.id).map(r => r.deputy_id);
  res.json({ permissions: JSON.parse(dep?.permissions || '{}'), deputy_ids: links });
});

// Unread
router.get('/unread-count', (req, res) => { res.json({ count: db.prepare("SELECT COUNT(*) as c FROM event_participants WHERE deputy_id=? AND status='pending'").get(req.user.id).c }); });

module.exports = router;
module.exports.updateWritingStyle = updateWritingStyle;
