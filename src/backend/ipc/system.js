const { app, dialog, BrowserWindow } = require('electron');
const { queryAll, run, saveDB, logInfo } = require('../db');
const fs = require('fs');
const path = require('path');

function registerSystemHandlers(handle) {
    handle('get-settings', () => {
        const rows = queryAll('SELECT * FROM settings');
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        return settings;
    });

    handle('save-settings', (e, settings) => {
        try {
            for (const [key, value] of Object.entries(settings)) {
                run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    handle('select-backup-dir', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
            title: 'Select Backup Location'
        });
        if (result.canceled) return null;
        return result.filePaths[0];
    });

    handle('create-backup', async (e, customPath) => {
        try {
            saveDB();
            const dbPath = path.join(app.getPath('userData'), 'mart_database.sqlite');
            if (!fs.existsSync(customPath)) fs.mkdirSync(customPath, { recursive: true });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(customPath, `mart_backup_${timestamp}.sqlite`);

            fs.copyFileSync(dbPath, backupPath);
            logInfo(`Backup created successfully at ${backupPath}`);
            return { success: true, path: backupPath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    handle('get-version', () => app.getVersion());

    handle('check-for-updates', async () => {
        const { autoUpdater } = require('electron-updater');
        const result = await autoUpdater.checkForUpdatesAndNotify();
        return { success: true, updateInfo: result ? result.updateInfo : null };
    });

    handle('quit-and-install', () => {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.quitAndInstall();
        return { success: true };
    });
}

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
