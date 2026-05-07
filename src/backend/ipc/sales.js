const { queryOne, queryAll, run, saveDB, getDB, logInfo } = require('../db');

function registerSalesHandlers(handle) {
    handle('process-sale', (e, { items, total, discount, tax, net, method, paid }) => {
        const db = getDB();
        try {
            db.run('BEGIN TRANSACTION');

            const receiptNo = 'RCP-' + Date.now();
            const change = paid - net;
            
            const saleStmt = db.prepare('INSERT INTO sales (receipt_number, total_amount, discount, tax, net_amount, payment_method, amount_paid, change_amount) VALUES (?,?,?,?,?,?,?,?)');
            saleStmt.run([receiptNo, total, discount, tax, net, method, paid, change]);
            saleStmt.free();

            const saleRow = queryOne('SELECT id FROM sales WHERE receipt_number = ?', [receiptNo]);
            const saleId = saleRow.id;

            for (const item of items) {
                const product = queryOne('SELECT quantity, name, cost_price FROM products WHERE id = ?', [item.id]);
                if (!product || product.quantity < item.quantity) {
                    db.run('ROLLBACK');
                    return { success: false, error: `Insufficient stock for ${product ? product.name : 'Unknown Product'}.` };
                }

                const itemStmt = db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, cost_price, subtotal) VALUES (?,?,?,?,?,?,?,?)');
                itemStmt.run([saleId, item.id, item.name, item.barcode, item.quantity, item.sale_price, product.cost_price || 0, item.quantity * item.sale_price]);
                itemStmt.free();

                const stockStmt = db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?');
                stockStmt.run([item.quantity, item.id]);
                stockStmt.free();
            }

            db.run('COMMIT');
            saveDB();

            return { success: true, receiptNo };
        } catch (err) {
            db.run('ROLLBACK');
            return { success: false, error: err.message };
        }
    });

    handle('get-sales', () => queryAll('SELECT * FROM sales ORDER BY created_at DESC LIMIT 50'));
    
    handle('get-sales-history', (e, { page = 1, pageSize = 20 } = {}) => {
        const offset = (page - 1) * pageSize;
        return queryAll(`SELECT * FROM sales ORDER BY created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset]);
    });

    handle('get-sales-count', () => {
        const res = queryOne('SELECT COUNT(*) as count FROM sales');
        return res ? res.count : 0;
    });

    handle('get-sale-items', (e, saleId) => queryAll('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]));

    handle('return-sale-item', async (e, { saleId, itemId, productId, quantity, unitPrice }) => {
        const db = getDB();
        try {
            db.run('BEGIN TRANSACTION');
            db.run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [quantity, productId]);
            db.run('DELETE FROM sale_items WHERE id = ?', [itemId]);
            const refundAmount = quantity * unitPrice;
            db.run('UPDATE sales SET total_amount = total_amount - ?, net_amount = net_amount - ? WHERE id = ?', [refundAmount, refundAmount, saleId]);
            const remaining = queryOne('SELECT COUNT(*) as count FROM sale_items WHERE sale_id = ?', [saleId]);
            if (remaining.count === 0) {
                db.run('DELETE FROM sales WHERE id = ?', [saleId]);
            }
            db.run('COMMIT');
            saveDB();
            return { success: true };
        } catch (err) {
            db.run('ROLLBACK');
            return { success: false, error: err.message };
        }
    });

    handle('refund-sale', async (e, saleId) => {
        const db = getDB();
        try {
            db.run('BEGIN TRANSACTION');
            const items = queryAll('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', [saleId]);
            for (const item of items) {
                db.run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
            }
            db.run('DELETE FROM sale_items WHERE id = ?', [saleId]);
            db.run('DELETE FROM sales WHERE id = ?', [saleId]);
            db.run('COMMIT');
            saveDB();
            return { success: true };
        } catch (err) {
            db.run('ROLLBACK');
            return { success: false, error: err.message };
        }
    });
}

module.exports = registerSalesHandlers;
