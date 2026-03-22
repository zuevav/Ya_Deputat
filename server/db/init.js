const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'deputat.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS districts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, okrug TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, okrug)
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT, email TEXT,
      admin_role TEXT NOT NULL DEFAULT 'system_admin' CHECK(admin_role IN ('system_admin','deputy_admin')),
      reset_token TEXT, reset_token_expires DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_districts (
      admin_id INTEGER NOT NULL, district_id INTEGER NOT NULL,
      PRIMARY KEY (admin_id, district_id),
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
      FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_passkey_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0, transports TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deputies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL, phone TEXT, email TEXT,
      district_id INTEGER,
      user_type TEXT NOT NULL DEFAULT 'deputy' CHECK(user_type IN ('deputy','staff')),
      deputy_role TEXT NOT NULL DEFAULT 'deputy' CHECK(deputy_role IN ('deputy','head')),
      vacation_start DATE, vacation_end DATE,
      substitute_for_id INTEGER,
      password_hash TEXT,
      permissions TEXT,
      smtp_settings TEXT,
      staff_role TEXT DEFAULT 'regular' CHECK(staff_role IN ('regular','lead')),
      invite_token TEXT, invite_token_expires DATETIME,
      passkey_registered INTEGER DEFAULT 0,
      push_subscription TEXT,
      notification_preferences TEXT DEFAULT '{"push_new_event":true,"push_reminder":true,"email_new_event":true,"email_reminder":true}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (district_id) REFERENCES districts(id),
      FOREIGN KEY (substitute_for_id) REFERENCES deputies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deputy_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0, transports TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, description TEXT, district_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (district_id) REFERENCES districts(id)
    );

    CREATE TABLE IF NOT EXISTS commission_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id INTEGER NOT NULL, deputy_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member' CHECK(role IN ('chair','vice_chair','member')),
      FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE CASCADE,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE,
      UNIQUE(commission_id, deputy_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, description TEXT,
      event_type TEXT NOT NULL,
      commission_id INTEGER,
      event_date DATETIME NOT NULL, location TEXT,
      district_id INTEGER,
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','closed')),
      admin_comment TEXT, ai_summary TEXT, audio_transcription TEXT,
      created_by INTEGER, closed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE SET NULL,
      FOREIGN KEY (district_id) REFERENCES districts(id),
      FOREIGN KEY (created_by) REFERENCES admins(id)
    );

    CREATE TABLE IF NOT EXISTS event_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT,
      file_type TEXT NOT NULL DEFAULT 'document' CHECK(file_type IN ('document','photo','audio')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL, deputy_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','seen','confirmed','declined')),
      seen_at DATETIME, responded_at DATETIME,
      ai_post_text TEXT,
      admin_block_text TEXT, deputy_response_text TEXT, block_confirmed INTEGER DEFAULT 0,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE,
      UNIQUE(event_id, deputy_id)
    );

    CREATE TABLE IF NOT EXISTS event_agenda_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      title TEXT NOT NULL, description TEXT, item_order INTEGER DEFAULT 0,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL, agenda_item_id INTEGER NOT NULL, deputy_id INTEGER NOT NULL,
      vote TEXT CHECK(vote IN ('support','abstain','oppose')),
      ai_suggestion TEXT CHECK(ai_suggestion IN ('support','abstain','oppose')),
      ai_reasoning TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (agenda_item_id) REFERENCES event_agenda_items(id) ON DELETE CASCADE,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE,
      UNIQUE(agenda_item_id, deputy_id)
    );

    CREATE TABLE IF NOT EXISTS staff_deputy_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      deputy_id INTEGER NOT NULL,
      FOREIGN KEY (staff_id) REFERENCES deputies(id) ON DELETE CASCADE,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE,
      UNIQUE(staff_id, deputy_id)
    );

    CREATE TABLE IF NOT EXISTS vacations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deputy_id INTEGER NOT NULL,
      vacation_start DATE NOT NULL,
      vacation_end DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#007AFF',
      is_system INTEGER DEFAULT 0,
      district_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (district_id) REFERENCES districts(id)
    );

    CREATE TABLE IF NOT EXISTS event_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_type TEXT DEFAULT 'regular',
      default_time TEXT DEFAULT '19:00',
      description TEXT,
      days_ahead INTEGER DEFAULT 10,
      district_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (district_id) REFERENCES districts(id)
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      district_id INTEGER,
      is_default INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (district_id) REFERENCES districts(id)
    );

    CREATE TABLE IF NOT EXISTS receptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deputy_id INTEGER NOT NULL,
      reception_date DATE NOT NULL,
      time_start TEXT NOT NULL,
      time_end TEXT NOT NULL,
      location TEXT,
      description TEXT,
      outcome TEXT CHECK(outcome IN ('held','cancelled')),
      district_id INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),
      created_by_staff INTEGER,
      post_text TEXT,
      quarter INTEGER,
      year INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE,
      FOREIGN KEY (district_id) REFERENCES districts(id),
      FOREIGN KEY (created_by_staff) REFERENCES deputies(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT
    );

    CREATE TABLE IF NOT EXISTS personal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deputy_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_date DATETIME NOT NULL,
      location TEXT,
      visibility TEXT DEFAULT 'private' CHECK(visibility IN ('private','shared')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deputy_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      report_text TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      is_group INTEGER DEFAULT 0,
      created_by INTEGER NOT NULL,
      district_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES deputies(id)
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      deputy_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (deputy_id) REFERENCES deputies(id) ON DELETE CASCADE,
      UNIQUE(chat_id, deputy_id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      encrypted_text TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES deputies(id)
    );

    CREATE TABLE IF NOT EXISTS chat_read (
      chat_id INTEGER NOT NULL,
      deputy_id INTEGER NOT NULL,
      last_read_id INTEGER DEFAULT 0,
      PRIMARY KEY (chat_id, deputy_id)
    );
  `);

  // Migrations
  try { db.exec('ALTER TABLE receptions ADD COLUMN post_text TEXT'); } catch(e) {}
  try { db.exec("ALTER TABLE commission_members ADD COLUMN role TEXT DEFAULT 'member'"); } catch(e) {}
  try { db.exec('ALTER TABLE deputies ADD COLUMN writing_style TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE event_participants ADD COLUMN post_gen_count INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec("ALTER TABLE reports ADD COLUMN visible_to_deputy INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec('ALTER TABLE chat_messages ADD COLUMN reply_to_id INTEGER'); } catch(e) {}
  try { db.exec('ALTER TABLE chat_messages ADD COLUMN is_edited INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE chat_messages ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}

  // Default admin
  const ac = db.prepare('SELECT COUNT(*) as c FROM admins').get();
  if (ac.c === 0) {
    db.prepare('INSERT INTO admins (username, password_hash, full_name, email, admin_role) VALUES (?,?,?,?,?)')
      .run('admin', bcrypt.hashSync('admin123', 10), 'Администратор', '', 'system_admin');
    console.log('Default admin: admin / admin123');
  }

  // Districts
  const dc = db.prepare('SELECT COUNT(*) as c FROM districts').get();
  if (dc.c === 0) { seedDistricts(); console.log('Districts seeded'); }

  // Event types
  const etc = db.prepare('SELECT COUNT(*) as c FROM event_types').get();
  if (etc.c === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO event_types (name, code, color, is_system) VALUES (?,?,?,1)');
    ins.run('Очередное заседание', 'regular', '#007AFF');
    ins.run('Внеочередное заседание', 'extraordinary', '#FF9500');
    ins.run('Выездное заседание', 'field', '#34C759');
    ins.run('Комиссия', 'commission', '#AF52DE');
  }

  // Changelog
  const cc = db.prepare('SELECT COUNT(*) as c FROM changelog').get();
  if (cc.c === 0) seedChangelog();
}

function seedDistricts() {
  const d = {
    'ЦАО':['Арбат','Басманный','Замоскворечье','Красносельский','Мещанский','Пресненский','Таганский','Тверской','Хамовники','Якиманка'],
    'САО':['Аэропорт','Беговой','Бескудниковский','Войковский','Восточное Дегунино','Головинский','Дмитровский','Западное Дегунино','Коптево','Левобережный','Молжаниновский','Савёловский','Сокол','Тимирязевский','Ховрино'],
    'СВАО':['Алексеевский','Алтуфьевский','Бабушкинский','Бибирево','Бутырский','Лианозово','Лосиноостровский','Марфино','Марьина Роща','Останкинский','Отрадное','Ростокино','Свиблово','Северный','Северное Медведково','Южное Медведково','Ярославский'],
    'ВАО':['Богородское','Вешняки','Восточное Измайлово','Восточный','Гольяново','Ивановское','Измайлово','Косино-Ухтомский','Метрогородок','Новогиреево','Новокосино','Перово','Преображенское','Северное Измайлово','Соколиная Гора','Сокольники'],
    'ЮВАО':['Выхино-Жулебино','Капотня','Кузьминки','Лефортово','Люблино','Марьино','Некрасовка','Нижегородский','Печатники','Рязанский','Текстильщики','Южнопортовый'],
    'ЮАО':['Бирюлёво Восточное','Бирюлёво Западное','Братеево','Даниловский','Донской','Зябликово','Москворечье-Сабурово','Нагатино-Садовники','Нагатинский Затон','Нагорный','Орехово-Борисово Северное','Орехово-Борисово Южное','Царицыно','Чертаново Северное','Чертаново Центральное','Чертаново Южное'],
    'ЮЗАО':['Академический','Гагаринский','Зюзино','Коньково','Котловка','Ломоносовский','Обручевский','Северное Бутово','Тёплый Стан','Черёмушки','Южное Бутово','Ясенево'],
    'ЗАО':['Внуково','Дорогомилово','Крылатское','Кунцево','Можайский','Ново-Переделкино','Очаково-Матвеевское','Проспект Вернадского','Раменки','Солнцево','Тропарёво-Никулино','Филёвский Парк','Фили-Давыдково'],
    'СЗАО':['Куркино','Митино','Покровское-Стрешнево','Северное Тушино','Строгино','Хорошёво-Мнёвники','Щукино','Южное Тушино'],
    'ЗелАО':['Крюково','Матушкино','Савёлки','Силино','Старое Крюково'],
    'НАО':['Внуковское','Воскресенское','Десёновское','Кокошкино','Марушкинское','Московский','Мосрентген','Рязановское','Сосенское','Филимонковское','Щербинка'],
    'ТАО':['Вороновское','Киевский','Клёновское','Краснопахорское','Михайлово-Ярцевское','Новофёдоровское','Первомайское','Роговское','Троицк','Щаповское']
  };
  const ins = db.prepare('INSERT INTO districts (name, okrug) VALUES (?, ?)');
  db.transaction(() => { for (const [o, ns] of Object.entries(d)) ns.forEach(n => ins.run(n, o)); })();
}

function seedChangelog() {
  const entries = [
    ['0.1.0', 'Начальная версия', 'Базовый функционал: мероприятия, депутаты, комиссии, push-уведомления, PWA'],
    ['0.1.1', 'Passkey и email', 'Вход через Passkey для депутатов, настройка SMTP, email-уведомления, сброс пароля'],
    ['0.1.2', 'Районы и роли', 'Все районы Москвы, роли (сис.админ, админ депутатов, глава, депутат, сотрудник), отпуск, замещение, повестка, голосование'],
    ['0.2.0', 'Полный функционал', 'Passkey для админов, приёмы населения, диктофон с расшифровкой, годовой отчёт, интеграция DeepSeek (баланс, модели), блок заполнения админом, история изменений']
  ];
  const ins = db.prepare('INSERT INTO changelog (version, title, description) VALUES (?, ?, ?)');
  entries.forEach(e => ins.run(...e));
}

initialize();
module.exports = db;
