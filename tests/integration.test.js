const initSqlJs = require('sql.js');

describe('MartOS Integration Tests (Database & Business Logic)', () => {
    let db;
    let SQL;

    beforeAll(async () => {
        SQL = await initSqlJs();
    });

    beforeEach(() => {
        db = new SQL.Database();
        
        // Schema with explicit types
        db.run(`CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT, name TEXT, quantity INTEGER, sale_price REAL, cost_price REAL)`);
        db.run(`CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT, total_amount REAL, net_amount REAL)`);
        db.run(`CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER, quantity INTEGER, unit_price REAL)`);
        
        // Seed
        db.run(`INSERT INTO products (barcode, name, quantity, sale_price, cost_price) VALUES ('123', 'Test Product', 10, 100, 50)`);
    });

    afterEach(() => {
        db.close();
    });

    function getOne(sql, params = []) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const res = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return res;
    }

    test('Atomic Sale: Should deduct stock and create sale record', () => {
        db.run('BEGIN TRANSACTION');
        
        db.run('UPDATE products SET quantity = quantity - ? WHERE id = ?', [3, 1]);
        db.run('INSERT INTO sales (receipt_number, total_amount, net_amount) VALUES (?, ?, ?)', ['RCP-001', 300, 300]);
        db.run('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)', [1, 1, 3, 100]);
        
        db.run('COMMIT');

        const product = getOne('SELECT quantity FROM products WHERE id = 1');
        const saleItem = getOne('SELECT quantity FROM sale_items WHERE sale_id = 1');
        
        expect(product.quantity).toBe(7);
        expect(saleItem.quantity).toBe(3);
    });

    test('Transaction Rollback: Should not deduct stock if logic fails', () => {
        const initial = getOne('SELECT quantity FROM products WHERE id = 1').quantity;
        
        try {
            db.run('BEGIN TRANSACTION');
            db.run('UPDATE products SET quantity = quantity - 5 WHERE id = 1');
            
            // Simulate error
            throw new Error('Forced Error');
            
            db.run('COMMIT');
        } catch (err) {
            db.run('ROLLBACK');
        }

        const product = getOne('SELECT quantity FROM products WHERE id = 1');
        expect(product.quantity).toBe(initial);
    });

    test('Refund Logic: Should restore stock correctly', () => {
        // Setup sale
        db.run(`INSERT INTO sales (id, receipt_number, total_amount, net_amount) VALUES (10, 'RCP-X', 100, 100)`);
        db.run(`INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price) VALUES (50, 10, 1, 1, 100)`);
        db.run(`UPDATE products SET quantity = 9 WHERE id = 1`);

        // Refund action
        db.run('BEGIN TRANSACTION');
        db.run('UPDATE products SET quantity = quantity + 1 WHERE id = 1');
        db.run('DELETE FROM sale_items WHERE id = 50');
        db.run('UPDATE sales SET total_amount = 0 WHERE id = 10');
        db.run('COMMIT');

        const product = getOne('SELECT quantity FROM products WHERE id = 1');
        expect(product.quantity).toBe(10);
        
        const sale = getOne('SELECT total_amount FROM sales WHERE id = 10');
        expect(sale.total_amount).toBe(0);
    });
});
