const { drizzle } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

// Path to SQLite database
const dbPath = process.env.SQLITE_DB_PATH || path.join(app.getPath('userData'), 'sqlite.db');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log('Database path:', dbPath);

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

module.exports = { db, sqlite };
