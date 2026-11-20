const $ = (id) => document.getElementById(id);
const state = { guilds: [], guildId: null, settings: null, channels: [] };

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ الطلب.');
  return data;
}

function setStatus(text, ready) {
  $('botStatus').innerHTML = '<i></i> ' + text;
  $('botReady').textContent = ready ? 'متصل' : 'غير متصل';
  $('botReady').classList.toggle('waiting', !ready);
}

async function loadGuilds() {
  const data = await api('/api/guilds');
  state.guilds = data.guilds;
  $('guildCount').textContent = data.guilds.length;
  const select = $('guildSelect');
  select.innerHTML = '';
  if (!data.guilds.length) {
    select.add(new Option('لا توجد سيرفرات مشتركة مناسبة', ''));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.add(new Option('اختر السيرفر', ''));
  data.guilds.forEach(g => select.add(new Option(g.name, g.id)));
}

async function loadGuild(id) {
  state.guildId = id;
  if (!id) return;
  const [settingsData, channelData, overview] = await Promise.all([
    api('/api/guild/' + id + '/settings'),
    api('/api/guild/' + id + '/channels'),
    api('/api/guild/' + id + '/overview')
  ]);
  state.settings = settingsData.settings;
  state.channels = channelData.channels;
  $('nicknameToggle').disabled = false;
  $('nicknameToggle').classList.toggle('on', state.settings.nickname);
  $('channelList').innerHTML = '';
  if (!state.channels.length) $('channelList').textContent = 'ما فيه رومات نصية متاحة.';
  state.channels.forEach(channel => {
    const label = document.createElement('label');
    label.className = 'channel-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.settings.ignoredChannels.includes(channel.id);
    checkbox.addEventListener('change', () => updateIgnored(channel.id, checkbox.checked));
    const name = document.createElement('span');
    name.textContent = '#' + channel.name;
    label.append(checkbox, name);
    $('channelList').append(label);
  });
  $('afkCount').textContent = overview.members.length;
  $('mentionCount').textContent = overview.mentionCount;
  const empty = $('membersEmpty');
  if (!overview.members.length) {
    empty.innerHTML = '<div class="empty-icon">☾</div><b>ما فيه أحد غايب حالياً</b><p>إذا استخدم أحد /afk بيظهر هنا.</p>';
  } else {
    empty.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'member-list';
    overview.members.forEach(member => {
      const item = document.createElement('div');
      item.className = 'member-item';
      const main = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = member.name || 'عضو غير معروف';
      const reason = document.createElement('small');
      reason.textContent = member.reason || 'بدون سبب';
      main.append(name, reason);
      const count = document.createElement('span');
      count.textContent = member.mentions + ' منشن';
      item.append(main, count);
      list.append(item);
    });
    empty.append(list);
  }
}

async function updateSettings(patch) {
  const result = await api('/api/guild/' + state.guildId + '/settings', {
    method: 'PUT',
    body: JSON.stringify(patch)
  });
  state.settings = result.settings;
  $('nicknameToggle').classList.toggle('on', state.settings.nickname);
}

async function updateIgnored(channelId, checked) {
  const next = new Set(state.settings.ignoredChannels);
  checked ? next.add(channelId) : next.delete(channelId);
  if (next.size > 20) {
    alert('الحد الأعلى 20 روم.');
    await loadGuild(state.guildId);
    return;
  }
  try { await updateSettings({ ignoredChannels: [...next] }); }
  catch (error) { alert(error.message); await loadGuild(state.guildId); }
}

async function init() {
  try {
    const [status, me] = await Promise.all([api('/api/status'), api('/api/me')]);
    setStatus(status.ready ? 'البوت يعمل' : 'البوت غير متصل', status.ready);
    if (me.user) {
      $('authGate').hidden = true;
      $('loginButton').hidden = true;
      $('logoutButton').hidden = false;
      $('accountName').textContent = me.user.global_name || me.user.username;
      $('accountTag').textContent = '@' + me.user.username;
      $('accountRole').textContent = me.isOwner ? me.role + ' — صلاحية كاملة' : 'عضو — حساب شخصي';
      $('accountAvatar').src = me.user.avatar
        ? 'https://cdn.discordapp.com/avatars/' + me.user.id + '/' + me.user.avatar + '.png?size=128'
        : 'https://cdn.discordapp.com/embed/avatars/0.png';
      if (me.isOwner) {
        document.body.classList.add('owner-view');
        $('settingsLock').textContent = 'صلاحية كاملة';
        await loadGuilds();
      } else {
        document.body.classList.add('personal-view');
      }
    } else {
      $('authGate').hidden = false;
      document.body.classList.add('logged-out');
      $('guildSelect').disabled = true;
      $('guildSelect').innerHTML = '<option value="">سجّل دخولك أولاً</option>';
    }
    if (!status.loginConfigured) {
      $('loginButton').textContent = 'إعداد تسجيل الدخول مطلوب';
      $('loginButton').removeAttribute('href');
      $('loginButton').classList.add('disabled');
      $('settingsLock').textContent = 'إعداد OAuth مطلوب';
      $('authLogin').textContent = 'إعداد تسجيل الدخول مطلوب';
      $('authLogin').removeAttribute('href');
    }
  } catch (error) {
    setStatus('تعذر الاتصال بالخادم', false);
    console.error(error);
  }
}

$('guildSelect').addEventListener('change', async event => {
  try { await loadGuild(event.target.value); }
  catch (error) { alert(error.message); }
});
$('nicknameToggle').addEventListener('click', async () => {
  if (!state.settings) return;
  try { await updateSettings({ nickname: !state.settings.nickname }); }
  catch (error) { alert(error.message); }
});
$('accountLogout').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); location.reload(); }
  catch (error) { alert(error.message); }
});
$('logoutButton').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); location.reload(); }
  catch (error) { alert(error.message); }
});
init();
