import { pad } from './_paddle.mjs';
const r = await pad('GET', '/notification-settings?per_page=200');
const list = (r.json?.data || []).map(n => ({ id: n.id, description: n.description, destination: n.destination, type: n.type, active: n.active, events: (n.subscribed_events||[]).map(e=>e.name||e).slice(0,8) }));
console.log('status', r.status);
console.log(JSON.stringify(list, null, 2));
