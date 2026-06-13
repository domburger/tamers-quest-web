import { pad } from './_paddle.mjs';

const PACKS = [
  { pack: 'pouch', name: "Tamer's Quest — Pouch of Essence", gems: 500,  amount: '499'  },
  { pack: 'sack',  name: "Tamer's Quest — Sack of Essence",  gems: 1100, amount: '999'  },
  { pack: 'chest', name: "Tamer's Quest — Chest of Essence", gems: 2400, amount: '1999' },
  { pack: 'hoard', name: "Tamer's Quest — Hoard of Essence", gems: 6500, amount: '4999' },
];

const out = [];
for (const p of PACKS) {
  const prod = await pad('POST', '/products', {
    name: p.name,
    tax_category: 'standard',
    custom_data: { pack: p.pack, gems: String(p.gems) },
  });
  if (prod.status >= 300) { console.error('PRODUCT FAIL', p.pack, prod.status, JSON.stringify(prod.json)); process.exit(1); }
  const productId = prod.json.data.id;

  const price = await pad('POST', '/prices', {
    product_id: productId,
    description: `${p.gems.toLocaleString('en-US')} Essence`,
    unit_price: { amount: p.amount, currency_code: 'USD' },
    quantity: { minimum: 1, maximum: 1 },
    custom_data: { pack: p.pack, gems: String(p.gems) },
  });
  if (price.status >= 300) { console.error('PRICE FAIL', p.pack, price.status, JSON.stringify(price.json)); process.exit(1); }
  const priceId = price.json.data.id;

  out.push({ pack: p.pack, gems: p.gems, usd: (Number(p.amount) / 100).toFixed(2), productId, priceId });
  console.log('created', p.pack, '->', productId, priceId);
}
console.log('RESULT', JSON.stringify(out, null, 2));
