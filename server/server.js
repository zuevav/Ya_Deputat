const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://deputat.zetit.ru',
  credentials: true,
  exposedHeaders: ['X-New-Token']
}));
app.use(express.json());

// Failed login tracking
const failedLogins = new Map(); // ip -> { login, attempts, blockedAt }
function trackFailedLogin(ip, login) {
  const entry = failedLogins.get(ip) || { login, attempts: 0, firstAt: Date.now() };
  entry.login = login;
  entry.attempts++;
  if (entry.attempts >= 10) entry.blockedAt = Date.now();
  failedLogins.set(ip, entry);
}
function clearFailedLogin(ip) { failedLogins.delete(ip); }
// Cleanup old entries every 15 min
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [ip, e] of failedLogins) {
    if (e.firstAt < cutoff) failedLogins.delete(ip);
  }
}, 60 * 1000);

// Rate limiting — login endpoints
const loginStore = new rateLimit.MemoryStore();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 10, // 10 попыток
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
  standardHeaders: true,
  store: loginStore
});
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/deputy-login', loginLimiter);
app.use('/api/auth/forgot-password', loginLimiter);
app.use('/api/auth/deputy-forgot-password', loginLimiter);

// Expose tracker to auth routes
app.set('failedLogins', { track: trackFailedLogin, clear: clearFailedLogin, map: failedLogins });

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 500, // 500 запросов в минуту
  message: { error: 'Слишком много запросов. Подождите.' }
});
app.use('/api/', apiLimiter);

// Static files — no cache for JS/CSS
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res, filePath) => {
    // Correct Content-Type with charset for text files
    if (filePath.endsWith('.txt') || filePath.endsWith('.csv')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    // Force download for office documents
    if (filePath.match(/\.(doc|docx|xls|xlsx|pptx)$/i)) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

// Admin: blocked logins management
const { authAdmin } = require('./middleware/auth');
app.get('/api/admin/blocked-logins', authAdmin, (req, res) => {
  if (req.user.adminRole !== 'system_admin') return res.status(403).json({ error: 'Только системный администратор' });
  const list = [];
  for (const [ip, e] of failedLogins) {
    list.push({ ip, login: e.login, attempts: e.attempts, blocked: e.attempts >= 10, blockedAt: e.blockedAt || null });
  }
  res.json(list);
});
app.post('/api/admin/unblock-ip', authAdmin, (req, res) => {
  if (req.user.adminRole !== 'system_admin') return res.status(403).json({ error: 'Только системный администратор' });
  const { ip } = req.body;
  if (ip) {
    loginStore.resetKey(ip);
    failedLogins.delete(ip);
  } else {
    loginStore.resetAll();
    failedLogins.clear();
  }
  res.json({ ok: true });
});

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/deputy', require('./routes/deputy'));
app.use('/api/chat', require('./routes/chat'));

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global error handler — never crash, always return JSON
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  } else {
    res.status(500).send('Error');
  }
});

// Cleanup old photos (older than 1 year) — runs daily
const UPLOADS_DIR = path.join(__dirname, '../uploads');
function cleanupOldPhotos() {
  const db = require('./db/init');
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString();
  const oldFiles = db.prepare(`SELECT ef.id, ef.filename FROM event_files ef
    JOIN events e ON e.id = ef.event_id
    WHERE ef.file_type = 'photo' AND e.event_date < ?`).all(cutoff);
  let count = 0;
  for (const f of oldFiles) {
    const fp = path.join(UPLOADS_DIR, f.filename);
    try { const fs = require('fs'); if (fs.existsSync(fp)) { fs.unlinkSync(fp); } } catch(e) {}
    db.prepare('DELETE FROM event_files WHERE id=?').run(f.id);
    count++;
  }
  if (count) console.log(`Cleanup: deleted ${count} photos older than 1 year`);
}
// Run daily at 3:00 AM
setInterval(cleanupOldPhotos, 24 * 60 * 60 * 1000);
setTimeout(cleanupOldPhotos, 10000); // First run 10s after start

// Catch unhandled rejections
process.on('unhandledRejection', (err) => { console.error('Unhandled rejection:', err); });
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); });

app.listen(PORT, () => {
  console.log(`Я Депутат — сервер запущен на http://localhost:${PORT}`);
});
