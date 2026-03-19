const express = require('express');
const db = require('../db/init');
const { authDeputy } = require('../middleware/auth');
const { vapidKeys } = require('../push');

const router = express.Router();
router.use(authDeputy);

// Get my upcoming events
router.get('/events', (req, res) => {
  const { filter } = req.query; // upcoming, past, all

  let dateFilter = '';
  if (filter === 'past') {
    dateFilter = "AND e.event_date < datetime('now')";
  } else if (filter !== 'all') {
    dateFilter = "AND e.event_date >= datetime('now')";
  }

  const events = db.prepare(`
    SELECT e.*, ep.status as my_status, c.name as commission_name
    FROM events e
    JOIN event_participants ep ON ep.event_id = e.id AND ep.deputy_id = ?
    LEFT JOIN commissions c ON e.commission_id = c.id
    ${dateFilter}
    ORDER BY e.event_date ASC
  `).all(req.user.id);

  res.json(events);
});

// Get event details
router.get('/events/:id', (req, res) => {
  const event = db.prepare(`
    SELECT e.*, ep.status as my_status, c.name as commission_name
    FROM events e
    JOIN event_participants ep ON ep.event_id = e.id AND ep.deputy_id = ?
    LEFT JOIN commissions c ON e.commission_id = c.id
    WHERE e.id = ?
  `).get(req.user.id, req.params.id);

  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });

  event.files = db.prepare('SELECT id, original_name, filename, mime_type FROM event_files WHERE event_id = ?').all(req.params.id);

  event.participants = db.prepare(`
    SELECT d.full_name, ep.status
    FROM event_participants ep
    JOIN deputies d ON d.id = ep.deputy_id
    WHERE ep.event_id = ?
    ORDER BY d.full_name
  `).all(req.params.id);

  res.json(event);
});

// Mark event as seen
router.post('/events/:id/seen', (req, res) => {
  db.prepare(`
    UPDATE event_participants SET status = 'seen', seen_at = datetime('now')
    WHERE event_id = ? AND deputy_id = ? AND status = 'pending'
  `).run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Confirm or decline event
router.post('/events/:id/respond', (req, res) => {
  const { response } = req.body; // 'confirmed' or 'declined'
  if (!['confirmed', 'declined'].includes(response)) {
    return res.status(400).json({ error: 'Укажите confirmed или declined' });
  }

  db.prepare(`
    UPDATE event_participants SET status = ?, responded_at = datetime('now')
    WHERE event_id = ? AND deputy_id = ?
  `).run(response, req.params.id, req.user.id);

  res.json({ success: true });
});

// Subscribe to push notifications
router.post('/push-subscribe', (req, res) => {
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: 'Укажите subscription' });

  db.prepare('UPDATE deputies SET push_subscription = ? WHERE id = ?').run(
    JSON.stringify(subscription), req.user.id
  );
  res.json({ success: true });
});

// Get VAPID public key
router.get('/vapid-key', (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});

// Get my profile
router.get('/profile', (req, res) => {
  const deputy = db.prepare('SELECT id, full_name, phone, email FROM deputies WHERE id = ?').get(req.user.id);
  res.json(deputy);
});

// Unread events count
router.get('/unread-count', (req, res) => {
  const count = db.prepare(`
    SELECT COUNT(*) as count FROM event_participants
    WHERE deputy_id = ? AND status = 'pending'
  `).get(req.user.id).count;
  res.json({ count });
});

module.exports = router;
