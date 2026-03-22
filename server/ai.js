const db = require('./db/init');

function getAiConfig() {
  const key = db.prepare("SELECT value FROM settings WHERE key = 'deepseek_api_key'").get();
  const model = db.prepare("SELECT value FROM settings WHERE key = 'deepseek_model'").get();
  return { apiKey: key?.value || '', model: model?.value || 'deepseek-chat' };
}

function isAiConfigured() { return !!getAiConfig().apiKey; }

async function callDeepSeek(systemPrompt, userPrompt) {
  const c = getAiConfig();
  if (!c.apiKey) throw new Error('DeepSeek API ключ не настроен');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.apiKey}` },
    body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`DeepSeek error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function getBalance() {
  const c = getAiConfig();
  if (!c.apiKey) throw new Error('API ключ не настроен');
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { 'Authorization': `Bearer ${c.apiKey}` }
  });
  if (!res.ok) throw new Error(`Balance error: ${res.status}`);
  return res.json();
}

async function getModels() {
  const c = getAiConfig();
  if (!c.apiKey) throw new Error('API ключ не настроен');
  const res = await fetch('https://api.deepseek.com/models', {
    headers: { 'Authorization': `Bearer ${c.apiKey}` }
  });
  if (!res.ok) throw new Error(`Models error: ${res.status}`);
  return res.json();
}

async function generateEventSummary(event, agendaItems, files) {
  const agenda = agendaItems.map((a, i) => `${i+1}. ${a.title}${a.description ? ': '+a.description : ''}`).join('\n');
  return callDeepSeek(
    'Ты — помощник муниципального совета. Пиши кратко на русском.',
    `Составь резюме заседания:\nНазвание: ${event.title}\nДата: ${event.event_date}\nМесто: ${event.location||'—'}\nПовестка:\n${agenda||'—'}\n${event.description||''}\n${event.admin_comment?'Комментарий: '+event.admin_comment:''}\n${event.audio_transcription?'Расшифровка аудио: '+event.audio_transcription:''}\nДокументы: ${files.map(f=>f.original_name).join(', ')||'—'}\n\nРезюме в 3-5 предложениях.`
  );
}

async function generateVotingSuggestions(deputy, event, agendaItems) {
  const agenda = agendaItems.map((a, i) => `${i+1}. ${a.title}`).join('\n');
  const r = await callDeepSeek(
    'Ты — помощник депутата. Отвечай JSON.',
    `Депутат ${deputy.full_name} в отпуске. Заседание: ${event.title}\nПовестка:\n${agenda}\nДля каждого пункта предложи голос и причину. JSON: [{"item_id":1,"suggestion":"support|abstain|oppose","reasoning":"причина"}]`
  );
  try { const m = r.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); } catch {}
  return [];
}

async function generatePostText(deputy, event, agendaItems, adminComment, photoCount) {
  const agenda = agendaItems.map((a, i) => `${i+1}. ${a.title}`).join('\n');
  return callDeepSeek(
    'Ты — SMM-помощник депутата. Пиши от первого лица, живо, 150-300 слов, на русском.',
    `Пост для ${deputy.full_name}.\nМероприятие: ${event.title}\nДата: ${event.event_date}\nМесто: ${event.location||''}\n${event.description||''}\nПовестка:\n${agenda}\n${adminComment?'Комментарий: '+adminComment:''}\n${event.audio_transcription?'Из расшифровки: '+event.audio_transcription.substring(0,500):''}\n${photoCount?`Фото: ${photoCount}`:''}. Уникальный текст.`
  );
}

async function generateAnnualReport(deputy, events, year) {
  const eventList = events.map(e => `- ${e.title} (${e.event_date}) — ${e.my_status||e.status}`).join('\n');
  return callDeepSeek(
    'Ты составляешь годовой отчёт о депутатской деятельности. Формальный стиль, на русском, 500-1000 слов.',
    `Годовой отчёт за ${year} год для депутата ${deputy.full_name}.\nРайон: ${deputy.district_name||'—'}\n\nМероприятия (${events.length}):\n${eventList}\n\nСоставь структурированный отчёт с разделами: Введение, Участие в заседаниях, Основные решения, Работа с населением, Итоги.`
  );
}

async function cleanupTranscription(rawText) {
  return callDeepSeek(
    'Ты редактор стенограмм заседаний. Исправь ошибки распознавания, расставь пунктуацию, раздели на абзацы.',
    `Отредактируй расшифровку аудиозаписи заседания:\n\n${rawText}`
  );
}

module.exports = { isAiConfigured, getAiConfig, callDeepSeek, getBalance, getModels, generateEventSummary, generateVotingSuggestions, generatePostText, generateAnnualReport, cleanupTranscription };
