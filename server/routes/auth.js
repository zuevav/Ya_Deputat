const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/init');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Admin login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = jwt.sign({ id: admin.id, role: 'admin', name: admin.full_name }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: admin.id, name: admin.full_name, role: 'admin' } });
});

// Deputy login — by phone, simplified (no SMS, code shown in admin panel)
router.post('/deputy-login', (req, res) => {
  const { phone, code } = req.body;
  if (!phone) return res.status(400).json({ error: 'Укажите телефон' });

  const deputy = db.prepare('SELECT * FROM deputies WHERE phone = ?').get(phone);
  if (!deputy) return res.status(404).json({ error: 'Депутат не найден' });

  // If code provided, verify it
  if (code) {
    if (deputy.login_code !== code) {
      return res.status(401).json({ error: 'Неверный код' });
    }
    if (deputy.login_code_expires && new Date(deputy.login_code_expires) < new Date()) {
      return res.status(401).json({ error: 'Код истёк' });
    }

    // Clear code after use
    db.prepare('UPDATE deputies SET login_code = NULL, login_code_expires = NULL WHERE id = ?').run(deputy.id);

    const token = jwt.sign({ id: deputy.id, role: 'deputy', name: deputy.full_name }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: { id: deputy.id, name: deputy.full_name, role: 'deputy' } });
  }

  // Generate new code
  const newCode = String(Math.floor(1000 + Math.random() * 9000));
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('UPDATE deputies SET login_code = ?, login_code_expires = ? WHERE id = ?').run(newCode, expires, deputy.id);

  // In production, send SMS here. For now, code visible in admin panel.
  res.json({ message: 'Код отправлен', hint: `Код: ${newCode} (dev mode)` });
});

module.exports = router;
