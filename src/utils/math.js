/**
 * Retail Math Utilities
 * Isolated logic for unit testing
 */

/**
 * Calculates the total for a line item including tax and discount
 * @param {number} price - Unit price
 * @param {number} quantity - Quantity sold
 * @param {number} taxRate - Tax percentage (e.g. 17 for 17%)
 * @param {number} discountPercent - Discount percentage (e.g. 10 for 10%)
 * @returns {number} - Final rounded total
 */
const calculateLineTotal = (price, quantity, taxRate = 0, discountPercent = 0) => {
    if (price < 0 || quantity < 0) return 0;
    
    const subtotal = price * quantity;
    const discountAmount = subtotal * (discountPercent / 100);
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = taxableAmount * (taxRate / 100);
    
    return parseFloat((taxableAmount + taxAmount).toFixed(2));
};

/**
 * Validates a barcode format (EAN-8 or EAN-13)
 * @param {string} barcode 
 * @returns {boolean}
 */
const isValidBarcode = (barcode) => {
    if (!barcode) return false;
    const clean = barcode.trim();
    return /^\d{8}$|^\d{12,13}$/.test(clean);
};

/**
 * Checks if stock is below or at reorder level
 * @param {number} currentStock 
 * @param {number} reorderLevel 
 * @returns {boolean}
 */
const isLowStock = (currentStock, reorderLevel) => {
    return (currentStock || 0) <= (reorderLevel || 0);
};

module.exports = {
    calculateLineTotal,
    isValidBarcode,
    isLowStock
};
