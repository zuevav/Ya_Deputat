# Я Депутат — PWA приложение для муниципальных депутатов

## Архитектура

### Стек технологий
- **Backend**: Node.js + Express
- **Database**: SQLite (через better-sqlite3) — простота, без отдельного сервера
- **Frontend (PWA)**: Vanilla JS + HTML + CSS (без тяжёлых фреймворков)
- **Push-уведомления**: Web Push API (VAPID)
- **Авторизация**: JWT токены

### Структура проекта
```
/server
  /routes        — API маршруты
  /middleware     — auth middleware
  /db            — миграции и инициализация БД
  server.js      — точка входа
/public
  /css
  /js
  /icons
  manifest.json
  sw.js          — Service Worker
  index.html     — SPA точка входа
```

### Модели данных (SQLite)

**deputies** — Депутаты
- id, full_name, phone, email, push_subscription, created_at

**commissions** — Комиссии
- id, name, description, created_at

**commission_members** — Привязка депутатов к комиссиям
- id, commission_id, deputy_id

**events** — Мероприятия
- id, title, description, event_type (commission/session/external),
  commission_id (nullable), event_date, location, created_at

**event_files** — Файлы к мероприятиям
- id, event_id, filename, original_name, created_at

**event_participants** — Участники мероприятий
- id, event_id, deputy_id, status (pending/seen/confirmed/declined), seen_at, responded_at

**admins** — Администраторы
- id, username, password_hash, created_at

### API маршруты

**Auth**
- POST /api/auth/login — вход админа
- POST /api/auth/deputy-login — вход депутата (по телефону/email + код)

**Admin API** (требует JWT)
- CRUD /api/admin/deputies
- CRUD /api/admin/commissions
- POST /api/admin/commissions/:id/members — добавить депутатов
- CRUD /api/admin/events
- POST /api/admin/events/:id/files — загрузить файлы
- POST /api/admin/events/:id/remind — отправить напоминание

**Deputy API** (требует JWT)
- GET /api/deputy/events — мои мероприятия
- POST /api/deputy/events/:id/confirm — подтвердить/отклонить
- GET /api/deputy/events/:id — детали мероприятия
- POST /api/deputy/push-subscribe — подписка на push

### PWA
- Service Worker для кеширования и offline
- Web App Manifest
- Push-уведомления через VAPID

### Типы мероприятий
1. **Комиссия** — привязана к комиссии, участники = члены комиссии
2. **Заседание** — все депутаты
3. **Выездное мероприятие** — выбранные депутаты
