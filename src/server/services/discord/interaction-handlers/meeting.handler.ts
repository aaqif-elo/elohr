import {
  CacheType,
  ChatInputCommandInteraction,
  GuildMember,
  Role,
  User,
} from "discord.js";
import {
  EMeetingCommands,
  MEETING_PARTICIPANT_OPTION_NAMES,
} from "../discord.enums";
import {
  Client,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  getGroupWeekdayAvailabilityWindows,
  getUserByDiscordId,
  createMeeting,
  sendMeetingInviteDM,
  getWeekdayAvailabilityHeatmap,
} from "../../../db";
import { discordTimestamp } from "../../../utils/discord";

// Utility to convert minutes offset to HH:MM
function toHHMM(mins: number) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = (mins % 60).toString().padStart(2, "0");
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${period}`;
}

export const handleMeetingCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  if (interaction.commandName !== EMeetingCommands.MEETING) return;

  // Ensure in a guild text channel
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: "Ephemeral",
    });
    return;
  }

  // Enforce expected guild if configured
  const expectedGuildId = process.env.DISCORD_SERVER_ID;
  if (expectedGuildId && interaction.guildId !== expectedGuildId) {
    await interaction.reply({
      content: "❌ This command can't be used in this server.",
      flags: "Ephemeral",
    });
    return;
  }

  await interaction.deferReply({ flags: "Ephemeral" });

  const mentionableOptionNames = MEETING_PARTICIPANT_OPTION_NAMES;
  const selectedMentionables: (Role | GuildMember | User)[] = [];
  for (const optionName of mentionableOptionNames) {
    const mentionable = interaction.options.getMentionable(
      optionName,
      optionName === mentionableOptionNames[0]
    );
    if (
      mentionable &&
      (mentionable instanceof Role ||
        mentionable instanceof GuildMember ||
        mentionable instanceof User)
    ) {
      selectedMentionables.push(mentionable as Role | GuildMember | User);
    }
  }
  const agenda = interaction.options.getString("agenda", true);
  const dateInput = interaction.options.getString("date") ?? undefined; // YYYY-MM-DD
  const duration = interaction.options.getInteger("duration") ?? 30;
  const showHeatmap = interaction.options.getBoolean("heatmap") ?? false;

  // Resolve participants to Discord user IDs via selected mentionables
  const participantDiscordIds = new Set<string>();
  for (const mentionable of selectedMentionables) {
    if (mentionable instanceof Role) {
      for (const id of mentionable.members.keys())
        participantDiscordIds.add(id);
      continue;
    }
    if (mentionable instanceof GuildMember) {
      participantDiscordIds.add(mentionable.id);
      continue;
    }
    // Discord.js User
    if ("id" in mentionable) {
      participantDiscordIds.add(mentionable.id);
    }
  }
  let participantDiscordIdList = Array.from(participantDiscordIds);

  // Include the initiator by default
  if (!participantDiscordIdList.includes(interaction.user.id)) {
    participantDiscordIdList.push(interaction.user.id);
  }

  // Map discord ids -> app users while preserving association
  const resolvedParticipants = await Promise.all(
    participantDiscordIdList.map(async (discordId: string) => {
      try {
        const user = await getUserByDiscordId(discordId);
        return user ? { userId: user.id, discordId } : null;
      } catch {
        return null;
      }
    })
  );
  const participantPairs = resolvedParticipants.filter(
    (p): p is { userId: string; discordId: string } => !!p
  );
  const participantUserIds = participantPairs.map((p) => p.userId);

  if (participantUserIds.length < 2) {
    await interaction.editReply({
      content: "❌ Not enough valid participants found.",
    });
    return;
  }

  // Suggest windows over last 30 days, with optional time filter if scheduling today
  const now = new Date();
  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  let scheduleDate: Date;
  if (!dateInput) {
    scheduleDate = new Date(todayMidnight);
  } else {
    const match = /^\d{4}-\d{2}-\d{2}$/.test(dateInput);
    if (!match) {
      await interaction.editReply({
        content: "❌ Invalid date. Use YYYY-MM-DD.",
      });
      return;
    }
    const [y, m, d] = dateInput.split("-").map((n) => parseInt(n, 10));
    scheduleDate = new Date(y, m - 1, d);
  }

  if (scheduleDate < todayMidnight) {
    await interaction.editReply({ content: "❌ Date cannot be in the past." });
    return;
  }

  const requiredHours = duration / 60;
  const isToday = scheduleDate.getTime() === todayMidnight.getTime();
  const minStartMinutes = isToday
    ? now.getHours() * 60 + now.getMinutes()
    : undefined;

  // Try with all participants first
  let availabilityWindows = await getGroupWeekdayAvailabilityWindows(
    participantUserIds,
    requiredHours,
    30,
    { minStartMinutes }
  );
  // If no windows found, retry without the creator's heatmap influence
  if (!availabilityWindows.length) {
    const creator = await getUserByDiscordId(interaction.user.id);
    const othersOnly = participantUserIds.filter((id) => id !== creator?.id);
    if (othersOnly.length >= 1) {
      availabilityWindows = await getGroupWeekdayAvailabilityWindows(
        othersOnly,
        requiredHours,
        30,
        { minStartMinutes }
      );
    }
  }
  if (!availabilityWindows.length) {
    await interaction.editReply({
      content:
        "❌ Couldn't find any good time windows. Try a shorter duration or different group.",
    });
    return;
  }

  // Show top up to 3 windows for selection, include confidence in label
  type TimeSuggestion = {
    startMinutes: number;
    endMinutes: number;
    avgConfidence: number;
  };
  const timeSuggestions: TimeSuggestion[] = availabilityWindows
    .slice(0, 3)
    .map(
      (w: {
        startMinutes: number;
        endMinutes: number;
        avgConfidence: number;
      }) => ({
        startMinutes: w.startMinutes,
        endMinutes: w.endMinutes,
        avgConfidence: w.avgConfidence,
      })
    );

  const timeButtons = timeSuggestions.map((suggestion, index) =>
    new ButtonBuilder()
      .setCustomId(`mtg-pick-${index}`)
      .setLabel(
        `${toHHMM(suggestion.startMinutes)}–${toHHMM(
          suggestion.endMinutes
        )} (${Math.round(suggestion.avgConfidence * 100)}%)`
      )
      .setStyle(ButtonStyle.Primary)
  );

  // Manual custom time entry button
  const customButton = new ButtonBuilder()
    .setCustomId("mtg-custom")
    .setLabel("Pick custom time…")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...timeButtons,
    customButton
  );

  // Optional heatmap visualization
  let heatmapText = "";
  if (showHeatmap) {
    try {
      const heatmaps = await Promise.all(
        participantUserIds.map((uid) =>
          getWeekdayAvailabilityHeatmap(uid, 30, { slotMinutes: 60 })
        )
      );
      // Build a simple ASCII heatmap per hour 0..23 using avg confidence across users
      const hours = Array.from({ length: 24 }, (_, h) => h * 60);
      const rows = hours.map((m) => {
        const vals = heatmaps.map((hm) => {
          const slot = hm.heatmap.find((s) => s.startMinutes === m);
          return slot ? slot.confidence : 0;
        });
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        const blocks = "░▒▓"; // 3-level shading
        const level = avg >= 0.66 ? 2 : avg >= 0.33 ? 1 : 0;
        const label = `${String(Math.floor(m / 60)).padStart(2, "0")}:00`;
        return `${label} ${blocks[level].repeat(10)} ${Math.round(avg * 100)}%`;
      });
      heatmapText = "\n\nAvailability heatmap (hourly avg):\n" + rows.join("\n");
    } catch {}
  }

  await interaction.editReply({
    content: `Select a meeting time${
      dateInput ? ` for ${dateInput}` : " (today/tomorrow weekday)"
    }:${heatmapText}`,
  components: [row],
  });

  try {
    const response = await interaction.fetchReply();
    const selection = await response.awaitMessageComponent({
      time: 60_000,
      filter: (i) => i.user.id === interaction.user.id,
    });
  let startTime: Date | null = null;
  let fromModal = false;
    const idParts = selection.customId.split("-");
  if (selection.customId === "mtg-custom") {
      // Show modal to collect HH:MM input
      const modal = new ModalBuilder()
        .setCustomId("mtg-custom-modal")
        .setTitle("Enter meeting start time");
      const timeInput = new TextInputBuilder()
        .setCustomId("time")
        .setLabel("Time (HH:MM 24h)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("14:30");
      const modalRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
        timeInput
      );
      modal.addComponents(modalRow);
      await selection.showModal(modal);

      // Wait for modal submission from the same user
      const submitted = await selection.awaitModalSubmit({
        time: 60_000,
        filter: (i) => i.user.id === interaction.user.id && i.customId === "mtg-custom-modal",
      });
      const timeValue = submitted.fields.getTextInputValue("time").trim();
      const match = timeValue.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!match) {
        await submitted.reply({
          content:
            "❌ Invalid time. Use 24h format HH:MM (e.g., 09:00, 14:30).",
            flags: "Ephemeral",
        });
        return;
      }
      const hh = parseInt(match[1], 10);
      const mm = parseInt(match[2], 10);
      const d = new Date(scheduleDate);
      d.setSeconds(0, 0);
      d.setHours(hh, mm, 0, 0);
      if (isToday && d <= now) d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  startTime = d;
  fromModal = true;
  // Acknowledge modal submission to avoid 'This interaction failed'
  await submitted.deferUpdate();
    } else if (selection.customId.startsWith("mtg-free-")) {
      const m = Number(idParts[idParts.length - 1]);
      const d = new Date(scheduleDate);
      d.setSeconds(0, 0);
      d.setHours(Math.floor(m / 60), m % 60, 0, 0);
      if (isToday && d <= now) d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      startTime = d;
    } else {
      const selectedIndex = Number(idParts.pop());
      const selectedWindow = timeSuggestions[selectedIndex];

      // Materialize to the selected date at that time; if today and passed, bump to next weekday
      const materializeToDateAtMinutes = (): Date => {
        const d = new Date(scheduleDate);
        const hh = Math.floor(selectedWindow.startMinutes / 60);
        const mm = selectedWindow.startMinutes % 60;
        d.setSeconds(0, 0);
        d.setHours(hh, mm, 0, 0);
        if (isToday && d <= now) d.setDate(d.getDate() + 1);
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        return d;
      };
      startTime = materializeToDateAtMinutes();
    }

    const endTime = new Date(startTime!.getTime() + duration * 60_000);

    // Step 3: confirmation before creating the meeting
    const confirmBtn = new ButtonBuilder()
      .setCustomId("mtg-confirm")
      .setLabel("OK")
      .setStyle(ButtonStyle.Success);
    const cancelBtn = new ButtonBuilder()
      .setCustomId("mtg-cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger);
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmBtn,
      cancelBtn
    );

    const participantMentions = participantPairs
      .map((p: { discordId: string }) => `<@${p.discordId}>`)
      .join(" ");
    const whenFancy = `${discordTimestamp(startTime!, "F")} (${duration} mins, ${discordTimestamp(startTime!, "R")})`;
    if (fromModal) {
      await interaction.editReply({
        content: `Review meeting details:\n• Agenda: ${agenda}\n• When: ${whenFancy}\n• Participants: ${participantMentions}\n\nConfirm?`,
        components: [confirmRow],
      });
    } else {
      await selection.update({
        content: `Review meeting details:\n• Agenda: ${agenda}\n• When: ${whenFancy}\n• Participants: ${participantMentions}\n\nConfirm?`,
        components: [confirmRow],
      });
    }

  const confirmResponse = await response.awaitMessageComponent({
      time: 60_000,
      filter: (i) => i.user.id === interaction.user.id,
    });
    if (confirmResponse.customId === "mtg-cancel") {
      await confirmResponse.update({
        content: "❎ Meeting creation canceled.",
        components: [],
      });
      return;
    }

    // Proceed to create meeting
    const creator = await getUserByDiscordId(interaction.user.id);
    const meeting = await createMeeting({
      title: agenda,
      creatorUserId: creator.id,
      channelId: interaction.channelId,
      startTime: startTime!,
      endTime,
      durationMins: duration,
      requests: participantPairs.map(
        (p: { userId: string; discordId: string }) => ({
          userId: p.userId,
          requestSentAt: new Date(),
          requestAcceptedAt:
            p.discordId === interaction.user.id ? new Date() : null,
          attended: false,
          rejectedAt: null,
        })
      ),
      reminderSentAt: null,
    });

    await confirmResponse.update({
      content: `✅ Meeting scheduled for ${discordTimestamp(startTime!, "F")} (${duration} mins, ${discordTimestamp(startTime!, "R")}). Agenda: ${agenda}. Invitations sent.`,
      components: [],
    });

    // Send DMs
    const client = interaction.client as unknown as Client<boolean>;
    await Promise.all(
      participantPairs
        .filter(
          (p: { userId: string; discordId: string }) =>
            p.discordId !== interaction.user.id
        )
        .map((p: { userId: string; discordId: string }) =>
          sendMeetingInviteDM(client, p.discordId, meeting)
        )
    );

    // Reminder will be handled by cron-based scheduler; no local timers here
  } catch (e) {
    await interaction.editReply({
      content: "⏱️ Time out. Please run the command again.",
    });
  }
};
