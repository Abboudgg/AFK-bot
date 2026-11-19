// أساس مشترك لبوتات Codeon المجانية
require('dotenv').config();
const { Client, EmbedBuilder, ActivityType, version } = require('discord.js');

const GOLD = 0xD4AF6A;
const BRAND = 'CASS AFK ・ Discord';

function start({ name, intents, partials = [], commands, onReady }) {
  const TOKEN = process.env.TOKEN;
  if (!TOKEN) { console.error('❌ حط توكن البوت في ملف .env  (TOKEN=...)'); process.exit(1); }
  const client = new Client({ intents, partials });
  const [a, b] = version.split('.').map(Number);
  client.once(a > 14 || b >= 22 ? 'clientReady' : 'ready', async () => {
    try { await client.application.commands.set(commands.map(c => c.toJSON())); }
    catch (e) { console.error('❌ تسجيل الأوامر:', e.message); }
    client.user.setActivity('CASS ON TOP', { type: ActivityType.Watching });
    console.log(`✅ ${name} شغال باسم ${client.user.tag}`);
    try { await onReady?.(client); } catch (e) { console.error(e); }
  });
  client.on('error', e => console.error('⚠️', e.message));
  process.on('unhandledRejection', e => console.error('⚠️', e?.message || e));
  client.login(TOKEN).catch(e => {
    console.error('❌ ما قدرت أسجل دخول:', e.message);
    if (/disallowed intents/i.test(e.message)) console.error('👉 فعّل الـ Intents المطلوبة من Developer Portal ← Bot ← Privileged Gateway Intents (شوف README)');
    process.exit(1);
  });
  return client;
}

const embed = (title, desc, color = GOLD) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc || null).setFooter({ text: BRAND });
const say = (i, content, extra = {}) => (i.deferred || i.replied ? i.followUp({ content, flags: 64, ...extra }) : i.reply({ content, flags: 64, ...extra })).catch(() => {});
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { console.error('⚠️', e); const i = a[0]; if (i?.isRepliable?.()) say(i, '❌ صار خطأ، حاول مرة ثانية.'); } };

// "10m" "2h" "1d12h" "30د" "2س" "1ي" ← ملي ثانية
const UNIT = { s: 1e3, m: 60e3, h: 3600e3, d: 864e5, w: 6048e5, 'ث': 1e3, 'د': 60e3, 'س': 3600e3, 'ي': 864e5 };
function parseDur(text) {
  const t = String(text || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g, '').toLowerCase();
  if (/^\d+$/.test(t)) return Number(t) * 60e3;
  const re = /(\d+)(s|m|h|d|w|ث|د|س|ي)/g; let ms = 0, used = 0, m;
  while ((m = re.exec(t))) { ms += Number(m[1]) * UNIT[m[2]]; used += m[0].length; }
  return used === t.length && ms ? ms : null;
}
const ts = (ms, f = 'R') => `<t:${Math.floor(ms / 1000)}:${f}>`;

module.exports = { start, embed, say, safe, parseDur, ts, GOLD, BRAND };
