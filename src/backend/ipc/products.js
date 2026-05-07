const { queryOne, queryAll, run, logInfo } = require('../db');

function registerProductHandlers(handle) {
    handle('get-dashboard-stats', () => {
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

    handle('get-products', () => queryAll('SELECT p.*, s.name as supplier_name FROM products p LEFT JOIN suppliers s ON p.supplier_id = s.id ORDER BY p.name'));
    
    handle('get-product-by-barcode', (e, barcode) => queryOne('SELECT * FROM products WHERE barcode = ?', [barcode]));
    
    handle('search-products', (e, query) => {
        return queryAll('SELECT * FROM products WHERE barcode = ? OR name LIKE ?', [query, `%${query}%`]);
    });

    handle('save-product', (e, p) => {
        // Strict Input Validation
        if (!p.barcode || p.barcode.trim() === '') return { success: false, error: 'Barcode is required.' };
        if (!p.name || p.name.trim() === '') return { success: false, error: 'Product name is required.' };
        if (p.cost_price < 0 || p.sale_price < 0) return { success: false, error: 'Prices cannot be negative.' };
        if (p.quantity < 0) return { success: false, error: 'Quantity cannot be negative.' };

        if (p.id) {
            return run('UPDATE products SET name=?, barcode=?, brand=?, category=?, unit=?, cost_price=?, sale_price=?, quantity=?, reorder_level=?, supplier_id=?, updated_at=datetime("now", "localtime") WHERE id=?', 
                [p.name, p.barcode, p.brand || '', p.category, p.unit, p.cost_price, p.sale_price, p.quantity, p.reorder_level, p.supplier_id || null, p.id]);
        } else {
            return run('INSERT INTO products (name, barcode, brand, category, unit, cost_price, sale_price, quantity, reorder_level, supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?)', 
                [p.name, p.barcode, p.brand || '', p.category, p.unit, p.cost_price, p.sale_price, p.quantity, p.reorder_level, p.supplier_id || null]);
        }
    });

    handle('delete-product', async (e, id) => {
        const sales = queryOne('SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?', [id]);
        if (sales && sales.count > 0) {
            return { success: false, error: 'Cannot delete product with sales history. Try setting stock to 0 instead.' };
        }
        const pos = queryOne('SELECT COUNT(*) as count FROM purchase_order_items WHERE product_id = ?', [id]);
        if (pos && pos.count > 0) {
            return { success: false, error: 'Cannot delete product linked to purchase orders.' };
        }
        return run('DELETE FROM products WHERE id = ?', [id]);
    });

    handle('adjust-stock', (e, { productId, delta, reason }) => {
        return run('UPDATE products SET quantity = quantity + ?, updated_at = datetime("now", "localtime") WHERE id = ?', [delta, productId]);
    });

    handle('lookup-barcode-external', async (e, barcode) => {
        try {
            logInfo(`Looking up barcode: ${barcode}`);
            try {
                const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
                const data = await response.json();
                if (data.status === 1 && data.product) {
                    const p = data.product;
                    const name = p.product_name || p.generic_name || '';
                    let category = p.categories ? p.categories.split(',')[0] : 'General';
                    if (category.includes(':')) category = category.split(':').pop();
                    return {
                        success: true,
                        product: {
                            name: name,
                            brand: p.brands || name.split(' ')[0] || '',
                            category: category.charAt(0).toUpperCase() + category.slice(1)
                        }
                    };
                }
            } catch (err) { /* ignore */ }

            try {
                const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
                const data = await response.json();
                if (data.items && data.items.length > 0) {
                    const item = data.items[0];
                    let category = item.category ? item.category.split('>').pop().trim() : 'General';
                    return {
                        success: true,
                        product: {
                            name: item.title || '',
                            brand: item.brand || item.title.split(' ')[0] || '',
                            category: category.charAt(0).toUpperCase() + category.slice(1)
                        }
                    };
                }
            } catch (err) { /* ignore */ }
            return { success: false, error: 'Product not found.' };
        } catch (e) {
            return { success: false, error: 'Lookup failed.' };
        }
    });
}

module.exports = registerProductHandlers;
