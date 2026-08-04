import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { ChannelType, SlashCommandBuilder } from "discord.js";
import { EProjectCommands, EProjectSubcommands } from "../discord.enums";

// /project — admin management of projects and their tracked voice channels.
const projectCommand = new SlashCommandBuilder()
  .setName(EProjectCommands.PROJECT)
  .setDescription("Manage work projects and their voice channels (admin only)")
  .addSubcommand((sub) =>
    sub
      .setName(EProjectSubcommands.LIST)
      .setDescription("List all projects and their assigned voice channels")
  )
  .addSubcommand((sub) =>
    sub
      .setName(EProjectSubcommands.CREATE)
      .setDescription("Create a new project")
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("Name of the project")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName(EProjectSubcommands.DELETE)
      .setDescription("Delete a project and unassign all its channels")
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("Project to delete")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName(EProjectSubcommands.ASSIGN)
      .setDescription("Assign a voice channel to a project")
      .addStringOption((opt) =>
        opt
          .setName("project")
          .setDescription("Project to assign the channel to")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Voice channel to assign")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName(EProjectSubcommands.UNASSIGN)
      .setDescription("Unassign a voice channel from its project")
      .addStringOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Assigned channel to unassign")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName(EProjectSubcommands.MANAGER)
      .setDescription("Reassign a project's manager")
      .addStringOption((opt) =>
        opt
          .setName("project")
          .setDescription("Project to reassign")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("New manager (must be an admin)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName(EProjectSubcommands.REPORT)
      .setDescription("Download a CSV of this month's work on a project")
      .addStringOption((opt) =>
        opt
          .setName("project")
          .setDescription("Project to report on")
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

export const projectCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  projectCommand.toJSON();
