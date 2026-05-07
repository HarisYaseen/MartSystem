const { queryOne, queryAll } = require('../db');

function registerReportHandlers(handle) {
    handle('get-inventory-report', () => {
        return queryAll(`SELECT p.*, s.name as supplier_name 
                        FROM products p 
                        LEFT JOIN suppliers s ON p.supplier_id = s.id 
                        WHERE p.quantity <= p.reorder_level 
                        ORDER BY p.quantity ASC`);
    });

    handle('get-sales-analytics', () => {
        return queryAll(`SELECT date(created_at) as date, SUM(net_amount) as revenue, COUNT(*) as transactions 
                        FROM sales 
                        WHERE created_at >= date('now', '-30 days')
                        GROUP BY date(created_at) 
                        ORDER BY date ASC`);
    });

    handle('get-top-products', () => {
        return queryAll(`SELECT product_name as name, SUM(quantity) as total_sold, SUM(subtotal) as revenue 
                        FROM sale_items 
                        GROUP BY product_id 
                        ORDER BY total_sold DESC 
                        LIMIT 10`);
    });

    handle('get-category-sales', () => {
        return queryAll(`SELECT p.category, SUM(si.quantity) as total_sold, SUM(si.subtotal) as revenue 
                        FROM sale_items si
                        JOIN products p ON si.product_id = p.id
                        GROUP BY p.category
                        ORDER BY revenue DESC`);
    });

    handle('get-report-data', (e, { range, from, to, category }) => {
        try {
            let dateFilter = '';
            if (range === 'daily' || range === 'today') dateFilter = "date(created_at) = date('now', 'localtime')";
            else if (range === '3days') dateFilter = "date(created_at) >= date('now', '-3 days', 'localtime')";
            else if (range === 'weekly') dateFilter = "date(created_at) >= date('now', '-7 days', 'localtime')";
            else if (range === 'monthly') dateFilter = "date(created_at) >= date('now', '-30 days', 'localtime')";
            else if (range === 'custom' && from && to) dateFilter = `date(created_at) BETWEEN date('${from}') AND date('${to}')`;
            else dateFilter = "1=1";

            let categoryFilter = '';
            let catJoin = '';
            if (category && category !== 'All') {
                categoryFilter = ` AND p.category = '${category}'`;
                catJoin = ` JOIN sale_items si ON s.id = si.sale_id JOIN products p ON si.product_id = p.id`;
            }

            // Summary data
            let summary;
            if (category && category !== 'All') {
                summary = queryOne(`
                    SELECT COUNT(DISTINCT s.id) as transactions, SUM(si.subtotal) as net, 0 as discount 
                    FROM sales s 
                    ${catJoin}
                    WHERE ${dateFilter.replace('created_at', 's.created_at')} ${categoryFilter}
                `);
            } else {
                summary = queryOne(`SELECT COUNT(*) as transactions, SUM(net_amount) as net, SUM(discount) as discount FROM sales WHERE ${dateFilter}`);
            }

            const purchaseData = queryOne(`SELECT SUM(total_cost) as total_spent FROM purchase_orders WHERE status = 'received' AND ${dateFilter}`);
            
            const profitData = queryOne(`
                SELECT SUM((si.unit_price - CASE WHEN si.cost_price > 0 THEN si.cost_price ELSE IFNULL(p.cost_price, 0) END) * si.quantity) as gross_profit
                FROM sale_items si
                JOIN products p ON si.product_id = p.id
                JOIN sales s ON si.sale_id = s.id
                WHERE ${dateFilter.replace('created_at', 's.created_at')} ${category && category !== 'All' ? ` AND p.category = '${category}'` : ''}
            `);

            const totalDiscount = summary.discount || 0;
            const netProfit = (profitData.gross_profit || 0) - totalDiscount;

            let sales;
            if (category && category !== 'All') {
                sales = queryAll(`
                    SELECT DISTINCT s.* 
                    FROM sales s 
                    ${catJoin}
                    WHERE ${dateFilter.replace('created_at', 's.created_at')} ${categoryFilter}
                    ORDER BY s.created_at DESC
                `);
            } else {
                sales = queryAll(`SELECT * FROM sales WHERE ${dateFilter} ORDER BY created_at DESC`);
            }
            
            return {
                success: true,
                transactions: summary.transactions || 0,
                net: summary.net || 0,
                discount: summary.discount || 0,
                totalPurchases: purchaseData.total_spent || 0,
                profit: netProfit,
                sales: sales
            };
        } catch (err) {
            console.error('Report Error:', err);
            return { success: false, error: err.message };
        }
    });
}

module.exports = registerReportHandlers;
