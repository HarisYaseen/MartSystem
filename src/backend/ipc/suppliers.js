const { queryOne, queryAll, run, saveDB } = require('../db');

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

    ipcMain.handle('delete-supplier', async (e, id) => {
        // 1. Check for PO history
        const pos = queryOne('SELECT COUNT(*) as count FROM purchase_orders WHERE supplier_id = ?', [id]);
        if (pos && pos.count > 0) {
            return { success: false, error: 'Cannot delete supplier with purchase order history.' };
        }

        // 2. Check for Ledger/Balance
        const supplier = queryOne('SELECT current_balance FROM suppliers WHERE id = ?', [id]);
        if (supplier && Math.abs(supplier.current_balance) > 0.01) {
            return { success: false, error: 'Cannot delete supplier with an outstanding balance.' };
        }

        return run('DELETE FROM suppliers WHERE id = ?', [id]);
    });

    ipcMain.handle('get-supplier-ledger', (e, supplierId) => {
        return queryAll('SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY created_at DESC', [supplierId]);
    });

    ipcMain.handle('add-supplier-payment', (e, { supplierId, amount, method, ref, note }) => {
        try {
            const actualRef = ref || 'PAY-' + Date.now();
            const res = run('INSERT INTO supplier_payments (supplier_id, amount, payment_method, reference, note) VALUES (?,?,?,?,?)', 
                [supplierId, amount, method, actualRef, note]);
            
            if (res.success) {
                const payRow = queryOne('SELECT id FROM supplier_payments WHERE reference = ?', [actualRef]);
                const paymentId = payRow ? payRow.id : null;
                
                const supplier = queryOne('SELECT current_balance FROM suppliers WHERE id = ?', [supplierId]);
                const newBalance = (supplier?.current_balance || 0) - amount;
                
                run('INSERT INTO supplier_ledger (supplier_id, transaction_type, ref_id, ref_number, description, credit, balance) VALUES (?,?,?,?,?,?,?)', 
                    [supplierId, 'payment', paymentId, actualRef, 'Payment made to supplier', amount, newBalance]);
                
                run('UPDATE suppliers SET current_balance = ? WHERE id = ?', [newBalance, supplierId]);
                return { success: true };
            }
            return res;
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('add-supplier-adjustment', (e, { supplierId, amount, type, description }) => {
        try {
            const supplier = queryOne('SELECT current_balance FROM suppliers WHERE id = ?', [supplierId]);
            const currentBalance = supplier ? parseFloat(supplier.current_balance || 0) : 0;
            
            let debit = 0, credit = 0, newBalance = currentBalance;
            if (type === 'debit') { debit = amount; newBalance += amount; }
            else { credit = amount; newBalance -= amount; }
            
            run('INSERT INTO supplier_ledger (supplier_id, transaction_type, description, debit, credit, balance) VALUES (?,?,?,?,?,?)', 
                [supplierId, 'adjustment', description, debit, credit, newBalance]);
            
            run('UPDATE suppliers SET current_balance = ? WHERE id = ?', [newBalance, supplierId]);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Purchase Orders
    ipcMain.handle('get-purchase-orders', () => queryAll('SELECT po.*, s.name as supplier_name FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id ORDER BY po.created_at DESC'));
    
    ipcMain.handle('save-purchase-order', (e, { supplierId, totalCost, items }) => {
        try {
            const poNo = 'PO-' + Date.now();
            const res = run('INSERT INTO purchase_orders (po_number, supplier_id, total_cost) VALUES (?,?,?)', [poNo, supplierId, totalCost]);
            
            if (res.success) {
                const poId = queryOne('SELECT id FROM purchase_orders WHERE po_number = ?', [poNo]).id;
                items.forEach(item => {
                    run('INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, barcode, quantity, unit_cost, subtotal) VALUES (?,?,?,?,?,?,?)', 
                        [poId, item.id, item.name, item.barcode, item.quantity, item.cost_price, item.quantity * item.cost_price]);
                });
                return { success: true, poId };
            }
            return res;
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('receive-purchase-order', (e, poId) => {
        const { getDB, saveDB, queryAll, run } = require('../db');
        const db = getDB();
        try {
            db.run('BEGIN TRANSACTION');

            // 1. Get all items in this PO
            const items = queryAll('SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
            
            // 2. Update stock for each item
            for (const item of items) {
                db.run('UPDATE products SET quantity = quantity + ?, updated_at = datetime("now", "localtime") WHERE id = ?', [item.quantity, item.product_id]);
            }

            // 3. Mark PO as received
            db.run('UPDATE purchase_orders SET status = "received", received_at = datetime("now", "localtime") WHERE id = ?', [poId]);

            db.run('COMMIT');
            saveDB();
            return { success: true };
        } catch (err) {
            db.run('ROLLBACK');
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('get-po-items', (e, poId) => queryAll('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [poId]));
}

module.exports = registerSupplierHandlers;
