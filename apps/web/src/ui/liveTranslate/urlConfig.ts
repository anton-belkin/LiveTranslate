import type { Lang } from "@livetranslate/shared";

const DEFAULT_TARGET_LANGS: Lang[] = ["en", "de", "ru"];

export type UrlConfig = {
  targetLangs: Lang[];
  showOriginal: boolean;
  showSummary: boolean;
  lean: boolean;
  staticContext?: string;
};

export function parseUrlConfig(): UrlConfig {
  const params = new URLSearchParams(window.location.search);
  const langs = parseLangsParam(params.get("langs"));
  const lean = parseBoolParam(params.get("lean"), false);
  const showOriginal = parseBoolParam(params.get("showOriginal"), true);
  const showSummary = parseBoolParam(params.get("showSummary"), !lean);
  const staticContext = params.get("staticContext")?.trim() || undefined;

  return {
    targetLangs: langs,
    showOriginal,
    showSummary,
    lean,
    staticContext,
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
