/*
  backend/scripts/paypalList.js
  Usage:
    node scripts/paypalList.js list-products
    node scripts/paypalList.js list-plans [--product <PRODUCT_ID>]
*/

require('dotenv').config();
const axios = require('axios');

function getBaseUrl() {
	const env = (process.env.PAYPAL_ENV || '').toLowerCase() || (process.env.NODE_ENV === 'production' ? 'live' : 'sandbox');
	return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken() {
	const id = process.env.PAYPAL_CLIENT_ID;
	const secret = process.env.PAYPAL_CLIENT_SECRET;
	if (!id || !secret) throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
	const auth = Buffer.from(`${id}:${secret}`).toString('base64');
	const url = `${getBaseUrl()}/v1/oauth2/token`;
	const res = await axios.post(url, 'grant_type=client_credentials', {
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Authorization': `Basic ${auth}`
		}
	});
	return res.data?.access_token;
}

async function listProducts(token) {
	const url = `${getBaseUrl()}/v1/catalogs/products?page_size=50`;
	const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
	const items = res.data?.products || [];
	console.log('Products:');
	for (const p of items) {
		console.log(`- ${p.id} | ${p.name} | status:${p.status || 'N/A'}`);
	}
	return items;
}

async function listPlans(token, productId) {
	let page = 1;
	let total = 0;
	let fetched = 0;
	const all = [];
	do {
		let url = `${getBaseUrl()}/v1/billing/plans?page_size=20&page=${page}&total_required=true`;
		if (productId) url += `&product_id=${encodeURIComponent(productId)}`;
		const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
		const items = res.data?.plans || [];
		const totalItems = Number(res.data?.total_items || 0);
		console.log(`Page ${page} — ${items.length} items`);
		for (const p of items) {
			all.push(p);
			const price = p?.billing_cycles?.[0]?.pricing_scheme?.fixed_price;
			console.log(`- ${p.id} | ${p.name} | ${p.status} | product:${p.product_id} | price:${price?.value || 'N/A'} ${price?.currency_code || ''}`);
		}
		total = totalItems;
		fetched += items.length;
		page += 1;
	} while (fetched < total && page < 50);
	return all;
}

(async () => {
	try {
		const token = await getAccessToken();
		const [cmd, ...args] = process.argv.slice(2);
		if (cmd === 'list-products') {
			await listProducts(token);
			return;
		}
		if (cmd === 'list-plans') {
			let productId = null;
			for (let i = 0; i < args.length; i++) {
				if (args[i] === '--product' && args[i + 1]) { productId = args[i + 1]; i++; }
			}
			await listPlans(token, productId || process.env.PAYPAL_SUBS_PRODUCT_ID);
			return;
		}
		console.log('Usage:');
		console.log('  node scripts/paypalList.js list-products');
		console.log('  node scripts/paypalList.js list-plans [--product <PRODUCT_ID>]');
	} catch (e) {
		console.error('Error:', e.response?.data || e.message);
		process.exit(1);
	}
})(); 