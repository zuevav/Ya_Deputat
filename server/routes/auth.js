const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/init');
const { JWT_SECRET, authAdmin } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../email');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Минимум 8 символов';
  if (!/[A-ZА-ЯЁ]/.test(pw)) return 'Нужна хотя бы одна заглавная буква';
  if (!/[a-zа-яё]/.test(pw)) return 'Нужна хотя бы одна строчная буква';
  if (!/[0-9]/.test(pw)) return 'Нужна хотя бы одна цифра';
  if (!/[^A-Za-zА-Яа-яЁё0-9]/.test(pw)) return 'Нужен хотя бы один спецсимвол (!@#$%...)';
  return null;
}

const router = express.Router();
const challenges = new Map();
function store(k, v) { challenges.set(k, v); setTimeout(() => challenges.delete(k), 5*60*1000); }
function pop(k) { const v = challenges.get(k); challenges.delete(k); return v; }
function rp(req) { const h = req.get('host'); const proto = req.get('x-forwarded-proto') || req.protocol; return { rpID: h.split(':')[0], rpName: 'Я Депутат', origin: `${proto}://${h}` }; }

// === Admin login ===
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Укажите логин и пароль' });
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    const fl = req.app.get('failedLogins');
    if (fl) fl.track(req.ip, username || '?');
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const fl = req.app.get('failedLogins');
  if (fl) fl.clear(req.ip);
  const token = jwt.sign({ id: admin.id, role: 'admin', adminRole: admin.admin_role, name: admin.full_name }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, user: { id: admin.id, name: admin.full_name, role: 'admin', adminRole: admin.admin_role } });
});

// === Forgot/Reset password ===
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Укажите email' });
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (admin) {
    const t = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE admins SET reset_token=?, reset_token_expires=? WHERE id=?').run(t, new Date(Date.now()+3600000).toISOString(), admin.id);
    await sendPasswordResetEmail(admin, `${req.protocol}://${req.get('host')}/#reset-password/${t}`);
  }
  res.json({ message: 'Если email найден, ссылка отправлена' });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  const pwErr = validatePassword(password);
  if (!token || pwErr) return res.status(400).json({ error: pwErr || 'Неверные данные' });
  const admin = db.prepare('SELECT * FROM admins WHERE reset_token = ?').get(token);
  if (!admin || new Date(admin.reset_token_expires) < new Date()) return res.status(400).json({ error: 'Ссылка недействительна' });
  db.prepare('UPDATE admins SET password_hash=?, reset_token=NULL, reset_token_expires=NULL WHERE id=?').run(bcrypt.hashSync(password, 10), admin.id);
  res.json({ message: 'Пароль обновлён' });
});

// === Admin Passkey Registration (requires auth) ===
router.post('/admin-passkey/register-options', authAdmin, async (req, res) => {
  try {
    const { rpID, rpName } = rp(req);
    const existing = db.prepare('SELECT credential_id FROM admin_passkey_credentials WHERE admin_id = ?').all(req.user.id);
    const options = await generateRegistrationOptions({
      rpName, rpID, userID: Buffer.from(`admin_${req.user.id}`).toString('base64url'), userName: req.user.name,
      userDisplayName: req.user.name, attestationType: 'none',
      excludeCredentials: existing.map(c => ({ id: Buffer.from(c.credential_id, 'base64'), type: 'public-key' })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    store(`admin_reg_${req.user.id}`, options.challenge);
    res.json({ options });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/admin-passkey/register-verify', authAdmin, async (req, res) => {
  try {
    const { response } = req.body;
    const ch = pop(`admin_reg_${req.user.id}`);
    if (!ch) return res.status(400).json({ error: 'Сессия истекла' });
    const { rpID, origin } = rp(req);
    const v = await verifyRegistrationResponse({ response, expectedChallenge: ch, expectedOrigin: origin, expectedRPID: rpID });
    if (!v.verified) return res.status(400).json({ error: 'Не пройдена' });
    const { credentialID, credentialPublicKey, counter } = v.registrationInfo;
    db.prepare('INSERT INTO admin_passkey_credentials (admin_id, credential_id, public_key, counter, transports) VALUES (?,?,?,?,?)')
      .run(req.user.id, Buffer.from(credentialID).toString('base64'), Buffer.from(credentialPublicKey).toString('base64'), counter, JSON.stringify(response.response?.transports||[]));
    res.json({ verified: true });
  } catch (e) { console.error(e); res.status(400).json({ error: 'Ошибка регистрации' }); }
});

// === Deputy Passkey Registration (invite) ===
router.post('/passkey/register-options', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Нет токена' });
    const dep = db.prepare('SELECT * FROM deputies WHERE invite_token = ?').get(token);
    if (!dep) return res.status(400).json({ error: 'Недействительно' });
    if (new Date(dep.invite_token_expires) < new Date()) return res.status(400).json({ error: 'Истекло' });
    const { rpID, rpName } = rp(req);
    const existing = db.prepare('SELECT credential_id FROM passkey_credentials WHERE deputy_id = ?').all(dep.id);
    const options = await generateRegistrationOptions({
      rpName, rpID, userID: Buffer.from(String(dep.id)).toString('base64url'), userName: dep.email || dep.full_name,
      userDisplayName: dep.full_name, attestationType: 'none',
      excludeCredentials: existing.map(c => ({ id: Buffer.from(c.credential_id, 'base64'), type: 'public-key' })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    store(`reg_${token}`, options.challenge);
    res.json({ options, deputyName: dep.full_name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/passkey/register-verify', async (req, res) => {
  try {
    const { token, response } = req.body;
    const dep = db.prepare('SELECT * FROM deputies WHERE invite_token = ?').get(token);
    if (!dep) return res.status(400).json({ error: 'Недействительно' });
    const ch = pop(`reg_${token}`);
    if (!ch) return res.status(400).json({ error: 'Сессия истекла' });
    const { rpID, origin } = rp(req);
    const v = await verifyRegistrationResponse({ response, expectedChallenge: ch, expectedOrigin: origin, expectedRPID: rpID });
    if (!v.verified) return res.status(400).json({ error: 'Не пройдена' });
    const { credentialID, credentialPublicKey, counter } = v.registrationInfo;
    db.prepare('INSERT INTO passkey_credentials (deputy_id, credential_id, public_key, counter, transports) VALUES (?,?,?,?,?)')
      .run(dep.id, Buffer.from(credentialID).toString('base64'), Buffer.from(credentialPublicKey).toString('base64'), counter, JSON.stringify(response.response?.transports||[]));
    db.prepare('UPDATE deputies SET passkey_registered=1, invite_token=NULL, invite_token_expires=NULL WHERE id=?').run(dep.id);
    const t = jwt.sign({ id: dep.id, role: 'deputy', name: dep.full_name, userType: dep.user_type, deputyRole: dep.deputy_role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ verified: true, token: t, user: { id: dep.id, name: dep.full_name, role: 'deputy', userType: dep.user_type, deputyRole: dep.deputy_role } });
  } catch (e) { console.error(e); res.status(400).json({ error: 'Ошибка' }); }
});

// === Passkey Authentication (shared: checks admin + deputy) ===
router.post('/passkey/auth-options', async (req, res) => {
  try {
    const { rpID } = rp(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    const sid = crypto.randomBytes(16).toString('hex');
    store(`auth_${sid}`, options.challenge);
    res.json({ options, sessionId: sid });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/passkey/auth-verify', async (req, res) => {
  try {
    const { sessionId, response } = req.body;
    const ch = pop(`auth_${sessionId}`);
    if (!ch) return res.status(400).json({ error: 'Сессия истекла' });

    const credId64 = Buffer.from(response.id, 'base64url').toString('base64');

    // Check deputy credentials
    let cred = db.prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?').get(credId64);
    let ownerType = 'deputy';

    // Check admin credentials
    if (!cred) {
      cred = db.prepare('SELECT * FROM admin_passkey_credentials WHERE credential_id = ?').get(credId64);
      ownerType = 'admin';
    }

    // Fallback with rawId
    if (!cred && response.rawId) {
      const rawId64 = Buffer.from(response.rawId, 'base64url').toString('base64');
      cred = db.prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?').get(rawId64);
      ownerType = 'deputy';
      if (!cred) {
        cred = db.prepare('SELECT * FROM admin_passkey_credentials WHERE credential_id = ?').get(rawId64);
        ownerType = 'admin';
      }
    }

    if (!cred) return res.status(401).json({ error: 'Passkey не найден' });

    const { rpID, origin } = rp(req);
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: ch, expectedOrigin: origin, expectedRPID: rpID,
      authenticator: { credentialID: Buffer.from(cred.credential_id, 'base64'), credentialPublicKey: Buffer.from(cred.public_key, 'base64'), counter: cred.counter },
    });
    if (!v.verified) return res.status(401).json({ error: 'Не пройдена' });

    if (ownerType === 'admin') {
      db.prepare('UPDATE admin_passkey_credentials SET counter=? WHERE id=?').run(v.authenticationInfo.newCounter, cred.id);
      const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(cred.admin_id);
      const t = jwt.sign({ id: admin.id, role: 'admin', adminRole: admin.admin_role, name: admin.full_name }, JWT_SECRET, { expiresIn: '90d' });
      res.json({ token: t, user: { id: admin.id, name: admin.full_name, role: 'admin', adminRole: admin.admin_role } });
    } else {
      db.prepare('UPDATE passkey_credentials SET counter=? WHERE id=?').run(v.authenticationInfo.newCounter, cred.id);
      const dep = db.prepare('SELECT * FROM deputies WHERE id = ?').get(cred.deputy_id);
      const t = jwt.sign({ id: dep.id, role: 'deputy', name: dep.full_name, userType: dep.user_type, deputyRole: dep.deputy_role }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token: t, user: { id: dep.id, name: dep.full_name, role: 'deputy', userType: dep.user_type, deputyRole: dep.deputy_role } });
    }
  } catch (e) { console.error(e); res.status(401).json({ error: 'Ошибка аутентификации' }); }
});

// === Deputy password registration (via invite) ===
router.post('/deputy-register-password', (req, res) => {
  const { token, password } = req.body;
  const pwErr2 = validatePassword(password);
  if (!token || pwErr2) return res.status(400).json({ error: pwErr2 || 'Неверные данные' });

  const dep = db.prepare('SELECT * FROM deputies WHERE invite_token = ?').get(token);
  if (!dep) return res.status(400).json({ error: 'Недействительное приглашение' });
  if (new Date(dep.invite_token_expires) < new Date()) return res.status(400).json({ error: 'Приглашение истекло' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE deputies SET password_hash = ?, invite_token = NULL, invite_token_expires = NULL WHERE id = ?').run(hash, dep.id);

  const t = jwt.sign({ id: dep.id, role: 'deputy', name: dep.full_name, userType: dep.user_type, deputyRole: dep.deputy_role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token: t, user: { id: dep.id, name: dep.full_name, role: 'deputy', userType: dep.user_type, deputyRole: dep.deputy_role } });
});

// === Deputy password login ===
router.post('/deputy-login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });

  const dep = db.prepare('SELECT * FROM deputies WHERE email = ?').get(email);
  if (!dep || !dep.password_hash || !bcrypt.compareSync(password, dep.password_hash)) {
    const fl = req.app.get('failedLogins');
    if (fl) fl.track(req.ip, email || '?');
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const fl = req.app.get('failedLogins');
  if (fl) fl.clear(req.ip);
  const t = jwt.sign({ id: dep.id, role: 'deputy', name: dep.full_name, userType: dep.user_type, deputyRole: dep.deputy_role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token: t, user: { id: dep.id, name: dep.full_name, role: 'deputy', userType: dep.user_type, deputyRole: dep.deputy_role } });
});

// === Deputy forgot password ===
router.post('/deputy-forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Укажите email' });
  const dep = db.prepare('SELECT * FROM deputies WHERE email = ?').get(email);
  if (dep) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE deputies SET invite_token = ?, invite_token_expires = ? WHERE id = ?')
      .run(resetToken, new Date(Date.now() + 3600000).toISOString(), dep.id);
    const origin = `${req.protocol}://${req.get('host')}`;
    const { sendEmail } = require('../email');
    await sendEmail(dep.email, 'Сброс пароля — Я Депутат', `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
        <h2 style="color:#007AFF;">Я Депутат</h2>
        <p>Здравствуйте, ${dep.full_name}!</p>
        <p>Для сброса пароля перейдите по ссылке:</p>
        <p><a href="${origin}/#deputy-reset/${resetToken}" style="display:inline-block;padding:12px 24px;background:#007AFF;color:#fff;text-decoration:none;border-radius:980px;">Сбросить пароль</a></p>
        <p style="color:#888;font-size:13px;">Ссылка действительна 1 час.</p>
      </div>`);
  }
  res.json({ message: 'Если email найден, ссылка отправлена' });
});

// === Deputy reset password ===
router.post('/deputy-reset-password', (req, res) => {
  const { token, password } = req.body;
  const pwErr3 = validatePassword(password);
  if (!token || pwErr3) return res.status(400).json({ error: pwErr3 || 'Неверные данные' });
  const dep = db.prepare('SELECT * FROM deputies WHERE invite_token = ?').get(token);
  if (!dep || new Date(dep.invite_token_expires) < new Date()) return res.status(400).json({ error: 'Ссылка недействительна' });
  db.prepare('UPDATE deputies SET password_hash = ?, invite_token = NULL, invite_token_expires = NULL WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), dep.id);
  res.json({ message: 'Пароль обновлён' });
});

// Changelog
router.get('/changelog', (req, res) => {
  res.json(db.prepare('SELECT * FROM changelog ORDER BY id DESC').all());
});

module.exports = router;
