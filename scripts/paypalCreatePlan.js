/*
  backend/scripts/paypalCreatePlan.js
  Create (or find) a Product and a monthly Plan.
  Usage:
    node scripts/paypalCreatePlan.js --name "AIWaverider All-Access" --price 50 --currency EUR
*/
require('dotenv').config();
const axios = require('axios');

function baseUrl() {
	const env = (process.env.PAYPAL_ENV || '').toLowerCase() || (process.env.NODE_ENV === 'production' ? 'live' : 'sandbox');
	return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}
async function getAccessToken() {
	const id = process.env.PAYPAL_CLIENT_ID;
	const secret = process.env.PAYPAL_CLIENT_SECRET;
	if (!id || !secret) throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
	const auth = Buffer.from(`${id}:${secret}`).toString('base64');
	const res = await axios.post(`${baseUrl()}/v1/oauth2/token`, 'grant_type=client_credentials', {
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}` }
	});
	return res.data?.access_token;
}
function parseArgs() {
	const args = process.argv.slice(2);
	const out = { name: 'AIWaverider All-Access', price: '50.00', currency: 'EUR' };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--name' && args[i+1]) { out.name = args[++i]; continue; }
		if (args[i] === '--price' && args[i+1]) { out.price = String(args[++i]); continue; }
		if (args[i] === '--currency' && args[i+1]) { out.currency = args[++i].toUpperCase(); continue; }
		if (args[i] === '--product-id' && args[i+1]) { out.productId = args[++i]; continue; }
	}
	return out;
}
async function findProductByName(token, name) {
	const url = `${baseUrl()}/v1/catalogs/products?page_size=20&total_required=true`;
	const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
	const items = res.data?.products || [];
	return items.find(p => (p.name || '').toLowerCase() === name.toLowerCase());
}
async function createProduct(token, name) {
	const body = {
		name,
		type: 'SERVICE',
		category: 'SOFTWARE',
		description: 'All agents access subscription',
		image_url: 'https://aiwaverider.com/logo.png',
		home_url: 'https://aiwaverider.com'
	};
	const res = await axios.post(`${baseUrl()}/v1/catalogs/products`, body, { headers: { Authorization: `Bearer ${token}` } });
	return res.data;
}
async function createMonthlyPlan(token, productId, name, price, currency) {
	const body = {
		product_id: productId,
		name: `${name} Monthly`,
		description: 'Unlimited access to all agents',
		status: 'ACTIVE',
		billing_cycles: [
			{
				frequency: { interval_unit: 'MONTH', interval_count: 1 },
				tenure_type: 'REGULAR',
				sequence: 1,
				total_cycles: 0,
				pricing_scheme: { fixed_price: { value: Number(price).toFixed(2), currency_code: currency } }
			}
		],
		payment_preferences: {
			auto_bill_outstanding: true,
			setup_fee_failure_action: 'CANCEL',
			payment_failure_threshold: 2
		},
		taxes: { percentage: '0', inclusive: false }
	};
	const res = await axios.post(`${baseUrl()}/v1/billing/plans`, body, { headers: { Authorization: `Bearer ${token}` } });
	return res.data;
}

(async () => {
	try {
		const { name, price, currency, productId: providedProductId } = parseArgs();
		const token = await getAccessToken();
		let productId = providedProductId || null;
		if (!productId) {
			const existing = await findProductByName(token, name);
			if (existing) {
				productId = existing.id;
				console.log(`Using existing product: ${productId} | ${existing.name}`);
			} else {
				const created = await createProduct(token, name);
				productId = created.id;
				console.log(`Created product: ${productId}`);
			}
		}
		const plan = await createMonthlyPlan(token, productId, name, price, currency);
		console.log('Created plan:');
		console.log(`PLAN_ID=${plan.id}`);
		console.log(`PRODUCT_ID=${productId}`);
		console.log(`NAME=${plan.name}`);
		console.log(`PRICE=${plan?.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.value} ${plan?.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.currency_code}`);
		process.exit(0);
	} catch (e) {
		console.error('Error:', e.response?.data || e.message);
		process.exit(1);
	}
})(); 