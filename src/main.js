const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let db;

function logInfo(msg) { console.log(`[INFO] ${new Date().toLocaleTimeString()}: ${msg}`); }

async function connectDB() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'mart_database.sqlite');
    
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        logInfo('Database loaded from AppData.');
    } else {
        db = new SQL.Database();
        logInfo('New system initialized.');
        fs.writeFileSync(dbPath, Buffer.from(db.export()));
    }
    ensureTables();
}

function ensureTables() {
    // Standard Tables for Mart System
    db.run(`CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        brand TEXT,
        category TEXT DEFAULT 'General',
        unit TEXT DEFAULT 'pcs',
        cost_price REAL DEFAULT 0,
        sale_price REAL DEFAULT 0,
        quantity INTEGER DEFAULT 0,
        reorder_level INTEGER DEFAULT 10,
        supplier_id INTEGER,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT UNIQUE NOT NULL,
        total_amount REAL NOT NULL,
        discount REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        net_amount REAL NOT NULL,
        payment_method TEXT,
        amount_paid REAL,
        change_amount REAL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER,
        product_id INTEGER,
        product_name TEXT,
        barcode TEXT,
        quantity INTEGER,
        unit_price REAL,
        subtotal REAL
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_number TEXT UNIQUE NOT NULL,
        supplier_id INTEGER,
        total_cost REAL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        received_at TEXT
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_order_id INTEGER,
        product_id INTEGER,
        product_name TEXT,
        barcode TEXT,
        quantity INTEGER,
        unit_cost REAL,
        subtotal REAL
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );`);

    // Initialize default settings if they don't exist
    const martName = queryOne('SELECT value FROM settings WHERE key = "mart_name"');
    if (!martName) {
        db.run('INSERT INTO settings (key, value) VALUES ("mart_name", "MartOS Management")');
        db.run('INSERT INTO settings (key, value) VALUES ("receipt_footer", "Thank you for shopping with us!")');
    }

    saveDB();
}

function saveDB() {
    if (!db) return;
    const dbPath = path.join(app.getPath('userData'), 'mart_database.sqlite');
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function queryOne(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
        stmt.free(); return null;
    } catch (e) { console.error('queryOne error:', e.message, sql); return null; }
}

function queryAll(sql, params = []) {
    try {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free(); return results;
    } catch (e) { console.error('queryAll error:', e.message, sql); return []; }
}

function run(sql, params = []) {
    try { 
        db.run(sql, params); 
        saveDB(); 
        return { success: true }; 
    } catch (e) { 
        console.error('SQL run error:', e.message, sql); 
        return { success: false, error: e.message }; 
    }
}

// ========================= IPC HANDLERS =========================

// Dashboard Stats
ipcMain.handle('get-dashboard-stats', () => {
    const totalProducts = queryOne('SELECT COUNT(*) as c FROM products')?.c || 0;
    const lowStock = queryOne('SELECT COUNT(*) as c FROM products WHERE quantity <= reorder_level')?.c || 0;
    const todaySales = queryOne("SELECT COUNT(*) as c FROM sales WHERE date(created_at) = date('now', 'localtime')")?.c || 0;
    const todayRevenue = queryOne("SELECT SUM(net_amount) as s FROM sales WHERE date(created_at) = date('now', 'localtime')")?.s || 0;
    
    return {
        totalProducts,
        lowStock,
        todaySales,
        todayRevenue: todayRevenue || 0
    };
});

// Products
ipcMain.handle('get-products', () => queryAll('SELECT p.*, s.name as supplier_name FROM products p LEFT JOIN suppliers s ON p.supplier_id = s.id ORDER BY p.name'));
ipcMain.handle('get-product-by-barcode', (e, barcode) => queryOne('SELECT * FROM products WHERE barcode = ?', [barcode]));
ipcMain.handle('search-products', (e, query) => {
    return queryAll('SELECT * FROM products WHERE barcode = ? OR name LIKE ?', [query, `%${query}%`]);
});
ipcMain.handle('save-product', (e, p) => {
    if (p.id) {
        return run('UPDATE products SET name=?, barcode=?, brand=?, category=?, unit=?, cost_price=?, sale_price=?, quantity=?, reorder_level=?, supplier_id=?, updated_at=datetime("now", "localtime") WHERE id=?', 
            [p.name, p.barcode, p.brand || '', p.category, p.unit, p.cost_price, p.sale_price, p.quantity, p.reorder_level, p.supplier_id || null, p.id]);
    } else {
        return run('INSERT INTO products (name, barcode, brand, category, unit, cost_price, sale_price, quantity, reorder_level, supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?)', 
            [p.name, p.barcode, p.brand || '', p.category, p.unit, p.cost_price, p.sale_price, p.quantity, p.reorder_level, p.supplier_id || null]);
    }
});

ipcMain.handle('lookup-barcode-external', async (e, barcode) => {
    try {
        logInfo(`Looking up barcode: ${barcode}`);
        
        // Source 1: Open Food Facts
        try {
            const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
            const data = await response.json();
            if (data.status === 1 && data.product) {
                const p = data.product;
                const name = p.product_name || p.generic_name || '';
                let category = p.categories ? p.categories.split(',')[0] : 'General';
                // Clean up category (remove "en:" or other language prefixes)
                if (category.includes(':')) category = category.split(':').pop();
                
                return {
                    success: true,
                    product: {
                        name: name,
                        brand: p.brands || name.split(' ')[0] || '', // Guess brand from name if empty
                        category: category.charAt(0).toUpperCase() + category.slice(1)
                    }
                };
            }
        } catch (err) { console.log('OFF Lookup failed, trying fallback...'); }

        // Source 2: UPCItemDB (Trial API)
        try {
            const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                const item = data.items[0];
                let category = item.category ? item.category.split('>').pop().trim() : 'General';
                if (category.includes(':')) category = category.split(':').pop();

                return {
                    success: true,
                    product: {
                        name: item.title || '',
                        brand: item.brand || item.title.split(' ')[0] || '',
                        category: category.charAt(0).toUpperCase() + category.slice(1)
                    }
                };
            }
        } catch (err) { console.log('UPCItemDB Lookup failed.'); }

        return { success: false, error: 'Product not found in global databases.' };
    } catch (e) {
        console.error('Barcode lookup error:', e.message);
        return { success: false, error: 'Failed to connect to lookup services.' };
    }
});

// Sales
ipcMain.handle('process-sale', (e, { items, total, discount, tax, net, method, paid }) => {
    const receiptNo = 'RCP-' + Date.now();
    const change = paid - net;
    
    const res = run('INSERT INTO sales (receipt_number, total_amount, discount, tax, net_amount, payment_method, amount_paid, change_amount) VALUES (?,?,?,?,?,?,?,?)', 
        [receiptNo, total, discount, tax, net, method, paid, change]);
    
    if (res.success) {
        const saleId = queryOne('SELECT id FROM sales WHERE receipt_number = ?', [receiptNo]).id;
        items.forEach(item => {
            run('INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, subtotal) VALUES (?,?,?,?,?,?,?)', 
                [saleId, item.id, item.name, item.barcode, item.quantity, item.sale_price, item.quantity * item.sale_price]);
            // Update stock
            run('UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.id]);
        });
        return { success: true, receiptNo };
    }
    return res;
});

// Suppliers
ipcMain.handle('get-suppliers', () => queryAll('SELECT * FROM suppliers ORDER BY name'));
ipcMain.handle('save-supplier', (e, s) => {
    if (s.id) {
        return run('UPDATE suppliers SET name=?, contact_name=?, phone=?, email=?, address=? WHERE id=?', 
            [s.name, s.contact_name, s.phone, s.email, s.address, s.id]);
    } else {
        return run('INSERT INTO suppliers (name, contact_name, phone, email, address) VALUES (?,?,?,?,?)', 
            [s.name, s.contact_name, s.phone, s.email, s.address]);
    }
});

// History & Inventory
ipcMain.handle('get-sales', () => queryAll('SELECT * FROM sales ORDER BY created_at DESC'));
ipcMain.handle('get-sales-history', () => queryAll('SELECT * FROM sales ORDER BY created_at DESC'));
ipcMain.handle('get-sale-items', (e, saleId) => queryAll('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]));

ipcMain.handle('get-inventory-report', () => {
    return queryAll(`SELECT p.*, s.name as supplier_name 
                    FROM products p 
                    LEFT JOIN suppliers s ON p.supplier_id = s.id 
                    WHERE p.quantity <= p.reorder_level 
                    ORDER BY p.quantity ASC`);
});

ipcMain.handle('adjust-stock', (e, { productId, delta, reason }) => {
    return run('UPDATE products SET quantity = quantity + ?, updated_at = datetime("now", "localtime") WHERE id = ?', [delta, productId]);
});

// Reports & Analytics
ipcMain.handle('get-sales-analytics', () => {
    return queryAll(`SELECT date(created_at) as date, SUM(net_amount) as revenue, COUNT(*) as transactions 
                    FROM sales 
                    WHERE created_at >= date('now', '-30 days')
                    GROUP BY date(created_at) 
                    ORDER BY date ASC`);
});

ipcMain.handle('get-top-products', () => {
    return queryAll(`SELECT product_name as name, SUM(quantity) as total_sold, SUM(subtotal) as revenue 
                    FROM sale_items 
                    GROUP BY product_id 
                    ORDER BY total_sold DESC 
                    LIMIT 10`);
});

ipcMain.handle('get-category-sales', () => {
    return queryAll(`SELECT p.category, SUM(si.quantity) as total_sold, SUM(si.subtotal) as revenue 
                    FROM sale_items si
                    JOIN products p ON si.product_id = p.id
                    GROUP BY p.category
                    ORDER BY revenue DESC`);
});

// Purchase Orders
ipcMain.handle('get-purchase-orders', () => {
    return queryAll(`SELECT po.*, s.name as supplier_name 
                    FROM purchase_orders po 
                    LEFT JOIN suppliers s ON po.supplier_id = s.id 
                    ORDER BY po.created_at DESC`);
});

ipcMain.handle('create-po', (e, { supplierId, items }) => {
    const poNumber = 'PO-' + Date.now();
    const totalCost = items.reduce((sum, item) => sum + (item.quantity * item.cost_price), 0);
    
    const res = run('INSERT INTO purchase_orders (po_number, supplier_id, total_cost, status) VALUES (?,?,?,?)', 
        [poNumber, supplierId, totalCost, 'pending']);
    
    if (res.success) {
        const poId = queryOne('SELECT last_insert_rowid() as id').id;
        items.forEach(item => {
            run('INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, barcode, quantity, unit_cost, subtotal) VALUES (?,?,?,?,?,?,?)', 
                [poId, item.id, item.name, item.barcode, item.quantity, item.cost_price, item.quantity * item.cost_price]);
        });
        return { success: true, poNumber };
    }
    return res;
});

ipcMain.handle('receive-po', (e, poId) => {
    const items = queryAll('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
    items.forEach(item => {
        run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
    });
    return run('UPDATE purchase_orders SET status = "received", received_at = datetime("now", "localtime") WHERE id = ?', [poId]);
});

ipcMain.handle('create-backup-to-d', async () => {
    try {
        const userDataPath = app.getPath('userData');
        const dbPath = path.join(userDataPath, 'mart_database.sqlite');
        
        // Ensure database is saved before backup
        saveDB();

        const backupDir = 'D:\\MartBackups';
        if (!fs.existsSync('D:\\')) {
            return { success: false, error: 'D: drive not found. Please insert a drive or check partition.' };
        }

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `mart_backup_${timestamp}.sqlite`);
        
        fs.copyFileSync(dbPath, backupPath);
        logInfo(`Backup created successfully at ${backupPath}`);
        
        return { success: true, path: backupPath };
    } catch (e) {
        console.error('Backup error:', e.message);
        return { success: false, error: e.message };
    }
});

// Settings Handlers
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

// Printer Handlers
ipcMain.handle('get-thermal-printer', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const printers = await win.webContents.getPrintersAsync();
    // Try to find a printer with 'thermal' or 'pos' in the name
    const thermal = printers.find(p => 
        p.name.toLowerCase().includes('thermal') || 
        p.name.toLowerCase().includes('pos') || 
        p.name.toLowerCase().includes('80mm')
    );
    if (thermal) return thermal.name;
    
    // Fallback to default printer
    const def = printers.find(p => p.isDefault);
    return def ? def.name : null;
});

ipcMain.handle('print-receipt-silent', async (e, { printerName, htmlContent }) => {
    try {
        const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        
        await new Promise((resolve, reject) => {
            win.webContents.print({
                silent: true,
                deviceName: printerName,
                printBackground: true,
                margins: { marginType: 'none' }
            }, (success, failureReason) => {
                if (success) resolve();
                else reject(new Error(failureReason));
            });
        });
        
        win.close();
        return { success: true };
    } catch (err) {
        console.error('Print error:', err.message);
        return { success: false, error: err.message };
    }
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1280, height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        },
        title: 'Mart Management System',
        autoHideMenuBar: true
    });
    win.loadFile(path.join(__dirname, 'pages', 'dashboard.html'));
}

app.whenReady().then(async () => {
    await connectDB();
    createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
