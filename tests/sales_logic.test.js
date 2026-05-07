const { calculateLineTotal } = require('../src/utils/math');

describe('Sales Transaction Logic', () => {
    test('should calculate correct net amount for multiple items', () => {
        const items = [
            { price: 100, qty: 2, discount: 0 },
            { price: 50, qty: 1, discount: 10 }, // 50 - 10 = 40
        ];
        
        const subtotal = items.reduce((acc, item) => acc + (item.price * item.qty), 0);
        const totalDiscount = items.reduce((acc, item) => acc + (item.discount || 0), 0);
        const net = subtotal - totalDiscount;

        expect(subtotal).toBe(250);
        expect(net).toBe(240);
    });

    test('should handle zero quantity in calculations', () => {
        expect(calculateLineTotal(100, 0, 0)).toBe(0);
    });
});
