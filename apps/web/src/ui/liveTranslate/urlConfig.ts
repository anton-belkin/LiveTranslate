import type { Lang } from "@livetranslate/shared";

const DEFAULT_TARGET_LANGS: Lang[] = ["en", "de", "ru"];

export type UrlConfig = {
  targetLangs: Lang[];
  showOriginal: boolean;
  showSummary: boolean;
  lean: boolean;
  staticContext?: string;
  specialWords?: string;
  specialWordsBoost?: number;
  audioSource: "mic" | "tab" | "both";
};

export function parseUrlConfig(): UrlConfig {
  const params = new URLSearchParams(window.location.search);
  const langs = parseLangsParam(params.get("langs"));
  const lean = parseBoolParam(params.get("lean"), false);
  const showOriginal = parseBoolParam(params.get("showOriginal"), false);
  const showSummary = parseBoolParam(params.get("showSummary"), false);
  const staticContext = params.get("staticContext")?.trim() || undefined;
  const specialWords = parseMultilineParam(params.get("specialWords"));
  const specialWordsBoost = parseIntParam(params.get("specialWordsBoost"), 1, 1, 5);
  const audioSource = parseAudioSourceParam(params.get("audioSource"));

  return {
    targetLangs: langs,
    showOriginal,
    showSummary,
    lean,
    staticContext,
    specialWords,
    specialWordsBoost,
    audioSource,
  };
}

export function updateUrlParam(key: string, value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.history.replaceState(null, "", url.toString());
}

function parseLangsParam(value: string | null): Lang[] {
  if (!value) return DEFAULT_TARGET_LANGS;
  const parts = value
    .split(/[,\s]+/g)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
  const unique: Lang[] = [];
  for (const part of parts) {
    if (!unique.includes(part as Lang)) unique.push(part as Lang);
  }
  return unique.length > 0 ? unique : DEFAULT_TARGET_LANGS;
}

function parseBoolParam(value: string | null, fallback: boolean) {
  if (value == null || value === "") return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return fallback;
}

function parseAudioSourceParam(value: string | null): "mic" | "tab" | "both" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mic" || normalized === "tab" || normalized === "both") return normalized;
  return "tab";
}

function parseMultilineParam(value: string | null) {
  if (value == null) return undefined;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseIntParam(value: string | null, fallback: number, min: number, max: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}
