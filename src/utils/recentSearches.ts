/** "Recent searches" on the Search page: newest first, at most 10, kept in localStorage. */
import type { KeyValueStorage } from './persistence';

export const RECENT_SEARCHES_KEY = 'metrolist.recentSearches.v1';
export const MAX_RECENT_SEARCHES = 10;
const MAX_QUERY_LENGTH = 200;
const MIN_QUERY_LENGTH = 2;

/** Trimmed, inner whitespace collapsed (linear, no regular expression). */
function normalize(query: string): string {
  let out = '';
  let pendingSpace = false;
  for (const ch of query.slice(0, MAX_QUERY_LENGTH * 2)) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) out += ' ';
    pendingSpace = false;
    out += ch;
  }
  return out.slice(0, MAX_QUERY_LENGTH);
}

const sameQuery = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `query` on top (replacing an earlier spelling of it). The same array when nothing changes. */
export function addRecentSearch(list: readonly string[], query: string): string[] {
  const clean = normalize(query);
  if (clean.length < MIN_QUERY_LENGTH) return list as string[];
  if (list[0] === clean) return list as string[];
  return [clean, ...list.filter((q) => !sameQuery(q, clean))].slice(0, MAX_RECENT_SEARCHES);
}

export function removeRecentSearch(list: readonly string[], query: string): string[] {
  return list.some((q) => sameQuery(q, query)) ? list.filter((q) => !sameQuery(q, query)) : (list as string[]);
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadRecentSearches(storage: KeyValueStorage | null = defaultStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let list: string[] = [];
    // Oldest first, so the newest ends on top
    for (const entry of [...parsed].reverse()) {
      if (typeof entry === 'string') list = addRecentSearch(list, entry);
    }
    return list.slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecentSearches(list: readonly string[], storage: KeyValueStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, MAX_RECENT_SEARCHES)));
    return true;
  } catch {
    return false;
  }
}
