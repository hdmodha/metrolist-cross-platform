import test from 'node:test';
import assert from 'node:assert/strict';
import type { InnerTubeParsedTrack } from './metrolistCore';
import { createInitialPlayerState, playerReducer } from '../player/playerCore';
import { createPlayerStore } from '../player/playerStore';
import {
  DEBUG_LOG_CAPACITY,
  connectPlayerDebugLog,
  createDebugLog,
  describePlayerChange,
  formatDebugLogText,
  formatDebugTime,
  mergeDebugEntries,
} from './debugLog';

const yt = (name: string): InnerTubeParsedTrack => ({
  videoId: `vid${name}`.padEnd(11, '_'),
  title: `Song ${name}`,
  artist: `Artist ${name}`,
  album: '',
  durationMs: 200000,
  thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
});

test('keeps the last 100 entries, oldest first, with timestamps', () => {
  let clock = 1000;
  const log = createDebugLog(DEBUG_LOG_CAPACITY, () => clock++);
  for (let i = 0; i < 130; i++) log.add('player', `event ${i}`);
  const entries = log.entries();
  assert.equal(entries.length, 100);
  assert.equal(entries[0].message, 'event 30');
  assert.equal(entries.at(-1)?.message, 'event 129');
  assert.equal(entries[0].at, 1030);
  assert.equal(entries[0].source, 'player');
  log.clear();
  assert.deepEqual(log.entries(), []);
});

test('listeners hear about new entries; messages are bounded', () => {
  const log = createDebugLog(5, () => 1);
  let calls = 0;
  const stop = log.subscribe(() => calls++);
  log.add('page', 'x'.repeat(5000), 'warn');
  assert.equal(calls, 1);
  assert.equal(log.entries()[0].message.length, 500);
  assert.equal(log.entries()[0].level, 'warn');
  stop();
  log.add('page', 'y');
  assert.equal(calls, 1);
});

test('player changes are described: song, play / pause, stream status, alternate upload, network, notices', () => {
  const empty = createInitialPlayerState();
  assert.deepEqual(describePlayerChange(null, empty), ['Nothing loaded']);
  const started = playerReducer(empty, { type: 'playFromSearch', track: yt('a') });
  const lines = describePlayerChange(empty, started);
  assert.ok(lines.some((l) => l.startsWith('Song: "Song a" by Artist a (vida_______)')), lines.join('|'));
  assert.ok(lines.includes('Play'));
  assert.ok(lines.includes('Stream: loading'));
  const playing = playerReducer(started, { type: 'streamStatusChanged', status: 'playing' });
  assert.deepEqual(describePlayerChange(started, playing), ['Stream: playing']);
  const paused = playerReducer(playing, { type: 'setPlaying', playing: false });
  assert.ok(describePlayerChange(playing, paused).includes('Pause'));
  assert.deepEqual(describePlayerChange(paused, paused), []);
  const waiting = playerReducer(playing, { type: 'networkLost' });
  assert.ok(describePlayerChange(playing, waiting).includes('Waiting for the network'));
  const id = started.activeTrackId!;
  const moved = { ...playing, tracksById: { ...playing.tracksById, [id]: { ...playing.tracksById[id], videoId: 'other______' } } };
  assert.ok(describePlayerChange(playing, moved).includes('Upload: other______'));
});

test('connectPlayerDebugLog records store changes until disconnected', () => {
  const log = createDebugLog(100, () => 5);
  const store = createPlayerStore(createInitialPlayerState());
  const disconnect = connectPlayerDebugLog(store, log);
  store.dispatch({ type: 'playFromSearch', track: yt('b') });
  assert.ok(log.entries().some((e) => e.message === 'Play' && e.source === 'player'));
  const count = log.entries().length;
  disconnect();
  store.dispatch({ type: 'setPlaying', playing: false });
  assert.equal(log.entries().length, count);
});

test('JS and native entries are merged by time; time and text formats', () => {
  const merged = mergeDebugEntries(
    [
      { at: 3, source: 'player', level: 'info', message: 'c' },
      { at: 1, source: 'player', level: 'info', message: 'a' },
    ],
    [{ at: 2, source: 'native', level: 'warn', message: 'b' }]
  );
  assert.deepEqual(merged.map((e) => e.message), ['a', 'b', 'c']);
  const at = new Date(2026, 10, 11, 9, 5, 7, 42).getTime();
  assert.equal(formatDebugTime(at), '09:05:07.042');
  assert.equal(formatDebugLogText([{ at, source: 'native', level: 'warn', message: 'hello' }]), '09:05:07.042 native warn hello');
});
