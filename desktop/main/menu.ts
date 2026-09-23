import { app, Menu, type MenuItemConstructorOptions } from "electron";
import type { ApiEvents } from "../../lib/api/contract";

type Command = ApiEvents["menu-command"]["command"];

export function buildMenu(opts: { isDev: boolean; send: (c: Command) => void; openDataFolder: () => void }): Menu {
  const mac = process.platform === "darwin";
  const item = (label: string, accelerator: string | undefined, command: Command): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => opts.send(command),
  });

  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              item("Settings…", "CmdOrCtrl+,", "settings"),
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        item("Add Property…", "CmdOrCtrl+Shift+P", "new-property"),
        item("New Maintenance Request…", "CmdOrCtrl+Shift+M", "new-maintenance"),
        item("Record Payment…", "CmdOrCtrl+Shift+R", "record-payment"),
        { type: "separator" },
        item("Search…", "CmdOrCtrl+K", "search"),
        { type: "separator" },
        item("Back Up…", undefined, "backup"),
        item("Restore from Backup…", undefined, "restore"),
        { label: "Show Data Folder", click: opts.openDataFolder },
        ...(mac ? [] : [{ type: "separator" } as const, item("Settings…", "Ctrl+,", "settings"), { role: "quit" } as const]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(opts.isDev ? ([{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }] as MenuItemConstructorOptions[]) : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
