export const DOCTOR_CHECK_IDS = [
  "metadata",
  "temporal",
  "actions",
  "videos",
  "statistics",
  "episodes",
  "consistency",
  "training",
  "anomalies",
  "portability",
  "per_episode",
] as const;

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];
export type DoctorSeverity = "PASS" | "WARN" | "FAIL";

export interface DoctorMessage {
  severity: DoctorSeverity;
  message: string;
}

export interface DoctorCheckResult {
  name: string;
  severity: DoctorSeverity;
  messages: DoctorMessage[];
}

/** Exact JSON schema emitted by lerobot-doctor's report_to_json(). */
export interface DoctorReport {
  version: string;
  dataset_path: string;
  dataset_name: string | null;
  codebase_version: string | null;
  format_version: string | null;
  total_episodes: number | null;
  total_frames: number | null;
  fps: number | null;
  overall_severity: DoctorSeverity;
  checks: DoctorCheckResult[];
  summary: Record<DoctorSeverity, number>;
}

export interface DoctorExecution {
  duration_ms: number;
  requested_max_episodes: number | null;
  loaded_episode_count: number;
  loaded_episode_indices: number[];
  doctor_source: string;
}

export interface DoctorRunResponse {
  ok: true;
  report: DoctorReport;
  execution: DoctorExecution;
}

/**
 * Extract explicit episode references from a Doctor message.
 *
 * The upstream checks currently use both `Episode 12: ...` and
 * `episodes [1, 4, 9]`; keeping this parser in one pure helper lets the UI
 * connect either form to the viewer's existing flagged-episode workflow.
 */
export function extractDoctorEpisodeIdsFromMessage(message: string): number[] {
  const ids = new Set<number>();

  const singular = /\bepisode\s+(\d+)\b/gi;
  for (const match of message.matchAll(singular)) {
    ids.add(Number(match[1]));
  }

  const bracketed = /\[([^\]]*)\]/g;
  for (const match of message.matchAll(bracketed)) {
    const prefix = message.slice(Math.max(0, match.index - 100), match.index);
    if (
      !/(?:\bepisodes\b|\bepisode\(s\)|\bepisode\s+indices?\b)/i.test(prefix)
    ) {
      continue;
    }

    const contents = match[1];
    if (/^\s*\d+(?:\s*,\s*\d+)*\s*(?:\.\.\.)?\s*$/.test(contents)) {
      for (const numeric of contents.match(/\d+/g) ?? []) {
        ids.add(Number(numeric));
      }
      continue;
    }

    // Some consistency checks return tuples such as
    // `[(episode_id, feature), ...]`. Only take the first tuple item; shape
    // dimensions and counts later in the tuple are not episode ids.
    const tupleEpisode = /(?:^|,\s*)\(\s*(\d+)\s*,/g;
    for (const tupleMatch of contents.matchAll(tupleEpisode)) {
      ids.add(Number(tupleMatch[1]));
    }
  }

  return [...ids].filter(Number.isSafeInteger).sort((a, b) => a - b);
}

/** Episode ids mentioned by non-passing Doctor messages, sorted and deduped. */
export function extractAffectedDoctorEpisodeIds(
  report: DoctorReport,
): number[] {
  const ids = new Set<number>();
  for (const check of report.checks) {
    for (const message of check.messages) {
      if (message.severity === "PASS") continue;
      for (const id of extractDoctorEpisodeIdsFromMessage(message.message)) {
        if (id >= 0) ids.add(id);
      }
    }
  }
  return [...ids].sort((a, b) => a - b);
}
