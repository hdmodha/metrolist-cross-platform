export interface MetrolistTrack {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  bpm: number;
  rootFreqHz: number;
  chordIntervals: number[];
  coverUrl: string;
  genre: 'Electronic' | 'Ambient' | 'Post-Rock' | 'Synthwave' | 'Indie' | 'YouTube Music';
  liked: boolean;
  cachedOffline: boolean;
  isLiveInnerTube?: boolean;
}

// Resolved through the bundler so the artwork ships in production builds (web `dist/`, APK, desktop)
const COVER_ANALOG_HORIZON = new URL('../assets/images/album_analog_horizon_1794313623251.jpg', import.meta.url).href;
const COVER_MIDNIGHT_SYNTH = new URL('../assets/images/album_midnight_synth_1794313619830.jpg', import.meta.url).href;
const COVER_NORDIC_ECHOES = new URL('../assets/images/album_nordic_echoes_1794313623118.jpg', import.meta.url).href;
const COVER_TOKYO_RAIN = new URL('../assets/images/album_tokyo_rain_1794313623366.jpg', import.meta.url).href;

export const INITIAL_TRACKS: MetrolistTrack[] = [
  {
    id: 'trk-01',
    videoId: 'ytm_NP_9081a',
    title: 'Night Prism',
    artist: 'Obsidian Sound',
    album: 'Night Prism (180g Vinyl Session)',
    durationMs: 218000,
    bpm: 112,
    rootFreqHz: 220.0, // A3 minor
    chordIntervals: [0, 3, 7, 10],
    coverUrl: COVER_MIDNIGHT_SYNTH,
    genre: 'Synthwave',
    liked: true,
    cachedOffline: true,
  },
  {
    id: 'trk-02',
    videoId: 'ytm_TR_4412b',
    title: 'Shinjuku Raindrop Protocol',
    artist: 'Kaito & The Late Trains',
    album: 'After Hours in Chiyoda',
    durationMs: 194000,
    bpm: 94,
    rootFreqHz: 196.0, // G3
    chordIntervals: [0, 4, 7, 11],
    coverUrl: COVER_TOKYO_RAIN,
    genre: 'Ambient',
    liked: true,
    cachedOffline: true,
  },
  {
    id: 'trk-03',
    videoId: 'ytm_NE_7731c',
    title: 'Basalt Fjord Echoes',
    artist: 'Sigurðsson & Olsen',
    album: 'Nordic Mist (ECM 1432)',
    durationMs: 246000,
    bpm: 78,
    rootFreqHz: 164.81, // E3
    chordIntervals: [0, 3, 7, 14],
    coverUrl: COVER_NORDIC_ECHOES,
    genre: 'Post-Rock',
    liked: false,
    cachedOffline: false,
  },
  {
    id: 'trk-04',
    videoId: 'ytm_AH_5590d',
    title: 'Modular Patch Bay 04',
    artist: 'Buchla Telemetry',
    album: 'Voltage Controlled Architecture',
    durationMs: 182000,
    bpm: 124,
    rootFreqHz: 246.94, // B3
    chordIntervals: [0, 5, 7, 10],
    coverUrl: COVER_ANALOG_HORIZON,
    genre: 'Electronic',
    liked: true,
    cachedOffline: false,
  },
  {
    id: 'trk-05',
    videoId: 'ytm_VL_3109e',
    title: 'Velvet Subcarrier',
    artist: 'Obsidian Sound',
    album: 'Night Prism (180g Vinyl Session)',
    durationMs: 205000,
    bpm: 105,
    rootFreqHz: 174.61, // F3
    chordIntervals: [0, 4, 7, 9],
    coverUrl: COVER_MIDNIGHT_SYNTH,
    genre: 'Indie',
    liked: false,
    cachedOffline: true,
  },
];
