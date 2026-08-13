import { describe, expect, test } from "bun:test";
import {
  assignEpisodesToBins,
  type HistogramBinning,
} from "@/utils/episodeLengthHistogram";

const ep = (episodeIndex: number, lengthSeconds: number) => ({
  episodeIndex,
  lengthSeconds,
});

describe("assignEpisodesToBins", () => {
  test("buckets episodes by length and always returns binCount bins", () => {
    const binning: HistogramBinning = { min: 0, width: 10, binCount: 3 };
    const bins = assignEpisodesToBins(
      [ep(0, 5), ep(1, 15), ep(2, 25), ep(3, 12)],
      binning,
    );

    expect(bins).toHaveLength(3);
    expect(bins).toEqual([[0], [1, 3], [2]]);
  });

  test("includes empty bins so bar index maps to bin index", () => {
    const bins = assignEpisodesToBins([ep(7, 0.5)], {
      min: 0,
      width: 1,
      binCount: 4,
    });

    expect(bins).toEqual([[7], [], [], []]);
  });

  test("returns episode indices in ascending order regardless of input order", () => {
    const bins = assignEpisodesToBins([ep(9, 1), ep(2, 1), ep(5, 1)], {
      min: 0,
      width: 10,
      binCount: 1,
    });

    expect(bins[0]).toEqual([2, 5, 9]);
  });

  test("clamps lengths below the first edge into the first bin", () => {
    // p1/p99 binning means sub-min outliers exist and must still be counted.
    const bins = assignEpisodesToBins([ep(0, -5), ep(1, 2)], {
      min: 0,
      width: 10,
      binCount: 2,
    });

    expect(bins[0]).toEqual([0, 1]);
  });

  test("clamps lengths at or past the top edge into the last bin", () => {
    const bins = assignEpisodesToBins([ep(0, 20), ep(1, 999)], {
      min: 0,
      width: 10,
      binCount: 2,
    });

    expect(bins[1]).toEqual([0, 1]);
  });

  test("puts everything in one bin when width is zero (single length value)", () => {
    const bins = assignEpisodesToBins([ep(0, 4.2), ep(1, 4.2), ep(2, 4.2)], {
      min: 4.2,
      width: 0,
      binCount: 1,
    });

    expect(bins).toEqual([[0, 1, 2]]);
  });

  test("handles an empty episode list", () => {
    expect(assignEpisodesToBins([], { min: 0, width: 5, binCount: 2 })).toEqual(
      [[], []],
    );
  });

  test("bin counts match the length of each returned bin", () => {
    const episodes = Array.from({ length: 50 }, (_, i) => ep(i, i * 0.7));
    const binning: HistogramBinning = { min: 0, width: 2.5, binCount: 14 };

    const bins = assignEpisodesToBins(episodes, binning);

    expect(bins.flat()).toHaveLength(episodes.length);
    expect(new Set(bins.flat()).size).toBe(episodes.length);
  });
});
