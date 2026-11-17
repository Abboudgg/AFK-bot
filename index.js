
const {
  Client,
  GatewayIntentBits,
  ActivityType
} = require("discord.js");

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;
const PASSWORD = process.env.DASHBOARD_PASSWORD;

const AFK_CHANNEL_ID = "1571122453655326851";
const AFK_ROLE_ID = "1572139691577315338";

if (!TOKEN || !PASSWORD) {
  console.error("Missing DISCORD_TOKEN or DASHBOARD_PASSWORD");
  process.exit(1);
}

// حفظ بيانات AFK
const DATA_FILE = path.join(__dirname, "afk-data.json");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { afk: {}, logs: [] };
  }
}

let data = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addLog(username, action) {
  data.logs.unshift({
    username,
    action,
    time: new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Riyadh"
    })
  });

  data.logs = data.logs.slice(0, 100);
  saveData();
}

// حماية تسجيل الدخول
function sign(value) {
  return crypto
    .createHmac("sha256", PASSWORD)
    .update(value)
    .digest("hex");
}

function createSession() {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  return expires + "." + sign(String(expires));
}

function isAuthenticated(req) {
  const cookies = (req.headers.cookie || "")
    .split(";")
    .reduce((result, item) => {
      const parts = item.trim().split("=");
      result[parts[0]] = parts.slice(1).join("=");
      return result;
    }, {});

  const value = cookies.afk_session;
  if (!value) return false;

  const parts = value.split(".");
  if (parts.length !== 2) return false;

  const expires = parts[0];
  if (Number(expires) < Date.now()) return false;

  const expected = sign(expires);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(parts[1]),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

function auth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// صفحة لوحة التحكم
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AFK BY CASS</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#10111a;color:white;font-family:Arial,sans-serif;padding:20px}
.container{max-width:650px;margin:35px auto}
.card{background:#1c1e2b;padding:20px;border-radius:16px;margin-bottom:15px}
h1{color:#a78bfa}
input,select,button{width:100%;padding:13px;margin-top:10px;border:0;border-radius:9px;font-size:15px}
input,select{background:#303244;color:white}
button{background:#805ad5;color:white;font-weight:bold;cursor:pointer}
.secondary{background:#3a3c4c}
.hidden{display:none}
.log{padding:12px;border-bottom:1px solid #393b4c}
small{color:#aaa}
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <h1>AFK BY CASS</h1>
    <p>لوحة التحكم الخاصة بالبوت</p>
  </div>

  <div class="card" id="login">
    <h3>تسجيل الدخول</h3>
    <input id="password" type="password" placeholder="كلمة المرور">
    <button onclick="login()">دخول</button>
    <p id="loginError"></p>
  </div>

  <div id="dashboard" class="hidden">
    <div class="card">
      <h3>حالة اتصال البوت</h3>
      <p id="connection">جاري التحقق...</p>
      <p id="botName"></p>
      <p id="afkCount"></p>
    </div>

    <div class="card">
      <h3>نشاط البوت</h3>
      <label>نوع النشاط</label>
      <select id="activity">
        <option value="Playing">Playing</option>
        <option value="Streaming">Streaming</option>
        <option value="Listening">Listening</option>
        <option value="Watching">Watching</option>
        <option value="Competing">Competing</option>
      </select>

      <label>النص</label>
      <input id="activityText" placeholder="اكتب حالة البوت">

      <div id="streamBox" class="hidden">
        <label>رابط البث</label>
        <input id="streamUrl" placeholder="https://www.twitch.tv/...">
      </div>

      <label>حالة Discord</label>
      <select id="status">
        <option value="online">Online</option>
        <option value="idle">Idle</option>
        <option value="dnd">Do Not Disturb</option>
        <option value="invisible">Invisible</option>
      </select>

      <button onclick="savePresence()">حفظ التغييرات</button>
      <p id="saveMessage"></p>
    </div>

    <div class="card">
      <h3>سجل أعضاء AFK</h3>
      <div id="logs">لا توجد سجلات حالياً</div>
    </div>

    <button class="secondary" onclick="logout()">تسجيل الخروج</button>
  </div>
</div>

<script>
async function api(url, options) {
  const response = await fetch(url, options || {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "حدث خطأ");
  return result;
}

async function login() {
  try {
    await api("/api/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        password: document.getElementById("password").value
      })
    });

    document.getElementById("login").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    refresh();
  } catch {
    document.getElementById("loginError").textContent =
      "كلمة المرور غير صحيحة";
  }
}

async function refresh() {
  try {
    const result = await api("/api/status");
    document.getElementById("connection").textContent =
      result.online ? "🟢 Online" : "🔴 Offline";
    document.getElementById("botName").textContent =
      result.name || "";
    document.getElementById("afkCount").textContent =
      "أعضاء AFK: " + result.afkCount;

    const logs = await api("/api/logs");
    document.getElementById("logs").innerHTML =
      logs.length ? logs.map(function(log) {
        return '<div class="log"><b>' +
          escapeHtml(log.username) + '</b><br>' +
          escapeHtml(log.action) + '<br><small>' +
          escapeHtml(log.time) + '</small></div>';
      }).join("") : "لا توجد سجلات حالياً";
  } catch {
    document.getElementById("connection").textContent =
      "تعذر جلب الحالة";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

async function savePresence() {
  try {
    await api("/api/presence", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        activity: document.getElementById("activity").value,
        text: document.getElementById("activityText").value,
        url: document.getElementById("streamUrl").value,
        status: document.getElementById("status").value
      })
    });

    document.getElementById("saveMessage").textContent =
      "✅ تم تحديث نشاط البوت";
  } catch(error) {
    document.getElementById("saveMessage").textContent =
      "❌ " + error.message;
  }
}

document.getElementById("activity").addEventListener("change", function() {
  document.getElementById("streamBox").classList.toggle(
    "hidden", this.value !== "Streaming"
  );
});

async function logout() {
  await fetch("/api/logout", {method:"POST"});
  location.reload();
}
</script>
</body>
</html>
`);
});

// تسجيل الدخول
app.post("/api/login", (req, res) => {
  const supplied = String(req.body.password || "");

  if (supplied !== PASSWORD) {
    return res.status(401).json({ error: "Wrong password" });
  }

  const session = createSession();

  res.setHeader("Set-Cookie",
    "afk_session=" + session +
    "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200"
  );

  res.json({ success: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie",
    "afk_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );
  res.json({ success: true });
});

// معلومات البوت
app.get("/api/status", auth, (req, res) => {
  res.json({
    online: client.isReady(),
    name: client.user?.tag || null,
    afkCount: Object.keys(data.afk).length
  });
});

// السجل
app.get("/api/logs", auth, (req, res) => {
  res.json(data.logs);
});

// تغيير النشاط
app.post("/api/presence", auth, async (req, res) => {
  if (!client.isReady()) {
    return res.status(503).json({ error: "البوت غير متصل" });
  }

  const types = {
    Playing: ActivityType.Playing,
    Streaming: ActivityType.Streaming,
    Listening: ActivityType.Listening,
    Watching: ActivityType.Watching,
    Competing: ActivityType.Competing
  };

  const { activity, text, url, status } = req.body;

  if (!types[activity] || !text || text.length > 128) {
    return res.status(400).json({ error: "إعدادات النشاط غير صحيحة" });
  }

  if (!["online", "idle", "dnd", "invisible"].includes(status)) {
    return res.status(400).json({ error: "حالة الاتصال غير صحيحة" });
  }

  const presenceActivity = {
    name: text,
    type: types[activity]
  };

  if (activity === "Streaming") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error();
      presenceActivity.url = parsed.toString();
    } catch {
      return res.status(400).json({ error: "رابط البث غير صحيح" });
    }
  }

  try {
    client.user.setPresence({
      activities: [presenceActivity],
      status
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Presence error:", error);
    res.status(500).json({ error: "تعذر تغيير النشاط" });
  }
});

// تشغيل الموقع
app.listen(PORT, "0.0.0.0", () => {
  console.log("Dashboard running on port " + PORT);
});

// تشغيل بوت Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once("ready", () => {
  console.log("Logged in as " + client.user.tag);
});

// إدارة AFK
client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
console.log("[VOICE EVENT]", {
  member: member?.user?.tag,
  oldChannel: oldState.channelId,
  newChannel: newState.channelId,
  afkChannel: AFK_CHANNEL_ID
});
  if (!member || member.user.bot) return;

  const joinedAFK =
    newState.channelId === AFK_CHANNEL_ID &&
    oldState.channelId !== AFK_CHANNEL_ID;

  const leftAFK =
    oldState.channelId === AFK_CHANNEL_ID &&
    newState.channelId !== AFK_CHANNEL_ID;

  try {
    if (joinedAFK) {
      if (!Object.prototype.hasOwnProperty.call(data.afk, member.id)) {
        data.afk[member.id] = member.nickname;
        saveData();
      }

      const currentName = member.nickname || member.user.username;

      if (!currentName.startsWith("[AFK] ")) {
        await member.setNickname("[AFK] " + currentName);
      }

      await member.roles.add(AFK_ROLE_ID);
      addLog(member.user.tag, "دخل روم AFK");
    }

    if (leftAFK) {
      if (Object.prototype.hasOwnProperty.call(data.afk, member.id)) {
        await member.setNickname(data.afk[member.id]);
        delete data.afk[member.id];
        saveData();
      }

      await member.roles.remove(AFK_ROLE_ID);
      addLog(member.user.tag, "خرج من روم AFK");
    }
  } catch (error) {
    console.error("AFK Error:", error);
  }
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error.message);
});