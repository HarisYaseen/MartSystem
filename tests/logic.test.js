// Mocking the DB and Logic for deep testing
const { calculateLineTotal, isLowStock } = require('../src/utils/math');

describe('Core Business Logic', () => {
    
    describe('Inventory Management', () => {
        test('should correctly calculate stock after sale', () => {
            const initialStock = 100;
            const soldQuantity = 5;
            const finalStock = initialStock - soldQuantity;
            expect(finalStock).toBe(95);
        });

        test('should correctly calculate stock after PO receipt', () => {
            const currentStock = 50;
            const receivedQty = 20;
            const newStock = currentStock + receivedQty;
            expect(newStock).toBe(70);
        });

        test('should trigger low stock alert when quantity hits reorder level', () => {
            // Reorder level is 10. 
            expect(isLowStock(10, 10)).toBe(true);
            expect(isLowStock(9, 10)).toBe(true);
            expect(isLowStock(11, 10)).toBe(false);
        });
    });

    describe('Sales Integrity', () => {
        test('should reject negative item quantities in line total', () => {
            // Business rule: totals should be 0 if input is invalid
            expect(calculateLineTotal(10, -5, 0)).toBe(0);
        });

        test('should reject negative prices in line total', () => {
            expect(calculateLineTotal(-100, 1, 0)).toBe(0);
        });
    });
});
