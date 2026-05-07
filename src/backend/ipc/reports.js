const { queryOne, queryAll } = require('../db');

function registerReportHandlers(handle) {
    handle('get-inventory-report', () => {
        return queryAll(`SELECT p.*, s.name as supplier_name 
                        FROM products p 
                        LEFT JOIN suppliers s ON p.supplier_id = s.id 
                        WHERE p.quantity <= p.reorder_level 
                        ORDER BY p.quantity ASC`);
    });

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

    ipcMain.handle('get-report-data', (e, { range, from, to }) => {
        try {
            let dateFilter = '';
            if (range === 'daily') dateFilter = "date(created_at) = date('now', 'localtime')";
            else if (range === 'weekly') dateFilter = "date(created_at) >= date('now', '-7 days')";
            else if (range === 'monthly') dateFilter = "date(created_at) >= date('now', '-30 days')";
            else if (range === 'custom' && from && to) dateFilter = `date(created_at) BETWEEN date('${from}') AND date('${to}')`;
            else dateFilter = "1=1";

            const summary = queryOne(`SELECT COUNT(*) as transactions, SUM(total_amount) as total, SUM(net_amount) as net, SUM(discount) as discount FROM sales WHERE ${dateFilter}`);
            const purchaseData = queryOne(`SELECT SUM(total_cost) as total_spent FROM purchase_orders WHERE status = 'received' AND ${dateFilter}`);
            const profitData = queryOne(`
                SELECT SUM((si.unit_price - IFNULL(p.cost_price, 0)) * si.quantity) as total_profit
                FROM sale_items si
                JOIN products p ON si.product_id = p.id
                JOIN sales s ON si.sale_id = s.id
                WHERE ${dateFilter.replace('created_at', 's.created_at')}
            `);

            const items = queryAll(`SELECT * FROM sales WHERE ${dateFilter} ORDER BY created_at DESC`);
            
            return {
                success: true,
                transactions: summary.transactions || 0,
                total: summary.total || 0,
                net: summary.net || 0,
                discount: summary.discount || 0,
                totalPurchases: purchaseData.total_spent || 0,
                profit: profitData.total_profit || 0,
                sales: items
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = registerReportHandlers;
