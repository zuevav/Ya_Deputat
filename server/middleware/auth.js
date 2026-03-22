const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db/init');

// JWT secret: use env var, or generate and store in DB
function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(48).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
  console.log('JWT secret generated and saved to DB');
  return secret;
}
const JWT_SECRET = getJwtSecret();

// Auto-renew token if less than 15 days remaining
function renewIfNeeded(decoded, res) {
  if (!decoded.exp) return;
  const daysLeft = (decoded.exp - Date.now() / 1000) / 86400;
  if (daysLeft < 15) {
    const { iat, exp, ...payload } = decoded;
    const expiresIn = decoded.role === 'admin' ? '90d' : '30d';
    const newToken = jwt.sign(payload, JWT_SECRET, { expiresIn });
    res.setHeader('X-New-Token', newToken);
  }
}

function authAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    renewIfNeeded(decoded, res);

    // Regular admin
    if (decoded.role === 'admin') {
      req.user = decoded;
      if (decoded.adminRole === 'deputy_admin') {
        const rows = db.prepare('SELECT district_id FROM admin_districts WHERE admin_id = ?').all(decoded.id);
        req.user.districtIds = rows.map(r => r.district_id);
      } else {
        req.user.districtIds = null;
      }
      next();
      return;
    }

    // Staff with permissions (acts as limited admin)
    if (decoded.role === 'deputy' && decoded.userType === 'staff') {
      const dep = db.prepare('SELECT permissions, district_id FROM deputies WHERE id = ?').get(decoded.id);
      const perms = JSON.parse(dep?.permissions || '{}');
      if (Object.values(perms).some(v => v)) {
        req.user = decoded;
        req.user.isStaff = true;
        req.user.staffPermissions = perms;
        req.user.adminRole = 'staff';
        const links = db.prepare('SELECT deputy_id FROM staff_deputy_links WHERE staff_id = ?').all(decoded.id);
        req.user.assignedDeputyIds = links.map(l => l.deputy_id);
        req.user.districtIds = dep.district_id ? [dep.district_id] : null;
        next();
        return;
      }
    }

    return res.status(403).json({ error: 'Нет доступа' });
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

function requireSystemAdmin(req, res, next) {
  if (req.user.adminRole !== 'system_admin') {
    return res.status(403).json({ error: 'Только для системного администратора' });
  }
  next();
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (req.user.isStaff && !req.user.staffPermissions?.[perm]) {
      return res.status(403).json({ error: 'Нет прав' });
    }
    next();
  };
}

function checkDistrictAccess(req, districtId) {
  if (!req.user.districtIds) return true;
  if (!districtId) return true;
  return req.user.districtIds.includes(parseInt(districtId));
}

function getDistrictFilter(req, alias) {
  if (!req.user.districtIds) return { sql: '', params: [] };
  const placeholders = req.user.districtIds.map(() => '?').join(',');
  return {
    sql: ` AND ${alias}.district_id IN (${placeholders})`,
    params: [...req.user.districtIds]
  };
}

// For staff: filter deputies to only assigned ones
function getStaffDeputyFilter(req, alias) {
  if (!req.user.isStaff || !req.user.assignedDeputyIds?.length) return { sql: '', params: [] };
  const ph = req.user.assignedDeputyIds.map(() => '?').join(',');
  return { sql: ` AND ${alias}.id IN (${ph})`, params: [...req.user.assignedDeputyIds] };
}

// Check if user can access a specific deputy by ID
function checkDeputyAccess(req, deputyId) {
  if (!req.user.districtIds) return true; // system admin
  const dep = db.prepare('SELECT district_id FROM deputies WHERE id=?').get(deputyId);
  if (!dep) return false;
  if (!dep.district_id) return true;
  return req.user.districtIds.includes(dep.district_id);
}

// Check if user can access a specific event by ID
function checkEventAccess(req, eventId) {
  if (!req.user.districtIds) return true;
  const ev = db.prepare('SELECT district_id FROM events WHERE id=?').get(eventId);
  if (!ev) return false;
  if (!ev.district_id) return true;
  return req.user.districtIds.includes(ev.district_id);
}

// Check if user can access a specific commission by ID
function checkCommissionAccess(req, commissionId) {
  if (!req.user.districtIds) return true;
  const c = db.prepare('SELECT district_id FROM commissions WHERE id=?').get(commissionId);
  if (!c) return false;
  if (!c.district_id) return true;
  return req.user.districtIds.includes(c.district_id);
}

function authDeputy(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'deputy') return res.status(403).json({ error: 'Нет доступа' });
    renewIfNeeded(decoded, res);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

module.exports = { authAdmin, authDeputy, requireSystemAdmin, requirePermission, checkDistrictAccess, getDistrictFilter, getStaffDeputyFilter, checkDeputyAccess, checkEventAccess, checkCommissionAccess, JWT_SECRET };
