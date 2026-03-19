const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ya-deputat-secret-key-change-in-production';

function authAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

function authDeputy(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'deputy') return res.status(403).json({ error: 'Нет доступа' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

module.exports = { authAdmin, authDeputy, JWT_SECRET };
