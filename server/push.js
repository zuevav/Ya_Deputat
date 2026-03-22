const webpush = require('web-push');
const db = require('./db/init');

function getVapidKeys() {
  const pub = db.prepare("SELECT value FROM settings WHERE key = 'vapid_public'").get();
  const priv = db.prepare("SELECT value FROM settings WHERE key = 'vapid_private'").get();

  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_public', ?)").run(keys.publicKey);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_private', ?)").run(keys.privateKey);
    return keys;
  }

  return { publicKey: pub.value, privateKey: priv.value };
}

const vapidKeys = getVapidKeys();

// Get contact email from settings or use default
const adminEmail = db.prepare("SELECT email FROM admins WHERE admin_role='system_admin' LIMIT 1").get();
webpush.setVapidDetails(
  `mailto:${adminEmail?.email || 'admin@deputat.zetit.ru'}`,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

async function sendPushToDeputy(deputyId, payload, notificationType) {
  const deputy = db.prepare('SELECT push_subscription, notification_preferences FROM deputies WHERE id = ?').get(deputyId);
  if (!deputy?.push_subscription) return false;

  // Check notification preference
  if (notificationType) {
    const prefs = JSON.parse(deputy.notification_preferences || '{}');
    const prefKey = `push_${notificationType}`;
    if (prefs[prefKey] === false) return false;
  }

  try {
    const subscription = JSON.parse(deputy.push_subscription);
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410) {
      db.prepare('UPDATE deputies SET push_subscription = NULL WHERE id = ?').run(deputyId);
    }
    console.error(`Push failed for deputy ${deputyId}:`, err.message);
    return false;
  }
}

async function sendPushToEventParticipants(eventId, payload, notificationType) {
  const participants = db.prepare(`
    SELECT d.id FROM deputies d
    JOIN event_participants ep ON ep.deputy_id = d.id
    WHERE ep.event_id = ? AND d.push_subscription IS NOT NULL
  `).all(eventId);

  const results = await Promise.allSettled(
    participants.map(p => sendPushToDeputy(p.id, payload, notificationType))
  );

  return results.filter(r => r.status === 'fulfilled' && r.value).length;
}

module.exports = { sendPushToDeputy, sendPushToEventParticipants, vapidKeys };
