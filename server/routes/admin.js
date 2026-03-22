const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/init');
const { authAdmin, requireSystemAdmin, requirePermission, checkDistrictAccess, getDistrictFilter, checkDeputyAccess, checkEventAccess, checkCommissionAccess } = require('../middleware/auth');
const { sendPushToEventParticipants, sendPushToDeputy } = require('../push');
const { sendInviteEmail, sendEmail, sendEmailAsStaff, sendEventNotificationEmail, sendReminderEmail, sendEventEmailWithFiles } = require('../email');
const ai = require('../ai');

const router = express.Router();
router.use(authAdmin);

function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Минимум 8 символов';
  if (!/[A-ZА-ЯЁ]/.test(pw)) return 'Нужна хотя бы одна заглавная буква';
  if (!/[a-zа-яё]/.test(pw)) return 'Нужна хотя бы одна строчная буква';
  if (!/[0-9]/.test(pw)) return 'Нужна хотя бы одна цифра';
  if (!/[^A-Za-zА-Яа-яЁё0-9]/.test(pw)) return 'Нужен хотя бы один спецсимвол (!@#$%...)';
  return null;
}

// Format push body: title + date/time, no duplication
function pushBody(title, eventDate) {
  if (!eventDate) return title;
  const d = new Date(eventDate);
  const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  // Check if date/time already in title
  const hasDate = title.includes(dateStr) || title.includes(d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  const hasTime = title.includes(timeStr);
  if (hasDate && hasTime) return title;
  const suffix = !hasDate ? `${dateStr} в ${timeStr}` : `в ${timeStr}`;
  return `${title} — ${suffix}`;
}

// District isolation: check access to specific resources
function guardDeputy(req, res, next) {
  if (!checkDeputyAccess(req, req.params.id)) return res.status(403).json({ error: 'Нет доступа к этому депутату' });
  next();
}
function guardEvent(req, res, next) {
  const eid = req.params.id || req.params.eid;
  if (!checkEventAccess(req, eid)) return res.status(403).json({ error: 'Нет доступа к этому мероприятию' });
  next();
}

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const ALLOWED_EXTENSIONS = /\.(doc|docx|xls|xlsx|pdf|txt|csv|pptx|html|htm|rtf|jpg|jpeg|png|gif|bmp|webp|tiff|tif|mp3|wav|ogg|m4a|webm|mp4)$/i;

// Fix multer filename encoding (Latin-1 → UTF-8)
function fixFilename(name) {
  try { return decodeURIComponent(escape(name)); } catch(e) { return name; }
}
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOADS_DIR, filename: (r, f, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(fixFilename(f.originalname))}`) }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXTENSIONS.test(file.originalname)) cb(null, true);
    else cb(new Error('Недопустимый тип файла: ' + path.extname(file.originalname)));
  }
});

// === Districts ===
router.get('/districts', (req, res) => {
  if (req.user.districtIds) {
    const ph = req.user.districtIds.map(() => '?').join(',');
    res.json(db.prepare(`SELECT * FROM districts WHERE id IN (${ph}) ORDER BY okrug, name`).all(...req.user.districtIds));
  } else res.json(db.prepare('SELECT * FROM districts ORDER BY okrug, name').all());
});

// === Admin management ===
router.get('/admins', requireSystemAdmin, (req, res) => {
  const admins = db.prepare('SELECT id, username, full_name, email, admin_role, created_at FROM admins ORDER BY full_name').all();
  admins.forEach(a => {
    a.districts = db.prepare('SELECT d.id, d.name, d.okrug FROM districts d JOIN admin_districts ad ON ad.district_id=d.id WHERE ad.admin_id=?').all(a.id);
    a.has_passkey = !!db.prepare('SELECT 1 FROM admin_passkey_credentials WHERE admin_id=?').get(a.id);
  });
  res.json(admins);
});

router.post('/admins', requireSystemAdmin, (req, res) => {
  const { username, password, full_name, email, admin_role, district_ids } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  try {
    const r = db.prepare('INSERT INTO admins (username, password_hash, full_name, email, admin_role) VALUES (?,?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 10), full_name||'', email||'', admin_role||'deputy_admin');
    if (district_ids?.length) { const ins = db.prepare('INSERT INTO admin_districts (admin_id, district_id) VALUES (?,?)'); district_ids.forEach(d => ins.run(r.lastInsertRowid, d)); }
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admins/:id', requireSystemAdmin, (req, res) => {
  const { full_name, email, admin_role, district_ids, password } = req.body;
  db.prepare('UPDATE admins SET full_name=?, email=?, admin_role=? WHERE id=?').run(full_name, email||'', admin_role||'deputy_admin', req.params.id);
  if (password) db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
  if (district_ids) {
    db.prepare('DELETE FROM admin_districts WHERE admin_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO admin_districts (admin_id, district_id) VALUES (?,?)');
    district_ids.forEach(d => ins.run(req.params.id, d));
  }
  res.json({ success: true });
});

router.delete('/admins/:id', requireSystemAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  db.prepare('DELETE FROM admins WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === Deputies ===
router.get('/deputies', (req, res) => {
  const { district_id, user_type } = req.query;
  let sql = `SELECT d.*, dist.name as district_name, dist.okrug,
    (SELECT GROUP_CONCAT(s.full_name, ', ') FROM staff_deputy_links sdl JOIN deputies s ON s.id=sdl.staff_id WHERE sdl.deputy_id=d.id) as assigned_staff,
    CASE WHEN d.passkey_registered = 1 OR d.password_hash IS NOT NULL THEN 1 ELSE 0 END as is_registered
    FROM deputies d LEFT JOIN districts dist ON d.district_id=dist.id WHERE 1=1`;
  const p = [];
  if (district_id) { sql += ' AND d.district_id=?'; p.push(district_id); }
  if (user_type) { sql += ' AND d.user_type=?'; p.push(user_type); }
  const f = getDistrictFilter(req, 'd'); sql += f.sql; p.push(...f.params);
  sql += ' ORDER BY d.deputy_role DESC, d.full_name';
  res.json(db.prepare(sql).all(...p));
});

router.post('/deputies', requirePermission('can_manage_deputies'), (req, res) => {
  const { full_name, phone, email, district_id, user_type, deputy_role } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Укажите ФИО' });
  try {
    const r = db.prepare('INSERT INTO deputies (full_name, phone, email, district_id, user_type, deputy_role) VALUES (?,?,?,?,?,?)')
      .run(full_name, phone||null, email||null, district_id||null, user_type||'deputy', deputy_role||'deputy');
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/deputies/:id', requirePermission('can_manage_deputies'), guardDeputy, (req, res) => {
  const { full_name, phone, email, district_id, deputy_role, staff_role } = req.body;
  db.prepare('UPDATE deputies SET full_name=?, phone=?, email=?, district_id=?, deputy_role=?, staff_role=? WHERE id=?')
    .run(full_name, phone||null, email||null, district_id||null, deputy_role||'deputy', staff_role||'regular', req.params.id);
  res.json({ success: true });
});

router.delete('/deputies/:id', requirePermission('can_manage_deputies'), guardDeputy, (req, res) => { db.prepare('DELETE FROM deputies WHERE id=?').run(req.params.id); res.json({ success: true }); });

// Set password for deputy/staff (system_admin only)
router.post('/deputies/:id/set-password', guardDeputy, (req, res) => {
  if (req.user.adminRole !== 'system_admin') return res.status(403).json({ error: 'Только системный администратор' });
  const { password } = req.body;
  const pwCheck = validatePassword(password);
  if (pwCheck) return res.status(400).json({ error: pwCheck });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE deputies SET password_hash=? WHERE id=?').run(hash, req.params.id);
  res.json({ success: true });
});

// Send password reset link (system_admin only)
router.post('/deputies/:id/send-reset', guardDeputy, async (req, res) => {
  if (req.user.adminRole !== 'system_admin') return res.status(403).json({ error: 'Только системный администратор' });
  const dep = db.prepare('SELECT * FROM deputies WHERE id=?').get(req.params.id);
  if (!dep || !dep.email) return res.status(400).json({ error: 'Email не указан' });
  const resetToken = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE deputies SET invite_token=?, invite_token_expires=? WHERE id=?')
    .run(resetToken, new Date(Date.now() + 3600000).toISOString(), dep.id);
  const origin = `${req.protocol}://${req.get('host')}`;
  try {
    await sendEmail(dep.email, 'Сброс пароля — Я Депутат', `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
        <h2 style="color:#007AFF;">Я Депутат</h2>
        <p>Здравствуйте, ${dep.full_name}!</p>
        <p>Администратор инициировал сброс вашего пароля. Перейдите по ссылке чтобы установить новый:</p>
        <p><a href="${origin}/#deputy-reset/${resetToken}" style="display:inline-block;padding:12px 24px;background:#007AFF;color:#fff;text-decoration:none;border-radius:980px;">Установить пароль</a></p>
        <p style="color:#888;font-size:13px;">Ссылка действительна 1 час.</p>
      </div>`);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Ошибка отправки: ' + e.message });
  }
});

// Deputy-staff links (from deputy side)
router.get('/deputies/:id/staff-links', guardDeputy, (req, res) => {
  const links = db.prepare('SELECT staff_id FROM staff_deputy_links WHERE deputy_id=?').all(req.params.id);
  res.json(links.map(l => l.staff_id));
});
router.put('/deputies/:id/staff-links', guardDeputy, (req, res) => {
  const { staff_ids } = req.body;
  db.transaction(() => {
    db.prepare('DELETE FROM staff_deputy_links WHERE deputy_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO staff_deputy_links (staff_id, deputy_id) VALUES (?,?)');
    (staff_ids || []).forEach(sid => ins.run(sid, req.params.id));
  })();
  res.json({ success: true });
});

// Vacations (multiple)
router.get('/deputies/:id/vacations', guardDeputy, (req, res) => {
  res.json(db.prepare('SELECT * FROM vacations WHERE deputy_id=? ORDER BY vacation_start').all(req.params.id));
});
router.post('/deputies/:id/vacation', guardDeputy, (req, res) => {
  const { vacation_start, vacation_end } = req.body;
  if (!vacation_start || !vacation_end) return res.status(400).json({ error: 'Укажите даты' });
  const r = db.prepare('INSERT INTO vacations (deputy_id, vacation_start, vacation_end) VALUES (?,?,?)').run(req.params.id, vacation_start, vacation_end);
  res.json({ success: true, id: r.lastInsertRowid });
});
router.delete('/deputies/:id/vacation', guardDeputy, (req, res) => {
  db.prepare('DELETE FROM vacations WHERE deputy_id=?').run(req.params.id);
  db.prepare('UPDATE deputies SET substitute_for_id=NULL WHERE substitute_for_id=?').run(req.params.id);
  res.json({ success: true });
});
router.delete('/vacations/:id', (req, res) => {
  const v = db.prepare('SELECT deputy_id FROM vacations WHERE id=?').get(req.params.id);
  if (v && !checkDeputyAccess(req, v.deputy_id)) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('DELETE FROM vacations WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Substitute
router.post('/deputies/:headId/substitute', (req, res) => {
  if (!checkDeputyAccess(req, req.params.headId)) return res.status(403).json({ error: 'Нет доступа к этому депутату' });
  db.prepare('UPDATE deputies SET substitute_for_id=NULL WHERE substitute_for_id=?').run(req.params.headId);
  if (req.body.substitute_id) db.prepare('UPDATE deputies SET substitute_for_id=? WHERE id=?').run(req.params.headId, req.body.substitute_id);
  res.json({ success: true });
});

// Staff permissions & deputy links
router.get('/staff/:id/permissions', (req, res) => {
  const dep = db.prepare('SELECT permissions, district_id FROM deputies WHERE id = ? AND user_type = ?').get(req.params.id, 'staff');
  if (!dep) return res.status(404).json({ error: 'Не найден' });
  if (!checkDeputyAccess(req, req.params.id)) return res.status(403).json({ error: 'Нет доступа' });
  const links = db.prepare('SELECT deputy_id FROM staff_deputy_links WHERE staff_id = ?').all(req.params.id).map(r => r.deputy_id);
  res.json({ permissions: JSON.parse(dep.permissions || '{}'), deputy_ids: links });
});

router.put('/staff/:id/permissions', (req, res) => {
  if (req.user.isStaff) return res.status(403).json({ error: 'Только администратор может изменять права сотрудников' });
  if (!checkDeputyAccess(req, req.params.id)) return res.status(403).json({ error: 'Нет доступа' });
  const { permissions, deputy_ids } = req.body;
  if (permissions) db.prepare('UPDATE deputies SET permissions = ? WHERE id = ?').run(JSON.stringify(permissions), req.params.id);
  if (Array.isArray(deputy_ids)) {
    db.transaction(() => {
      db.prepare('DELETE FROM staff_deputy_links WHERE staff_id = ?').run(req.params.id);
      const ins = db.prepare('INSERT INTO staff_deputy_links (staff_id, deputy_id) VALUES (?, ?)');
      deputy_ids.forEach(did => ins.run(req.params.id, did));
    })();
  }
  res.json({ success: true });
});

// Admin can mark deputy attendance manually
router.post('/events/:eid/mark-attendance', requirePermission('can_create_events'), (req, res) => {
  const { deputy_id, status } = req.body;
  if (!['confirmed', 'declined'].includes(status)) return res.status(400).json({ error: 'Неверный статус' });
  db.prepare("UPDATE event_participants SET status = ?, responded_at = datetime('now') WHERE event_id = ? AND deputy_id = ?")
    .run(status, req.params.eid, deputy_id);
  res.json({ success: true });
});

// === Rooms (кабинеты) ===
router.get('/rooms', (req, res) => {
  const { district_id } = req.query;
  let sql = 'SELECT * FROM rooms WHERE 1=1';
  const p = [];
  if (district_id) { sql += ' AND district_id=?'; p.push(district_id); }
  const f = getDistrictFilter(req, 'rooms'); sql += f.sql; p.push(...f.params);
  res.json(db.prepare(sql + ' ORDER BY name').all(...p));
});

router.post('/rooms', requirePermission('can_create_events'), (req, res) => {
  const { name, address, district_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите название' });
  const r = db.prepare('INSERT INTO rooms (name, address, district_id, created_by) VALUES (?,?,?,?)')
    .run(name, address || null, district_id || null, req.user.id);
  res.json({ id: r.lastInsertRowid, name, address });
});

router.put('/rooms/:id/default', requirePermission('can_create_events'), (req, res) => {
  const room = db.prepare('SELECT district_id FROM rooms WHERE id=?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Не найден' });
  db.prepare('UPDATE rooms SET is_default=0 WHERE district_id=?').run(room.district_id);
  db.prepare('UPDATE rooms SET is_default=1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.delete('/rooms/:id', requirePermission('can_create_events'), (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === Event types ===
router.get('/event-types', (req, res) => {
  const { district_id } = req.query;
  if (district_id) {
    res.json(db.prepare('SELECT * FROM event_types WHERE district_id IS NULL OR district_id=? ORDER BY is_system DESC, name').all(district_id));
  } else {
    res.json(db.prepare('SELECT * FROM event_types ORDER BY is_system DESC, name').all());
  }
});

router.post('/event-types', requirePermission('can_create_events'), (req, res) => {
  const { name, code, color, district_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите название' });
  const safeCode = (code || name).toLowerCase().replace(/[^a-zа-я0-9]/gi, '_').substring(0, 30);
  try {
    const r = db.prepare('INSERT INTO event_types (name, code, color, is_system, district_id) VALUES (?,?,?,0,?)')
      .run(name, safeCode, color || '#007AFF', district_id || null);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: 'Такой тип уже существует' }); }
});

router.delete('/event-types/:id', requirePermission('can_create_events'), (req, res) => {
  const t = db.prepare('SELECT is_system FROM event_types WHERE id=?').get(req.params.id);
  if (t?.is_system) return res.status(400).json({ error: 'Системный тип нельзя удалить' });
  db.prepare('DELETE FROM event_types WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === Event templates ===
router.get('/event-templates', (req, res) => {
  const { district_id } = req.query;
  if (district_id) {
    // Global + district-specific
    res.json(db.prepare('SELECT * FROM event_templates WHERE district_id IS NULL OR district_id=? ORDER BY district_id NULLS FIRST, name').all(district_id));
  } else {
    // Only global (for system admin settings)
    res.json(db.prepare('SELECT * FROM event_templates ORDER BY district_id NULLS FIRST, name').all());
  }
});

router.post('/event-templates', requirePermission('can_create_events'), (req, res) => {
  const { name, event_type, default_time, description, district_id, days_ahead } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите название' });
  const r = db.prepare('INSERT INTO event_templates (name, event_type, default_time, description, days_ahead, district_id) VALUES (?,?,?,?,?,?)')
    .run(name, event_type || 'regular', default_time || '19:00', description || null, days_ahead ?? 10, district_id || null);
  res.json({ id: r.lastInsertRowid });
});

router.delete('/event-templates/:id', requirePermission('can_create_events'), (req, res) => {
  db.prepare('DELETE FROM event_templates WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Invite & Passkey reset
router.post('/deputies/:id/invite', guardDeputy, async (req, res) => {
  const dep = db.prepare('SELECT * FROM deputies WHERE id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Не найден' });
  if (!dep.email) return res.status(400).json({ error: 'Нет email' });
  const t = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE deputies SET invite_token=?, invite_token_expires=?, passkey_registered=0 WHERE id=?').run(t, new Date(Date.now()+7*86400000).toISOString(), dep.id);
  db.prepare('DELETE FROM passkey_credentials WHERE deputy_id=?').run(dep.id);
  const url = `${req.protocol}://${req.get('host')}/#register/${t}`;
  const sent = await sendInviteEmail(dep, url);
  res.json({ success: true, inviteUrl: url, emailSent: sent });
});

router.post('/deputies/:id/reset-passkey', guardDeputy, (req, res) => {
  db.prepare('DELETE FROM passkey_credentials WHERE deputy_id=?').run(req.params.id);
  db.prepare('UPDATE deputies SET passkey_registered=0 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === Deputy block (admin fills, deputy confirms) ===
router.post('/events/:id/deputy-block', guardEvent, (req, res) => {
  const { blocks } = req.body; // [{deputy_id, text}]
  if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks required' });
  const upd = db.prepare('UPDATE event_participants SET admin_block_text=?, block_confirmed=0 WHERE event_id=? AND deputy_id=?');
  blocks.forEach(b => upd.run(b.text, req.params.id, b.deputy_id));
  // Notify
  blocks.forEach(b => sendPushToDeputy(b.deputy_id, { title: 'Требуется подтверждение', body: 'Администратор заполнил информацию для вас', data: { type: 'block_confirm', eventId: parseInt(req.params.id) } }, 'new_event'));
  res.json({ success: true });
});

// === Commissions ===
router.get('/commissions', (req, res) => {
  const { district_id } = req.query;
  let sql = 'SELECT * FROM commissions WHERE 1=1'; const p = [];
  if (district_id) { sql += ' AND district_id=?'; p.push(district_id); }
  const f = getDistrictFilter(req, 'commissions'); sql += f.sql; p.push(...f.params);
  const coms = db.prepare(sql + ' ORDER BY name').all(...p);
  const cnt = db.prepare('SELECT COUNT(*) as c FROM commission_members WHERE commission_id=?');
  const chairQ = db.prepare("SELECT d.full_name FROM commission_members cm JOIN deputies d ON d.id=cm.deputy_id WHERE cm.commission_id=? AND cm.role='chair' LIMIT 1");
  coms.forEach(c => {
    c.member_count = cnt.get(c.id).c;
    const ch = chairQ.get(c.id);
    c.chair_name = ch ? ch.full_name : null;
  });
  res.json(coms);
});

router.post('/commissions', (req, res) => {
  const { name, description, district_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Название' });
  res.json({ id: db.prepare('INSERT INTO commissions (name, description, district_id) VALUES (?,?,?)').run(name, description||null, district_id||null).lastInsertRowid });
});
router.put('/commissions/:id', (req, res) => { db.prepare('UPDATE commissions SET name=?, description=? WHERE id=?').run(req.body.name, req.body.description||null, req.params.id); res.json({ success: true }); });
router.delete('/commissions/:id', (req, res) => { db.prepare('DELETE FROM commissions WHERE id=?').run(req.params.id); res.json({ success: true }); });
router.get('/commissions/:id/members', (req, res) => { res.json(db.prepare("SELECT d.id, d.full_name, d.user_type, COALESCE(cm.role,'member') as role FROM deputies d JOIN commission_members cm ON cm.deputy_id=d.id WHERE cm.commission_id=? ORDER BY CASE cm.role WHEN 'chair' THEN 0 WHEN 'vice_chair' THEN 1 ELSE 2 END, d.full_name").all(req.params.id)); });
router.post('/commissions/:id/members', (req, res) => {
  const { members } = req.body;
  // members: [{id, role}] or legacy deputy_ids: [id]
  const list = members || (req.body.deputy_ids || []).map(id => ({ id, role: 'member' }));
  db.transaction(() => { db.prepare('DELETE FROM commission_members WHERE commission_id=?').run(req.params.id); const ins = db.prepare('INSERT OR IGNORE INTO commission_members (commission_id, deputy_id, role) VALUES (?,?,?)'); list.forEach(m => ins.run(req.params.id, m.id, m.role || 'member')); })();
  res.json({ success: true });
});

// === Events ===
router.get('/events', (req, res) => {
  const { district_id } = req.query;
  let sql = `SELECT e.*, c.name as commission_name, (SELECT COUNT(*) FROM event_participants WHERE event_id=e.id) as participant_count, (SELECT COUNT(*) FROM event_participants WHERE event_id=e.id AND status='confirmed') as confirmed_count FROM events e LEFT JOIN commissions c ON e.commission_id=c.id WHERE 1=1`;
  const p = [];
  if (district_id) { sql += ' AND e.district_id=?'; p.push(district_id); }
  const f = getDistrictFilter(req, 'e'); sql += f.sql; p.push(...f.params);
  res.json(db.prepare(sql + ' ORDER BY e.event_date DESC').all(...p));
});

router.get('/events/:id', guardEvent, (req, res) => {
  const ev = db.prepare('SELECT e.*, c.name as commission_name FROM events e LEFT JOIN commissions c ON e.commission_id=c.id WHERE e.id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Не найдено' });
  ev.participants = db.prepare('SELECT d.id, d.full_name, d.user_type, d.deputy_role, d.vacation_start, d.vacation_end, ep.status, ep.ai_post_text, ep.admin_block_text, ep.deputy_response_text, ep.block_confirmed FROM event_participants ep JOIN deputies d ON d.id=ep.deputy_id WHERE ep.event_id=? ORDER BY d.full_name').all(req.params.id);
  ev.files = db.prepare('SELECT * FROM event_files WHERE event_id=?').all(req.params.id);
  ev.agenda_items = db.prepare('SELECT * FROM event_agenda_items WHERE event_id=? ORDER BY item_order').all(req.params.id);
  ev.votes = db.prepare('SELECT v.*, d.full_name as deputy_name FROM event_votes v JOIN deputies d ON d.id=v.deputy_id WHERE v.event_id=?').all(req.params.id);
  res.json(ev);
});

router.post('/events', requirePermission('can_create_events'), async (req, res) => {
  let { title, description, event_type, commission_id, event_date, location, deputy_ids, district_id, agenda_items, send_email, send_as_staff, custom_notification } = req.body;
  if (!event_type) event_type = 'regular';
  if (!title || !event_date) return res.status(400).json({ error: 'Укажите название и дату' });
  let eid;
  try {
    const createdBy = req.user.isStaff ? null : req.user.id;
    const r = db.prepare('INSERT INTO events (title, description, event_type, commission_id, event_date, location, district_id, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(title, description||null, event_type, commission_id||null, event_date, location||null, district_id||null, createdBy);
    eid = r.lastInsertRowid;
    const addP = db.prepare('INSERT OR IGNORE INTO event_participants (event_id, deputy_id) VALUES (?,?)');
    db.transaction(() => {
      if (event_type === 'commission' && commission_id) db.prepare('SELECT deputy_id FROM commission_members WHERE commission_id=?').all(commission_id).forEach(m => addP.run(eid, m.deputy_id));
      else if (deputy_ids?.length) deputy_ids.forEach(d => addP.run(eid, d));
      if (agenda_items?.length) { const insA = db.prepare('INSERT INTO event_agenda_items (event_id, title, description, item_order) VALUES (?,?,?,?)'); agenda_items.forEach((a, i) => insA.run(eid, a.title, a.description||null, i)); }
    })();
    res.json({ id: eid });
  } catch(err) { console.error('Create event error:', err.message); if (!res.headersSent) res.status(500).json({ error: err.message }); return; }

  // Send notifications in background (after response)
  sendPushToEventParticipants(eid, { title: 'Новое мероприятие', body: pushBody(title, event_date), data: { type: 'new_event', eventId: eid } }, 'new_event').catch(()=>{});

  if (send_email) {
    // Get staff email for CC
    let staffCc = null;
    if (req.user.isStaff) {
      const staffDep = db.prepare('SELECT email FROM deputies WHERE id=?').get(req.user.id);
      if (staffDep?.email) staffCc = staffDep.email;
    }
    // Wait a moment for files to be uploaded
    setTimeout(() => {
      const parts = db.prepare('SELECT d.* FROM deputies d JOIN event_participants ep ON ep.deputy_id=d.id WHERE ep.event_id=?').all(eid);
      const eventFiles = db.prepare('SELECT original_name, filename FROM event_files WHERE event_id=?').all(eid);
      const filePaths = eventFiles.map(f => ({ original_name: f.original_name, full_path: path.join(UPLOADS_DIR, f.filename) }));
      const notifText = custom_notification || '';
      for (const d of parts) {
        if (d.email) {
          if (send_as_staff && req.user.isStaff) {
            const html = `<div style="font-family:sans-serif;max-width:600px;line-height:1.6;white-space:pre-wrap">${notifText || description || title}</div>`;
            sendEmailAsStaff(req.user.id, d.email, title, html, filePaths.map(f=>({filename:f.original_name,path:f.full_path})), staffCc).catch(()=>{});
          } else {
            sendEventEmailWithFiles(d, { title, event_date, location, description, event_type }, filePaths, { cc: staffCc, customNotification: notifText }).catch(()=>{});
          }
        }
      }
    }, 3000);
  }
});

router.put('/events/:id', requirePermission('can_create_events'), guardEvent, (req, res) => {
  const { title, description, event_type, commission_id, event_date, location } = req.body;
  db.prepare('UPDATE events SET title=?, description=?, event_type=?, commission_id=?, event_date=?, location=? WHERE id=?').run(title, description||null, event_type, commission_id||null, event_date, location||null, req.params.id);
  res.json({ success: true });
});

// Add/remove participants
router.post('/events/:id/participants', requirePermission('can_create_events'), guardEvent, (req, res) => {
  const { deputy_ids } = req.body;
  if (!Array.isArray(deputy_ids)) return res.status(400).json({ error: 'deputy_ids required' });
  const ins = db.prepare('INSERT OR IGNORE INTO event_participants (event_id, deputy_id) VALUES (?,?)');
  // Remove those not in list, add new
  const current = db.prepare('SELECT deputy_id FROM event_participants WHERE event_id=?').all(req.params.id).map(r => r.deputy_id);
  const toAdd = deputy_ids.filter(id => !current.includes(id));
  const toRemove = current.filter(id => !deputy_ids.includes(id));
  db.transaction(() => {
    toAdd.forEach(id => ins.run(req.params.id, id));
    toRemove.forEach(id => db.prepare('DELETE FROM event_participants WHERE event_id=? AND deputy_id=?').run(req.params.id, id));
  })();
  res.json({ success: true, added: toAdd.length, removed: toRemove.length });
});

// Notify about event update
router.post('/events/:id/notify-update', requirePermission('can_create_events'), guardEvent, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Не найдено' });

  // Push
  sendPushToEventParticipants(event.id, {
    title: 'Мероприятие изменено',
    body: pushBody(event.title, event.event_date),
    data: { type: 'event_updated', eventId: event.id }
  }, 'new_event').catch(()=>{});

  // Email
  const parts = db.prepare('SELECT d.* FROM deputies d JOIN event_participants ep ON ep.deputy_id=d.id WHERE ep.event_id=?').all(event.id);
  const dt = new Date(event.event_date);
  const dateStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  for (const d of parts) {
    if (d.email) {
      const html = `<div style="font-family:sans-serif;max-width:600px;line-height:1.6">
        <p>Добрый день, ${d.full_name}!</p>
        <p><strong>Мероприятие было изменено:</strong></p>
        <h3>${event.title}</h3>
        <p><strong>Дата:</strong> ${dateStr} в ${timeStr}</p>
        ${event.location ? `<p><strong>Место:</strong> ${event.location}</p>` : ''}
        ${event.description ? `<p>${event.description}</p>` : ''}
        <p>Пожалуйста, проверьте обновлённую информацию в приложении.</p>
      </div>`;

      if (req.user.isStaff) {
        sendEmailAsStaff(req.user.id, d.email, `Изменено: ${event.title}`, html).catch(()=>{});
      } else {
        const { sendEmail: se } = require('../email');
        se(d.email, `Изменено: ${event.title}`, html).catch(()=>{});
      }
    }
  }

  res.json({ success: true, notified: parts.length });
});

router.delete('/events/:id', requirePermission('can_create_events'), guardEvent, (req, res) => {
  db.prepare('SELECT filename FROM event_files WHERE event_id=?').all(req.params.id).forEach(f => { const p = path.join(UPLOADS_DIR, f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); });
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Files
router.post('/events/:id/files', requirePermission('can_create_events'), guardEvent, upload.any(), (req, res) => {
  if (!req.files) req.files = [];
  const ft = req.query.type || 'document';
  const ins = db.prepare('INSERT INTO event_files (event_id, filename, original_name, mime_type, file_type) VALUES (?,?,?,?,?)');
  res.json({ files: req.files.map(f => { ins.run(req.params.id, f.filename, fixFilename(f.originalname), f.mimetype, ft); return { filename: f.filename, original_name: fixFilename(f.originalname) }; }) });
});
router.delete('/events/:eid/files/:fid', requirePermission('can_create_events'), guardEvent, (req, res) => {
  const f = db.prepare('SELECT filename FROM event_files WHERE id=? AND event_id=?').get(req.params.fid, req.params.eid);
  if (f) { const p = path.join(UPLOADS_DIR, f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); db.prepare('DELETE FROM event_files WHERE id=?').run(req.params.fid); }
  res.json({ success: true });
});

// Agenda
router.post('/events/:id/agenda', requirePermission('can_create_events'), guardEvent, (req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM event_agenda_items WHERE event_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO event_agenda_items (event_id, title, description, item_order) VALUES (?,?,?,?)');
    req.body.items.forEach((a, i) => ins.run(req.params.id, a.title, a.description||null, i));
  })();
  res.json({ success: true });
});

// Transcribe audio
router.post('/events/:id/transcribe', requirePermission('can_create_events'), guardEvent, async (req, res) => {
  const { transcription } = req.body;
  if (!transcription) return res.status(400).json({ error: 'Нет текста' });
  let cleaned = transcription;
  if (ai.isAiConfigured()) {
    try { cleaned = await ai.cleanupTranscription(transcription); } catch (e) { console.error('Cleanup failed:', e.message); }
  }
  db.prepare('UPDATE events SET audio_transcription=? WHERE id=?').run(cleaned, req.params.id);
  res.json({ success: true, transcription: cleaned });
});

// Close event
router.post('/events/:id/close', requirePermission('can_create_events'), guardEvent, async (req, res) => {
  const { admin_comment } = req.body;
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Не найдено' });
  db.prepare('UPDATE events SET status=?, admin_comment=?, closed_at=datetime(?) WHERE id=?').run('closed', admin_comment||null, new Date().toISOString(), req.params.id);
  const items = db.prepare('SELECT * FROM event_agenda_items WHERE event_id=? ORDER BY item_order').all(req.params.id);
  const photos = db.prepare("SELECT * FROM event_files WHERE event_id=? AND file_type='photo'").all(req.params.id);
  if (ai.isAiConfigured()) {
    try {
      const allFiles = db.prepare('SELECT * FROM event_files WHERE event_id=?').all(req.params.id);
      const summary = await ai.generateEventSummary({ ...ev, admin_comment, audio_transcription: ev.audio_transcription }, items, allFiles);
      db.prepare('UPDATE events SET ai_summary=? WHERE id=?').run(summary, req.params.id);
    } catch (e) { console.error('Summary failed:', e.message); }
    const deps = db.prepare("SELECT d.* FROM deputies d JOIN event_participants ep ON ep.deputy_id=d.id WHERE ep.event_id=? AND d.user_type='deputy'").all(req.params.id);
    for (const d of deps) {
      try {
        const post = await ai.generatePostText(d, { ...ev, admin_comment, audio_transcription: ev.audio_transcription }, items, admin_comment, photos.length);
        db.prepare('UPDATE event_participants SET ai_post_text=? WHERE event_id=? AND deputy_id=?').run(post, req.params.id, d.id);
      } catch (e) { console.error(`Post failed ${d.id}:`, e.message); }
    }
  }
  sendPushToEventParticipants(req.params.id, { title: 'Заседание завершено', body: pushBody(ev.title, ev.event_date), data: { type: 'event_closed', eventId: parseInt(req.params.id) } }, 'new_event');
  res.json({ success: true });
});

// Remind
router.post('/events/:id/remind', requirePermission('can_create_events'), guardEvent, async (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Не найдено' });
  const sent = await sendPushToEventParticipants(ev.id, { title: 'Напоминание', body: pushBody(ev.title, ev.event_date), data: { type: 'reminder', eventId: ev.id } }, 'reminder');
  const parts = db.prepare('SELECT d.* FROM deputies d JOIN event_participants ep ON ep.deputy_id=d.id WHERE ep.event_id=?').all(ev.id);
  for (const d of parts) { if (d.email) { const pr = JSON.parse(d.notification_preferences||'{}'); if (pr.email_reminder !== false) sendReminderEmail(d, ev).catch(()=>{}); } }
  res.json({ sent });
});

// === Receptions ===
router.get('/receptions', (req, res) => {
  const { district_id, quarter, year, deputy_id } = req.query;
  let sql = 'SELECT r.*, d.full_name FROM receptions r JOIN deputies d ON d.id=r.deputy_id WHERE 1=1';
  const p = [];
  if (district_id) { sql += ' AND d.district_id=?'; p.push(district_id); }
  if (quarter) { sql += ' AND r.quarter=?'; p.push(quarter); }
  if (year) { sql += ' AND r.year=?'; p.push(year); }
  if (deputy_id) { sql += ' AND r.deputy_id=?'; p.push(deputy_id); }
  res.json(db.prepare(sql + ' ORDER BY r.reception_date, r.time_start').all(...p));
});

// Staff creates receptions for deputies (batch)
router.post('/receptions', requirePermission('can_manage_receptions'), (req, res) => {
  const { items } = req.body; // [{deputy_id, reception_date, time_start, time_end, location, quarter, year}]
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Укажите приёмы' });
  const ins = db.prepare('INSERT INTO receptions (deputy_id, reception_date, time_start, time_end, location, district_id, status, created_by_staff, quarter, year) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const staffId = req.user.isStaff ? req.user.id : null;
  db.transaction(() => {
    items.forEach(i => ins.run(i.deputy_id, i.reception_date, i.time_start, i.time_end, i.location || null, i.district_id || null, 'pending', staffId, i.quarter || null, i.year || null));
  })();
  res.json({ success: true, count: items.length });

  // Push notification to affected deputies
  const deputyIds = [...new Set(items.map(i => i.deputy_id))];
  const q = items[0]?.quarter, y = items[0]?.year;
  deputyIds.forEach(depId => {
    sendPushToDeputy(depId, {
      title: 'Новые приёмы населения',
      body: `Назначены приёмы за ${q} квартал ${y}. Проверьте и подтвердите.`,
      data: { type: 'reception_new' }
    }, 'new_event');
  });
});

router.delete('/receptions/:id', requirePermission('can_manage_receptions'), (req, res) => {
  db.prepare('DELETE FROM receptions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Send confirmation request to deputies
router.post('/receptions/send-confirmation', requirePermission('can_manage_receptions'), async (req, res) => {
  const { quarter, year, district_id } = req.body;
  const deps = db.prepare(`SELECT DISTINCT d.* FROM deputies d JOIN receptions r ON r.deputy_id=d.id
    WHERE r.quarter=? AND r.year=? ${district_id ? 'AND d.district_id=?' : ''}`)
    .all(...[quarter, year, ...(district_id ? [district_id] : [])]);
  for (const d of deps) {
    sendPushToDeputy(d.id, {
      title: 'Подтвердите приёмы населения',
      body: `${quarter} квартал ${year} — проверьте даты и подтвердите`,
      data: { type: 'reception_confirm' }
    }, 'new_event');
  }
  res.json({ success: true, notified: deps.length });
});

// === Deputy personal events (staff view) ===
router.get('/deputies/:id/personal-events', guardDeputy, (req, res) => {
  const events = db.prepare("SELECT * FROM personal_events WHERE deputy_id=? ORDER BY event_date DESC").all(req.params.id);
  // Private events — show only as "busy" without details
  const result = events.map(e => {
    if (e.visibility === 'private') {
      return { id: e.id, event_date: e.event_date, title: 'Занято', description: null, location: null, visibility: 'private' };
    }
    return e;
  });
  res.json(result);
});

// === Deputy history ===
router.get('/deputies/:id/history', guardDeputy, (req, res) => {
  const dep = db.prepare('SELECT d.*, dist.name as district_name FROM deputies d LEFT JOIN districts dist ON d.district_id=dist.id WHERE d.id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Не найден' });

  const events = db.prepare(`SELECT e.title, e.event_date, e.event_type, e.status, ep.status as participation
    FROM events e JOIN event_participants ep ON ep.event_id=e.id AND ep.deputy_id=?
    ORDER BY e.event_date DESC`).all(req.params.id);

  const receptions = db.prepare('SELECT * FROM receptions WHERE deputy_id=? ORDER BY reception_date DESC').all(req.params.id);
  const vacations = db.prepare('SELECT * FROM vacations WHERE deputy_id=? ORDER BY vacation_start DESC').all(req.params.id);
  const personalEvents = db.prepare("SELECT * FROM personal_events WHERE deputy_id=? ORDER BY event_date DESC").all(req.params.id)
    .map(e => e.visibility === 'private' ? { ...e, title: 'Занято', description: null, location: null } : e);

  res.json({ deputy: dep, events, receptions, vacations, personalEvents });
});

// === Period report ===
router.post('/deputies/:id/period-report', guardDeputy, async (req, res) => {
  if (!ai.isAiConfigured()) return res.status(400).json({ error: 'DeepSeek не настроен' });
  const { period, quarter, year, template_text } = req.body;
  const dep = db.prepare('SELECT d.*, dist.name as district_name FROM deputies d LEFT JOIN districts dist ON d.district_id=dist.id WHERE d.id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Не найден' });

  let dateFrom, dateTo;
  if (period === 'quarter' && quarter && year) {
    const qStart = (quarter - 1) * 3;
    dateFrom = `${year}-${String(qStart + 1).padStart(2,'0')}-01`;
    dateTo = `${year}-${String(qStart + 3).padStart(2,'0')}-${qStart+3===12?'31':qStart+3===6||qStart+3===9?'30':'31'}`;
  } else {
    dateFrom = `${year}-01-01`;
    dateTo = `${year}-12-31`;
  }

  const events = db.prepare(`SELECT e.title, e.event_date, e.event_type, ep.status as participation
    FROM events e JOIN event_participants ep ON ep.event_id=e.id AND ep.deputy_id=?
    WHERE e.event_date BETWEEN ? AND ? ORDER BY e.event_date`).all(req.params.id, dateFrom, dateTo);

  const receptions = db.prepare('SELECT * FROM receptions WHERE deputy_id=? AND reception_date BETWEEN ? AND ? ORDER BY reception_date').all(req.params.id, dateFrom, dateTo);
  const personalShared = db.prepare("SELECT * FROM personal_events WHERE deputy_id=? AND visibility='shared' AND event_date BETWEEN ? AND ? ORDER BY event_date").all(req.params.id, dateFrom, dateTo);

  const periodLabel = period === 'quarter' ? `${quarter} квартал ${year} года` : `${year} год`;

  try {
    const eventList = events.map(e => {
      const st = {confirmed:'присутствовал',declined:'не присутствовал',seen:'уведомлён',pending:'не ответил'};
      return `- ${e.title} (${e.event_date}) — ${st[e.participation]||e.participation}`;
    }).join('\n');

    const recList = receptions.map(r => `- Приём ${r.reception_date} ${r.time_start}-${r.time_end}`).join('\n');
    const persListStr = personalShared.map(p => `- ${p.title} (${p.event_date})${p.description?' — '+p.description:''}`).join('\n');

    const report = await ai.callDeepSeek(
      'Ты составляешь официальный отчёт муниципального депутата о своей деятельности. Пиши от первого лица депутата. Формальный деловой стиль, на русском. Формат: заголовок крупными буквами, затем разделы с римскими цифрами (I. II. III. и т.д.). Каждый раздел — абзацы с красной строки.',
      `Составь отчёт за ${periodLabel} для депутата ${dep.full_name}, депутата Совета депутатов муниципального округа ${dep.district_name||''}.\n\nМероприятия за период (${events.length}):\n${eventList||'нет'}\n\nПриёмы населения за период (${receptions.length}):\n${recList||'нет'}\n\n${persListStr?'Дополнительные мероприятия и встречи ('+personalShared.length+'):\n'+persListStr+'\n\n':''}${template_text ? 'ВАЖНО: Используй структуру и стиль из предыдущего отчёта депутата:\n' + template_text.substring(0,2000) + '\n\nСформируй новый отчёт в точно таком же формате и стиле, но с актуальными данными за указанный период.' : 'Формат отчёта:\n\nОТЧЁТ\nдепутата Совета депутатов МО [район]\n[ФИО]\nза [период]\n\nI. РАБОТА В СОВЕТЕ ДЕПУТАТОВ\n(участие в заседаниях, голосования)\n\nII. РАБОТА В КОМИССИЯХ\n(участие в работе комиссий)\n\nIII. ПРИЁМЫ НАСЕЛЕНИЯ\n(количество приёмов, обращения)\n\nIV. ВЗАИМОДЕЙСТВИЕ С ОРГАНАМИ ВЛАСТИ\n\nV. ЗАКЛЮЧЕНИЕ\n(итоги, планы)'}`
    );

    res.json({ report, period: periodLabel });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === Download report as Word ===
router.post('/report/download-docx', (req, res) => {
  const { text, title } = req.body;
  if (!text) return res.status(400).json({ error: 'Нет текста' });

  const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');

  const lines = text.split('\n');
  const children = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { children.push(new Paragraph({ text: '' })); continue; }

    // Detect headings (all caps or starts with roman numerals or "ОТЧЁТ" etc)
    const isHeading = /^[IVXLCDM]+\.\s/.test(trimmed) || /^[А-ЯЁ\s]{10,}$/.test(trimmed) || /^ОТЧЁТ|^ЗАКЛЮЧЕНИЕ|^ВВЕДЕНИЕ/i.test(trimmed);
    const isBold = /^\*\*(.+)\*\*$/.test(trimmed) || isHeading;

    if (isHeading) {
      children.push(new Paragraph({
        children: [new TextRun({ text: trimmed.replace(/\*\*/g, ''), bold: true, size: 28, font: 'Times New Roman' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 100 },
      }));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      children.push(new Paragraph({
        children: [new TextRun({ text: trimmed.substring(2), size: 24, font: 'Times New Roman' })],
        bullet: { level: 0 },
        spacing: { after: 40 },
      }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: trimmed.replace(/\*\*/g, ''), bold: isBold, size: 24, font: 'Times New Roman' })],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80 },
        indent: { firstLine: 720 },
      }));
    }
  }

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1800, right: 1200 } } }, children }]
  });

  Packer.toBuffer(doc).then(buffer => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="report.docx"`);
    res.send(buffer);
  }).catch(e => res.status(500).json({ error: e.message }));
});

// === Saved reports ===
router.get('/deputies/:id/reports', guardDeputy, (req, res) => {
  res.json(db.prepare('SELECT id, period, created_at, visible_to_deputy FROM reports WHERE deputy_id=? ORDER BY created_at DESC').all(req.params.id));
});

router.post('/deputies/:id/reports', guardDeputy, (req, res) => {
  const { period, report_text } = req.body;
  const r = db.prepare('INSERT INTO reports (deputy_id, period, report_text, created_by, visible_to_deputy) VALUES (?,?,?,?,0)')
    .run(req.params.id, period, report_text, req.user.id);
  res.json({ id: r.lastInsertRowid });
});

router.post('/reports/:id/toggle-visibility', requirePermission('can_view_reports'), (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Не найден' });
  if (!checkDeputyAccess(req, r.deputy_id)) return res.status(403).json({ error: 'Нет доступа' });
  const newVal = r.visible_to_deputy ? 0 : 1;
  db.prepare('UPDATE reports SET visible_to_deputy=? WHERE id=?').run(newVal, req.params.id);
  res.json({ visible: newVal });

  // Push to deputy when report becomes visible
  if (newVal === 1) {
    sendPushToDeputy(r.deputy_id, {
      title: 'Новый отчёт',
      body: `Вам доступен отчёт: ${r.period}`,
      data: { type: 'report' }
    }, 'new_event').catch(() => {});
  }
});

router.get('/reports/:id', (req, res) => {
  const r = db.prepare('SELECT r.*, d.full_name FROM reports r JOIN deputies d ON d.id=r.deputy_id WHERE r.id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Не найден' });
  if (!checkDeputyAccess(req, r.deputy_id)) return res.status(403).json({ error: 'Нет доступа' });
  res.json(r);
});

router.put('/reports/:id', (req, res) => {
  const { report_text } = req.body;
  if (!report_text) return res.status(400).json({ error: 'Текст пуст' });
  const r = db.prepare('SELECT deputy_id FROM reports WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Не найден' });
  if (!checkDeputyAccess(req, r.deputy_id)) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('UPDATE reports SET report_text=? WHERE id=?').run(report_text, req.params.id);
  res.json({ success: true });
});

router.delete('/reports/:id', (req, res) => {
  const r = db.prepare('SELECT deputy_id FROM reports WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Не найден' });
  if (!checkDeputyAccess(req, r.deputy_id)) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('DELETE FROM reports WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === Annual Report ===
router.post('/deputies/:id/annual-report', guardDeputy, async (req, res) => {
  const { year } = req.body;
  if (!ai.isAiConfigured()) return res.status(400).json({ error: 'DeepSeek не настроен' });
  const dep = db.prepare('SELECT d.*, dist.name as district_name FROM deputies d LEFT JOIN districts dist ON d.district_id=dist.id WHERE d.id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Не найден' });
  const events = db.prepare(`SELECT e.*, ep.status as my_status FROM events e JOIN event_participants ep ON ep.event_id=e.id AND ep.deputy_id=? WHERE e.event_date LIKE ? ORDER BY e.event_date`).all(dep.id, `${year}%`);
  try {
    const report = await ai.generateAnnualReport(dep, events, year);
    res.json({ report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === Stats ===
router.get('/stats', (req, res) => {
  const { district_id } = req.query;
  const f = district_id ? ' AND district_id=?' : ''; const fw = district_id ? ' WHERE district_id=?' : ''; const p = district_id ? [district_id] : [];
  res.json({
    deputyCount: db.prepare(`SELECT COUNT(*) as c FROM deputies WHERE user_type='deputy'${f}`).get(...p).c,
    staffCount: db.prepare(`SELECT COUNT(*) as c FROM deputies WHERE user_type='staff'${f}`).get(...p).c,
    commissionCount: db.prepare(`SELECT COUNT(*) as c FROM commissions${fw}`).get(...p).c,
    upcomingEvents: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event_date>=datetime('now')${f}`).get(...p).c,
    onVacation: db.prepare(`SELECT COUNT(DISTINCT v.deputy_id) as c FROM vacations v JOIN deputies d ON d.id=v.deputy_id WHERE v.vacation_start<=date('now') AND v.vacation_end>=date('now')${f.replace(/district_id/g,'d.district_id')}`).get(...p).c,
  });
});

// === Settings ===
router.get('/settings', requireSystemAdmin, (req, res) => {
  const keys = ['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure','deepseek_api_key','deepseek_model'];
  const s = {};
  keys.forEach(k => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); s[k] = r?.value || ''; });
  res.json(s);
});

router.post('/settings', requireSystemAdmin, (req, res) => {
  const ups = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  db.transaction(() => { for (const [k, v] of Object.entries(req.body.settings)) { if (k.startsWith('smtp_') || k.startsWith('deepseek_')) ups.run(k, v); } })();
  res.json({ success: true });
});

router.post('/settings/test-email', requireSystemAdmin, async (req, res) => {
  const r = await sendEmail(req.body.email, 'Тест — Я Депутат', '<p>Тестовое письмо. SMTP работает!</p>');
  res.json({ success: r });
});

// AI create event from file
router.post('/ai/create-from-file', upload.single('file'), async (req, res) => {
  if (!ai.isAiConfigured()) return res.status(400).json({ error: 'DeepSeek не настроен' });
  const { callDeepSeek } = require('../ai');

  let fileText = '';
  const filePath = path.join(UPLOADS_DIR, req.file.filename);
  try {
    fileText = await extractFileText(filePath, fixFilename(req.file.originalname));
    fileText = cleanOcrText(fileText);
  } catch (e) { fileText = `Файл: ${fixFilename(req.file.originalname)} (не удалось прочитать)`; }

  // Keep the file for attachment
  const savedFilename = req.file.filename;
  const originalName = fixFilename(req.file.originalname);
  const mimeType = req.file.mimetype;

  try {
    const response = await callDeepSeek(
      'Ты секретарь. Извлекай ТОЛЬКО факты из документа. НЕ придумывай. JSON.',
      `Прочитай документ и найди КЛЮЧЕВОЕ СОБЫТИЕ — то, куда нас приглашают, куда надо прийти, где надо быть. Это может быть: заседание, комиссия, открытие работ, встреча, приём, мероприятие и т.д.

Найди ДАТУ И ВРЕМЯ именно этого ключевого события (когда надо явиться/присутствовать). В документе может быть несколько дат (дата договора, дата письма и т.д.) — нужна именно дата СОБЫТИЯ.

Извлеки:
- title: название ключевого события (точно как в тексте)
- event_type: "" (пустая строка)
- event_date: дата СОБЫТИЯ в формате YYYY-MM-DD (НЕ дата письма, НЕ дата договора — дата когда надо явиться)
- event_time: время СОБЫТИЯ в формате HH:MM
- location: адрес где проходит событие
- description: основной текст документа, сохраняя смысл
- agenda_items: []
- mentioned_names: фамилии адресатов ["Иванов"]
- notification_text: "Уведомляем вас, что [дата] в [время] по адресу: [адрес] состоится [событие]. [суть документа]. Прошу подтвердить участие."

Пример: если в тексте "23.03.2026 в 11:00 состоится комиссионное открытие работ" — event_date="2026-03-23", event_time="11:00".

Документ:
${fileText}

JSON:`
    );

    let parsed = {};
    try {
      const m = response.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch (e) {}

    parsed.file = { filename: savedFilename, original_name: originalName, mime_type: mimeType };
    res.json(parsed);
  } catch (e) {
    try { fs.unlinkSync(filePath); } catch(x) {}
    res.status(500).json({ error: e.message });
  }
});

// AI analyze uploaded files
// Helper: extract text from any file
async function extractFileText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  // Word (.docx)
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.substring(0, 4000);
  }

  // Word (.doc old format)
  if (ext === '.doc') {
    try { const mammoth = require('mammoth'); const result = await mammoth.extractRawText({ path: filePath }); return result.value.substring(0, 4000); }
    catch (e) { return `(Формат .doc — рекомендуем конвертировать в .docx)`; }
  }

  // PDF — try text extraction first, fall back to OCR
  if (ext === '.pdf') {
    let textFromPdf = '';
    try {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      textFromPdf = data.text.trim();
    } catch (e) {}

    // Check if text is usable (not garbled)
    // Garbled text has too many non-Cyrillic/Latin characters
    const cleanChars = (textFromPdf.match(/[а-яА-ЯёЁa-zA-Z0-9\s.,;:!?()-]/g) || []).length;
    const isGarbled = textFromPdf.length > 0 && (cleanChars / textFromPdf.length) < 0.6;
    const hasEnoughText = textFromPdf.length >= 50 && !isGarbled;

    if (hasEnoughText) return textFromPdf.substring(0, 4000);

    // OCR fallback — convert PDF pages to images
    try {
      const pdfConvert = require('pdf-img-convert');
      const Tesseract = require('tesseract.js');
      const images = await pdfConvert.convert(filePath, { width: 1500, height: 2000, page_numbers: [1, 2, 3] });

      let ocrText = '';
      for (let i = 0; i < Math.min(images.length, 3); i++) {
        const imgPath = filePath + `_page${i}.png`;
        fs.writeFileSync(imgPath, images[i]);
        const { data: { text: pageText } } = await Tesseract.recognize(imgPath, 'rus+eng');
        ocrText += pageText + '\n';
        try { fs.unlinkSync(imgPath); } catch(e) {}
      }
      return (ocrText.trim() || textFromPdf).substring(0, 4000);
    } catch (e) {
      return textFromPdf || `(PDF: не удалось распознать — ${e.message})`;
    }
  }

  // Excel (.xlsx, .xls)
  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    let text = '';
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      text += `Лист "${name}":\n` + XLSX.utils.sheet_to_csv(sheet, { FS: ' | ' }) + '\n\n';
    }
    return text.substring(0, 4000);
  }

  // Plain text, CSV, HTML, XML, RTF (read as text)
  if (['.txt','.csv','.html','.htm','.xml','.rtf','.md'].includes(ext)) {
    return fs.readFileSync(filePath, 'utf-8').substring(0, 4000);
  }

  // Images — OCR
  if (['.jpg','.jpeg','.png','.gif','.bmp','.webp','.tiff','.tif'].includes(ext)) {
    try {
      const Tesseract = require('tesseract.js');
      const { data: { text } } = await Tesseract.recognize(filePath, 'rus+eng');
      return text.substring(0, 4000) || `(Изображение: ${originalName} — текст не распознан)`;
    } catch (e) {
      return `(Изображение: ${originalName} — ошибка OCR: ${e.message})`;
    }
  }

  // PowerPoint (.pptx)
  if (ext === '.pptx') {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      let text = '';
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
          const xml = entry.getData().toString('utf-8');
          const matches = xml.match(/<a:t>([^<]+)<\/a:t>/g);
          if (matches) text += matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ') + '\n';
        }
      }
      return text.substring(0, 4000) || `(Презентация: ${originalName})`;
    } catch (e) { return `(Презентация: ${originalName})`; }
  }

  return `(Формат ${ext} не поддерживается. Поддерживаемые: .docx, .pdf, .xlsx, .xls, .txt, .csv, .pptx)`;
}

// Clean common OCR errors
function cleanOcrText(text) {
  return text
    // Cyrillic letters confused with Latin/digits
    .replace(/0З/g, '03').replace(/0з/g, '03')
    .replace(/З\./g, '3.').replace(/з\./g, '3.')
    .replace(/О(\d)/g, '0$1').replace(/о(\d)/g, '0$1')
    .replace(/(\d)О/g, '$10').replace(/(\d)о/g, '$10')
    .replace(/l(\d)/g, '1$1').replace(/(\d)l/g, '$11')
    .replace(/I(\d)/g, '1$1').replace(/(\d)I/g, '$11')
    .replace(/(\d{2})\.(\d[З3з])\.(\d{4})/g, (m, d, mo, y) => `${d}.${mo.replace(/[Зз]/g,'3')}.${y}`)
    // Common OCR garbage
    .replace(/[!|]l/g, 'и').replace(/!l/g, 'и')
    .replace(/rг/g, 'рт').replace(/rг/g, 'рт')
    .replace(/T ь/g, 'ть').replace(/&T/g, 'ат')
    // Multiple spaces
    .replace(/\s{3,}/g, ' ');
}

router.post('/ai/analyze-files', function(req, res, next) {
  // Accept any field name for files
  upload.any()(req, res, function(err) {
    if (err) { console.error('Multer error:', err); return res.status(400).json({ error: 'Ошибка загрузки: ' + err.message }); }
    // Map req.files from any() format
    if (!req.files) req.files = [];
    next();
  });
}, async (req, res) => {
  console.log('analyze-files: received', req.files?.length || 0, 'files');
  if (!ai.isAiConfigured()) return res.status(400).json({ error: 'DeepSeek не настроен' });

  const { callDeepSeek } = require('../ai');
  const title = req.body.title || '';
  const existingAgenda = req.body.agenda || '';

  // Extract text from files
  let fileContents = [];
  for (const f of req.files) {
    const filePath = path.join(UPLOADS_DIR, f.filename);
    try {
      const text = cleanOcrText(await extractFileText(filePath, fixFilename(f.originalname)));
      fileContents.push({ name: fixFilename(f.originalname), text });
    } catch (e) {
      fileContents.push({ name: fixFilename(f.originalname), text: '(ошибка чтения: ' + e.message + ')' });
    }
    try { fs.unlinkSync(filePath); } catch(e) {}
  }

  const filesText = fileContents.map(f => `=== ${f.name} ===\n${f.text}`).join('\n\n');

  try {
    const response = await callDeepSeek(
      'Ты — секретарь муниципального совета. Анализируй документы. Отвечай строго в JSON формате.',
      `Заседание: ${title}\n\n${existingAgenda ? 'Текущая повестка: ' + existingAgenda + '\n\n' : ''}Содержимое приложенных документов:\n\n${filesText}\n\nЗадачи:\n1. Найди документ с повесткой дня (обычно называется "ПРОЕКТ повестки дня" или подобное). Если нашёл — извлеки все пункты повестки.\n2. По каждому документу составь краткое фактическое описание (только сухие факты, без рекомендаций).\n\nОтвет строго в JSON:\n{"agenda_items": ["пункт 1", "пункт 2", ...], "summary": "📄 Файл1.docx\\nСодержание: ...\\n\\n📄 Файл2.docx\\nСодержание: ..."}\n\nЕсли повестка не найдена, agenda_items = [].`
    );

    // Parse JSON from response
    let parsed = { agenda_items: [], summary: response };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {}

    res.json(parsed);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save AI summary to event
router.post('/events/:id/ai-summary', guardEvent, (req, res) => {
  db.prepare('UPDATE events SET ai_summary=? WHERE id=?').run(req.body.summary, req.params.id);
  res.json({ success: true });
});

// AI endpoints
router.get('/ai/balance', requireSystemAdmin, async (req, res) => {
  try { res.json(await ai.getBalance()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ai/models', requireSystemAdmin, async (req, res) => {
  try { res.json(await ai.getModels()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Password
router.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните поля' });
  const pwErr = validatePassword(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, admin.password_hash)) return res.status(400).json({ error: 'Неверный пароль' });
  db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ success: true });
});

router.put('/admin-email', (req, res) => { db.prepare('UPDATE admins SET email=? WHERE id=?').run(req.body.email||null, req.user.id); res.json({ success: true }); });

// Admin profile
router.get('/profile', (req, res) => {
  const admin = db.prepare('SELECT id, username, full_name, email, admin_role FROM admins WHERE id=?').get(req.user.id);
  res.json(admin);
});
router.put('/profile', (req, res) => {
  const { full_name, email, username } = req.body;
  if (username) {
    const existing = db.prepare('SELECT id FROM admins WHERE username=? AND id!=?').get(username, req.user.id);
    if (existing) return res.status(400).json({ error: 'Логин уже занят' });
  }
  db.prepare('UPDATE admins SET full_name=?, email=?, username=? WHERE id=?').run(full_name || '', email || '', username || req.user.username, req.user.id);
  res.json({ success: true });
});

module.exports = router;
