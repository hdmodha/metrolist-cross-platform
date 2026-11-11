import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import {
  MIN_ALTERNATE_SCORE,
  chooseAlternateUpload,
  rankAlternateUploads,
  scoreAlternateUpload,
} from './alternateUploads';

let seq = 0;
function candidate(title: string, artist: string, durationMs = 202000): InnerTubeParsedTrack {
  seq++;
  return {
    videoId: `cand${String(seq).padStart(7, '0')}`,
    title,
    artist,
    album: '',
    durationMs,
    thumbnailUrl: '',
  };
}

const ORIGINAL = { title: 'Blinding Lights', artist: 'The Weeknd', durationMs: 202000 };

describe('scoring another upload of the same song', () => {
  test('the official upload, an "Artist - Title" upload and a lyric video all score high', () => {
    const official = scoreAlternateUpload(ORIGINAL, candidate('Blinding Lights', 'The Weeknd', 201000));
    const dashed = scoreAlternateUpload(ORIGINAL, candidate('The Weeknd - Blinding Lights (Official Audio)', 'TheWeekndVEVO', 203000));
    const lyrics = scoreAlternateUpload(ORIGINAL, candidate('Blinding Lights - The Weeknd (Lyrics)', '7clouds', 200000));
    for (const score of [official, dashed, lyrics]) {
      assert.ok(score !== null && score >= 90, `score ${score}`);
    }
  });

  test('covers, remixes and edits are penalised unless the original is one too', () => {
    const variants = [
      'Blinding Lights (Piano Cover)',
      'Blinding Lights (Karaoke Version)',
      'Blinding Lights (Remix)',
      'Blinding Lights remake',
      'Blinding Lights (slowed + reverb)',
      'Blinding Lights - sped up',
      'Blinding Lights (Nightcore)',
      'Blinding Lights 8D Audio',
      'Blinding Lights (Live at the Grammys)',
      'Blinding Lights (Instrumental)',
      'How to play Blinding Lights - Tutorial',
      'Blinding Lights (Extended Mix)',
      'Blinding Lights 1 Hour',
    ];
    for (const title of variants) {
      const score = scoreAlternateUpload(ORIGINAL, candidate(title, 'The Weeknd'));
      assert.ok(score === null || score < MIN_ALTERNATE_SCORE, `${title} scored ${score}`);
    }
    // The original itself is a remix: another upload of that remix is fine
    const remix = { title: 'Blinding Lights (Chromatics Remix)', artist: 'The Weeknd', durationMs: 290000 };
    const score = scoreAlternateUpload(remix, candidate('The Weeknd - Blinding Lights (Chromatics Remix)', 'The Weeknd', 291000));
    assert.ok(score !== null && score >= MIN_ALTERNATE_SCORE, `remix scored ${score}`);
    // ... and the other way round: a karaoke / remix track is not replaced by the original recording
    const karaoke = { title: 'Adele - Hello (Acoustic Karaoke)', artist: 'Sing2Guitar | Acoustic Karaoke', durationMs: 298000 };
    const vocal = scoreAlternateUpload(karaoke, candidate('Adele - Hello (Lyrics)', 'Rare Vibes', 290000));
    assert.ok(vocal === null || vocal < MIN_ALTERNATE_SCORE, `the vocal version scored ${vocal}`);
    const plain = scoreAlternateUpload(remix, candidate('The Weeknd - Blinding Lights', 'The Weeknd', 290000));
    assert.ok(plain === null || plain < MIN_ALTERNATE_SCORE, `the original mix scored ${plain}`);
    // "Live" in the song title itself ("Live Forever") is not a live recording
    const oasis = { title: 'Live Forever', artist: 'Oasis', durationMs: 276000 };
    const forever = scoreAlternateUpload(oasis, candidate('Oasis - Live Forever (Official Video)', 'Oasis', 280000));
    assert.ok(forever !== null && forever >= MIN_ALTERNATE_SCORE, `live forever scored ${forever}`);
  });

  test('a duration within 15 s is a strong signal; beyond 60 s the upload is rejected outright', () => {
    const close = scoreAlternateUpload(ORIGINAL, candidate('Blinding Lights', 'The Weeknd', 202000 + 14000));
    const further = scoreAlternateUpload(ORIGINAL, candidate('Blinding Lights', 'The Weeknd', 202000 + 40000));
    const unknownDuration = scoreAlternateUpload({ ...ORIGINAL, durationMs: 0 }, candidate('Blinding Lights', 'The Weeknd', 202000 + 40000));
    assert.ok(close !== null && further !== null && close > further);
    assert.equal(scoreAlternateUpload(ORIGINAL, candidate('Blinding Lights', 'The Weeknd', 202000 + 61000)), null);
    assert.equal(scoreAlternateUpload(ORIGINAL, candidate('Blinding Lights', 'The Weeknd', 20 * 60 * 1000)), null);
    // Without a known original duration nothing is rejected for its length
    assert.ok(unknownDuration !== null && unknownDuration >= MIN_ALTERNATE_SCORE);
  });

  test('another song by the same artist, or the same title by someone else, is not good enough', () => {
    const otherSong = scoreAlternateUpload(ORIGINAL, candidate('Save Your Tears', 'The Weeknd'));
    const otherArtist = scoreAlternateUpload(ORIGINAL, candidate('Lights', 'Ellie Goulding', 240000));
    assert.ok(otherSong === null || otherSong < MIN_ALTERNATE_SCORE, `other song scored ${otherSong}`);
    assert.ok(otherArtist === null || otherArtist < MIN_ALTERNATE_SCORE, `other artist scored ${otherArtist}`);
  });

  test('the uploader may be a "- Topic" or VEVO channel and the original a YouTube-style title', () => {
    const original = { title: 'Kavinsky - Nightcall (Official Audio)', artist: 'Record Makers', durationMs: 258000 };
    const topic = scoreAlternateUpload(original, candidate('Nightcall', 'Kavinsky - Topic', 258000));
    assert.ok(topic !== null && topic >= 90, `topic scored ${topic}`);
  });

  test('the same title by an uploader that does not name the artist is not enough (an unlabelled cover)', () => {
    const coldplay = { title: 'Yellow', artist: 'Coldplay', durationMs: 273000 };
    const cover = scoreAlternateUpload(coldplay, candidate('Yellow', 'Daniel Jang', 273000));
    assert.ok(cover === null || cover < MIN_ALTERNATE_SCORE, `cover scored ${cover}`);
    const swapped = scoreAlternateUpload(coldplay, candidate('Yellow - Daniel Jang', 'Daniel Jang', 273000));
    assert.ok(swapped === null || swapped < MIN_ALTERNATE_SCORE, `swapped scored ${swapped}`);
  });

  test('two re-uploads naming the same "Artist - Title" match each other, in either order', () => {
    const reupload = { title: 'The Weeknd - Blinding Lights', artist: 'David Dean Burkhart', durationMs: 203000 };
    for (const title of ['The Weeknd - Blinding Lights (Lyrics)', 'Blinding Lights - The Weeknd (Lyrics)']) {
      const score = scoreAlternateUpload(reupload, candidate(title, '7clouds', 201000));
      assert.ok(score !== null && score >= 90, `${title} scored ${score}`);
    }
  });

  test('TV performances, dance practices and fancams are other recordings', () => {
    const bts = { title: 'Dynamite', artist: 'BTS', durationMs: 224000 };
    for (const title of [
      'BTS(방탄소년단) - Dynamite (2020 KBS Song Festival) I KBS WORLD TV 201218',
      'BTS (방탄소년단) - Dynamite Dance Practice (Mirrored)',
      'BTS - Dynamite @ MMA 2020 Performance',
      '[FANCAM] BTS Dynamite',
    ]) {
      const score = scoreAlternateUpload(bts, candidate(title, 'KBS WORLD TV', 230000));
      assert.ok(score === null || score < MIN_ALTERNATE_SCORE, `${title} scored ${score}`);
    }
  });

  test('non-Latin titles are compared too', () => {
    const original = { title: 'Tum Hi Ho', artist: 'Arijit Singh', durationMs: 262000 };
    assert.ok((scoreAlternateUpload(original, candidate('Tum Hi Ho - Arijit Singh', 'T-Series', 262000)) ?? 0) >= 90);
    const korean = { title: '봄날', artist: 'BTS', durationMs: 274000 };
    assert.ok((scoreAlternateUpload(korean, candidate('BTS (방탄소년단) 봄날 (Spring Day)', 'HYBE LABELS', 275000)) ?? 0) >= MIN_ALTERNATE_SCORE);
  });

  test('scoring stays fast on hostile input (linear time)', () => {
    const long = '((((('.repeat(20000) + 'a'.repeat(50000);
    const started = Date.now();
    scoreAlternateUpload({ title: long, artist: long, durationMs: 200000 }, candidate(long, long));
    assert.ok(Date.now() - started < 200);
  });
});

describe('ranking and choosing', () => {
  test('ranked best first, without tried uploads or anything below the minimum score', () => {
    const tried = candidate('Blinding Lights', 'The Weeknd');
    const cover = candidate('Blinding Lights (Cover)', 'Someone');
    const lyric = candidate('The Weeknd - Blinding Lights (Lyrics)', 'Lyrics Hub', 230000);
    const best = candidate('Blinding Lights', 'The Weeknd', 202000);
    const ranked = rankAlternateUploads(ORIGINAL, [tried, cover, lyric, best], [tried.videoId]);
    assert.deepEqual(ranked.map((r) => r.candidate.videoId), [best.videoId, lyric.videoId]);
    assert.ok(ranked[0].score >= ranked[1].score);
    assert.deepEqual(rankAlternateUploads(ORIGINAL, [cover], []), []);
  });

  test('a candidate known to be embeddable wins; one known not to be is never chosen', () => {
    const first = candidate('Blinding Lights', 'The Weeknd');
    const second = candidate('Blinding Lights', 'The Weeknd');
    const third = candidate('Blinding Lights', 'The Weeknd');
    const ranked = rankAlternateUploads(ORIGINAL, [first, second, third], []);
    const known = (map: Record<string, boolean | null>) => (videoId: string) => map[videoId];
    assert.equal(chooseAlternateUpload(ranked, known({ [first.videoId]: false, [second.videoId]: null, [third.videoId]: true }))?.videoId, third.videoId);
    // Unknown (the check failed) still counts as playable, after the known-good ones
    assert.equal(chooseAlternateUpload(ranked, known({ [first.videoId]: false, [second.videoId]: null }))?.videoId, second.videoId);
    assert.equal(chooseAlternateUpload(ranked, known({ [first.videoId]: false, [second.videoId]: false, [third.videoId]: false })), null);
    assert.equal(chooseAlternateUpload([], known({})), null);
  });
});

describe('credit lists, title segments and more version markers', () => {
  const A = { title: 'Humsafar', artist: 'Akhil Sachdeva & Mansheel Gujral', durationMs: 269000 };
  const B = { title: 'Humsafar (Movie: Saiyaara)', artist: 'Sachet-Parampara, Sachet Tandon, Parampara Tandon & Irshad Kamil', durationMs: 323000 };
  const C = { title: 'Humsafar', artist: 'Hadiqa Kiani', durationMs: 215000 };

  test('a Bollywood upload with the movie and a bitrate in the title is accepted, wrong versions are not', () => {
    const leo = candidate('Humsafar - Badrinath Ki Dulhania (2017) - Akhil Sachdeva & Mansheel Gujral - 320Kbps', 'Leo Studio 27', 269000);
    const lyrical = candidate('Humsafar - Akhil Sachdeva (Lyrics) | Lyrical Bam Hindi', 'LYRICAL BAM HINDI', 223000);
    const chipmunk = candidate("Akhil Sachdeva, Mansheel Gujral - Humsafar (From 'Badrinath Ki Dulhania') | Chipmunk Version", 'Chipmunked Music', 269000);
    const slowed = candidate('Sun Mere Humsafar (Slowed + Reverb) | Akhil Sachdeva & Mansheel Gujral | Night Vibes 🎧', 'Veyofficial ツ', 245000);
    const lofi = candidate('Humsafar (slowed+reverb) |Akhil Sachdeva,Mansheel Gujral |Varun,Alia Bhatt |"Badrinath ki Dulhania"', 'Lo-fi world', 269000);
    const leoScore = scoreAlternateUpload(A, leo);
    assert.ok(leoScore !== null && leoScore >= MIN_ALTERNATE_SCORE, `leo ${leoScore}`);
    for (const c of [chipmunk, slowed, lofi]) {
      const s = scoreAlternateUpload(A, c);
      assert.ok(s === null || s < MIN_ALTERNATE_SCORE, `${c.title}: ${s}`);
    }
    const ranked = rankAlternateUploads(A, [chipmunk, slowed, lofi, lyrical, leo], []);
    assert.equal(ranked[0].candidate.videoId, leo.videoId);
  });

  test('a credit list matches on any listed name; a lyric upload of a movie song is accepted', () => {
    const good = candidate('Humsafar (Lyrics) - Sachet Tandon & Parampara Tandon | Saiyaara | New Heartbreak Romantic Song', 'cadence spot', 311000);
    const score = scoreAlternateUpload(B, good);
    assert.ok(score !== null && score >= MIN_ALTERNATE_SCORE, `score ${score}`);
    const others = [
      candidate('Lyrical | Humsafar Song | Saiyaara | Ahaan, Aneet | Sachet Tandon, Parampara Tandon, Irshad Kamil', 'Maza Beats', 398000),
      candidate('Humsafar – Full Song | Saiyaara | Ahaan Panday | Aneet Padda | Sachet–Parampara | The Muzzic', 'THE MUZZIC', 192000),
    ];
    for (const c of others) assert.equal(scoreAlternateUpload(B, c), null);
  });

  test('another song of the same movie and singers never matches on the movie segment', () => {
    const original = { title: 'Humsafar | Saiyaara | Sachet Tandon', artist: 'Sachet Tandon', durationMs: 300000 };
    const other = candidate('Barbaad | Saiyaara | Sachet Tandon', 'Sachet Tandon', 300000);
    const s = scoreAlternateUpload(original, other);
    assert.ok(s === null || s < MIN_ALTERNATE_SCORE, `score ${s}`);
  });

  test('another singer with the same title stays rejected; the same singer scores high', () => {
    const ost = candidate('Humsafar | OST by Qurat-ul-Ain Balouch | HUM Music', 'HUM Music', 225000);
    const s = scoreAlternateUpload(C, ost);
    assert.ok(s === null || s < MIN_ALTERNATE_SCORE, `ost ${s}`);
    assert.equal(scoreAlternateUpload(C, candidate('Humsafar | Hadiqa Kiani', 'Hadiqa Kiani', 221000)), 100);
  });

  test('a single act named with "&" still matches, an en dash splits "Artist – Title"', () => {
    const o = { title: 'The Sound of Silence', artist: 'Simon & Garfunkel', durationMs: 185000 };
    const s = scoreAlternateUpload(o, candidate('Simon & Garfunkel – The Sound of Silence', 'Some Channel', 185000));
    assert.ok(s !== null && s >= MIN_ALTERNATE_SCORE, `score ${s}`);
  });

  test('new version markers count', () => {
    for (const t of ['Blinding Lights (Lo-Fi)', 'Blinding Lights lofi', 'Blinding Lights (Acoustic)', 'Blinding Lights Unplugged', 'Blinding Lights (Reprise)', 'Blinding Lights Female Version', 'Blinding Lights Bass Boosted', 'Blinding Lights Reverbed', 'Blinding Lights Ringtone', 'Blinding Lights Teaser']) {
      const s = scoreAlternateUpload(ORIGINAL, candidate(t, 'The Weeknd'));
      assert.ok(s !== null && s < MIN_ALTERNATE_SCORE, `${t}: ${s}`);
    }
  });

  test('a song titled only with noise words still matches itself', () => {
    const o = { title: 'Song 2', artist: 'Blur', durationMs: 122000 };
    const s = scoreAlternateUpload(o, candidate('Blur - Song 2 (Official Video)', 'Blur', 122000));
    assert.ok(s !== null && s >= MIN_ALTERNATE_SCORE, `score ${s}`);
    const only = scoreAlternateUpload({ title: 'Song', artist: 'Blur', durationMs: 122000 }, candidate('Song', 'Blur', 122000));
    assert.ok(only !== null && only >= MIN_ALTERNATE_SCORE, `only ${only}`);
  });
});
