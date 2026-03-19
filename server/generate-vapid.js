const webpush = require('web-push');
const db = require('./db/init');

const vapidKeys = webpush.generateVAPIDKeys();

db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_public', ?)").run(vapidKeys.publicKey);
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_private', ?)").run(vapidKeys.privateKey);

console.log('VAPID keys generated and saved to database');
console.log('Public key:', vapidKeys.publicKey);
