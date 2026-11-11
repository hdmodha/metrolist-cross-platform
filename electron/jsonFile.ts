/** Small JSON files in `userData` (window state, port notices). Failures never stop the app. */
import fs from 'node:fs';
import path from 'node:path';

export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Writes atomically (temp file + rename), so a crash mid-write never leaves a corrupt file. */
export function writeJsonFile(file: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
  } catch (err) {
    console.warn(`[metrolist] could not save ${path.basename(file)}:`, err);
  }
}
