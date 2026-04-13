import { GoogleGenAI, MediaModality } from "@google/genai";
import type {
  GenerateContentResponseUsageMetadata,
  ModalityTokenCount,
} from "@google/genai";
import { appendFileSync, readFileSync } from "fs";
import { basename, join, relative } from "path";
import type {
  GeneratedSummary,
  SummaryPromptContext,
} from "./recording-processing.types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const ELEVENLABS_API_KEY =
  process.env.ELEVEN_LABS_API_KEY?.trim() ||
  process.env.ELEVENLABS_API_KEY?.trim();
const ELEVENLABS_SPEECH_TO_TEXT_URL =
  "https://api.elevenlabs.io/v1/speech-to-text";
const ELEVENLABS_TRANSCRIPTION_MODEL = "scribe_v2";
const GEMINI_USAGE_LOG_FILE_NAME = "gemini-usage.jsonl";
const GEMINI_PRICING_SOURCE =
  "Gemini Developer API paid-tier list price for gemini-3.1-flash-lite-preview (ai.google.dev/gemini-api/docs/pricing, updated 2026-04-09 UTC)";
const SUMMARY_DISCLAIMER =
  "_Disclaimer: This summary is AI-generated and may not be 100% accurate._";
const DEFAULT_SUMMARY_CONTEXT = [
  'We are a software development agency called "ELO".',
  "We have clients for whom we do projects, and we have a project channel for each project.",
  "The project channel name is usually the name of the project but not always.",
  "We speak in English and Bangla and use a lot of technical terms in our speech.",
].join("\n");
const SUMMARY_DEPLOYMENT_CONTEXT =
  process.env.SUMMARY_DEPLOYMENT_CONTEXT?.trim() ||
  process.env.TRANSCRIPTION_DEPLOYMENT_CONTEXT?.trim() ||
  DEFAULT_SUMMARY_CONTEXT;

/** Maximum requests per minute to the Gemini API. */
const GEMINI_RPM_LIMIT = parseInt(process.env.GEMINI_RPM_LIMIT ?? "10", 10);
const MIN_REQUEST_INTERVAL_MS = Math.ceil(60_000 / GEMINI_RPM_LIMIT);
const MAX_RETRIES = 3;

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function getRetryBackoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 5_000, 60_000);
}

type GeminiRequestContents = Parameters<
  GoogleGenAI["models"]["generateContent"]
>[0]["contents"];
type GeminiUsageOperation = "meeting_summary" | "snippet_transcription";
type GeminiPrimaryInputModality = "text" | "audio";
type UsageModality =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "unknown";
type UsageTokenBreakdown = Partial<Record<UsageModality, number>>;

interface GeminiUsageLogContext {
  sessionPath: string;
  operation: GeminiUsageOperation;
  primaryInputModality: GeminiPrimaryInputModality;
  sourcePath?: string;
}

const USAGE_MODALITIES: UsageModality[] = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "unknown",
];

function parseUsdRate(envValue: string | undefined, fallback: number): number {
  const parsedValue = Number.parseFloat(envValue ?? "");
  return Number.isFinite(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback;
}

const GEMINI_PRICING = {
  inputUsdPerMillion: {
    text: parseUsdRate(process.env.GEMINI_TEXT_INPUT_USD_PER_MILLION, 0.25),
    audio: parseUsdRate(process.env.GEMINI_AUDIO_INPUT_USD_PER_MILLION, 0.5),
  },
  cachedInputUsdPerMillion: {
    text: parseUsdRate(process.env.GEMINI_TEXT_CACHE_USD_PER_MILLION, 0.025),
    audio: parseUsdRate(process.env.GEMINI_AUDIO_CACHE_USD_PER_MILLION, 0.05),
  },
  outputUsdPerMillion: parseUsdRate(
    process.env.GEMINI_OUTPUT_USD_PER_MILLION,
    1.5,
  ),
};

let lastRequestTimestamp = 0;

/** Enforces minimum delay between Gemini API calls. */
async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestTimestamp;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await delay(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestTimestamp = Date.now();
}

/** Detects MIME type from file extension. */
function getMimeType(filePath: string): string {
  const extension = filePath.toLowerCase().split(".").pop();
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "ogg") return "audio/ogg";
  if (extension === "m4a") return "audio/m4a";
  return "audio/wav";
}

function getObjectStringProperty(
  value: unknown,
  propertyName: string,
): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const propertyValue = Reflect.get(value, propertyName);
  return typeof propertyValue === "string" ? propertyValue : null;
}

async function readResponseErrorMessage(response: Response): Promise<string> {
  const responseText = await response.text();
  if (!responseText.trim()) {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const responseBody: unknown = JSON.parse(responseText);
    return (
      getObjectStringProperty(responseBody, "detail") ||
      getObjectStringProperty(responseBody, "message") ||
      responseText
    );
  } catch {
    return responseText;
  }
}

function extractElevenLabsTranscriptionText(responseBody: unknown): string {
  const text = getObjectStringProperty(responseBody, "text");
  if (!text) {
    throw new Error("ElevenLabs response did not include transcript text");
  }

  return text;
}

function getElevenLabsApiKey(): string {
  if (!ELEVENLABS_API_KEY) {
    throw new Error(
      "ELEVEN_LABS_API_KEY or ELEVENLABS_API_KEY is not configured",
    );
  }

  return ELEVENLABS_API_KEY;
}

function createElevenLabsFormData(
  audioBuffer: Buffer,
  wavPath: string,
): FormData {
  const formData = new FormData();
  formData.append("model_id", ELEVENLABS_TRANSCRIPTION_MODEL);
  formData.append(
    "file",
    new Blob([Uint8Array.from(audioBuffer)], { type: getMimeType(wavPath) }),
    basename(wavPath),
  );
  formData.append("num_speakers", "1");
  formData.append("diarize", "false");
  formData.append("tag_audio_events", "false");
  formData.append("timestamps_granularity", "none");
  return formData;
}

function normalizeParticipantNames(participantNames: string[]): string[] {
  return [
    ...new Set(participantNames.map((name) => name.trim()).filter(Boolean)),
  ];
}

function getUsageModality(modality?: MediaModality): UsageModality {
  switch (modality) {
    case MediaModality.TEXT:
      return "text";
    case MediaModality.IMAGE:
      return "image";
    case MediaModality.VIDEO:
      return "video";
    case MediaModality.AUDIO:
      return "audio";
    case MediaModality.DOCUMENT:
      return "document";
    default:
      return "unknown";
  }
}

function toUsageTokenBreakdown(
  details?: ModalityTokenCount[],
): UsageTokenBreakdown {
  const breakdown: UsageTokenBreakdown = {};

  for (const detail of details ?? []) {
    const tokenCount = detail.tokenCount ?? 0;
    if (tokenCount <= 0) {
      continue;
    }

    const modality = getUsageModality(detail.modality);
    breakdown[modality] = (breakdown[modality] ?? 0) + tokenCount;
  }

  return breakdown;
}

function sumBreakdownTokens(breakdown: UsageTokenBreakdown): number {
  let total = 0;

  for (const modality of USAGE_MODALITIES) {
    total += breakdown[modality] ?? 0;
  }

  return total;
}

function addBreakdownTokens(
  breakdown: UsageTokenBreakdown,
  modality: UsageModality,
  tokenCount: number,
): UsageTokenBreakdown {
  if (tokenCount <= 0) {
    return breakdown;
  }

  const nextBreakdown: UsageTokenBreakdown = { ...breakdown };
  nextBreakdown[modality] = (nextBreakdown[modality] ?? 0) + tokenCount;
  return nextBreakdown;
}

function subtractBreakdowns(
  minuend: UsageTokenBreakdown,
  subtrahend: UsageTokenBreakdown,
): UsageTokenBreakdown {
  const breakdown: UsageTokenBreakdown = {};

  for (const modality of USAGE_MODALITIES) {
    const difference = (minuend[modality] ?? 0) - (subtrahend[modality] ?? 0);
    if (difference > 0) {
      breakdown[modality] = difference;
    }
  }

  return breakdown;
}

function getInputUsdPerMillion(modality: UsageModality): number {
  return modality === "audio"
    ? GEMINI_PRICING.inputUsdPerMillion.audio
    : GEMINI_PRICING.inputUsdPerMillion.text;
}

function getCachedInputUsdPerMillion(modality: UsageModality): number {
  return modality === "audio"
    ? GEMINI_PRICING.cachedInputUsdPerMillion.audio
    : GEMINI_PRICING.cachedInputUsdPerMillion.text;
}

function tokensToUsd(tokenCount: number, usdPerMillion: number): number {
  return (tokenCount / 1_000_000) * usdPerMillion;
}

function estimateBreakdownUsd(
  breakdown: UsageTokenBreakdown,
  resolveUsdPerMillion: (modality: UsageModality) => number,
): number {
  let totalUsd = 0;

  for (const modality of USAGE_MODALITIES) {
    totalUsd += tokensToUsd(
      breakdown[modality] ?? 0,
      resolveUsdPerMillion(modality),
    );
  }

  return totalUsd;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function normalizeLogPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function estimateGeminiUsageCost(
  usageMetadata: GenerateContentResponseUsageMetadata | undefined,
  loggingContext: GeminiUsageLogContext,
): {
  inputTokensByModality: UsageTokenBreakdown;
  cachedTokensByModality: UsageTokenBreakdown;
  toolUseTokensByModality: UsageTokenBreakdown;
  inputUsd: number;
  cachedContentUsd: number;
  outputUsd: number;
  totalUsd: number;
  costEstimateNotes: string[];
} {
  const costEstimateNotes: string[] = [];
  const promptTokensByModality = toUsageTokenBreakdown(
    usageMetadata?.promptTokensDetails,
  );

  let cachedTokensByModality = toUsageTokenBreakdown(
    usageMetadata?.cacheTokensDetails,
  );
  const cachedContentTokenCount = usageMetadata?.cachedContentTokenCount ?? 0;
  const cachedTokenRemainder =
    cachedContentTokenCount - sumBreakdownTokens(cachedTokensByModality);
  if (cachedTokenRemainder > 0) {
    cachedTokensByModality = addBreakdownTokens(
      cachedTokensByModality,
      loggingContext.primaryInputModality,
      cachedTokenRemainder,
    );
    costEstimateNotes.push(
      `Allocated ${cachedTokenRemainder} cached-content tokens to ${loggingContext.primaryInputModality} input because Gemini did not provide a complete cache modality breakdown.`,
    );
  }

  let inputTokensByModality = subtractBreakdowns(
    promptTokensByModality,
    cachedTokensByModality,
  );
  const uncachedPromptTokenCount = Math.max(
    (usageMetadata?.promptTokenCount ?? 0) - cachedContentTokenCount,
    0,
  );
  const uncachedPromptTokenRemainder =
    uncachedPromptTokenCount - sumBreakdownTokens(inputTokensByModality);
  if (uncachedPromptTokenRemainder > 0) {
    inputTokensByModality = addBreakdownTokens(
      inputTokensByModality,
      loggingContext.primaryInputModality,
      uncachedPromptTokenRemainder,
    );
    costEstimateNotes.push(
      `Allocated ${uncachedPromptTokenRemainder} prompt tokens to ${loggingContext.primaryInputModality} input because Gemini did not provide a complete prompt modality breakdown.`,
    );
  }

  let toolUseTokensByModality = toUsageTokenBreakdown(
    usageMetadata?.toolUsePromptTokensDetails,
  );
  const toolUsePromptTokenCount = usageMetadata?.toolUsePromptTokenCount ?? 0;
  const toolUseTokenRemainder =
    toolUsePromptTokenCount - sumBreakdownTokens(toolUseTokensByModality);
  if (toolUseTokenRemainder > 0) {
    toolUseTokensByModality = addBreakdownTokens(
      toolUseTokensByModality,
      "text",
      toolUseTokenRemainder,
    );
    costEstimateNotes.push(
      `Allocated ${toolUseTokenRemainder} tool-use prompt tokens to text input because Gemini did not provide a complete tool modality breakdown.`,
    );
  }

  const outputTokenCount =
    (usageMetadata?.candidatesTokenCount ?? 0) +
    (usageMetadata?.thoughtsTokenCount ?? 0);
  const inputUsd =
    estimateBreakdownUsd(inputTokensByModality, getInputUsdPerMillion) +
    estimateBreakdownUsd(toolUseTokensByModality, getInputUsdPerMillion);
  const cachedContentUsd = estimateBreakdownUsd(
    cachedTokensByModality,
    getCachedInputUsdPerMillion,
  );
  const outputUsd = tokensToUsd(
    outputTokenCount,
    GEMINI_PRICING.outputUsdPerMillion,
  );

  if (
    usageMetadata?.trafficType &&
    usageMetadata.trafficType !== "TRAFFIC_TYPE_UNSPECIFIED" &&
    usageMetadata.trafficType !== "ON_DEMAND"
  ) {
    costEstimateNotes.push(
      `Traffic type ${usageMetadata.trafficType} was returned by Gemini; the estimate still uses standard on-demand list pricing.`,
    );
  }

  return {
    inputTokensByModality,
    cachedTokensByModality,
    toolUseTokensByModality,
    inputUsd,
    cachedContentUsd,
    outputUsd,
    totalUsd: inputUsd + cachedContentUsd + outputUsd,
    costEstimateNotes,
  };
}

function tryAppendGeminiUsageLog(
  loggingContext: GeminiUsageLogContext,
  entry: object,
): void {
  try {
    const usageLogPath = join(
      loggingContext.sessionPath,
      GEMINI_USAGE_LOG_FILE_NAME,
    );
    appendFileSync(usageLogPath, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch (error) {
    console.warn(
      `Failed to write Gemini usage log in ${loggingContext.sessionPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function buildSummaryPrompt(
  transcription: string,
  context: SummaryPromptContext,
): string {
  const normalizedParticipantNames = normalizeParticipantNames(
    context.participantNames,
  );
  const promptLines = [
    "You are summarizing a meeting transcript for follow-up and execution.",
    "",
    "Context:",
    SUMMARY_DEPLOYMENT_CONTEXT,
    context.channelName?.trim()
      ? `Discord voice channel name: ${context.channelName.trim()}`
      : null,
    context.textChannelName?.trim()
      ? `Discord text channel name: ${context.textChannelName.trim()}`
      : null,
    context.sessionId?.trim()
      ? `Recording session ID: ${context.sessionId.trim()}`
      : null,
    normalizedParticipantNames.length > 0
      ? `Known participant names in this meeting: ${normalizedParticipantNames.join(", ")}.`
      : null,
    "The transcript was generated by an automatic speech recognition system.",
    "Speaker labels in the transcript are authoritative and come from the recording system.",
    "",
    "Normalization rules:",
    "- The spoken content may contain ASR misspellings or phonetic variants.",
    "- If a transcript term is an obvious misspelling of a provided participant name, normalize it to the known name in the summary.",
    "- If a transcript term is an obvious misspelling of the project, client, or channel name, normalize it only when strongly supported by the provided context.",
    "- Do not invent corrections, owners, names, decisions, or agendas when the evidence is weak.",
    "- If ownership is ambiguous, keep it as Owner unclear.",
    "- Preserve technical, software, client, and project terminology where possible.",
    "",
    "Return ONLY a valid JSON object with these exact top-level keys:",
    '- "title": concise 4-10 word meeting title.',
    '- "summaryMarkdown": markdown using the required headings below.',
    "Do not wrap JSON in markdown code fences.",
    "",
    "summaryMarkdown must include exactly these sections and headings in this order:",
    "",
    "## Agendas & Sub-agendas",
    "- One bullet per major agenda discussed.",
    "- Use indented bullets for notable sub-agendas when they were clearly discussed.",
    "- If no clear agenda was discussed, write: - No clear agenda identified.",
    "",
    "## Decisions Taken",
    "- One bullet per decision that was actually made.",
    "- Do not list open questions as decisions.",
    "- If no decision was made, write: - No explicit decisions recorded.",
    "",
    "## Action Items",
    "- One bullet per action item.",
    "- Format each bullet like: - Assignee: action item.",
    "- If the owner is unclear, use: - Owner unclear: action item.",
    "- If no action items were assigned, write: - No action items assigned.",
    "",
    "Rules:",
    "- Be concise, specific, and actionable.",
    "- Prefer the provided participant names and channel context when cleaning up obvious naming errors.",
    "- Keep names consistent across the summary.",
    "- Do not include Discord mention syntax or any disclaimer text; those are added by the application after generation.",
    "- Prefer 3-8 bullets per section unless the transcript strongly justifies more.",
    "- Keep the full summary compact enough for chat delivery when possible.",
    "",
    "Transcription:",
    "---",
    transcription,
    "---",
    "",
    "JSON:",
  ].filter((line): line is string => Boolean(line));

  return promptLines.join("\n");
}

function extractCodeFenceJson(text: string): string | null {
  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return codeFenceMatch?.[1]?.trim() || null;
}

function extractLikelyJsonObject(text: string): string | null {
  const firstBraceIndex = text.indexOf("{");
  const lastBraceIndex = text.lastIndexOf("}");
  if (firstBraceIndex < 0 || lastBraceIndex <= firstBraceIndex) {
    return null;
  }

  return text.slice(firstBraceIndex, lastBraceIndex + 1).trim();
}

function parseGeneratedSummary(responseText: string): GeneratedSummary | null {
  const normalizedResponse = responseText.trim();
  const jsonCandidates = [
    normalizedResponse,
    extractCodeFenceJson(normalizedResponse),
    extractLikelyJsonObject(normalizedResponse),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of jsonCandidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const title = getObjectStringProperty(parsed, "title");
      const summaryMarkdown = getObjectStringProperty(parsed, "summaryMarkdown");

      if (title && summaryMarkdown) {
        return {
          title: title.trim(),
          summary: appendSummaryDisclaimer(summaryMarkdown),
        };
      }
    } catch {
      // Try the next parsing strategy.
    }
  }

  return null;
}

function buildFallbackSummary(responseText: string): GeneratedSummary {
  const trimmedResponse = responseText.trim();
  return {
    title: "Recording Summary",
    summary: appendSummaryDisclaimer(
      trimmedResponse || "Unable to generate summary.",
    ),
  };
}

function appendSummaryDisclaimer(summary: string): string {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) {
    return SUMMARY_DISCLAIMER;
  }

  if (trimmedSummary.endsWith(SUMMARY_DISCLAIMER)) {
    return trimmedSummary;
  }

  return `${trimmedSummary}\n\n${SUMMARY_DISCLAIMER}`;
}

/** Calls Gemini with retry + exponential backoff on rate limit errors. */
async function callGeminiWithRetry(
  ai: GoogleGenAI,
  contents: GeminiRequestContents,
  temperature: number,
  loggingContext: GeminiUsageLogContext,
): Promise<string> {
  const requestStartedAt = Date.now();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForRateLimit();

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: { temperature },
      });

      const usageMetadata = response.usageMetadata;
      const usageCostEstimate = estimateGeminiUsageCost(
        usageMetadata,
        loggingContext,
      );

      tryAppendGeminiUsageLog(loggingContext, {
        timestamp: new Date().toISOString(),
        status: "success",
        operation: loggingContext.operation,
        sourcePath: loggingContext.sourcePath
          ? normalizeLogPath(
              relative(loggingContext.sessionPath, loggingContext.sourcePath),
            )
          : undefined,
        model: GEMINI_MODEL,
        modelVersion: response.modelVersion ?? null,
        responseId: response.responseId ?? null,
        trafficType: usageMetadata?.trafficType ?? null,
        attempts: attempt + 1,
        latencyMs: Date.now() - requestStartedAt,
        usedCachedContent: (usageMetadata?.cachedContentTokenCount ?? 0) > 0,
        tokenCounts: {
          prompt: usageMetadata?.promptTokenCount ?? 0,
          cachedContent: usageMetadata?.cachedContentTokenCount ?? 0,
          toolUsePrompt: usageMetadata?.toolUsePromptTokenCount ?? 0,
          candidates: usageMetadata?.candidatesTokenCount ?? 0,
          thoughts: usageMetadata?.thoughtsTokenCount ?? 0,
          total: usageMetadata?.totalTokenCount ?? 0,
          inputByModality: usageCostEstimate.inputTokensByModality,
          cachedByModality: usageCostEstimate.cachedTokensByModality,
          toolUseByModality: usageCostEstimate.toolUseTokensByModality,
        },
        estimatedCostUsd: roundUsd(usageCostEstimate.totalUsd),
        estimatedCostBreakdownUsd: {
          input: roundUsd(usageCostEstimate.inputUsd),
          cachedContent: roundUsd(usageCostEstimate.cachedContentUsd),
          output: roundUsd(usageCostEstimate.outputUsd),
          total: roundUsd(usageCostEstimate.totalUsd),
        },
        pricingRatesUsdPerMillion: {
          textInput: GEMINI_PRICING.inputUsdPerMillion.text,
          audioInput: GEMINI_PRICING.inputUsdPerMillion.audio,
          cachedTextInput: GEMINI_PRICING.cachedInputUsdPerMillion.text,
          cachedAudioInput: GEMINI_PRICING.cachedInputUsdPerMillion.audio,
          output: GEMINI_PRICING.outputUsdPerMillion,
        },
        pricingSource: GEMINI_PRICING_SOURCE,
        costEstimateNotes: usageCostEstimate.costEstimateNotes,
      });

      return response.text ?? "";
    } catch (error) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") ||
          error.message.toLowerCase().includes("rate limit") ||
          error.message.toLowerCase().includes("quota"));

      if (isRateLimit && attempt < MAX_RETRIES) {
        const backoffMs = getRetryBackoffMs(attempt);
        console.warn(
          `Gemini rate limit hit (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
        );
        await delay(backoffMs);
        continue;
      }

      tryAppendGeminiUsageLog(loggingContext, {
        timestamp: new Date().toISOString(),
        status: "error",
        operation: loggingContext.operation,
        sourcePath: loggingContext.sourcePath
          ? normalizeLogPath(
              relative(loggingContext.sessionPath, loggingContext.sourcePath),
            )
          : undefined,
        model: GEMINI_MODEL,
        attempts: attempt + 1,
        latencyMs: Date.now() - requestStartedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  throw new Error("Gemini request failed after all retries");
}

async function callElevenLabsWithRetry(wavPath: string): Promise<string> {
  const apiKey = getElevenLabsApiKey();
  const audioBuffer = readFileSync(wavPath);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    try {
      response = await fetch(ELEVENLABS_SPEECH_TO_TEXT_URL, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
        },
        body: createElevenLabsFormData(audioBuffer, wavPath),
      });
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const backoffMs = getRetryBackoffMs(attempt);
        console.warn(
          `ElevenLabs transcription request errored (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
        );
        await delay(backoffMs);
        continue;
      }

      throw error;
    }

    if (!response.ok) {
      const errorMessage = await readResponseErrorMessage(response);
      const shouldRetry = response.status === 429 || response.status >= 500;

      if (shouldRetry && attempt < MAX_RETRIES) {
        const backoffMs = getRetryBackoffMs(attempt);
        console.warn(
          `ElevenLabs transcription request failed with ${response.status} (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
        );
        await delay(backoffMs);
        continue;
      }

      throw new Error(
        `ElevenLabs transcription failed (${response.status} ${response.statusText}): ${errorMessage}`,
      );
    }

    const responseBody: unknown = await response.json();
    return extractElevenLabsTranscriptionText(responseBody);
  }

  throw new Error("ElevenLabs transcription request failed after all retries");
}

export async function generateSummary(
  transcription: string,
  sessionPath: string,
  context: SummaryPromptContext,
): Promise<GeneratedSummary> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  if (
    !transcription.trim() ||
    transcription === "[No speech detected in the audio]"
  ) {
    return {
      title: "No Speech Detected",
      summary: appendSummaryDisclaimer(
        "No content to summarize - the recording contained no detectable speech.",
      ),
    };
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const prompt = buildSummaryPrompt(transcription, context);

  try {
    const rawResponse = await callGeminiWithRetry(ai, [prompt], 0.3, {
      sessionPath,
      operation: "meeting_summary",
      primaryInputModality: "text",
    });

    return parseGeneratedSummary(rawResponse) || buildFallbackSummary(rawResponse);
  } catch (error) {
    console.error("Summary generation error:", error);
    throw new Error(
      `Failed to generate summary: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

// ─── Snippet-based Transcription ─────────────────────────────────────────────

/**
 * Parses raw transcription output into individual lines.
 * Filters out empty lines, "[No speech detected]", and strips any
 * leading [MM:SS] timestamps a provider may include.
 */
function parseTranscriptionLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\[?\d{1,2}:\d{2}\]?\s*/, "").trim())
    .filter(
      (line) =>
        line.length > 0 &&
        line !== "[No speech detected]" &&
        !line.startsWith("[No speech"),
    );
}

/**
 * Transcribes a single audio snippet with ElevenLabs and returns an array of
 * text lines. Each line represents one sentence or phrase spoken in the snippet.
 */
export async function transcribeSnippetAudio(
  wavPath: string,
): Promise<string[]> {
  try {
    const raw = await callElevenLabsWithRetry(wavPath);

    return parseTranscriptionLines(raw);
  } catch (error) {
    console.error(`Failed to transcribe snippet ${wavPath}:`, error);
    return [];
  }
}
