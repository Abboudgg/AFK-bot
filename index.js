
const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const AFK_CHANNEL_ID = "1571122453655326851";
const AFK_ROLE_ID = "1572139691577315338";

const originalNames = new Map();

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const joinedAFK =
    newState.channelId === AFK_CHANNEL_ID &&
    oldState.channelId !== AFK_CHANNEL_ID;

  const leftAFK =
    oldState.channelId === AFK_CHANNEL_ID &&
    newState.channelId !== AFK_CHANNEL_ID;

  try {
    if (joinedAFK) {
      if (!originalNames.has(member.id)) {
        originalNames.set(member.id, member.nickname);
      }

      const currentName = member.nickname || member.user.username;

      if (!currentName.startsWith("[AFK] ")) {
        await member.setNickname(`[AFK] ${currentName}`);
      }

      await member.roles.add(AFK_ROLE_ID);

      console.log(`🟢 ${member.user.tag} entered AFK`);
    }

    if (leftAFK) {
      const oldName = originalNames.get(member.id);

      if (oldName !== undefined) {
        await member.setNickname(oldName);
        originalNames.delete(member.id);
      }

      await member.roles.remove(AFK_ROLE_ID);

      console.log(`🔴 ${member.user.tag} left AFK`);
    }
  } catch (error) {
    console.error("AFK Error:", error);
  }
});

client.login(process.env.DISCORD_TOKEN);