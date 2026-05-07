# MartOS Project Roadmap & Issue Log

## 🔒 Security
- [ ] **No authentication** — Add login screen/PIN/password.
- [ ] **No user roles** — Implement cashier vs manager permissions.
- [ ] **Security Vulnerability** — Remove `nodeIntegration: true` from thermal print window.
- [ ] **IPC Verification** — Add sender verification to `ipcMain.handle`.
- [ ] **Input Validation** — Sanitize and validate all data before database insertion.

## ⚠️ Data Integrity
- [ ] **SQL Transactions** — Wrap sale inserts and stock deductions in transactions.
- [ ] **Negative Stock Guard** — Prevent sales if stock is insufficient.
- [ ] **Backup Path** — Make the backup path user-selectable (not hardcoded to D:).
- [ ] **Crash Protection** — Implement periodic `sql.js` memory-to-disk flushes.
- [ ] **Backend Cleanup** — Remove the dead `drizzle-orm` code and consolidate backends.

## 🔧 Code Quality
- [ ] **Refactoring** — Break down the 458-line `main.js` "God File".
- [ ] **Error Handling** — Implement robust error checking in the renderer for all IPC calls.
- [ ] **Configuration** — Use a `.env` or config file for hardcoded strings/paths.
- [ ] **Standardization** — Add ESLint and Prettier for consistent code style.
- [ ] **Testing** — Implement basic unit and integration tests.

## ✨ Missing Features / UX Gaps
- [ ] **Refunds/Voids** — Add ability to cancel or reverse a sale.
- [ ] **PO Stock Integration** — Ensure `receive-po` actually increments product quantities.
- [ ] **Pagination** — Add pagination to the Sales List (remove 50-row hard cap).
- [ ] **Foreign Key Protection** — Add guards when deleting Suppliers/Products to protect history.

## 🛡 Reliability
- [ ] **Crash-Safe Writes** — Ensure data is written to disk frequently.
- [ ] **Auto-Backups** — Implement a scheduled background backup task.
- [ ] **Multi-Device Support** — (Future) Research multi-machine sync options.
