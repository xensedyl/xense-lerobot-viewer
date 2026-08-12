import { describe, expect, test } from "bun:test";
import {
  extractAffectedDoctorEpisodeIds,
  extractDoctorEpisodeIdsFromMessage,
  type DoctorReport,
} from "@/types/doctor.types";

function report(
  messages: DoctorReport["checks"][number]["messages"],
): DoctorReport {
  return {
    version: "0.2.0",
    dataset_path: "/data/example",
    dataset_name: "example",
    codebase_version: "v3.0",
    format_version: "v3",
    total_episodes: 100,
    total_frames: 1000,
    fps: 30,
    overall_severity: "WARN",
    checks: [{ name: "test", severity: "WARN", messages }],
    summary: { PASS: 0, WARN: 1, FAIL: 0 },
  };
}

describe("extractDoctorEpisodeIdsFromMessage", () => {
  test("extracts a singular episode reference", () => {
    expect(
      extractDoctorEpisodeIdsFromMessage(
        "action: Episode 17 has 3 sudden action jumps",
      ),
    ).toEqual([17]);
  });

  test("extracts and sorts bracketed episode lists", () => {
    expect(
      extractDoctorEpisodeIdsFromMessage(
        "Video files missing for episodes [9, 2, 9, 4]",
      ),
    ).toEqual([2, 4, 9]);
  });

  test("handles upstream episode(s) and episode indices wording", () => {
    expect(
      extractDoctorEpisodeIdsFromMessage(
        "3 abnormally short episode(s) (>3 std below mean): [8, 1, 5]",
      ),
    ).toEqual([1, 5, 8]);
    expect(
      extractDoctorEpisodeIdsFromMessage("Missing episode indices: [7, 3]"),
    ).toEqual([3, 7]);
  });

  test("does not mistake counts for episode ids", () => {
    expect(
      extractDoctorEpisodeIdsFromMessage("5/20 episode(s) flagged"),
    ).toEqual([]);
    expect(
      extractDoctorEpisodeIdsFromMessage("shape is [3, 480, 640]"),
    ).toEqual([]);
    expect(
      extractDoctorEpisodeIdsFromMessage(
        "Episode 5: camera shape is [3, 480, 640]",
      ),
    ).toEqual([5]);
  });

  test("takes episode ids but not dimensions from consistency tuples", () => {
    expect(
      extractDoctorEpisodeIdsFromMessage(
        "2 shape mismatch(es) across episodes: [(7, 'action', '(6,)->(7,)'), (12, 'state', '(3,)->(4,)')]",
      ),
    ).toEqual([7, 12]);
  });
});

describe("extractAffectedDoctorEpisodeIds", () => {
  test("uses only WARN/FAIL messages and deduplicates ids", () => {
    const result = report([
      { severity: "PASS", message: "Episode 1 is healthy" },
      { severity: "WARN", message: "Episode 4: frozen action" },
      { severity: "FAIL", message: "episodes [2, 4] are missing video" },
    ]);

    expect(extractAffectedDoctorEpisodeIds(result)).toEqual([2, 4]);
  });
});
