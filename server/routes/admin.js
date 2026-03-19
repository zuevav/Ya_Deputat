const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/init');
const { authAdmin } = require('../middleware/auth');
const { sendPushToEventParticipants, sendPushToDeputy } = require('../push');

const router = express.Router();
router.use(authAdmin);

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// === Deputies ===

router.get('/deputies', (req, res) => {
  const deputies = db.prepare('SELECT id, full_name, phone, email, login_code, created_at FROM deputies ORDER BY full_name').all();
  res.json(deputies);
});

router.post('/deputies', (req, res) => {
  const { full_name, phone, email } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Укажите ФИО' });

  try {
    const result = db.prepare('INSERT INTO deputies (full_name, phone, email) VALUES (?, ?, ?)').run(full_name, phone || null, email || null);
    res.json({ id: result.lastInsertRowid, full_name, phone, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/deputies/:id', (req, res) => {
  const { full_name, phone, email } = req.body;
  db.prepare('UPDATE deputies SET full_name = ?, phone = ?, email = ? WHERE id = ?').run(full_name, phone || null, email || null, req.params.id);
  res.json({ success: true });
});

router.delete('/deputies/:id', (req, res) => {
  db.prepare('DELETE FROM deputies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// === Commissions ===

router.get('/commissions', (req, res) => {
  const commissions = db.prepare('SELECT * FROM commissions ORDER BY name').all();
  // Add member count
  const stmt = db.prepare('SELECT COUNT(*) as count FROM commission_members WHERE commission_id = ?');
  commissions.forEach(c => {
    c.member_count = stmt.get(c.id).count;
  });
  res.json(commissions);
});

router.post('/commissions', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите название' });

  const result = db.prepare('INSERT INTO commissions (name, description) VALUES (?, ?)').run(name, description || null);
  res.json({ id: result.lastInsertRowid, name, description });
});

router.put('/commissions/:id', (req, res) => {
  const { name, description } = req.body;
  db.prepare('UPDATE commissions SET name = ?, description = ? WHERE id = ?').run(name, description || null, req.params.id);
  res.json({ success: true });
});

router.delete('/commissions/:id', (req, res) => {
  db.prepare('DELETE FROM commissions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Commission members
router.get('/commissions/:id/members', (req, res) => {
  const members = db.prepare(`
    SELECT d.id, d.full_name, d.phone, d.email
    FROM deputies d
    JOIN commission_members cm ON cm.deputy_id = d.id
    WHERE cm.commission_id = ?
    ORDER BY d.full_name
  `).all(req.params.id);
  res.json(members);
});

router.post('/commissions/:id/members', (req, res) => {
  const { deputy_ids } = req.body;
  if (!Array.isArray(deputy_ids)) return res.status(400).json({ error: 'Укажите массив deputy_ids' });

  const insert = db.prepare('INSERT OR IGNORE INTO commission_members (commission_id, deputy_id) VALUES (?, ?)');
  const tx = db.transaction(() => {
    // Remove existing members
    db.prepare('DELETE FROM commission_members WHERE commission_id = ?').run(req.params.id);
    deputy_ids.forEach(did => insert.run(req.params.id, did));
  });
  tx();
  res.json({ success: true });
});

// === Events ===

router.get('/events', (req, res) => {
  const events = db.prepare(`
    SELECT e.*, c.name as commission_name,
      (SELECT COUNT(*) FROM event_participants WHERE event_id = e.id) as participant_count,
      (SELECT COUNT(*) FROM event_participants WHERE event_id = e.id AND status = 'confirmed') as confirmed_count,
      (SELECT COUNT(*) FROM event_participants WHERE event_id = e.id AND status = 'declined') as declined_count,
      (SELECT COUNT(*) FROM event_participants WHERE event_id = e.id AND status = 'seen') as seen_count
    FROM events e
    LEFT JOIN commissions c ON e.commission_id = c.id
    ORDER BY e.event_date DESC
  `).all();
  res.json(events);
});

router.get('/events/:id', (req, res) => {
  const event = db.prepare(`
    SELECT e.*, c.name as commission_name
    FROM events e
    LEFT JOIN commissions c ON e.commission_id = c.id
    WHERE e.id = ?
  `).get(req.params.id);

  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });

  event.participants = db.prepare(`
    SELECT d.id, d.full_name, d.phone, ep.status, ep.seen_at, ep.responded_at
    FROM event_participants ep
    JOIN deputies d ON d.id = ep.deputy_id
    WHERE ep.event_id = ?
    ORDER BY d.full_name
  `).all(req.params.id);

  event.files = db.prepare('SELECT id, original_name, filename, mime_type FROM event_files WHERE event_id = ?').all(req.params.id);

  res.json(event);
});

router.post('/events', (req, res) => {
  const { title, description, event_type, commission_id, event_date, location, deputy_ids } = req.body;

  if (!title || !event_type || !event_date) {
    return res.status(400).json({ error: 'Укажите название, тип и дату' });
  }

  const result = db.prepare(`
    INSERT INTO events (title, description, event_type, commission_id, event_date, location, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, description || null, event_type, commission_id || null, event_date, location || null, req.user.id);

  const eventId = result.lastInsertRowid;

  // Add participants based on type
  const addParticipant = db.prepare('INSERT OR IGNORE INTO event_participants (event_id, deputy_id) VALUES (?, ?)');

  const tx = db.transaction(() => {
    if (event_type === 'commission' && commission_id) {
      const members = db.prepare('SELECT deputy_id FROM commission_members WHERE commission_id = ?').all(commission_id);
      members.forEach(m => addParticipant.run(eventId, m.deputy_id));
    } else if (event_type === 'session') {
      const allDeputies = db.prepare('SELECT id FROM deputies').all();
      allDeputies.forEach(d => addParticipant.run(eventId, d.id));
    } else if (deputy_ids && Array.isArray(deputy_ids)) {
      deputy_ids.forEach(did => addParticipant.run(eventId, did));
    }
  });
  tx();

  // Send push to participants about new event
  sendPushToEventParticipants(eventId, {
    title: 'Новое мероприятие',
    body: `${title} — ${new Date(event_date).toLocaleDateString('ru-RU')}`,
    data: { type: 'new_event', eventId }
  });

  res.json({ id: eventId });
});

router.put('/events/:id', (req, res) => {
  const { title, description, event_type, commission_id, event_date, location } = req.body;

  db.prepare(`
    UPDATE events SET title = ?, description = ?, event_type = ?, commission_id = ?, event_date = ?, location = ?
    WHERE id = ?
  `).run(title, description || null, event_type, commission_id || null, event_date, location || null, req.params.id);

  res.json({ success: true });
});

router.delete('/events/:id', (req, res) => {
  // Delete associated files from disk
  const files = db.prepare('SELECT filename FROM event_files WHERE event_id = ?').all(req.params.id);
  files.forEach(f => {
    const filePath = path.join(UPLOADS_DIR, f.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Event files
router.post('/events/:id/files', upload.array('files', 10), (req, res) => {
  const eventId = req.params.id;
  const insert = db.prepare('INSERT INTO event_files (event_id, filename, original_name, mime_type) VALUES (?, ?, ?, ?)');

  const files = req.files.map(f => {
    insert.run(eventId, f.filename, f.originalname, f.mimetype);
    return { filename: f.filename, original_name: f.originalname };
  });

  res.json({ files });
});

router.delete('/events/:eventId/files/:fileId', (req, res) => {
  const file = db.prepare('SELECT filename FROM event_files WHERE id = ? AND event_id = ?').get(req.params.fileId, req.params.eventId);
  if (file) {
    const filePath = path.join(UPLOADS_DIR, file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM event_files WHERE id = ?').run(req.params.fileId);
  }
  res.json({ success: true });
});

// Remind participants
router.post('/events/:id/remind', async (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });

  const sent = await sendPushToEventParticipants(event.id, {
    title: 'Напоминание о мероприятии',
    body: `${event.title} — ${new Date(event.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`,
    data: { type: 'reminder', eventId: event.id }
  });

  res.json({ sent });
});

// Dashboard stats
router.get('/stats', (req, res) => {
  const deputyCount = db.prepare('SELECT COUNT(*) as count FROM deputies').get().count;
  const commissionCount = db.prepare('SELECT COUNT(*) as count FROM commissions').get().count;
  const upcomingEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE event_date >= datetime('now')").get().count;
  const pendingResponses = db.prepare("SELECT COUNT(*) as count FROM event_participants WHERE status = 'pending'").get().count;

  res.json({ deputyCount, commissionCount, upcomingEvents, pendingResponses });
});

module.exports = router;
