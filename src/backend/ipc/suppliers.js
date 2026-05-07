const { queryOne, queryAll, run, saveDB, getDB, logInfo } = require('../db');

function registerSupplierHandlers(handle) {
    handle('get-suppliers', () => queryAll('SELECT * FROM suppliers ORDER BY name'));
    
    handle('save-supplier', (e, s) => {
        if (!s.name || s.name.trim() === '') return { success: false, error: 'Supplier name is required.' };
        if (s.id) {
            return run('UPDATE suppliers SET name=?, contact_name=?, phone=?, email=?, address=? WHERE id=?',
                [s.name, s.contact_name, s.phone, s.email, s.address, s.id]);
        } else {
            return run('INSERT INTO suppliers (name, contact_name, phone, email, address) VALUES (?,?,?,?,?)',
                [s.name, s.contact_name, s.phone, s.email, s.address]);
        }
    });

    handle('delete-supplier', async (e, id) => {
        const pos = queryOne('SELECT COUNT(*) as count FROM purchase_orders WHERE supplier_id = ?', [id]);
        if (pos && pos.count > 0) {
            return { success: false, error: 'Cannot delete supplier with purchase order history.' };
        }
        const supplier = queryOne('SELECT current_balance FROM suppliers WHERE id = ?', [id]);
        if (supplier && Math.abs(supplier.current_balance) > 0.01) {
            return { success: false, error: 'Cannot delete supplier with an outstanding balance.' };
        }
        return run('DELETE FROM suppliers WHERE id = ?', [id]);
    });

    handle('get-supplier-ledger', (e, supplierId) => {
        return queryAll('SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY created_at DESC', [supplierId]);
    });

    handle('add-supplier-payment', (e, { supplierId, amount, method, ref, note }) => {
        try {
            const actualRef = ref || 'PAY-' + Date.now();
            const paymentRes = run('INSERT INTO supplier_payments (supplier_id, amount, payment_method, reference, note) VALUES (?,?,?,?,?)',
                [supplierId, amount, method, actualRef, note]);

            if (paymentRes.success) {
                const payRow = queryOne('SELECT id FROM supplier_payments WHERE reference = ?', [actualRef]);
                const paymentId = payRow ? payRow.id : null;
                const supplier = queryOne('SELECT current_balance FROM suppliers WHERE id = ?', [supplierId]);
                const currentBalance = supplier ? supplier.current_balance : 0;
                const newBalance = currentBalance - amount;
                run('INSERT INTO supplier_ledger (supplier_id, transaction_type, ref_id, ref_number, description, credit, balance) VALUES (?,?,?,?,?,?,?)',
                    [supplierId, 'payment', paymentId, actualRef, 'Payment made to supplier', amount, newBalance]);
                run('UPDATE suppliers SET current_balance = ? WHERE id = ?', [newBalance, supplierId]);
                return { success: true };
            }
            return paymentRes;
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    handle('get-purchase-orders', () => {
        return queryAll(`SELECT po.*, s.name as supplier_name 
                        FROM purchase_orders po 
                        LEFT JOIN suppliers s ON po.supplier_id = s.id 
                        ORDER BY po.created_at DESC`);
    });

    handle('create-po', (e, { supplierId, items }) => {
        const poNumber = 'PO-' + Date.now();
        const totalCost = items.reduce((sum, item) => sum + (item.quantity * item.cost_price), 0);
        const res = run('INSERT INTO purchase_orders (po_number, supplier_id, total_cost, status) VALUES (?,?,?,?)',
            [poNumber, supplierId, totalCost, 'pending']);

        if (res.success) {
            const poRow = queryOne('SELECT id FROM purchase_orders WHERE po_number = ?', [poNumber]);
            const poId = poRow ? poRow.id : null;
            items.forEach(item => {
                const subtotal = item.quantity * item.cost_price;
                run('INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, barcode, quantity, unit_cost, subtotal) VALUES (?,?,?,?,?,?,?)',
                    [poId, item.id, item.name, item.barcode, item.quantity, item.cost_price, subtotal]);
            });
            if (supplierId) {
                const currentBalance = queryOne('SELECT current_balance FROM suppliers WHERE id = ?', [supplierId]).current_balance || 0;
                const newBalance = currentBalance + totalCost;
                run('INSERT INTO supplier_ledger (supplier_id, transaction_type, ref_id, ref_number, description, debit, balance) VALUES (?,?,?,?,?,?,?)',
                    [supplierId, 'purchase', poId, poNumber, 'Purchase Order Created', totalCost, newBalance]);
                run('UPDATE suppliers SET current_balance = ? WHERE id = ?', [newBalance, supplierId]);
            }
            return { success: true, poNumber };
        }
        return res;
    });

    handle('receive-purchase-order', (e, poId) => {
        const db = getDB();
        try {
            db.run('BEGIN TRANSACTION');
            const items = queryAll('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
            for (const item of items) {
                db.run('UPDATE products SET quantity = quantity + ?, updated_at = datetime("now", "localtime") WHERE id = ?', [item.quantity, item.product_id]);
            }
            db.run('UPDATE purchase_orders SET status = "received", received_at = datetime("now", "localtime") WHERE id = ?', [poId]);
            db.run('COMMIT');
            saveDB();
            return { success: true };
        } catch (err) {
            db.run('ROLLBACK');
            return { success: false, error: err.message };
        }
    });

    handle('get-po-items', (e, poId) => queryAll('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [poId]));
}

module.exports = registerSupplierHandlers;
