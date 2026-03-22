const express = require('express');
const crypto = require('crypto');
const db = require('../db/init');
const { authDeputy } = require('../middleware/auth');
const { sendPushToDeputy } = require('../push');

const router = express.Router();
router.use(authDeputy);

// AES-256-GCM encryption key per chat (stored server-side, derived from chat secret)
const MASTER_KEY = (() => {
  const row = db.prepare("SELECT value FROM settings WHERE key='chat_master_key'").get();
  if (row) return Buffer.from(row.value, 'hex');
  const key = crypto.randomBytes(32);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_master_key', ?)").run(key.toString('hex'));
  return key;
})();

function encryptMessage(text, chatId) {
  const iv = crypto.randomBytes(12);
  const chatKey = crypto.createHmac('sha256', MASTER_KEY).update(`chat-${chatId}`).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', chatKey, iv);
  let enc = cipher.update(text, 'utf8', 'base64');
  enc += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return { encrypted: enc + '.' + tag, iv: iv.toString('base64') };
}

function decryptMessage(encrypted, iv, chatId) {
  try {
    const [enc, tag] = encrypted.split('.');
    const chatKey = crypto.createHmac('sha256', MASTER_KEY).update(`chat-${chatId}`).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', chatKey, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    let dec = decipher.update(enc, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch { return '[Ошибка расшифровки]'; }
}

function isMember(chatId, deputyId) {
  return !!db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND deputy_id=?').get(chatId, deputyId);
}

// List my chats
router.get('/list', (req, res) => {
  const chats = db.prepare(`SELECT c.*,
    (SELECT COUNT(*) FROM chat_messages cm WHERE cm.chat_id=c.id) as msg_count,
    (SELECT cm2.id FROM chat_messages cm2 WHERE cm2.chat_id=c.id ORDER BY cm2.id DESC LIMIT 1) as last_msg_id,
    (SELECT cm3.encrypted_text FROM chat_messages cm3 WHERE cm3.chat_id=c.id ORDER BY cm3.id DESC LIMIT 1) as last_encrypted,
    (SELECT cm3.iv FROM chat_messages cm3 WHERE cm3.chat_id=c.id ORDER BY cm3.id DESC LIMIT 1) as last_iv,
    (SELECT cm3.sender_id FROM chat_messages cm3 WHERE cm3.chat_id=c.id ORDER BY cm3.id DESC LIMIT 1) as last_sender_id,
    (SELECT cm3.created_at FROM chat_messages cm3 WHERE cm3.chat_id=c.id ORDER BY cm3.id DESC LIMIT 1) as last_msg_at,
    (SELECT d.full_name FROM chat_messages cm3 JOIN deputies d ON d.id=cm3.sender_id WHERE cm3.chat_id=c.id ORDER BY cm3.id DESC LIMIT 1) as last_sender_name,
    COALESCE((SELECT cr.last_read_id FROM chat_read cr WHERE cr.chat_id=c.id AND cr.deputy_id=?), 0) as last_read_id
    FROM chats c JOIN chat_members m ON m.chat_id=c.id AND m.deputy_id=?
    ORDER BY last_msg_at DESC NULLS LAST`).all(req.user.id, req.user.id);

  chats.forEach(c => {
    c.unread = c.last_msg_id ? Math.max(0, c.last_msg_id - c.last_read_id) : 0;
    // Approximate unread count
    if (c.unread > 0) {
      c.unread = db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE chat_id=? AND id>?').get(c.id, c.last_read_id).c;
    }
    if (c.last_encrypted) {
      const preview = decryptMessage(c.last_encrypted, c.last_iv, c.id);
      c.last_message = preview.length > 50 ? preview.substring(0, 50) + '...' : preview;
    }
    delete c.last_encrypted; delete c.last_iv;
    // For 1-on-1 chats, show other person's name
    if (!c.is_group) {
      const other = db.prepare('SELECT d.full_name FROM chat_members cm JOIN deputies d ON d.id=cm.deputy_id WHERE cm.chat_id=? AND cm.deputy_id!=?').get(c.id, req.user.id);
      if (other) c.display_name = other.full_name;
    }
    c.display_name = c.display_name || c.name || 'Чат';
    // Members
    c.members = db.prepare('SELECT d.id, d.full_name FROM chat_members cm JOIN deputies d ON d.id=cm.deputy_id WHERE cm.chat_id=?').all(c.id);
  });
  res.json(chats);
});

// Create chat (staff only)
router.post('/create', (req, res) => {
  if (req.user.userType !== 'staff') return res.status(403).json({ error: 'Только сотрудник может создавать чаты' });
  const { name, member_ids, is_group } = req.body;
  if (!member_ids || !member_ids.length) return res.status(400).json({ error: 'Укажите участников' });

  const r = db.prepare('INSERT INTO chats (name, is_group, created_by, district_id) VALUES (?,?,?,?)')
    .run(name || null, is_group ? 1 : 0, req.user.id, null);
  const chatId = r.lastInsertRowid;

  const ins = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, deputy_id) VALUES (?,?)');
  // Add creator
  ins.run(chatId, req.user.id);
  // Add members
  member_ids.forEach(id => ins.run(chatId, id));

  res.json({ id: chatId });
});

// Get messages
router.get('/:id/messages', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const before = req.query.before ? parseInt(req.query.before) : null;
  const limit = 50;

  let msgs;
  if (before) {
    msgs = db.prepare(`SELECT cm.*, d.full_name as sender_name FROM chat_messages cm
      JOIN deputies d ON d.id=cm.sender_id WHERE cm.chat_id=? AND cm.id<? ORDER BY cm.id DESC LIMIT ?`).all(req.params.id, before, limit);
  } else {
    msgs = db.prepare(`SELECT cm.*, d.full_name as sender_name FROM chat_messages cm
      JOIN deputies d ON d.id=cm.sender_id WHERE cm.chat_id=? ORDER BY cm.id DESC LIMIT ?`).all(req.params.id, limit);
  }

  msgs.forEach(m => {
    if (m.is_deleted) {
      m.text = 'Сообщение удалено';
    } else {
      m.text = decryptMessage(m.encrypted_text, m.iv, req.params.id);
    }
    delete m.encrypted_text; delete m.iv;
    if (m.reply_to_id) {
      const orig = db.prepare('SELECT encrypted_text, iv, is_deleted FROM chat_messages WHERE id=?').get(m.reply_to_id);
      m.reply_to_text = orig ? (orig.is_deleted ? 'Сообщение удалено' : decryptMessage(orig.encrypted_text, orig.iv, req.params.id)) : null;
    }
  });

  // Mark as read
  if (msgs.length) {
    const maxId = Math.max(...msgs.map(m => m.id));
    db.prepare('INSERT OR REPLACE INTO chat_read (chat_id, deputy_id, last_read_id) VALUES (?,?,MAX(?,COALESCE((SELECT last_read_id FROM chat_read WHERE chat_id=? AND deputy_id=?),0)))')
      .run(req.params.id, req.user.id, maxId, req.params.id, req.user.id);
  }

  res.json(msgs.reverse());
});

// Send message
router.post('/:id/send', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const { text, reply_to_id } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Пустое сообщение' });

  const { encrypted, iv } = encryptMessage(text.trim(), req.params.id);
  const r = db.prepare('INSERT INTO chat_messages (chat_id, sender_id, encrypted_text, iv, reply_to_id) VALUES (?,?,?,?,?)')
    .run(req.params.id, req.user.id, encrypted, iv, reply_to_id || null);

  // Update read for sender
  db.prepare('INSERT OR REPLACE INTO chat_read (chat_id, deputy_id, last_read_id) VALUES (?,?,?)')
    .run(req.params.id, req.user.id, r.lastInsertRowid);

  // Push to other members (exclude sender)
  const sender = db.prepare('SELECT full_name FROM deputies WHERE id=?').get(req.user.id);
  const members = db.prepare('SELECT deputy_id FROM chat_members WHERE chat_id=? AND deputy_id!=?').all(req.params.id, req.user.id).filter(m => m.deputy_id !== req.user.id);
  const chat = db.prepare('SELECT name, is_group FROM chats WHERE id=?').get(req.params.id);
  const shortName = (n) => { const p=n.split(' '); return p[0]+(p[1]?' '+p[1][0]+'.':'')+(p[2]?p[2][0]+'.':''); };
  const pushTitle = chat.is_group ? `💬 ${chat.name || 'Групповой чат'}` : `💬 ${shortName(sender.full_name)}`;
  const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;

  // Get sender's push endpoint to exclude same device
  const senderSub = db.prepare('SELECT push_subscription FROM deputies WHERE id=?').get(req.user.id);
  let senderEndpoint = null;
  try { senderEndpoint = senderSub?.push_subscription ? JSON.parse(senderSub.push_subscription).endpoint : null; } catch {}

  members.forEach(m => {
    // Skip if same device as sender
    if (senderEndpoint) {
      const mSub = db.prepare('SELECT push_subscription FROM deputies WHERE id=?').get(m.deputy_id);
      try {
        if (mSub?.push_subscription && JSON.parse(mSub.push_subscription).endpoint === senderEndpoint) return;
      } catch {}
    }
    sendPushToDeputy(m.deputy_id, {
      title: pushTitle,
      body: chat.is_group ? `${shortName(sender.full_name)}: ${preview}` : preview,
      data: { type: 'chat_message', chatId: parseInt(req.params.id) }
    }, 'new_event').catch(() => {});
  });

  res.json({ id: r.lastInsertRowid, created_at: new Date().toISOString() });

  // Update writing style from chat messages (deputies only, >30 chars)
  if (req.user.userType !== 'staff' && text.trim().length > 30) {
    try {
      const { updateWritingStyle } = require('./deputy');
      if (typeof updateWritingStyle === 'function') updateWritingStyle(req.user.id, text.trim());
    } catch(e) {}
  }
});

// Edit message (own only)
router.put('/:id/messages/:msgId', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id=? AND chat_id=?').get(req.params.msgId, req.params.id);
  if (!msg || msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Можно редактировать только свои сообщения' });
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Пустое сообщение' });
  const { encrypted, iv } = encryptMessage(text.trim(), req.params.id);
  db.prepare('UPDATE chat_messages SET encrypted_text=?, iv=?, is_edited=1 WHERE id=?').run(encrypted, iv, req.params.msgId);
  res.json({ success: true });
});

// Delete message (own only)
router.delete('/:id/messages/:msgId', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id=? AND chat_id=?').get(req.params.msgId, req.params.id);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  const chat = db.prepare('SELECT created_by FROM chats WHERE id=?').get(req.params.id);
  const isCreator = chat && chat.created_by === req.user.id;
  if (msg.sender_id !== req.user.id && !isCreator) return res.status(403).json({ error: 'Нет прав' });
  db.prepare('UPDATE chat_messages SET is_deleted=1, encrypted_text=?, iv=? WHERE id=?').run('', '', req.params.msgId);
  res.json({ success: true });
});

// Total unread count across all chats
router.get('/unread-total', (req, res) => {
  const chats = db.prepare('SELECT chat_id FROM chat_members WHERE deputy_id=?').all(req.user.id);
  let total = 0;
  chats.forEach(c => {
    const lastRead = db.prepare('SELECT last_read_id FROM chat_read WHERE chat_id=? AND deputy_id=?').get(c.chat_id, req.user.id);
    const unread = db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE chat_id=? AND id>?').get(c.chat_id, lastRead?.last_read_id || 0);
    total += unread.c;
  });
  res.json({ count: total });
});

// Add members to chat (staff only)
router.post('/:id/members', (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!chat || chat.created_by !== req.user.id) return res.status(403).json({ error: 'Только создатель чата' });
  const { member_ids } = req.body;
  const ins = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, deputy_id) VALUES (?,?)');
  member_ids.forEach(id => ins.run(req.params.id, id));
  res.json({ success: true });
});

// Clear chat messages (staff/creator only)
router.post('/:id/clear', (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!chat || chat.created_by !== req.user.id) return res.status(403).json({ error: 'Только создатель чата' });
  db.prepare('DELETE FROM chat_messages WHERE chat_id=?').run(req.params.id);
  db.prepare('DELETE FROM chat_read WHERE chat_id=?').run(req.params.id);
  res.json({ success: true });
});

// Delete chat (staff only)
router.delete('/:id', (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!chat || chat.created_by !== req.user.id) return res.status(403).json({ error: 'Только создатель чата' });
  db.prepare('DELETE FROM chats WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
