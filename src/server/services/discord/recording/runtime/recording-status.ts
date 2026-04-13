import { ERecordingStage } from "../../discord.enums";

export function getStatusMessage(
  stage: ERecordingStage,
  sessionId?: string,
  error?: string,
): string {
  switch (stage) {
    case ERecordingStage.STARTED:
      return `🔴 **Recording started**\nSession: \`${sessionId}\`\n\nSpeak in the voice channel. Run \`/record\` again to stop it manually.`;
    case ERecordingStage.STOPPED:
      return `⏹️ **Recording stopped**\nSession: \`${sessionId}\`\n\nProcessing has started...`;
    case ERecordingStage.QUEUED:
      return `⏳ **Queued for processing**\nSession: \`${sessionId}\`\n\nWaiting for other recordings to finish processing...`;
    case ERecordingStage.PROCESSING:
      return `🔄 **Finalizing audio...**\nSession: \`${sessionId}\`\n\nMerging individual audio tracks...`;
    case ERecordingStage.TRANSCRIBING:
      return `📝 **Finalizing transcript...**\nSession: \`${sessionId}\`\n\nWaiting for remaining snippet transcriptions and building the transcript...`;
    case ERecordingStage.SUMMARIZING:
      return `📋 **Generating summary...**\nSession: \`${sessionId}\`\n\nCreating a summary from the transcript...`;
    case ERecordingStage.COMPLETE:
      return `✅ **Processing complete**\nSession: \`${sessionId}\`\n\nSummary posted and audio artifacts are ready.`;
    case ERecordingStage.ERROR:
      return `❌ **Error**\nSession: \`${sessionId}\`\n\n${error || "An unknown error occurred"}`;
    default:
      return "Unknown stage";
  }
}