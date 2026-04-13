import { adminProcedure, authProcedure, createTRPCRouter } from "../trpc";
import { object, parseAsync, string } from "valibot";
import type { StoredSessionSummary } from "../../services/discord/recording/processing/recording-processing.types";
import {
    assertAccessibleRecordingSession,
    deleteRecordingSession,
    filterAccessibleRecordingSessions,
    getFileContent,
    getRecordingSessionPath,
    listRecordingSessions,
    readSessionSummary,
} from "./recordings.shared";

const recordingSessionInputSchema = object({
    sessionId: string(),
});

function parseRecordingSessionInput(data: unknown) {
    return parseAsync(recordingSessionInputSchema, data);
}

export const recordingsRouter = createTRPCRouter({
    /**
     * List recording sessions.
     * Admins see all sessions; regular users see only sessions they participated in.
     */
    list: authProcedure.query(async (opts) => {
        const sessions = listRecordingSessions();
        return filterAccessibleRecordingSessions(
            sessions,
            opts.ctx.user.discordId,
            opts.ctx.isAdmin,
        );
    }),

    /**
     * Get transcript content
     */
    getTranscript: authProcedure
        .input(parseRecordingSessionInput)
        .query(async (opts) => {
            assertAccessibleRecordingSession(
                opts.input.sessionId,
                opts.ctx.user.discordId,
                opts.ctx.isAdmin,
            );
            return getFileContent(opts.input.sessionId, "transcript.txt");
        }),

    /**
     * Get summary content
     */
    getSummary: authProcedure
        .input(parseRecordingSessionInput)
        .query(async (opts) => {
            assertAccessibleRecordingSession(
                opts.input.sessionId,
                opts.ctx.user.discordId,
                opts.ctx.isAdmin,
            );
            const sessionPath = getRecordingSessionPath(opts.input.sessionId);
            const storedSummary = readSessionSummary(sessionPath);

            if (storedSummary) {
                return storedSummary;
            }

            const legacySummary = getFileContent(opts.input.sessionId, "summary.txt");
            if (!legacySummary) {
                return null;
            }

            return {
                version: 1,
                sessionId: opts.input.sessionId,
                title: "Recording Summary",
                summary: legacySummary,
                durationSeconds: 0,
                participantCount: 0,
                participants: [],
                generatedAt: new Date(0).toISOString(),
            } satisfies StoredSessionSummary;
        }),

    delete: adminProcedure
        .input(parseRecordingSessionInput)
        .mutation(async (opts) => {
            deleteRecordingSession(opts.input.sessionId);

            return {
                sessionId: opts.input.sessionId,
            };
        }),
});
