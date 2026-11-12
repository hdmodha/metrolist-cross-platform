/** Debug-log lines for network searches (never the query text). */
export function formatSearchTiming(resultCount: number, ms: number): string {
  return `search: ${resultCount} ${resultCount === 1 ? 'result' : 'results'} in ${Math.round(ms)} ms`;
}

export function formatSearchFailure(ms: number): string {
  return `search failed after ${Math.round(ms)} ms`;
}
