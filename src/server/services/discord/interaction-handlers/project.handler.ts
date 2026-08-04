import type {
  AutocompleteInteraction,
  CacheType,
  ChatInputCommandInteraction,
} from "discord.js";
import type { User } from "@prisma/client";
import { EProjectCommands, EProjectSubcommands } from "../discord.enums";
import {
  assignChannelToProject,
  createProject,
  deleteProject,
  getUserByDiscordId,
  listProjects,
  setProjectManager,
  unassignChannel,
} from "../../../db";

const handleList = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  const projects = await listProjects();

  if (!projects.length) {
    await interaction.editReply({
      content:
        "ℹ️ No projects yet. Create one with `/project create name:<name>`.",
    });
    return;
  }

  const lines: string[] = ["📁 **Projects & tracked voice channels**", ""];
  for (const project of projects) {
    lines.push(`**${project.name}** — manager: <@${project.manager.discordInfo.id}>`);
    if (!project.channels.length) {
      lines.push("  • _no channels assigned_");
    } else {
      for (const channel of project.channels) {
        lines.push(`  • <#${channel.channelId}> — \`${channel.channelName}\``);
      }
    }
  }

  await interaction.editReply({ content: lines.join("\n") });
};

const handleCreate = async (
  interaction: ChatInputCommandInteraction<CacheType>,
  creator: User
) => {
  const name = interaction.options.getString("name", true);
  const result = await createProject(name, creator.id);
  await interaction.editReply({
    content: result.ok
      ? `✅ Created project **${result.project.name}** — manager: <@${creator.discordInfo.id}>.`
      : `❌ ${result.message}`,
  });
};

const handleManager = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  const projectName = interaction.options.getString("project", true);
  const target = interaction.options.getUser("user", true);

  let manager: User;
  try {
    manager = await getUserByDiscordId(target.id);
  } catch {
    await interaction.editReply({
      content: `❌ Couldn't resolve <@${target.id}> to an employee in the system.`,
    });
    return;
  }

  if (!manager.isAdmin) {
    await interaction.editReply({
      content: `❌ <@${target.id}> must be an admin to manage a project.`,
    });
    return;
  }

  const result = await setProjectManager(projectName, manager);
  await interaction.editReply({
    content: result.ok
      ? `✅ **${result.projectName}** is now managed by <@${manager.discordInfo.id}>.`
      : `❌ ${result.message}`,
  });
};

const handleDelete = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  const name = interaction.options.getString("name", true);
  const result = await deleteProject(name);
  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.message}` });
    return;
  }
  const channelNote =
    result.removedChannels > 0
      ? ` and unassigned ${result.removedChannels} channel${result.removedChannels > 1 ? "s" : ""}`
      : "";
  await interaction.editReply({
    content: `✅ Deleted project **${result.project.name}**${channelNote}.`,
  });
};

const handleAssign = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  const projectName = interaction.options.getString("project", true);
  const channel = interaction.options.getChannel("channel", true);

  const result = await assignChannelToProject(
    projectName,
    channel.id,
    channel.name ?? channel.id
  );
  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.message}` });
    return;
  }

  const movedNote = result.previousProjectName
    ? ` (moved from **${result.previousProjectName}**)`
    : "";
  await interaction.editReply({
    content: `✅ Assigned <#${channel.id}> to **${result.projectName}**${movedNote}.`,
  });
};

const handleUnassign = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  const channel = interaction.options.getString("channel", true);
  const result = await unassignChannel(channel);
  await interaction.editReply({
    content: result.ok
      ? `✅ Unassigned \`${result.channelName}\` from **${result.projectName}**.`
      : `❌ ${result.message}`,
  });
};

export const handleProjectCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  if (interaction.commandName !== EProjectCommands.PROJECT) return;

  // Project management is restricted to the admin channel.
  if (interaction.channelId !== process.env.ADMIN_CHANNEL_ID) {
    await interaction.reply({
      content: "❌ This command can only be used in the admin channel.",
      flags: "Ephemeral",
    });
    return;
  }

  await interaction.deferReply({ flags: "Ephemeral" });

  let user: User;
  try {
    user = await getUserByDiscordId(interaction.user.id);
  } catch {
    await interaction.editReply({
      content: "❌ Couldn't find your employee record in the system.",
    });
    return;
  }

  if (!user.isAdmin) {
    await interaction.editReply({
      content: "❌ Only admins can manage projects.",
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  try {
    switch (subcommand) {
      case EProjectSubcommands.LIST:
        await handleList(interaction);
        break;
      case EProjectSubcommands.CREATE:
        await handleCreate(interaction, user);
        break;
      case EProjectSubcommands.DELETE:
        await handleDelete(interaction);
        break;
      case EProjectSubcommands.ASSIGN:
        await handleAssign(interaction);
        break;
      case EProjectSubcommands.UNASSIGN:
        await handleUnassign(interaction);
        break;
      case EProjectSubcommands.MANAGER:
        await handleManager(interaction);
        break;
      default:
        await interaction.editReply({ content: "❌ Unknown subcommand." });
    }
  } catch (e) {
    console.error(`/project ${subcommand} error`, e);
    await interaction.editReply({
      content: "❌ Failed to run the project command.",
    });
  }
};

// Discord allows at most 25 autocomplete suggestions per response.
const MAX_AUTOCOMPLETE_CHOICES = 25;

/**
 * Serve autocomplete suggestions for `/project` string options so admins pick
 * from live data instead of typing:
 *  - `assign`/`delete` → existing project names
 *  - `unassign` → currently assigned channels (value is the channel ID)
 */
export const handleProjectAutocomplete = async (
  interaction: AutocompleteInteraction<CacheType>
) => {
  if (interaction.commandName !== EProjectCommands.PROJECT) return;

  // Only surface data in the admin channel, mirroring the command's own gate.
  if (interaction.channelId !== process.env.ADMIN_CHANNEL_ID) {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getFocused().trim().toLowerCase();

  try {
    const projects = await listProjects();

    if (interaction.options.getSubcommand() === EProjectSubcommands.UNASSIGN) {
      const choices = projects
        .flatMap((project) =>
          project.channels.map((channel) => ({
            name: `${channel.channelName} — ${project.name}`,
            value: channel.channelId,
          }))
        )
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, MAX_AUTOCOMPLETE_CHOICES);
      await interaction.respond(choices);
      return;
    }

    // assign / delete: suggest project names
    const choices = projects
      .filter((project) => project.name.toLowerCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((project) => ({ name: project.name, value: project.name }));
    await interaction.respond(choices);
  } catch (e) {
    console.error("/project autocomplete error", e);
    // Autocomplete can't error gracefully to the user; just return nothing.
    if (!interaction.responded) await interaction.respond([]);
  }
};
