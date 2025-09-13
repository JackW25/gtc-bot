require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});


// ====== COMMAND HANDLER ======
client.commands = new Collection();
const commands = [];

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    // register commands per guild for faster updates:
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID), // or Routes.applicationGuildCommands(clientId, guildId)
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();


// ====== TICKET INACTIVITY HANDLER ======

// Map of ticketChannelIds -> { creatorId, lastCreatorMsgTime }
const tickets = new Map();

// Staff role names
const staffRoles = ['Admins', 'Moderator', 'Community Management'];

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // bot checks tickets every hour
  setInterval(checkTickets, 60 * 60 * 1000);
});

// bot will not react to tickets, or messages sent by ticket bot
client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  if (
    message.channel.parentId === process.env.CATEGORY_ID &&
    message.channel.name.startsWith('ticket-')
  ) {
    // Get the member who sent the message
    let member;
    try {
      member = await message.guild.members.fetch(message.author.id);
    } catch {
      return;
    }

    // Skip admins / staff completely
    if (
      member.permissions.has('Administrator') ||
      member.roles.cache.some(r =>
        staffRoles.some(name => r.name.includes(name))
      )
    ) return;

    // If there is not yet have a creator for this channel, set them now
    if (!tickets.has(message.channel.id)) {
      tickets.set(message.channel.id, {
        creatorId: message.author.id,
        lastCreatorMsgTime: Date.now()
      });
    } else {
      // If message is from creator, update timestamp
      const ticket = tickets.get(message.channel.id);
      if (message.author.id === ticket.creatorId) {
        ticket.lastCreatorMsgTime = Date.now();
        tickets.set(message.channel.id, ticket);
      }
    }
  }
});

async function checkTickets() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const category = guild.channels.cache.get(process.env.CATEGORY_ID);
  if (!category || category.type !== 4) return;

  const ticketChannels = category.children.cache.filter(
    ch => ch.isTextBased() && ch.name.startsWith('ticket-')
  );

  for (const [channelId, channel] of ticketChannels) {
    let ticket = tickets.get(channelId);

    // Discover the creator if not cached already
    if (!ticket) {
      try {
        const msgs = await channel.messages.fetch({ limit: 20 });
        const sorted = msgs
          .filter(m => !m.author.bot)
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const m of sorted.values()) {
          const mMember = await channel.guild.members.fetch(m.author.id);
          if (
            !mMember.permissions.has('Administrator') &&
            !mMember.roles.cache.some(r =>
              staffRoles.some(name => r.name.includes(name))
            )
          ) {
            ticket = {
              creatorId: m.author.id,
              lastCreatorMsgTime: m.createdTimestamp
            };
            tickets.set(channelId, ticket);
            break;
          }
        }
      } catch (e) {
        console.error(`Error fetching ${channel.name}:`, e);
      }
    }

    if (!ticket) continue;

    const now = Date.now();
    const msSinceCreator = now - ticket.lastCreatorMsgTime;

    // fetch last message in the channel
    let lastMessage;
    try {
      const msgs = await channel.messages.fetch({ limit: 1 });
      lastMessage = msgs.first();
    } catch {
      lastMessage = null;
    }

    // Only ping if creator hasn’t replied in 24h AND last message isn’t from them
    if (
      msSinceCreator >= 24 * 60 * 60 * 1000 &&
      lastMessage &&
      lastMessage.author.id !== ticket.creatorId
    ) {
      try {
        await channel.send(
          `<@${ticket.creatorId}> It’s been 24h since your last reply. Would you still like to verify? Please note this ticket will close if you do not reply`
        );

        // update timestamp so no spam
        ticket.lastCreatorMsgTime = now;
        tickets.set(channelId, ticket);
      } catch (err) {
        console.error(`Could not ping creator in ${channel.name}:`, err);
      }
    }
  }
}


client.login(process.env.DISCORD_TOKEN);
