const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const path = require('path');

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, '../service_account.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Log a user verification to the prefilled Google Sheet')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The Discord user to verify')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('method')
        .setDescription('Verification type')
        .setRequired(true)
        .addChoices(
          { name: 'Govt ID', value: 'Govt ID' },
          { name: 'Instagram', value: 'Instagram' },
          { name: 'Reddit', value: 'Reddit' },
          { name: 'TikTok', value: 'TikTok' },
          { name: 'Facebook', value: 'Facebook' },
          { name: 'Selfie', value: 'Selfie' },
        ),
    )
    .addStringOption(option =>
      option
        .setName('socialuser')
        .setDescription('Social media username (only if using a social account)')
        .setRequired(false),
    ),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const method = interaction.options.getString('method');
    const socialUser = interaction.options.getString('socialuser') || '';

    try {
      const sheets = google.sheets({
        version: 'v4',
        auth: await auth.getClient(),
      });

      const spreadsheetId = process.env.SHEET_ID;

      // read column D (Discord Username) to find first blank cell
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'D9:D', // adjust start row (you said D9:D)
      });

      const rows = res.data.values || [];
      // find first blank row index relative to D9
      let emptyIndex = rows.findIndex(r => !r[0] || r[0].trim() === '');
      if (emptyIndex === -1) {
        await interaction.editReply('❌ No empty row found in the sheet!');
        return;
      }
      // Convert to actual sheet row number
      const rowNumber = 9 + emptyIndex;

      // Write to that row: B=Verification Type, C=Social Username, D=Discord Username, E=Discord ID, F=Status
      const values = [
        [
          method,
          socialUser,
          user.username,
          user.id,
          'Verified',
        ],
      ];

      // Range B..F on the chosen row (Case # already in column A)
      const writeRange = `B${rowNumber}:F${rowNumber}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: writeRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });

      await interaction.editReply(
        `✅ Added verification for **${user.tag}** to row ${rowNumber} in the sheet`,
      );
    } catch (err) {
      console.error(err);
      await interaction.editReply(
        '❌ There was an error writing to the spreadsheet.',
      );
    }
  },
};
