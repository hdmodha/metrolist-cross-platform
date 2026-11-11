import React from 'react';
import { ChevronLeft, ClipboardCopy, RefreshCw, Trash2 } from 'lucide-react';
import { APP_VERSION } from '../appVersion';
import { NavLink } from '../components/NavLink';
import { getNativeBackgroundPlayback } from '../native/backgroundPlayback';
import { countRender } from '../utils/renderProbe';
import {
  debugLog,
  formatDebugLogText,
  formatDebugTime,
  mergeDebugEntries,
  type DebugEntry,
} from '../utils/debugLog';

const SOURCE_COLOR: Record<DebugEntry['source'], string> = {
  player: 'text-emerald-300',
  plugin: 'text-sky-300',
  page: 'text-amber-200',
  native: 'text-fuchsia-300',
};

/**
 * The hidden debug log (`#/debug`; a long press on the version in Library): the last player, page and
 * plugin events, newest first, with the native plugin's own lines (Android logcat tag `Metrolist`)
 * merged in. For device tests that cannot attach a debugger: read it here, or Copy and paste it.
 */
export const DebugPage = React.memo(function DebugPage() {
  countRender('DebugPage');
  const appEntries = React.useSyncExternalStore(debugLog.subscribe, debugLog.entries, debugLog.entries);
  const plugin = React.useMemo(() => getNativeBackgroundPlayback(), []);
  const [nativeEntries, setNativeEntries] = React.useState<DebugEntry[]>([]);
  const [copied, setCopied] = React.useState<'idle' | 'copied' | 'failed'>('idle');

  const refresh = React.useCallback(() => {
    if (!plugin) return;
    void plugin.getDebugLog().then((entries) =>
      setNativeEntries(entries.map((e) => ({ at: e.at, source: 'native' as const, level: e.level, message: e.message })))
    );
  }, [plugin]);
  React.useEffect(refresh, [refresh]);

  const oldestFirst = React.useMemo(() => mergeDebugEntries(appEntries, nativeEntries), [appEntries, nativeEntries]);
  const newestFirst = React.useMemo(() => [...oldestFirst].reverse(), [oldestFirst]);

  const copy = () => {
    const text = `Metrolist ${APP_VERSION} (${plugin?.platform ?? 'web / desktop'})\n${formatDebugLogText(oldestFirst)}`;
    const done = (ok: boolean) => setCopied(ok ? 'copied' : 'failed');
    try {
      void navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } catch {
      done(false);
    }
  };

  const button =
    'tap-target inline-flex items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-4 py-2 text-sm font-semibold text-white cursor-pointer';
  return (
    <div className="space-y-4">
      <NavLink to={{ name: 'library' }} className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Library
      </NavLink>
      <h1 className="text-[28px] short:text-2xl lg:text-4xl font-extrabold tracking-tight text-white">Debug log</h1>
      <p className="text-sm text-zinc-400 max-w-2xl">
        Metrolist {APP_VERSION} · {plugin ? `${plugin.platform} app` : 'web / desktop'} · the last {oldestFirst.length} player, page and
        plugin events, newest first. Kept in memory only; nothing is sent anywhere.
      </p>
      <div className="flex flex-wrap gap-2">
        {plugin && (
          <button type="button" className={button} onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Refresh
          </button>
        )}
        <button type="button" className={button} onClick={copy}>
          <ClipboardCopy className="w-4 h-4" aria-hidden="true" />
          {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            debugLog.clear();
            setNativeEntries([]);
          }}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          Clear
        </button>
      </div>
      {newestFirst.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing logged yet.</p>
      ) : (
        <ol aria-label="Debug log entries" className="font-mono text-xs leading-5 space-y-0.5 break-words">
          {newestFirst.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className={entry.level === 'info' ? 'text-zinc-300' : entry.level === 'warn' ? 'text-amber-300' : 'text-red-400'}>
              <span className="text-zinc-500">{formatDebugTime(entry.at)}</span> <span className={SOURCE_COLOR[entry.source]}>{entry.source}</span>{' '}
              {entry.message}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
