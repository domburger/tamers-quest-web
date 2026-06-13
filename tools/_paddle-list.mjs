import { pad, BASE } from './_paddle.mjs';
const prods = await pad('GET', '/products?per_page=200&status=active');
const prices = await pad('GET', '/prices?per_page=200&status=active');
console.log('BASE', BASE);
console.log('PRODUCTS', JSON.stringify((prods.json?.data||prods.json)?.map?.(p=>({id:p.id,name:p.name,status:p.status,custom_data:p.custom_data}))||prods.json, null, 2));
console.log('PRICES', JSON.stringify((prices.json?.data||prices.json)?.map?.(p=>({id:p.id,product_id:p.product_id,desc:p.description,amount:p.unit_price?.amount,ccy:p.unit_price?.currency_code,custom_data:p.custom_data}))||prices.json, null, 2));
