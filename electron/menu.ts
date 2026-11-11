/**
 * macOS: the standard app menu (About, Hide, Quit), an Edit menu (without it Cmd+C / Cmd+V do not work
 * in text fields), View and Window menus. Windows / Linux: no menu bar (copy and paste work without one).
 */
import { Menu, app, type MenuItemConstructorOptions } from 'electron';

export function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  app.setAboutPanelOptions({
    applicationName: 'Metrolist',
    applicationVersion: app.getVersion(),
    copyright: 'Metrolist contributors',
  });
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
