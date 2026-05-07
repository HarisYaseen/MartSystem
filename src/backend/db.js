const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let db;

function logInfo(msg) { console.log(`[INFO] ${new Date().toLocaleTimeString()}: ${msg}`); }

async function connectDB() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'mart_database.sqlite');
    
    logInfo(`Database path: ${dbPath}`);
    
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        logInfo('Database loaded successfully.');
    } else {
        db = new SQL.Database();
        logInfo('New system database initialized.');
        fs.writeFileSync(dbPath, Buffer.from(db.export()));
    }
    ensureTables();
    
    // Auto-save heartbeat
    setInterval(() => {
        saveDB();
    }, 5 * 60 * 1000); 
}

function ensureTables() {
    // Suppliers
    db.run(`CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        current_balance REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );`);

    // Products
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
        expiry_date TEXT,
        supplier_id INTEGER,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );`);

    // Sales
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

    // Purchase Orders
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

    // Ledger & Payments
    db.run(`CREATE TABLE IF NOT EXISTS supplier_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER,
        transaction_type TEXT,
        ref_id INTEGER,
        ref_number TEXT,
        description TEXT,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        balance REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER,
        amount REAL NOT NULL,
        payment_method TEXT,
        reference TEXT,
        note TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );`);

    // Default settings
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
        const cleanParams = params.map(p => p === undefined ? null : p);
        db.run(sql, cleanParams); 
        saveDB(); 
        return { success: true }; 
    } catch (e) { 
        console.error('SQL run error:', e.message || e, sql); 
        return { success: false, error: e.message || e }; 
    }
}

function getDB() { return db; }

module.exports = { 
    connectDB, 
    saveDB, 
    queryOne, 
    queryAll, 
    run, 
    getDB,
    logInfo 
};
