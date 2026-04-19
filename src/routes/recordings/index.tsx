import { useNavigate } from "@solidjs/router";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import { AuthGuard } from "../../components/AuthGuard";
import { hasStoredAuthToken } from "../../lib/auth";
import { api } from "../../lib/api";
import {
  formatRecordingDate,
  formatRecordingDuration,
  getRecordingDetailsPath,
  getRecordingErrorMessage,
  getRecordingTitle,
  type RecordingSession,
} from "../../lib/recordings";

function RecordingCard(props: {
  session: RecordingSession;
  onOpen: (session: RecordingSession) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.session)}
      class="w-full rounded-lg bg-gray-800 p-4 text-left transition hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-lg font-semibold text-white">
            {getRecordingTitle(props.session)}
          </h2>

          <Show when={props.session.channelName || props.session.textChannelName}>
            <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              <Show when={props.session.channelName}>
                <p class="text-indigo-300">Voice: {props.session.channelName}</p>
              </Show>
              <Show when={props.session.textChannelName}>
                <p class="text-sky-300">Text: #{props.session.textChannelName}</p>
              </Show>
            </div>
          </Show>

          <p class="mt-1 text-sm text-gray-400">{formatRecordingDate(props.session.createdAt)}</p>

          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-300">
            <span>{props.session.userCount} participant(s)</span>
            <span>{formatRecordingDuration(props.session.durationSeconds)}</span>
          </div>
        </div>

        <span class="rounded-full bg-gray-700 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-gray-200">
          Open
        </span>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <Show when={props.session.hasMerged}>
          <span class="rounded bg-green-600 px-2 py-0.5 text-xs text-white">Merged Audio</span>
        </Show>
        <Show when={props.session.hasTranscript}>
          <span class="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">Transcript</span>
        </Show>
        <Show when={props.session.hasSummary}>
          <span class="rounded bg-purple-600 px-2 py-0.5 text-xs text-white">Summary</span>
        </Show>
      </div>
    </button>
  );
}

function RecordingsListContent() {
  const navigate = useNavigate();
  const [clientReady, setClientReady] = createSignal(false);
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

  const openRecording = (session: RecordingSession) => {
    navigate(getRecordingDetailsPath(session));
  };

  return (
    <main class="min-h-screen bg-gray-900 p-6">
      <div class="mx-auto max-w-4xl">
        <h1 class="mb-6 text-2xl font-bold text-white">Voice Recordings</h1>

        <Show
          when={clientReady()}
          fallback={<div class="py-8 text-center text-gray-400">Loading recordings...</div>}
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
              fallback={<div class="py-8 text-center text-gray-400">Loading recordings...</div>}
            >
              <Show
                when={sessions()?.length}
                fallback={
                  <div class="rounded-lg bg-gray-800 py-8 text-center text-gray-400">
                    No recordings found. Use <code>/record</code> in Discord to start one.
                  </div>
                }
              >
                <div class="space-y-4">
                  <For each={sessions()}>
                    {(session) => <RecordingCard session={session} onOpen={openRecording} />}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </main>
  );
}

export default function RecordingsIndex() {
  return (
    <AuthGuard>
      <RecordingsListContent />
    </AuthGuard>
  );
}