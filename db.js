// قاعدة بيانات JSON مع كتابة ذرّية لتقليل احتمال تلف الملف
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
const TEMP = path.join(DIR, 'db.json.tmp');

fs.mkdirSync(DIR, { recursive: true });

let data = {};
try {
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
} catch (e) {
  if (e.code !== 'ENOENT') console.error('تعذر قراءة قاعدة البيانات:', e.message);
}

let timer = null;
let closed = false;

function flush() {
  try {
    fs.writeFileSync(TEMP, JSON.stringify(data), 'utf8');
    fs.renameSync(TEMP, FILE);
  } catch (e) {
    console.error('تعذر حفظ قاعدة البيانات:', e.message);
    try { fs.unlinkSync(TEMP); } catch {}
  }
}

function save() {
  if (closed) return;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

function guild(id, defaults) {
  data[id] ??= {};
  for (const [key, value] of Object.entries(defaults)) {
    if (data[id][key] == null) data[id][key] = structuredClone(value);
  }
  // توافق مع بيانات الإصدارات السابقة
  data[id].afk ??= {};
  data[id].cfg ??= { nick: true, ignore: [] };
  data[id].cfg.nick ??= true;
  data[id].cfg.ignore ??= [];
  return data[id];
}

function shutdown() {
  if (closed) return;
  closed = true;
  clearTimeout(timer);
  flush();
}

process.once('exit', shutdown);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdown();
    process.exit(0);
  });
}

module.exports = { guild, save };
