import {CacheType, ChatInputCommandInteraction, Client} from 'discord.js';
import {handleAttendanceCommand} from './attendance.handler';
import {handleAdminCommand} from './admin.handler';
import {EAttendanceCommands, EAuthCommands, ELeaveCommands} from '../discord.enums';
import {handleLeaveCommand} from './leave.handler';
import {handleAuthCommand} from './auth.handler';

console.log('NODE_ENV', process.env.NODE_ENV);
const production = process.env.NODE_ENV === 'production';
const attendanceChannelID = production
  ? process.env.ATTENDANCE_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

const modID = process.env.MOD_ID;

const sendErrorInteractionResponse = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  interaction.reply({
    content: `❌ Error handling command \`/${interaction.commandName}\`! Notifying: <@${modID}>`,
  });
};

export const interactionHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>,
  discordClient: Client<boolean>
) => {
  try {
    if (interaction.channelId === attendanceChannelID) {
      if (
        Object.values(EAttendanceCommands).includes(interaction.commandName as EAttendanceCommands)
      ) {
        handleAttendanceCommand(interaction, discordClient, sendErrorInteractionResponse);
      } else if (ELeaveCommands.REQUEST_LEAVE === interaction.commandName) {
        handleLeaveCommand(interaction);
      } else if (EAuthCommands.HR === interaction.commandName) {
        handleAuthCommand(interaction);
      }
    } else if (interaction.channelId === process.env.ADMIN_CHANNEL_ID) {
      handleAdminCommand(interaction);
    } else {
      if (production) {
        interaction.reply({
          content: `<@${interaction.user.id}> ❌ Please use the <#${attendanceChannelID}> channel for attendance related commands`,
        });
      }
    }
  } catch (error) {
    console.error(error);
    sendErrorInteractionResponse(interaction);
  }
};
