const nodemailer = require('nodemailer');
const db = require('./db/init');

function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function getSmtpConfig() {
  const keys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure'];
  const config = {};
  for (const key of keys) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    config[key] = row?.value || '';
  }
  return config;
}

function createTransporter() {
  const config = getSmtpConfig();
  if (!config.smtp_host) return null;

  return nodemailer.createTransport({
    host: config.smtp_host,
    port: parseInt(config.smtp_port) || 587,
    secure: config.smtp_secure === 'true',
    auth: config.smtp_user ? { user: config.smtp_user, pass: config.smtp_pass } : undefined
  });
}

async function sendEmail(to, subject, html, attachments, opts) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log('SMTP not configured, skipping email to:', to);
    return false;
  }

  const config = getSmtpConfig();
  try {
    const mailOpts = {
      from: `"Я Депутат" <${config.smtp_from || config.smtp_user}>`,
      to, subject, html,
      attachments: attachments || []
    };
    if (opts?.cc) mailOpts.cc = opts.cc;
    await transporter.sendMail(mailOpts);
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

async function sendEventEmailWithFiles(deputy, event, filePaths, opts) {
  const d = new Date(event.event_date);
  const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekday = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const attachments = filePaths.map(f => ({ filename: f.original_name, path: f.full_path }));

  const TYPE_LABELS = { regular: 'очередное заседание', extraordinary: 'внеочередное заседание', field: 'выездное заседание', commission: 'заседание комиссии' };
  const TYPE_COLORS = { regular: '#007AFF', extraordinary: '#FF9500', field: '#34C759', commission: '#AF52DE' };
  const typeName = TYPE_LABELS[event.event_type] || 'заседание';
  const typeColor = TYPE_COLORS[event.event_type] || '#007AFF';

  const customText = opts?.customNotification || '';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
      <div style="background:${typeColor};padding:24px 28px;border-radius:12px 12px 0 0;">
        <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:600;">${escapeHtml(event.title)}</h1>
        <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:6px;">${typeName.charAt(0).toUpperCase() + typeName.slice(1)}</div>
      </div>
      <div style="padding:24px 28px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;">
        <p style="font-size:15px;color:#333;margin:0 0 16px;">Добрый день, ${escapeHtml(deputy.full_name)}!</p>
        ${customText ? `<div style="font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(customText)}</div>` : `<p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 16px;">Уведомляем вас о предстоящем мероприятии. Просим подтвердить участие.</p>`}
        <div style="background:#f5f5f7;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 0;color:#888;font-size:13px;width:80px;vertical-align:top;">Дата</td>
                <td style="padding:6px 0;font-size:14px;font-weight:500;color:#333;">${dateStr}, ${weekday}</td></tr>
            <tr><td style="padding:6px 0;color:#888;font-size:13px;vertical-align:top;">Время</td>
                <td style="padding:6px 0;font-size:14px;font-weight:500;color:#333;">${timeStr}</td></tr>
            ${event.location ? `<tr><td style="padding:6px 0;color:#888;font-size:13px;vertical-align:top;">Место</td>
                <td style="padding:6px 0;font-size:14px;font-weight:500;color:#333;">${escapeHtml(event.location)}</td></tr>` : ''}
          </table>
        </div>
        ${event.description && !customText ? `<div style="font-size:14px;color:#555;line-height:1.6;margin-bottom:16px;">${escapeHtml(event.description)}</div>` : ''}
        ${attachments.length ? `<div style="font-size:13px;color:#888;margin-bottom:16px;">&#x1F4CE; Приложено файлов: <strong style="color:#333">${attachments.length}</strong></div>` : ''}
        <p style="font-size:14px;color:#333;font-weight:500;margin:0 0 16px;">Прошу подтвердить получение и ваше участие.</p>
        <div style="border-top:1px solid #e8e8e8;padding-top:12px;margin-top:8px;">
          <span style="color:#aaa;font-size:12px;">Система «Я Депутат»</span>
        </div>
      </div>
    </div>
  `;

  // Subject: title + date (no duplication)
  let subject = event.title;
  if (!subject.includes(dateStr) && !subject.includes(d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}))) {
    subject += ` — ${dateStr} в ${timeStr}`;
  } else if (!subject.includes(timeStr)) {
    subject += ` в ${timeStr}`;
  }
  return sendEmail(deputy.email, subject, html, attachments, { cc: opts?.cc });
}

async function sendInviteEmail(deputy, inviteUrl) {
  return sendEmail(deputy.email, 'Приглашение в систему «Я Депутат»', `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1a237e;">Я Депутат</h2>
      <p>Здравствуйте, ${escapeHtml(deputy.full_name)}!</p>
      <p>Вы приглашены в систему оповещения о мероприятиях.</p>
      <p>Для регистрации перейдите по ссылке и настройте вход через Passkey:</p>
      <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#1a237e;color:#fff;text-decoration:none;border-radius:8px;">Зарегистрироваться</a></p>
      <p style="color:#888;font-size:13px;">Ссылка действительна 7 дней.</p>
    </div>
  `);
}

async function sendPasswordResetEmail(admin, resetUrl) {
  return sendEmail(admin.email, 'Сброс пароля — Я Депутат', `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1a237e;">Я Депутат</h2>
      <p>Здравствуйте, ${escapeHtml(admin.full_name)}!</p>
      <p>Для сброса пароля перейдите по ссылке:</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#1a237e;color:#fff;text-decoration:none;border-radius:8px;">Сбросить пароль</a></p>
      <p style="color:#888;font-size:13px;">Ссылка действительна 1 час.</p>
    </div>
  `);
}

async function sendEventNotificationEmail(deputy, event) {
  const dateStr = new Date(event.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return sendEmail(deputy.email, `Новое мероприятие: ${event.title}`, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1a237e;">Я Депутат</h2>
      <p>Здравствуйте, ${escapeHtml(deputy.full_name)}!</p>
      <h3>${escapeHtml(event.title)}</h3>
      <p><strong>Дата:</strong> ${dateStr}</p>
      ${event.location ? `<p><strong>Место:</strong> ${escapeHtml(event.location)}</p>` : ''}
      ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
      <p>Войдите в приложение для подтверждения участия.</p>
    </div>
  `);
}

async function sendReminderEmail(deputy, event) {
  const dateStr = new Date(event.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return sendEmail(deputy.email, `Напоминание: ${event.title}`, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#1a237e;">Я Депутат</h2>
      <p>Здравствуйте, ${escapeHtml(deputy.full_name)}!</p>
      <p>Напоминаем о предстоящем мероприятии:</p>
      <h3>${escapeHtml(event.title)}</h3>
      <p><strong>Дата:</strong> ${dateStr}</p>
      ${event.location ? `<p><strong>Место:</strong> ${escapeHtml(event.location)}</p>` : ''}
    </div>
  `);
}

// Send email using staff's own SMTP
async function sendEmailAsStaff(staffId, to, subject, html, attachments) {
  const dep = db.prepare('SELECT smtp_settings, full_name FROM deputies WHERE id=?').get(staffId);
  if (!dep?.smtp_settings) return sendEmail(to, subject, html, attachments || []);

  const cfg = JSON.parse(dep.smtp_settings);
  if (!cfg.enabled || !cfg.host) return sendEmail(to, subject, html, attachments || []);

  // Append signature
  let fullHtml = html;
  if (cfg.signature) {
    const sigHtml = escapeHtml(cfg.signature).replace(/\n/g, '<br>');
    fullHtml += `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;color:#666;font-size:13px;line-height:1.6">${sigHtml}</div>`;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: parseInt(cfg.port) || 587,
      secure: cfg.secure === 'true',
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined
    });

    const mailOpts = {
      from: `"Я Депутат" <${cfg.from || cfg.user}>`,
      to, subject, html: fullHtml,
      attachments: attachments || []
    };
    if (arguments[5]) mailOpts.cc = arguments[5];
    await transporter.sendMail(mailOpts);
    return true;
  } catch (err) {
    console.error('Staff email failed:', err.message);
    return sendEmail(to, subject, html, attachments || []);
  }
}

module.exports = { sendEmail, sendEmailAsStaff, sendInviteEmail, sendPasswordResetEmail, sendEventNotificationEmail, sendReminderEmail, sendEventEmailWithFiles, getSmtpConfig };
