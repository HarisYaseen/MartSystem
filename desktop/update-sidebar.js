const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, '..', 'src', 'pages');
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));

const getNavHTML = (activePage) => `        <div class="nav-group">
            <a href="dashboard.html" class="nav-item${activePage === 'dashboard.html' ? ' active' : ''}"><i data-lucide="layout-dashboard"></i> Dashboard</a>
            <a href="pos.html" class="nav-item${activePage === 'pos.html' ? ' active' : ''}"><i data-lucide="shopping-cart"></i> POS Terminal</a>
            <a href="products.html" class="nav-item${activePage === 'products.html' ? ' active' : ''}"><i data-lucide="package"></i> Products</a>
            <a href="inventory.html" class="nav-item${activePage === 'inventory.html' ? ' active' : ''}"><i data-lucide="boxes"></i> Inventory</a>
            <a href="suppliers.html" class="nav-item${activePage === 'suppliers.html' ? ' active' : ''}"><i data-lucide="users"></i> Suppliers</a>
            <a href="purchase_orders.html" class="nav-item${activePage === 'purchase_orders.html' ? ' active' : ''}"><i data-lucide="file-text"></i> Purchase Orders</a>
            <a href="sales.html" class="nav-item${activePage === 'sales.html' ? ' active' : ''}"><i data-lucide="history"></i> Sales History</a>
            <a href="reports.html" class="nav-item${activePage === 'reports.html' ? ' active' : ''}"><i data-lucide="bar-chart-3"></i> Reports</a>
        </div>`;

files.forEach(file => {
    const filePath = path.join(pagesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    const regex = /<div class="nav-group">[\s\S]*?<\/div>/;
    const newNav = getNavHTML(file);
    
    if (content.match(regex)) {
        content = content.replace(regex, newNav);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Updated ' + file);
    }
});
console.log('Done replacing sidebar');
