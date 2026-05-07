const { ipcMain, app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { queryAll, run, logInfo } = require('../db');

function registerSystemHandlers() {
    ipcMain.handle('get-settings', () => {
        const rows = queryAll('SELECT * FROM settings');
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        return settings;
    });

    ipcMain.handle('save-settings', (e, settings) => {
        try {
            for (const [key, value] of Object.entries(settings)) {
                run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('get-version', () => app.getVersion());

    ipcMain.handle('check-for-updates', async () => {
        logInfo('Manual update check triggered.');
        const result = await autoUpdater.checkForUpdatesAndNotify();
        return { success: true, updateInfo: result ? result.updateInfo : null };
    });

    ipcMain.handle('quit-and-install', () => {
        autoUpdater.quitAndInstall();
        return { success: true };
    });
}

function registerPrinterHandlers() {
    ipcMain.handle('get-thermal-printer', async () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return null;
        const printers = await win.webContents.getPrintersAsync();
        const thermal = printers.find(p => 
            p.name.toLowerCase().includes('thermal') || 
            p.name.toLowerCase().includes('pos') || 
            p.name.toLowerCase().includes('80mm')
        );
        if (thermal) return thermal.name;
        const def = printers.find(p => p.isDefault);
        return def ? def.name : null;
    });

    ipcMain.handle('print-receipt-silent', async (e, { printerName, htmlContent }) => {
        let win = null;
        try {
            win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
            await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
            await new Promise(r => setTimeout(r, 500));
            await new Promise((resolve, reject) => {
                win.webContents.print({
                    silent: true,
                    deviceName: printerName,
                    printBackground: true,
                    margins: { marginType: 'none' },
                    pageSize: 'A4'
                }, (success, failureReason) => {
                    if (success) resolve();
                    else reject(new Error(failureReason));
                });
            });
            win.close();
            return { success: true };
        } catch (err) {
            if (win) win.close();
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerSystemHandlers, registerPrinterHandlers };
