const express = require('express');
const session = require('express-session');
const path = require('path');

const DISCORD_API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

function createDashboard(client, db, defaults) {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI;
  const sessionSecret = process.env.SESSION_SECRET;
  const publicUrl = process.env.PUBLIC_URL;

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));
  app.use(session({
    name: 'cass.sid',
    secret: sessionSecret || 'development-only-change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  app.use(express.static(path.join(__dirname), { index: 'index.html' }));

  const oauthReady = Boolean(clientId && clientSecret && redirectUri && sessionSecret);

  async function discordRequest(url, token) {
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!response.ok) throw new Error('Discord API returned ' + response.status);
    return response.json();
  }

  function requireLogin(req, res, next) {
    if (!req.session.user || !req.session.accessToken) {
      return res.status(401).json({ error: 'يلزم تسجيل الدخول عبر Discord.' });
    }
    next();
  }

  async function getManageableGuilds(req) {
    const guilds = await discordRequest(DISCORD_API + '/users/@me/guilds', req.session.accessToken);
    return guilds.filter(g => {
      const permissions = BigInt(g.permissions || '0');
      return (permissions & MANAGE_GUILD) === MANAGE_GUILD ||
        (permissions & ADMINISTRATOR) === ADMINISTRATOR;
    }).filter(g => client.guilds.cache.has(g.id));
  }

  app.get('/auth/discord', (req, res) => {
    if (!oauthReady) return res.status(503).send('إعداد تسجيل الدخول غير مكتمل. أضف متغيرات Discord OAuth في الاستضافة.');
    const state = require('crypto').randomBytes(24).toString('hex');
    req.session.oauthState = state;
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state
    });
    res.redirect('https://discord.com/oauth2/authorize?' + query.toString());
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      if (!oauthReady || !req.query.code || !req.query.state ||
          req.query.state !== req.session.oauthState) {
        return res.status(400).send('تعذر التحقق من تسجيل الدخول. ارجع وحاول مرة ثانية.');
      }
      delete req.session.oauthState;
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: redirectUri
      });
      const tokenResponse = await fetch(DISCORD_API + '/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!tokenResponse.ok) throw new Error('OAuth token exchange failed');
      const token = await tokenResponse.json();
      const user = await discordRequest(DISCORD_API + '/users/@me', token.access_token);
      req.session.user = { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar };
      req.session.accessToken = token.access_token;
      req.session.regenerate(err => {
        if (err) return res.status(500).send('تعذر إنشاء جلسة آمنة.');
        req.session.user = { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar };
        req.session.accessToken = token.access_token;
        res.redirect('/');
      });
    } catch (error) {
      console.error('[CASS dashboard OAuth]', error.message);
      res.status(502).send('فشل تسجيل الدخول عبر Discord. حاول مرة ثانية.');
    }
  });

  app.post('/auth/logout', requireLogin, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('cass.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.json({ ok: true });
    });
  });

  app.get('/api/status', (req, res) => {
    res.json({
      name: 'CASS AFK',
      ready: client.isReady(),
      botName: client.user?.tag || null,
      guildCount: client.guilds.cache.size,
      loginConfigured: oauthReady
    });
  });

  app.get('/api/me', (req, res) => {
    res.json({ user: req.session.user || null, loginConfigured: oauthReady });
  });

  app.get('/api/guilds', requireLogin, async (req, res) => {
    try {
      const allowed = await getManageableGuilds(req);
      res.json({ guilds: allowed.map(g => {
        const botGuild = client.guilds.cache.get(g.id);
        const data = db.guild(g.id, defaults);
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          afkCount: Object.keys(data.afk || {}).length,
          botName: botGuild.name
        };
      }) });
    } catch (error) {
      console.error('[CASS dashboard guilds]', error.message);
      res.status(502).json({ error: 'تعذر تحميل سيرفرات Discord.' });
    }
  });

  async function authorizeGuild(req, res, next) {
    try {
      const allowed = await getManageableGuilds(req);
      if (!allowed.some(g => g.id === req.params.guildId)) {
        return res.status(403).json({ error: 'ما عندك صلاحية إدارة هذا السيرفر أو أن البوت غير موجود فيه.' });
      }
      req.botGuild = client.guilds.cache.get(req.params.guildId);
      next();
    } catch (error) {
      console.error('[CASS dashboard permission]', error.message);
      res.status(502).json({ error: 'تعذر التحقق من صلاحيات السيرفر.' });
    }
  }

  app.get('/api/guild/:guildId/overview', requireLogin, authorizeGuild, (req, res) => {
    const data = db.guild(req.params.guildId, defaults);
    const members = Object.entries(data.afk || {}).map(([id, afk]) => ({
      id,
      reason: String(afk.reason || '').slice(0, 150),
      since: Number(afk.since || 0),
      mentions: Array.isArray(afk.pings) ? afk.pings.length : 0
    })).sort((a, b) => a.since - b.since);
    res.json({ members, mentionCount: members.reduce((sum, member) => sum + member.mentions, 0) });
  });

  app.get('/api/guild/:guildId/channels', requireLogin, authorizeGuild, async (req, res) => {
    try {
      const channels = await req.botGuild.channels.fetch();
      res.json({ channels: [...channels.values()]
        .filter(c => c && c.isTextBased() && c.guildId === req.params.guildId && typeof c.name === 'string')
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')) });
    } catch (error) {
      console.error('[CASS dashboard channels]', error.message);
      res.status(502).json({ error: 'تعذر تحميل الرومات.' });
    }
  });

  app.get('/api/guild/:guildId/settings', requireLogin, authorizeGuild, (req, res) => {
    const data = db.guild(req.params.guildId, defaults);
    res.json({ settings: { nickname: Boolean(data.cfg.nick), ignoredChannels: data.cfg.ignore || [] } });
  });

  app.put('/api/guild/:guildId/settings', requireLogin, authorizeGuild, async (req, res) => {
    if (publicUrl && req.get('origin') !== publicUrl.replace(/\/$/, '')) {
      return res.status(403).json({ error: 'مصدر الطلب غير موثوق.' });
    }
    const data = db.guild(req.params.guildId, defaults);
    const body = req.body || {};
    if (typeof body.nickname === 'boolean') data.cfg.nick = body.nickname;
    if (Array.isArray(body.ignoredChannels)) {
      if (body.ignoredChannels.length > 20 || body.ignoredChannels.some(id => typeof id !== 'string')) {
        return res.status(400).json({ error: 'قائمة الرومات غير صالحة.' });
      }
      const valid = [];
      for (const id of body.ignoredChannels) {
        const channel = await req.botGuild.channels.fetch(id).catch(() => null);
        if (!channel || channel.guildId !== req.params.guildId) {
          return res.status(400).json({ error: 'يوجد روم غير صالح في القائمة.' });
        }
        valid.push(id);
      }
      data.cfg.ignore = [...new Set(valid)];
    }
    db.save();
    res.json({ ok: true, settings: { nickname: Boolean(data.cfg.nick), ignoredChannels: data.cfg.ignore } });
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.log('🌐 CASS dashboard listening on port ' + port);
  });
  return server;
}

module.exports = { createDashboard };
