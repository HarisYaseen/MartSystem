const { calculateLineTotal, isValidBarcode, isLowStock } = require('../src/utils/math');

describe('Retail Math Utilities', () => {
    
    describe('calculateLineTotal', () => {
        test('should calculate total with 17% tax (Happy Path)', () => {
            // 1000 price * 2 qty = 2000. 17% tax = 340. Total = 2340.
            expect(calculateLineTotal(1000, 2, 17)).toBe(2340);
        });

        test('should apply 10% discount before tax', () => {
            // 1000 price * 1 qty = 1000. 
            // 10% disc = 100. Taxable = 900.
            // 10% tax on 900 = 90. Total = 990.
            expect(calculateLineTotal(1000, 1, 10, 10)).toBe(990);
        });

        test('should return 0 for negative price or quantity', () => {
            expect(calculateLineTotal(-100, 1, 10)).toBe(0);
            expect(calculateLineTotal(100, -1, 10)).toBe(0);
        });

        test('should handle floating point rounding correctly', () => {
            // 19.99 * 1 with 5% tax = 20.9895 -> rounded to 20.99
            expect(calculateLineTotal(19.99, 1, 5)).toBe(20.99);
        });
    });

    describe('isValidBarcode', () => {
        test('should validate 8-digit EAN codes', () => {
            expect(isValidBarcode('12345678')).toBe(true);
        });

        test('should validate 13-digit EAN codes', () => {
            expect(isValidBarcode('1234567890123')).toBe(true);
        });

        test('should reject invalid length codes', () => {
            expect(isValidBarcode('12345')).toBe(false);
            expect(isValidBarcode('123456789012345')).toBe(false);
        });

        test('should reject non-numeric codes', () => {
            expect(isValidBarcode('ABCDEFGH')).toBe(false);
        });
    });

    describe('isLowStock', () => {
        test('should return true if stock hits reorder level', () => {
            expect(isLowStock(5, 5)).toBe(true);
        });

        test('should return true if stock is below reorder level', () => {
            expect(isLowStock(2, 5)).toBe(true);
        });

        test('should return false if stock is healthy', () => {
            expect(isLowStock(10, 5)).toBe(false);
        });
    });
});
