/**
 * The one Metrolist window: dark from the first frame, title "Metrolist", minimum 360 x 560, size /
 * position / maximised state saved in `userData/window-state.json` and clamped to a visible display.
 */
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './jsonFile';
import { BACKGROUND_COLOR, secureWebPreferences } from './security';
import { MIN_SIZE, parseWindowState, restoreWindowState, type WindowState } from './policies/windowState';

const SAVE_DELAY_MS = 400;

export function createMainWindow(userDataDir: string): BrowserWindow {
  const stateFile = path.join(userDataDir, 'window-state.json');
  const restored = restoreWindowState(
    parseWindowState(readJsonFile(stateFile)),
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea
  );

  const win = new BrowserWindow({
    ...restored.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Metrolist',
    backgroundColor: BACKGROUND_COLOR,
    show: false,
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  if (restored.maximized) win.maximize();

  // The window keeps the product name; the page's longer <title> does not replace it
  win.on('page-title-updated', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());

  let saveTimer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    writeJsonFile(stateFile, state);
  };
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  };
  win.on('resize', saveSoon);
  win.on('move', saveSoon);
  win.on('maximize', saveSoon);
  win.on('unmaximize', saveSoon);
  win.on('close', save);

  return win;
}
