/**
 * Episode-length histogram binning.
 *
 * The server ships only the bin geometry (`min` / `width` / `binCount`) with the
 * histogram, not the episode indices per bin — `EpisodeLengthStats.allEpisodeLengths`
 * already carries every episode's index and length, so per-bin membership is
 * recovered on the client instead of being sent twice.
 *
 * Both sides call `assignEpisodesToBins`, so the bar counts and the inspected
 * membership can never disagree.
 */

export type HistogramBinning = {
  /** Lower edge of the first bin, in seconds. */
  min: number;
  /** Bin width in seconds. Non-positive means a degenerate single-value histogram. */
  width: number;
  binCount: number;
};

type BinnableEpisode = {
  episodeIndex: number;
  lengthSeconds: number;
};

/**
 * Bucket episodes into their histogram bins, returning one ascending array of
 * episode indices per bin (empty arrays included, so the result is always
 * `binCount` long and indexable by bar position).
 *
 * Lengths outside the bin range are clamped into the first/last bin — the
 * histogram edges come from the p1/p99 percentiles, so outliers are expected
 * and must still be counted somewhere.
 */
export function assignEpisodesToBins(
  episodes: readonly BinnableEpisode[],
  binning: HistogramBinning,
): number[][] {
  const binCount = Math.max(1, Math.floor(binning.binCount));
  const bins: number[][] = Array.from({ length: binCount }, () => []);

  if (!(binning.width > 0)) {
    // Every episode has the same length: one bin holds all of them.
    for (const episode of episodes) bins[0].push(episode.episodeIndex);
  } else {
    for (const episode of episodes) {
      let binIdx = Math.floor(
        (episode.lengthSeconds - binning.min) / binning.width,
      );
      if (binIdx < 0) binIdx = 0;
      if (binIdx >= binCount) binIdx = binCount - 1;
      bins[binIdx].push(episode.episodeIndex);
    }
  }

  for (const bin of bins) bin.sort((a, b) => a - b);
  return bins;
}
