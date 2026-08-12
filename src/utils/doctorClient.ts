import type { DoctorCheckId, DoctorRunResponse } from "@/types/doctor.types";

export interface RunDoctorOptions {
  maxEpisodes: number | null;
  checks?: DoctorCheckId[];
  signal?: AbortSignal;
}

export async function runDatasetDoctor(
  encodedPath: string,
  options: RunDoctorOptions,
): Promise<DoctorRunResponse> {
  const response = await fetch(`/api/local-datasets/${encodedPath}/doctor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: options.signal,
    body: JSON.stringify({
      maxEpisodes: options.maxEpisodes,
      checks: options.checks,
    }),
  });

  const data = (await response.json().catch(() => null)) as
    | DoctorRunResponse
    | { error?: string; hint?: string }
    | null;

  if (!response.ok || !data || !("ok" in data) || data.ok !== true) {
    const message =
      data && "error" in data && data.error
        ? data.error
        : `Doctor request failed (${response.status}).`;
    const hint = data && "hint" in data ? data.hint : undefined;
    throw new Error(hint ? `${message}\n\n${hint}` : message);
  }

  return data;
}
