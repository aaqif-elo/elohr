import { UserRoleTypes } from "@prisma/client";
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import toast from "solid-toast";
import { AuthGuard } from "../../components/AuthGuard";
import {
  getStoredAuthToken,
  hasStoredAuthToken,
} from "../../lib/auth";
import { api } from "../../lib/api";
import {
  decodeRecordingRouteTitle,
  formatRecordingBytes,
  formatRecordingDate,
  formatRecordingDuration,
  getRecordingDownloadFileName,
  getRecordingDownloadUrl,
  getRecordingErrorMessage,
  getRecordingTitle,
  matchesRecordingTitle,
  type RecordingFile,
  type RecordingSession,
  type StoredSessionSummary,
} from "../../lib/recordings";
import { getUser } from "../../store";

interface DeleteRecordingDialogProps {
  session: RecordingSession | null;
  deleting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

async function getDownloadErrorMessage(response: Response): Promise<string> {
  try {
    const responseBody: unknown = await response.json();

    if (
      typeof responseBody === "object" &&
      responseBody !== null &&
      "error" in responseBody &&
      typeof responseBody.error === "string"
    ) {
      return responseBody.error;
    }
  } catch {
    return `Download failed with status ${response.status}.`;
  }

  return `Download failed with status ${response.status}.`;
}

function getPrimaryDownloadLabel(file: RecordingFile): string {
  if (file.type === "audio") {
    if (file.name.endsWith(".ogg")) {
      return "Merged Audio (.ogg)";
    }

    if (file.name.endsWith(".wav")) {
      return "Merged Audio (.wav)";
    }

    return "Merged Audio";
  }

  if (file.type === "summary") {
    return file.name.endsWith(".json") ? "Summary JSON" : "Summary Text";
  }

  return "Transcript";
}

function getUserAudioDownloadLabel(file: RecordingFile): string {
  const fileExtension = getRecordingDownloadFileName(file.name).split(".").pop();
  const extensionSuffix = fileExtension ? `, ${fileExtension.toUpperCase()}` : "";
  const userIdPrefix = file.userId ? `${file.userId.slice(0, 8)}...` : "Unknown";
  return `User ${userIdPrefix} (${formatRecordingBytes(file.size)}${extensionSuffix})`;
}

function DownloadButton(props: {
  sessionId: string;
  fileName: string;
  label: string;
}) {
  const [downloading, setDownloading] = createSignal(false);

  const downloadFile = async () => {
    if (downloading()) {
      return;
    }

    const authToken = getStoredAuthToken();
    if (!authToken) {
      toast.error("Authentication required to download recordings.");
      return;
    }

    setDownloading(true);

    try {
      const response = await fetch(getRecordingDownloadUrl(props.sessionId, props.fileName), {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(await getDownloadErrorMessage(response));
      }

      const fileBlob = await response.blob();
      const objectUrl = window.URL.createObjectURL(fileBlob);
      const downloadLink = document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download = getRecordingDownloadFileName(props.fileName);
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast.error(getRecordingErrorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={downloadFile}
      class="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-900"
      disabled={downloading()}
    >
      {downloading() ? "Downloading..." : props.label}
    </button>
  );
}

function DeleteRecordingDialog(props: DeleteRecordingDialogProps) {
  return (
    <Show when={props.session}>
      {(session) => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div class="w-full max-w-md rounded-lg border border-red-900 bg-gray-900 p-6 shadow-xl">
            <h2 class="text-xl font-semibold text-white">Delete recording?</h2>
            <p class="mt-3 text-sm leading-6 text-gray-300">
              This will permanently remove
              <span class="font-semibold text-white"> {getRecordingTitle(session())}</span>
              and all associated files from disk.
            </p>
            <p class="mt-2 text-sm text-gray-400">
              Created {formatRecordingDate(session().createdAt)}. This action cannot be undone.
            </p>

            <Show when={props.errorMessage}>
              <div class="mt-4 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                {props.errorMessage}
              </div>
            </Show>

            <div class="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={props.onCancel}
                class="rounded-md px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={props.deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={props.onConfirm}
                class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-900"
                disabled={props.deleting}
              >
                {props.deleting ? "Deleting..." : "Delete recording"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

function RecordingDetailsContent() {
  const navigate = useNavigate();
  const params = useParams<{ title: string }>();
  const [searchParams] = useSearchParams();
  const [clientReady, setClientReady] = createSignal(false);
  const [sessionPendingDeletion, setSessionPendingDeletion] = createSignal<RecordingSession | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = createSignal<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = createSignal<string | null>(null);
  const recordingsEnabled = () => {
    if (!clientReady() || !hasStoredAuthToken()) {
      return null;
    }

    return "enabled";
  };

  onMount(() => {
    setClientReady(true);
  });

  const [sessions] = createResource(recordingsEnabled, async () => {
    return api.recordings.list.query();
  });

  const routeTitle = () => decodeRecordingRouteTitle(params.title);
  const routeSessionId = () => {
    return typeof searchParams.session === "string" ? searchParams.session : null;
  };

  const currentSession = () => {
    const availableSessions = sessions();
    if (!availableSessions) {
      return null;
    }

    const sessionId = routeSessionId();
    if (sessionId) {
      return availableSessions.find((session) => session.id === sessionId) ?? null;
    }

    return availableSessions.find((session) => matchesRecordingTitle(session, routeTitle())) ?? null;
  };

  const [transcript] = createResource(
    () => currentSession()?.id ?? null,
    async (sessionId) => {
      if (!sessionId) {
        return null;
      }

      return api.recordings.getTranscript.query({ sessionId });
    },
  );
  const [summary] = createResource<StoredSessionSummary | null, string | null>(
    () => currentSession()?.id ?? null,
    async (sessionId) => {
      if (!sessionId) {
        return null;
      }

      return api.recordings.getSummary.query({ sessionId });
    },
  );

  const canDeleteRecordings = () => getUser()?.roles.includes(UserRoleTypes.ADMIN) ?? false;
  const sessionDownloadFiles = () => currentSession()?.files.filter((file) => file.type !== "user_audio") ?? [];
  const userAudioFiles = () => currentSession()?.files.filter((file) => file.type === "user_audio") ?? [];

  const closeDeleteDialog = () => {
    if (deletingSessionId()) {
      return;
    }

    setDeleteErrorMessage(null);
    setSessionPendingDeletion(null);
  };

  const confirmDelete = async () => {
    const session = sessionPendingDeletion();
    if (!session) {
      return;
    }

    setDeleteErrorMessage(null);
    setDeletingSessionId(session.id);

    try {
      await api.recordings.delete.mutate({ sessionId: session.id });
      toast.success("Recording deleted successfully.");
      navigate("/recordings");
    } catch (error) {
      const errorMessage = getRecordingErrorMessage(error);
      setDeleteErrorMessage(errorMessage);
      toast.error(errorMessage);
    } finally {
      setDeletingSessionId(null);
    }
  };

  return (
    <main class="min-h-screen bg-gray-900 p-6">
      <div class="mx-auto max-w-5xl space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/recordings")}
            class="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800"
          >
            Back to recordings
          </button>

          <Show when={canDeleteRecordings() && currentSession()}>
            <button
              type="button"
              onClick={() => setSessionPendingDeletion(currentSession())}
              class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-900"
              disabled={Boolean(deletingSessionId())}
            >
              Delete recording
            </button>
          </Show>
        </div>

        <Show
          when={clientReady()}
          fallback={<div class="py-8 text-center text-gray-400">Loading recording...</div>}
        >
          <Show
            when={!sessions.error}
            fallback={
              <div class="rounded-lg border border-red-900 bg-red-950/40 py-8 text-center text-red-300">
                {getRecordingErrorMessage(sessions.error)}
              </div>
            }
          >
            <Show
              when={!sessions.loading}
              fallback={<div class="py-8 text-center text-gray-400">Loading recording...</div>}
            >
              <Show
                when={currentSession()}
                fallback={
                  <div class="rounded-xl border border-gray-800 bg-gray-850 p-8 text-center text-gray-300">
                    Recording not found.
                  </div>
                }
              >
                {(session) => (
                  <>
                    <section class="rounded-2xl border border-gray-800 bg-gray-800/80 p-6">
                      <div class="flex flex-wrap items-start justify-between gap-4">
                        <div class="min-w-0 flex-1">
                          <p class="text-sm uppercase tracking-[0.22em] text-indigo-300">Recording</p>
                          <h1 class="mt-2 text-3xl font-semibold text-white">
                            {getRecordingTitle(session())}
                          </h1>

                          <Show when={session().channelName || session().textChannelName}>
                            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                              <Show when={session().channelName}>
                                <p class="text-indigo-300">Voice: {session().channelName}</p>
                              </Show>
                              <Show when={session().textChannelName}>
                                <p class="text-sky-300">Text: #{session().textChannelName}</p>
                              </Show>
                            </div>
                          </Show>
                        </div>

                        <div class="flex flex-wrap gap-2">
                          <Show when={session().hasMerged}>
                            <span class="rounded bg-green-600 px-2 py-0.5 text-xs text-white">Merged Audio</span>
                          </Show>
                          <Show when={session().hasTranscript}>
                            <span class="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">Transcript</span>
                          </Show>
                          <Show when={session().hasSummary}>
                            <span class="rounded bg-purple-600 px-2 py-0.5 text-xs text-white">Summary</span>
                          </Show>
                        </div>
                      </div>

                      <div class="mt-6 grid gap-4 text-sm text-gray-300 md:grid-cols-2 xl:grid-cols-4">
                        <div class="rounded-lg bg-gray-900/70 p-4">
                          <p class="text-xs uppercase tracking-[0.18em] text-gray-500">Created</p>
                          <p class="mt-2 text-white">{formatRecordingDate(session().createdAt)}</p>
                        </div>
                        <div class="rounded-lg bg-gray-900/70 p-4">
                          <p class="text-xs uppercase tracking-[0.18em] text-gray-500">Duration</p>
                          <p class="mt-2 text-white">{formatRecordingDuration(session().durationSeconds)}</p>
                        </div>
                        <div class="rounded-lg bg-gray-900/70 p-4">
                          <p class="text-xs uppercase tracking-[0.18em] text-gray-500">Participants</p>
                          <p class="mt-2 text-white">{session().userCount}</p>
                        </div>
                        <div class="rounded-lg bg-gray-900/70 p-4">
                          <p class="text-xs uppercase tracking-[0.18em] text-gray-500">Session ID</p>
                          <p class="mt-2 break-all text-white">{session().id}</p>
                        </div>
                      </div>

                      <Show when={session().participants.length > 0}>
                        <div class="mt-6 space-y-3">
                          <h2 class="text-lg font-medium text-white">Participants</h2>
                          <ul class="flex flex-wrap gap-2">
                            <For each={session().participants}>
                              {(participant) => (
                                <li class="rounded-full bg-gray-700 px-3 py-1 text-sm text-gray-100">
                                  {participant.userName}
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      </Show>
                    </section>

                    <Show when={sessionDownloadFiles().length > 0 || userAudioFiles().length > 0}>
                      <section class="rounded-2xl border border-gray-800 bg-gray-800/80 p-6">
                        <div class="space-y-4">
                          <div>
                            <h2 class="text-lg font-medium text-white">Downloads</h2>
                            <p class="mt-1 text-sm text-gray-400">
                              Download the merged audio, transcript, summary, and per-user recordings.
                            </p>
                          </div>

                          <Show when={sessionDownloadFiles().length > 0}>
                            <div class="flex flex-wrap gap-2">
                              <For each={sessionDownloadFiles()}>
                                {(file) => (
                                  <DownloadButton
                                    sessionId={session().id}
                                    fileName={file.name}
                                    label={getPrimaryDownloadLabel(file)}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>

                          <Show when={userAudioFiles().length > 0}>
                            <div class="space-y-2">
                              <h3 class="text-sm font-medium text-gray-200">Individual recordings</h3>
                              <div class="flex flex-wrap gap-2">
                                <For each={userAudioFiles()}>
                                  {(file) => (
                                    <DownloadButton
                                      sessionId={session().id}
                                      fileName={file.name}
                                      label={getUserAudioDownloadLabel(file)}
                                    />
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </section>
                    </Show>

                    <Show when={summary.loading}>
                      <div class="rounded-2xl border border-gray-800 bg-gray-800/80 p-6 text-sm text-gray-400">
                        Loading summary...
                      </div>
                    </Show>

                    <Show when={summary()}>
                      <section class="rounded-2xl border border-gray-800 bg-gray-800/80 p-6">
                        <div class="space-y-4">
                          <div>
                            <h2 class="text-lg font-medium text-white">
                              Summary{summary()?.title ? `: ${summary()?.title}` : ""}
                            </h2>
                            <Show when={summary()?.channelName || summary()?.textChannelName}>
                              <p class="mt-1 text-xs text-gray-400">
                                {summary()?.channelName ? `Voice: ${summary()?.channelName}` : ""}
                                {summary()?.channelName && summary()?.textChannelName ? " | " : ""}
                                {summary()?.textChannelName ? `Text: #${summary()?.textChannelName}` : ""}
                              </p>
                            </Show>
                          </div>

                          <div class="prose max-w-none rounded-lg bg-gray-900 p-4 text-sm text-gray-300 prose-invert">
                            {summary()?.summary}
                          </div>
                        </div>
                      </section>
                    </Show>

                    <Show when={transcript.loading}>
                      <div class="rounded-2xl border border-gray-800 bg-gray-800/80 p-6 text-sm text-gray-400">
                        Loading transcript...
                      </div>
                    </Show>

                    <Show when={transcript()}>
                      <section class="rounded-2xl border border-gray-800 bg-gray-800/80 p-6">
                        <div class="space-y-4">
                          <h2 class="text-lg font-medium text-white">Transcript</h2>
                          <pre class="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-900 p-4 text-sm text-gray-300">
                            {transcript()}
                          </pre>
                        </div>
                      </section>
                    </Show>
                  </>
                )}
              </Show>
            </Show>
          </Show>
        </Show>

        <DeleteRecordingDialog
          session={sessionPendingDeletion()}
          deleting={deletingSessionId() === sessionPendingDeletion()?.id}
          errorMessage={deleteErrorMessage()}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
        />
      </div>
    </main>
  );
}

export default function RecordingDetailsPage() {
  return (
    <AuthGuard>
      <RecordingDetailsContent />
    </AuthGuard>
  );
}