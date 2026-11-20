// =============================================
//  💤 CASS AFK ・ بوت الغياب
// =============================================
const { GatewayIntentBits: G, Partials, SlashCommandBuilder, PermissionFlagsBits: P } = require('discord.js');
const { start, embed, say, safe, ts } = require('./core');
const db = require('./db');
const { createDashboard } = require('./dashboard/server');

const DEF = { afk: {}, cfg: { nick: true, ignore: [] } }; // afk: userId → { reason, since, nick, pings:[{by, url, at}] }
const PREFIX = '[AFK] ';
const AFK_VOICE_CHANNEL_ID = '1571122453655326851';
const AFK_ROLE_ID = '1572139691577315338';
const AFK_GUILD_ID = '1571120459775352925';
const pendingReasons = new Set();
const replied = new Map();
const COOLDOWN = 30e3;
const MAX_TRACKED_COOLDOWNS = 5000;

function canReply(key, now) {
  const previous = replied.get(key) || 0;
  if (now - previous < COOLDOWN) return false;
  replied.set(key, now);
  if (replied.size > MAX_TRACKED_COOLDOWNS) {
    for (const [k, at] of replied) {
      if (now - at >= COOLDOWN) replied.delete(k);
      if (replied.size <= MAX_TRACKED_COOLDOWNS) break;
    }
  }
  return true;
}

const clean = s => String(s || '').replace(/@(everyone|here)/g, '@​$1').replace(/<@[!&]?\d+>/g, '@منشن').replace(/https?:\/\/\S+/g, '🔗').slice(0, 150);
const ago = ms => {
  const m = Math.floor(ms / 60e3), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d} يوم${h % 24 ? ` و${h % 24} ساعة` : ''}` : h ? `${h} ساعة${m % 60 ? ` و${m % 60} دقيقة` : ''}` : m ? `${m} دقيقة` : 'أقل من دقيقة';
};

async function setNick(member, on, g, a) {
  if (!g.cfg.nick || !member?.manageable) return;
  if (on) {
    const cur = member.nickname || member.user.globalName || member.user.username;
    if (cur.startsWith(PREFIX)) return;
    a.nick = member.nickname || null;
    return member.setNickname((PREFIX + cur).slice(0, 32), 'CASS AFK').catch(() => {});
  }
  if (member.nickname?.startsWith(PREFIX)) await member.setNickname(a?.nick || null, 'CASS AFK').catch(() => {});
}

async function back(member, g, channel) {
  const a = member && g.afk[member.id]; if (!a) return;
  delete g.afk[member.id]; db.save();
  await setNick(member, false, g, a);
  if (member.guild.id === AFK_GUILD_ID) {
    await member.roles.remove(AFK_ROLE_ID, 'CASS AFK: عاد العضو من الغياب').catch(() => {});
  }
  const pings = Array.isArray(a.pings) ? a.pings : [];
  const list = pings.slice(-10).map(p => `▫️ <@${p.by}> ${ts(p.at)} ・ [الرسالة](${p.url})`);
  const e = embed(`👋 هلا بعودتك ${member.displayName}!`,
    `غبت **${ago(Date.now() - a.since)}**${pings.length ? `\n📨 منشنوك **${pings.length}** مرة:\n${list.join('\n')}${pings.length > 10 ? `\n... و${pings.length - 10} غيرها` : ''}` : '\nما أحد منشنك وأنت غايب 😴'}`);
  const m = await channel?.send({ content: `${member}`, embeds: [e], allowedMentions: { users: [member.id] } }).catch(() => null);
  if (m && !pings.length) setTimeout(() => m.delete().catch(() => {}), 10e3);
}

const cmds = [
  new SlashCommandBuilder().setName('afk').setDescription('حط نفسك غايب، والبوت يرد على اللي يمنشنك')
    .addStringOption(o => o.setName('reason').setDescription('سبب الغياب (مثل: نايم، بالدوام، أصلي)').setMaxLength(150)),
  new SlashCommandBuilder().setName('afklist').setDescription('مين غايب الحين بالسيرفر'),
  new SlashCommandBuilder().setName('afkadmin').setDescription('إعدادات بوت الغياب').setDefaultMemberPermissions(P.ManageNicknames)
    .addSubcommand(s => s.setName('remove').setDescription('شيل الغياب عن عضو')
      .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)))
    .addSubcommand(s => s.setName('nickname').setDescription('تشغيل أو إيقاف إضافة [AFK] للاسم')
      .addBooleanOption(o => o.setName('enabled').setDescription('شغّال؟').setRequired(true)))
    .addSubcommand(s => s.setName('ignore').setDescription('روم ما يشيل فيه الغياب لو كتبت (مثل روم البوتات) ・ ضغطة ثانية تشيله')
      .addChannelOption(o => o.setName('channel').setDescription('الروم').setRequired(true))),
];

const client = start({
  name: 'CASS AFK',
  intents: [G.Guilds, G.GuildMessages, G.GuildVoiceStates, G.DirectMessages, G.MessageContent],
  partials: [Partials.Channel],
  commands: cmds
});
createDashboard(client, db, DEF);

// دخول روم AFK الصوتي: إضافة الرتبة وطلب سبب الغياب بالخاص.
client.on('voiceStateUpdate', safe(async (oldState, newState) => {
  if (newState.guild.id !== AFK_GUILD_ID) return;
  if (newState.channelId !== AFK_VOICE_CHANNEL_ID || oldState.channelId === AFK_VOICE_CHANNEL_ID) return;
  const member = newState.member;
  if (!member || member.user.bot) return;

  const g = db.guild(newState.guild.id, DEF);
  if (g.afk[member.id]) return;

  const a = g.afk[member.id] = {
    reason: 'بانتظار تحديد السبب',
    since: Date.now(),
    pings: [],
    nick: member.nickname ?? null
  };
  await member.roles.add(AFK_ROLE_ID, 'CASS AFK: دخل روم الغياب').catch(() => {});
  await setNick(member, true, g, a);
  db.save();

  pendingReasons.add(member.id);
  await member.send({
    embeds: [embed('💤 تم تفعيل AFK', 'وش سبب غيابك؟ اكتب السبب هنا بالخاص، وإذا أحد منشنك بنعلمه بسبب غيابك.')],
  }).catch(() => {
    pendingReasons.delete(member.id);
  });
}));

client.on('messageCreate', safe(async msg => {
  if (msg.author.bot) return;

  // استقبال سبب الغياب من الخاص.
  if (!msg.guild) {
    if (!pendingReasons.has(msg.author.id)) return;
    const g = db.guild(AFK_GUILD_ID, DEF);
    const a = g.afk[msg.author.id];
    if (!a) { pendingReasons.delete(msg.author.id); return; }
    const reason = clean(msg.content);
    if (!reason) return msg.reply('اكتب سبب الغياب برسالة نصية عشان أسجله لك.');
    a.reason = reason;
    pendingReasons.delete(msg.author.id);
    db.save();
    return msg.reply('✅ تم تسجيل سبب غيابك: **' + reason + '**');
  }

  if (!msg.guild) return;
  const g = db.guild(msg.guild.id, DEF);
  if (g.afk[msg.author.id] && !g.cfg.ignore.includes(msg.channelId) && Date.now() - g.afk[msg.author.id].since > 15e3)
    await back(msg.member, g, msg.channel);
  const targets = [...new Set([...msg.mentions.users.keys(), msg.mentions.repliedUser?.id].filter(Boolean))]
    .filter(id => id !== msg.author.id && g.afk[id]);
  if (!targets.length) return;
  const lines = [];
  for (const id of targets.slice(0, 5)) {
    const a = g.afk[id];
    a.pings ??= [];
    a.pings.push({ by: msg.author.id, url: msg.url, at: Date.now() });
    if (a.pings.length > 50) a.pings.shift();
    const k = msg.channelId + id;
    if (!canReply(k, Date.now())) continue;
    lines.push(`💤 <@${id}> غايب من ${ts(a.since)}${a.reason ? ` ・ **${a.reason}**` : ''}`);
  }
  db.save();
  if (lines.length) {
    const r = await msg.reply({ content: lines.join('\n'), allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
    if (r) setTimeout(() => r.delete().catch(() => {}), 15e3);
  }
}));

client.on('interactionCreate', safe(async i => {
  if (!i.guild || !i.isChatInputCommand()) return;
  const g = db.guild(i.guild.id, DEF);
  if (i.commandName === 'afk') {
    const reason = clean(i.options.getString('reason'));
    const old = g.afk[i.user.id];
    const a = g.afk[i.user.id] = {
      reason, since: Date.now(), pings: old?.pings || [],
      nick: old ? old.nick : (i.member?.nickname ?? null)
    };
    await setNick(i.member, true, g, a); db.save();
    return i.reply({ embeds: [embed('💤 صرت غايب', `${i.user}${reason ? `\n📝 السبب: **${reason}**` : ''}\nأي أحد يمنشنك بقوله إنك غايب، وأول ما تكتب برجعك 👋`)], allowedMentions: { parse: [] } });
  }
  if (i.commandName === 'afklist') {
    const l = Object.entries(g.afk).sort((a, b) => a[1].since - b[1].since).slice(0, 30)
      .map(([u, a]) => `💤 <@${u}> ・ ${ts(a.since)}${a.reason ? ` ・ ${a.reason}` : ''}`);
    return say(i, null, { embeds: [embed(`💤 الغايبين (${Object.keys(g.afk).length})`, l.join('\n') || 'ما فيه أحد غايب، الكل صاحي 😄')] });
  }
  if (i.commandName === 'afkadmin') {
    const sub = i.options.getSubcommand();
    if (sub === 'remove') {
      const u = i.options.getUser('user');
      if (!g.afk[u.id]) return say(i, `❌ ${u} مو غايب.`);
      const a = g.afk[u.id]; delete g.afk[u.id]; db.save();
      await setNick(await i.guild.members.fetch(u.id).catch(() => null), false, g, a);
      return say(i, `✅ شلنا الغياب عن ${u}.`);
    }
    if (sub === 'nickname') {
      g.cfg.nick = i.options.getBoolean('enabled'); db.save();
      return say(i, g.cfg.nick ? '✅ البوت بيضيف `[AFK]` جنب اسم الغايب (يحتاج صلاحية Manage Nicknames ورتبته فوق).' : '✅ ما عاد البوت يغيّر الأسماء.');
    }
    if (sub === 'ignore') {
      const ch = i.options.getChannel('channel'), has = g.cfg.ignore.includes(ch.id);
      g.cfg.ignore = has ? g.cfg.ignore.filter(x => x !== ch.id) : [...g.cfg.ignore, ch.id].slice(-20); db.save();
      return say(i, has ? `✅ ${ch} رجع عادي: الكتابة فيه تشيل الغياب.` : `✅ الكتابة في ${ch} ما تشيل الغياب.`);
    }
  }
}));
