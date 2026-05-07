const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { connectDB, logInfo } = require('./backend/db');

// Import IPC Handlers
const registerProductHandlers = require('./backend/ipc/products');
const registerSalesHandlers = require('./backend/ipc/sales');
const registerSupplierHandlers = require('./backend/ipc/suppliers');
const registerReportHandlers = require('./backend/ipc/reports');
const { registerSystemHandlers, registerPrinterHandlers } = require('./backend/ipc/system');

// Security & Environment
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
app.setPath('userData', path.join(app.getPath('appData'), 'MartOS Management'));

// Auto-Updater Configuration
autoUpdater.autoDownload = true;
autoUpdater.forceDevUpdateConfig = true;
if (app.isPackaged) {
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'HarisYaseen',
        repo: 'MartOS-RElease'
    });
}

let mainWindow;

// Security Wrapper for IPC
function secureHandle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
        const sender = BrowserWindow.fromWebContents(event.sender);
        if (!sender || sender !== mainWindow) {
            logInfo(`SECURITY ALERT: Unauthorized IPC call on channel: ${channel}`);
            return { success: false, error: 'Unauthorized sender' };
        }
        return handler(event, ...args);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, 
            nodeIntegration: false
        },
        title: 'MartOS Management',
        autoHideMenuBar: true
    });

    mainWindow.loadFile(path.join(__dirname, 'pages', 'dashboard.html'));

    mainWindow.once('ready-to-show', () => {
        autoUpdater.checkForUpdatesAndNotify();
    });
}

// Initialize System
app.whenReady().then(async () => {
    await connectDB();
    
    // Register All IPC Handlers (passing secureHandle)
    registerProductHandlers(secureHandle);
    registerSalesHandlers(secureHandle);
    registerSupplierHandlers(secureHandle);
    registerReportHandlers(secureHandle);
    registerSystemHandlers(secureHandle);
    registerPrinterHandlers(secureHandle);

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Auto-Updater Events
autoUpdater.on('checking-for-update', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', 'Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-available', info);
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) mainWindow.webContents.send('update-progress', progressObj.percent);
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-downloaded', info);
});

autoUpdater.on('error', (err) => {
    if (mainWindow) mainWindow.webContents.send('update-error', err.toString());
});
