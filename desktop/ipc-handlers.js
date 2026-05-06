const { ipcMain } = require('electron');
const { db } = require('./db-setup');
const { 
  productsTable, 
  suppliersTable, 
  salesTable, 
  saleItemsTable, 
  purchaseOrdersTable, 
  purchaseOrderItemsTable 
} = require('./schema');
const { eq, like, or, lte, sql, desc, gte, and } = require('drizzle-orm');

function formatProduct(p) {
  if (!p) return p;
  return {
    ...p,
    costPrice: Number(p.costPrice),
    salePrice: Number(p.salePrice),
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  };
}

function setupIpcHandlers() {
  ipcMain.handle('api', async (event, { method, url, body, query }) => {
    console.log(`IPC API Call: ${method} ${url}`);
    
    try {
      // 1. PRODUCTS
      if (url === '/products' || url.startsWith('/products?')) {
        if (method === 'GET') {
          const { search, category, lowStock } = query || {};
          const rows = await db
            .select({
              id: productsTable.id,
              barcode: productsTable.barcode,
              name: productsTable.name,
              brand: productsTable.brand,
              category: productsTable.category,
              unit: productsTable.unit,
              costPrice: productsTable.costPrice,
              salePrice: productsTable.salePrice,
              quantity: productsTable.quantity,
              reorderLevel: productsTable.reorderLevel,
              supplierId: productsTable.supplierId,
              supplierName: suppliersTable.name,
              createdAt: productsTable.createdAt,
              updatedAt: productsTable.updatedAt,
            })
            .from(productsTable)
            .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
            .where(
              search
                ? or(
                    like(productsTable.name, `%${search}%`),
                    like(productsTable.barcode, `%${search}%`),
                    like(productsTable.brand, `%${search}%`),
                    like(productsTable.category, `%${search}%`)
                  )
                : category
                  ? like(productsTable.category, `%${category}%`)
                  : lowStock
                    ? lte(productsTable.quantity, productsTable.reorderLevel)
                    : undefined
            )
            .orderBy(productsTable.name);
          return rows.map(formatProduct);
        }
        
        if (method === 'POST') {
          const [inserted] = await db.insert(productsTable).values(body).returning();
          return formatProduct(inserted);
        }
      }

      if (url.startsWith('/products/barcode/')) {
         const barcode = url.split('/').pop();
         const row = await db.select().from(productsTable).where(eq(productsTable.barcode, barcode)).then(r => r[0]);
         return formatProduct(row);
      }

      if (url.startsWith('/products/')) {
        const id = parseInt(url.split('/').pop());
        if (method === 'GET') {
           const row = await db.select().from(productsTable).where(eq(productsTable.id, id)).then(r => r[0]);
           return formatProduct(row);
        }
        if (method === 'PUT') {
           await db.update(productsTable).set({...body, updatedAt: new Date()}).where(eq(productsTable.id, id));
           return { success: true };
        }
        if (method === 'DELETE') {
           await db.delete(productsTable).where(eq(productsTable.id, id));
           return { success: true };
        }
      }

      // 2. SUPPLIERS
      if (url === '/suppliers' || url.startsWith('/suppliers?')) {
        if (method === 'GET') {
          const rows = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
          return rows.map(r => ({
            ...r,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
          }));
        }
        if (method === 'POST') {
          const [inserted] = await db.insert(suppliersTable).values(body).returning();
          return inserted;
        }
      }
      
      if (url.startsWith('/suppliers/')) {
        const id = parseInt(url.split('/').pop());
        if (method === 'PUT') {
          await db.update(suppliersTable).set(body).where(eq(suppliersTable.id, id));
          return { success: true };
        }
        if (method === 'DELETE') {
          await db.delete(suppliersTable).where(eq(suppliersTable.id, id));
          return { success: true };
        }
      }

      // 3. SALES
      if (url === '/sales' || url.startsWith('/sales?')) {
        if (method === 'GET') {
          const { startDate, endDate, limit = 50 } = query || {};
          const start = startDate ? new Date(startDate) : undefined;
          const end = endDate ? new Date(endDate) : undefined;
          if (end) end.setDate(end.getDate() + 1);

          const sales = await db
            .select()
            .from(salesTable)
            .where(
              and(
                start ? gte(salesTable.createdAt, start) : undefined,
                end ? lte(salesTable.createdAt, end) : undefined
              )
            )
            .orderBy(desc(salesTable.createdAt))
            .limit(parseInt(limit));

          return await Promise.all(sales.map(async (sale) => {
            const items = await db.select().from(saleItemsTable).where(eq(saleItemsTable.saleId, sale.id));
            return { 
              ...sale, 
              createdAt: sale.createdAt.toISOString(),
              items 
            };
          }));
        }
        
        if (method === 'POST') {
          const { items, paymentMethod, amountPaid, discount = 0, taxRate = 0 } = body;
          
          const productRows = await Promise.all(
            items.map(item => db.select().from(productsTable).where(eq(productsTable.id, item.productId)).then(r => r[0]))
          );

          let subtotal = 0;
          const lineItems = items.map((item, i) => {
            const product = productRows[i];
            const unitPrice = Number(product.salePrice);
            const lineSubtotal = unitPrice * item.quantity;
            subtotal += lineSubtotal;
            return {
              productId: product.id,
              productName: product.name,
              barcode: product.barcode,
              quantity: item.quantity,
              unitPrice,
              subtotal: lineSubtotal,
            };
          });

          const taxAmount = subtotal * (taxRate / 100);
          const total = subtotal - discount + taxAmount;
          const change = amountPaid - total;
          const receiptNumber = `RCP-${Date.now()}`;

          const [sale] = await db.insert(salesTable).values({
            receiptNumber,
            subtotal,
            discount,
            tax: taxAmount,
            total,
            paymentMethod,
            amountPaid,
            change: Math.max(0, change),
          }).returning();

          await db.insert(saleItemsTable).values(
            lineItems.map(li => ({ ...li, saleId: sale.id }))
          );

          for (const item of items) {
             await db.update(productsTable)
               .set({ quantity: sql`${productsTable.quantity} - ${item.quantity}`, updatedAt: new Date() })
               .where(eq(productsTable.id, item.productId));
          }

          return { ...sale, createdAt: sale.createdAt.toISOString() };
        }
      }

      // 4. REPORTS
      if (url === '/reports/dashboard') {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [todayStats] = await db.select({
          count: sql`count(*)`,
          revenue: sql`coalesce(sum(${salesTable.total}), 0)`,
        }).from(salesTable).where(gte(salesTable.createdAt, todayStart));

        const [todayProfitResult] = await db.select({
          profit: sql`coalesce(sum((${saleItemsTable.unitPrice} - ${productsTable.costPrice}) * ${saleItemsTable.quantity}), 0)`,
        }).from(saleItemsTable)
          .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
          .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
          .where(gte(salesTable.createdAt, todayStart));

        const [totalProductsResult] = await db.select({ count: sql`count(*)` }).from(productsTable);
        const [lowStockResult] = await db.select({ count: sql`count(*)` }).from(productsTable).where(lte(productsTable.quantity, productsTable.reorderLevel));
        const [pendingOrdersResult] = await db.select({ count: sql`count(*)` }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.status, "pending"));
        const [weekResult] = await db.select({ revenue: sql`coalesce(sum(${salesTable.total}), 0)` }).from(salesTable).where(gte(salesTable.createdAt, weekStart));
        const [monthResult] = await db.select({ revenue: sql`coalesce(sum(${salesTable.total}), 0)` }).from(salesTable).where(gte(salesTable.createdAt, monthStart));

        return {
          todaySales: Number(todayStats?.count ?? 0),
          todayRevenue: Number(todayStats?.revenue ?? 0),
          todayProfit: Number(todayProfitResult?.profit ?? 0),
          totalProducts: Number(totalProductsResult?.count ?? 0),
          lowStockCount: Number(lowStockResult?.count ?? 0),
          pendingOrders: Number(pendingOrdersResult?.count ?? 0),
          weekRevenue: Number(weekResult?.revenue ?? 0),
          monthRevenue: Number(monthResult?.revenue ?? 0),
        };
      }

      if (url === '/reports/sales-analytics') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const rows = await db.select({
          date: sql`date(${salesTable.createdAt}, 'unixepoch')`,
          revenue: sql`sum(${salesTable.total})`,
          transactions: sql`count(*)`,
        }).from(salesTable)
          .where(gte(salesTable.createdAt, thirtyDaysAgo))
          .groupBy(sql`date(${salesTable.createdAt}, 'unixepoch')`)
          .orderBy(sql`date(${salesTable.createdAt}, 'unixepoch')`);

        const profitRows = await db.select({
          date: sql`date(${salesTable.createdAt}, 'unixepoch')`,
          profit: sql`sum((${saleItemsTable.unitPrice} - ${productsTable.costPrice}) * ${saleItemsTable.quantity})`,
        }).from(saleItemsTable)
          .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
          .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
          .where(gte(salesTable.createdAt, thirtyDaysAgo))
          .groupBy(sql`date(${salesTable.createdAt}, 'unixepoch')`);

        const profitMap = new Map(profitRows.map(r => [r.date, Number(r.profit)]));

        return rows.map(r => ({
          date: r.date,
          revenue: Number(r.revenue),
          profit: profitMap.get(r.date) ?? 0,
          transactions: Number(r.transactions),
        }));
      }

      if (url.startsWith('/reports/top-products')) {
        const limit = query?.limit ?? 10;
        const rows = await db.select({
          productId: saleItemsTable.productId,
          name: productsTable.name,
          barcode: productsTable.barcode,
          category: productsTable.category,
          totalQuantitySold: sql`sum(${saleItemsTable.quantity})`,
          totalRevenue: sql`sum(${saleItemsTable.subtotal})`,
          totalProfit: sql`sum((${saleItemsTable.unitPrice} - ${productsTable.costPrice}) * ${saleItemsTable.quantity})`,
        }).from(saleItemsTable)
          .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
          .groupBy(saleItemsTable.productId, productsTable.name, productsTable.barcode, productsTable.category)
          .orderBy(desc(sql`sum(${saleItemsTable.quantity})`))
          .limit(parseInt(limit));
          
        return rows.map(r => ({
           ...r,
           totalQuantitySold: Number(r.totalQuantitySold),
           totalRevenue: Number(r.totalRevenue),
           totalProfit: Number(r.totalProfit)
        }));
      }

      if (url.startsWith('/reports/profit-loss')) {
        const { startDate, endDate } = query || {};
        const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const end = endDate ? new Date(endDate) : new Date();
        end.setDate(end.getDate() + 1);

        const [revenue] = await db.select({
          total: sql`coalesce(sum(${salesTable.total}), 0)`,
          count: sql`count(*)`,
        }).from(salesTable).where(and(gte(salesTable.createdAt, start), lte(salesTable.createdAt, end)));

        const [profit] = await db.select({
          totalCost: sql`coalesce(sum(${productsTable.costPrice} * ${saleItemsTable.quantity}), 0)`,
        }).from(saleItemsTable)
          .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
          .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
          .where(and(gte(salesTable.createdAt, start), lte(salesTable.createdAt, end)));

        const totalRevenue = Number(revenue?.total ?? 0);
        const totalCost = Number(profit?.totalCost ?? 0);
        const grossProfit = totalRevenue - totalCost;
        const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

        return {
          startDate: start.toISOString().split("T")[0],
          endDate: new Date(end.getTime() - 86400000).toISOString().split("T")[0],
          totalRevenue,
          totalCost,
          grossProfit,
          margin: Math.round(margin * 100) / 100,
          transactionCount: Number(revenue?.count ?? 0),
        };
      }

      // 5. INVENTORY
      if (url === '/inventory/low-stock') {
        const rows = await db.select({
          id: productsTable.id,
          barcode: productsTable.barcode,
          name: productsTable.name,
          brand: productsTable.brand,
          category: productsTable.category,
          unit: productsTable.unit,
          costPrice: productsTable.costPrice,
          salePrice: productsTable.salePrice,
          quantity: productsTable.quantity,
          reorderLevel: productsTable.reorderLevel,
          supplierId: productsTable.supplierId,
          supplierName: suppliersTable.name,
          createdAt: productsTable.createdAt,
          updatedAt: productsTable.updatedAt,
        }).from(productsTable)
          .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
          .where(lte(productsTable.quantity, productsTable.reorderLevel))
          .orderBy(productsTable.quantity);
        return rows.map(formatProduct);
      }
      
      if (url === '/inventory/adjust') {
        const { productId, delta } = body;
        const [updated] = await db.update(productsTable).set({
          quantity: sql`${productsTable.quantity} + ${delta}`,
          updatedAt: new Date(),
        }).where(eq(productsTable.id, productId)).returning();
        return formatProduct(updated);
      }

      // 6. PURCHASE ORDERS
      if (url === '/purchase-orders' || url.startsWith('/purchase-orders?')) {
         if (method === 'GET') {
            const orders = await db.select({
              id: purchaseOrdersTable.id,
              poNumber: purchaseOrdersTable.poNumber,
              supplierId: purchaseOrdersTable.supplierId,
              supplierName: suppliersTable.name,
              totalCost: purchaseOrdersTable.totalCost,
              status: purchaseOrdersTable.status,
              createdAt: purchaseOrdersTable.createdAt,
              receivedAt: purchaseOrdersTable.receivedAt,
            }).from(purchaseOrdersTable)
              .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
              .orderBy(desc(purchaseOrdersTable.createdAt));
            
            return await Promise.all(orders.map(async (o) => {
               const items = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, o.id));
               return { 
                 ...o, 
                 createdAt: o.createdAt.toISOString(),
                 receivedAt: o.receivedAt ? o.receivedAt.toISOString() : null,
                 items 
               };
            }));
         }
         if (method === 'POST') {
            const { supplierId, items } = body;
            const totalCost = items.reduce((sum, i) => sum + (i.quantity * i.unitCost), 0);
            const poNumber = `PO-${Date.now()}`;

            const [order] = await db.insert(purchaseOrdersTable).values({
              poNumber,
              supplierId,
              totalCost,
              status: 'pending'
            }).returning();

            await db.insert(purchaseOrderItemsTable).values(
              items.map(i => ({ ...i, purchaseOrderId: order.id }))
            );

            return { ...order, createdAt: order.createdAt.toISOString() };
         }
      }

      throw new Error(`Unhandled route: ${method} ${url}`);
    } catch (error) {
      console.error('IPC Error:', error);
      return { error: error.message };
    }
  });
}

module.exports = { setupIpcHandlers };
