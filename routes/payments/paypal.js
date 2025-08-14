const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const logger = require('../../utils/logger');
const { db } = require('../../config/firebase');
const orderController = require('../../controllers/payment/orderController');
const invoiceService = require('../../services/invoice/invoiceService');
const { validateFirebaseToken } = require('../../middleware/authenticationMiddleware');

// Optional env for Subscriptions
const PAYPAL_SUBS_PRODUCT_ID = process.env.PAYPAL_SUBS_PRODUCT_ID || null;
const PAYPAL_SUBS_PLAN_ID = process.env.PAYPAL_SUBS_PLAN_ID || null;

// PayPal configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'test_client_id';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'test_client_secret';
// Determine PayPal environment explicitly: 'live' or 'sandbox'
const PAYPAL_ENV = (process.env.PAYPAL_ENV || '').toLowerCase() || (process.env.NODE_ENV === 'production' ? 'live' : 'sandbox');
const PAYPAL_BASE_URL = PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function generatePayPalAccessToken() {
  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const response = await axios({
      method: 'post',
      url: `${PAYPAL_BASE_URL}/v1/oauth2/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`
      },
      data: 'grant_type=client_credentials'
    });
    return response.data.access_token;
  } catch (error) {
    logger.error('Failed to generate PayPal access token:', error);
    throw new Error('Failed to generate PayPal access token');
  }
}

// Create PayPal order
router.post('/create-order', async (req, res) => {
  try {
    const { amount, currency, items = [], customerInfo = {}, metadata = {} } = req.body;

    // Validate amount as a number
    const parsedAmount = typeof amount === 'number' ? amount : parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount. Must be a positive number.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Amount and items are required' });
    }

    const allowedCurrencies = ['USD', 'EUR', 'GBP'];
    const requestedCurrency = (currency || 'USD').toUpperCase();
    if (!allowedCurrencies.includes(requestedCurrency)) {
      return res.status(400).json({ error: `Unsupported currency. Allowed: ${allowedCurrencies.join(', ')}` });
    }

    // Mock response for development if PayPal not configured
    if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === 'test_client_id') {
      const mockOrderId = `MOCK-PAYPAL-${uuidv4()}`;
      logger.info('Using mock PayPal order (credentials not configured)');

      return res.json({
        success: true,
        id: mockOrderId,
        orderId: metadata.orderId || uuidv4(),
        mock: true
      });
    }

    const accessToken = await generatePayPalAccessToken();
    const orderId = metadata.orderId || uuidv4();

    // Format line items for PayPal, coercing values safely
    const lineItems = items.map((item) => {
      const unitPrice = typeof item.price === 'number' ? item.price : parseFloat(item.price);
      const quantity = typeof item.quantity === 'number' ? item.quantity : parseInt(item.quantity, 10) || 1;
      const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      return {
        name: item.title || item.name || 'Product',
        unit_amount: {
          currency_code: requestedCurrency,
          value: safeUnitPrice.toFixed(2)
        },
        quantity: safeQuantity.toString(),
        category: 'DIGITAL_GOODS'
      };
    });

    const totalAmountFromItems = lineItems.reduce((sum, item) => sum + (parseFloat(item.unit_amount.value) * parseInt(item.quantity, 10)), 0);

    // Prefer cart sum from items if provided, otherwise use provided amount
    const totalAmount = Number.isFinite(totalAmountFromItems) && totalAmountFromItems > 0
      ? totalAmountFromItems
      : parsedAmount;

    // Create PayPal order payload
    const payload = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: orderId,
        amount: {
          currency_code: requestedCurrency,
          value: totalAmount.toFixed(2),
          breakdown: {
            item_total: {
              currency_code: requestedCurrency,
              value: totalAmount.toFixed(2)
            }
          }
        },
        items: lineItems
      }],
      application_context: {
        brand_name: 'AI Waverider',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id=${orderId}&status=success&type=paypal`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?canceled=true`
      }
    };

    let response;
    try {
      response = await axios({
        method: 'post',
        url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        data: payload
      });
    } catch (err) {
      const paypalStatus = err.response?.status;
      const paypalData = err.response?.data;
      logger.error('PayPal create order API error', { status: paypalStatus, data: paypalData, message: err.message });
      return res.status(502).json({ error: 'PayPal API error', status: paypalStatus, details: paypalData || err.message });
    }

    // Store PayPal order in database
    await db.collection('paypalOrders').doc(response.data.id).set({
      paypalOrderId: response.data.id,
      orderId,
      amount: totalAmount,
      currency: requestedCurrency,
      items,
      customerInfo,
      metadata,
      status: 'created',
      createdAt: new Date().toISOString()
    });

    logger.info(`Created PayPal order: ${response.data.id}`, { orderId, amount: totalAmount });

    return res.json({ success: true, id: response.data.id, orderId });
  } catch (error) {
    logger.error('Error creating PayPal order:', error);
    return res.status(500).json({ error: 'Failed to create PayPal order', details: error.message });
  }
});

// Capture PayPal payment
router.post('/capture', async (req, res) => {
  try {
    const { orderID } = req.body;

    if (!orderID) {
      return res.status(400).json({ error: 'PayPal Order ID is required' });
    }

    const accessToken = await generatePayPalAccessToken();

    const response = await axios({
      method: 'post',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    // Get our stored order data
    const paypalOrderDoc = await db.collection('paypalOrders').doc(orderID).get();
    const paypalOrderData = paypalOrderDoc.exists ? paypalOrderDoc.data() : null;

    if (!paypalOrderData) {
      logger.error(`PayPal order data not found: ${orderID}`);
      return res.status(404).json({ error: 'PayPal order not found' });
    }

    // Update PayPal order status
    await db.collection('paypalOrders').doc(orderID).update({
      status: 'captured',
      capturedAt: new Date().toISOString(),
      paypalResponse: response.data
    });

    // Process the order (deliver templates + email)
    try {
      const orderResult = await orderController.processPaymentSuccess({
        id: orderID,
        amount: paypalOrderData.amount * 100, // cents
        currency: paypalOrderData.currency.toLowerCase(),
        status: 'succeeded',
        payment_method_types: ['paypal'],
        customer: {
          id: paypalOrderData.customerInfo?.userId || null,
          email: paypalOrderData.customerInfo?.email || null
        },
        metadata: {
          ...paypalOrderData.metadata,
          payment_method: 'paypal',
          order_id: paypalOrderData.orderId
        },
        items: paypalOrderData.items,
        processor: 'paypal'
      });

      const templates = Array.isArray(orderResult?.templates) ? orderResult.templates : [];

      // Record minimal delivery evidence without storing extra PII
      const requestInfo = {
        ip: req.headers['x-forwarded-for'] || req.ip || null,
        userAgent: req.headers['user-agent'] || null
      };
      await db.collection('paypalOrders').doc(orderID).update({
        requestInfo,
        deliveredAt: new Date().toISOString()
      });

      // Create invoice
      const invoice = await invoiceService.createInvoice(
        {
          id: orderID,
          processor: 'paypal',
          paymentMethod: 'paypal',
          transaction_id: orderID
        },
        {
          orderId: paypalOrderData.orderId,
          items: paypalOrderData.items,
          total: paypalOrderData.amount,
          currency: paypalOrderData.currency,
          metadata: paypalOrderData.metadata
        },
        paypalOrderData.customerInfo
      );

      logger.info(`Successfully processed PayPal order: ${orderID}`, {
        orderId: paypalOrderData.orderId,
        invoiceId: invoice.invoiceId
      });

      return res.json({
        success: true,
        orderID,
        orderId: paypalOrderData.orderId,
        orderResult,
        invoice: invoice.invoice,
        templates, // include created template access tokens for immediate UI use
        ...response.data
      });
    } catch (orderError) {
      logger.error(`Error processing PayPal order: ${orderError.message}`);
      // Still return success as payment was captured
      return res.json({
        success: true,
        orderID,
        orderId: paypalOrderData.orderId,
        orderProcessingError: orderError.message,
        templates: Array.isArray(orderResult?.templates) ? orderResult.templates : [],
        ...response.data
      });
    }
  } catch (error) {
    logger.error('Error capturing PayPal payment:', error);
    return res.status(500).json({ error: 'Failed to capture PayPal payment', details: error.message });
  }
});

// Confirm a PayPal subscription (called after onApprove)
router.post('/subscriptions/confirm', validateFirebaseToken, async (req, res) => {
  try {
    const { subscriptionID } = req.body || {};
    const userId = req.user?.uid;
    const email = req.user?.email || null;

    if (!subscriptionID) return res.status(400).json({ success: false, error: 'subscriptionID is required' });

    const accessToken = await generatePayPalAccessToken();

    // Retrieve subscription details from PayPal
    const subResp = await axios({
      method: 'get',
      url: `${PAYPAL_BASE_URL}/v1/billing/subscriptions/${subscriptionID}`,
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const sub = subResp.data || {};
    const status = (sub.status || 'APPROVAL_PENDING').toLowerCase();
    const planId = sub.plan_id || PAYPAL_SUBS_PLAN_ID || null;
    const billingInfo = sub.billing_info || {};
    const nextBillingTime = billingInfo.next_billing_time || null;
    const startTime = sub.start_time || new Date().toISOString();

    // Persist subscription
    await db.collection('subscriptions').doc(subscriptionID).set({
      id: subscriptionID,
      provider: 'paypal',
      planId,
      userId,
      email,
      status,
      startTime,
      nextBillingTime,
      raw: sub,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Mirror summary on user
    if (userId) {
      await db.collection('users').doc(userId).set({
        subscription: {
          provider: 'paypal',
          id: subscriptionID,
          planId,
          status,
          currentPeriodEnd: nextBillingTime || null
        }
      }, { merge: true });
    }

    // Invalidate entitlement cache
    try {
      const { deleteCache } = require('../../utils/cache');
      await deleteCache(`user:${userId}:entitlements`);
    } catch (e) {
      logger.warn('Failed to invalidate entitlement cache after subscription confirm:', e.message);
    }

    return res.json({ success: true, id: subscriptionID, status, planId, nextBillingTime });
  } catch (error) {
    logger.error('Error confirming PayPal subscription:', error.response?.data || error.message);
    return res.status(500).json({ success: false, error: 'Failed to confirm subscription', details: error.response?.data || error.message });
  }
});

// Test-create a subscription (server-side) to validate plan + environment
router.post('/subscriptions/test-create', async (req, res) => {
  try {
    const planId = (req.body && req.body.plan_id) || PAYPAL_SUBS_PLAN_ID;
    if (!planId) {
      return res.status(400).json({ success: false, error: 'Missing plan_id. Provide in body or set PAYPAL_SUBS_PLAN_ID.' });
    }

    const token = await generatePayPalAccessToken();
    const idempotencyKey = `subtest_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const payload = {
      plan_id: planId,
      application_context: {
        brand_name: 'AI Waverider',
        user_action: 'SUBSCRIBE_NOW',
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscribe/success`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscribe?canceled=true`
      }
    };

    const resp = await axios.post(
      `${PAYPAL_BASE_URL}/v1/billing/subscriptions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'PayPal-Request-Id': idempotencyKey,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(resp.status).json({ success: true, sandbox: PAYPAL_ENV !== 'live', data: resp.data });
  } catch (e) {
    const status = e.response?.status || 500;
    logger.error('Error test-creating PayPal subscription:', e.response?.data || e.message);
    return res.status(status).json({ success: false, error: 'Failed to create subscription', details: e.response?.data || e.message });
  }
});

// Add GET variant here to avoid shadowing by /subscriptions/:id
router.get('/subscriptions/test-create', async (req, res) => {
  try {
    const planId = req.query.plan_id || PAYPAL_SUBS_PLAN_ID;
    if (!planId) {
      return res.status(400).json({ success: false, error: 'Missing plan_id (query) or PAYPAL_SUBS_PLAN_ID not set.' });
    }

    const token = await generatePayPalAccessToken();
    const idempotencyKey = `subtest_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const payload = {
      plan_id: planId,
      application_context: {
        brand_name: 'AI Waverider',
        user_action: 'SUBSCRIBE_NOW',
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscribe/success`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscribe?canceled=true`
      }
    };

    const resp = await axios.post(
      `${PAYPAL_BASE_URL}/v1/billing/subscriptions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'PayPal-Request-Id': idempotencyKey,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(resp.status).json({ success: true, sandbox: PAYPAL_ENV !== 'live', data: resp.data });
  } catch (e) {
    const status = e.response?.status || 500;
    logger.error('Error test-creating PayPal subscription (GET):', e.response?.data || e.message);
    return res.status(status).json({ success: false, error: 'Failed to create subscription', details: e.response?.data || e.message });
  }
});

// Get a subscription status
router.get('/subscriptions/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, error: 'Subscription ID is required' });

    const doc = await db.collection('subscriptions').doc(id).get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'Subscription not found' });

    return res.json({ success: true, subscription: doc.data() });
  } catch (error) {
    logger.error('Error fetching subscription:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch subscription' });
  }
});

// PayPal Webhook - verify and process subscription events
router.post('/webhook', async (req, res) => {
  try {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      logger.warn('PAYPAL_WEBHOOK_ID not configured; skipping verification');
      return res.status(400).json({ error: 'Webhook not configured' });
    }

    const transmissionId = req.header('paypal-transmission-id');
    const transmissionTime = req.header('paypal-transmission-time');
    const certUrl = req.header('paypal-cert-url');
    const authAlgo = req.header('paypal-auth-algo');
    const transmissionSig = req.header('paypal-transmission-sig');
    const body = req.body;

    const accessToken = await generatePayPalAccessToken();

    // Verify signature
    const verifyResp = await axios({
      method: 'post',
      url: `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      data: {
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: body
      }
    });

    if (verifyResp.data?.verification_status !== 'SUCCESS') {
      logger.warn('PayPal webhook verification failed', verifyResp.data);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const eventType = body.event_type || '';
    logger.info(`PayPal webhook received: ${eventType}`);

    if (eventType.startsWith('BILLING.SUBSCRIPTION') || eventType.startsWith('PAYMENT.SALE')) {
      try {
        const resource = body.resource || {};
        const subscriptionId = resource.id || resource.billing_agreement_id || resource.subscription_id;
        const status = (resource.status || body.summary || '').toLowerCase();
        const nextBillingTime = resource.billing_info?.next_billing_time || null;

        // Update subscription doc if present
        if (subscriptionId) {
          await db.collection('subscriptions').doc(subscriptionId).set({
            id: subscriptionId,
            provider: 'paypal',
            status,
            nextBillingTime: nextBillingTime || null,
            lastEvent: eventType,
            rawLastEvent: body,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }

        // Try to mirror on user if we previously linked
        // We purposely do not try to guess the user here without linkage
      } catch (e) {
        logger.error('Failed to persist webhook event:', e);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Webhook handler error:', error.message);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// List plans (optional product filter)
router.get('/plans', async (req, res) => {
  try {
    const token = await generatePayPalAccessToken();
    const productId = req.query.product_id;
    let url = `${PAYPAL_BASE_URL}/v1/billing/plans?page_size=20&page=1&total_required=true`;
    if (productId) url += `&product_id=${encodeURIComponent(productId)}`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.json({ success: true, ...resp.data });
  } catch (e) {
    logger.error('Error listing PayPal plans:', e.response?.data || e.message);
    return res.status(500).json({ success: false, error: 'Failed to list plans', details: e.response?.data || e.message });
  }
});

// Get plan details
router.get('/plans/:id', async (req, res) => {
  try {
    const token = await generatePayPalAccessToken();
    const url = `${PAYPAL_BASE_URL}/v1/billing/plans/${req.params.id}`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.json({ success: true, plan: resp.data });
  } catch (e) {
    const status = e.response?.status || 500;
    logger.error('Error fetching PayPal plan:', e.response?.data || e.message);
    return res.status(status).json({ success: false, error: 'Failed to fetch plan', details: e.response?.data || e.message });
  }
});

// Safe config echo for debugging (masked IDs)
router.get('/config', (req, res) => {
  const mask = (s) => {
    if (!s || typeof s !== 'string') return null;
    if (s.length <= 8) return '****';
    return `${s.slice(0, 4)}...${s.slice(-6)}`;
  };
  return res.json({
    success: true,
    env: PAYPAL_ENV,
    baseUrl: PAYPAL_BASE_URL,
    clientId: mask(process.env.PAYPAL_CLIENT_ID),
    planId: PAYPAL_SUBS_PLAN_ID ? mask(PAYPAL_SUBS_PLAN_ID) : null,
    productId: PAYPAL_SUBS_PRODUCT_ID ? mask(PAYPAL_SUBS_PRODUCT_ID) : null
  });
});

module.exports = router; 