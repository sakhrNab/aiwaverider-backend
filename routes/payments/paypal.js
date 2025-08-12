const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const logger = require('../../utils/logger');
const { db } = require('../../config/firebase');
const orderController = require('../../controllers/payment/orderController');
const invoiceService = require('../../services/invoice/invoiceService');

// PayPal configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'test_client_id';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'test_client_secret';
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production'
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

    if (!amount || !Array.isArray(items) || items.length === 0) {
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

    // Format line items for PayPal
    const lineItems = items.map(item => ({
      name: item.title || item.name || 'Product',
      unit_amount: {
        currency_code: requestedCurrency,
        value: (item.price || 0).toFixed(2)
      },
      quantity: (item.quantity || 1).toString(),
      category: 'DIGITAL_GOODS'
    }));

    const totalAmount = lineItems.reduce((sum, item) => sum + (parseFloat(item.unit_amount.value) * parseInt(item.quantity, 10)), 0);

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
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id=${orderId}&status=success&type=paypal`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?canceled=true`
      }
    };

    const response = await axios({
      method: 'post',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      data: payload
    });

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
        ...response.data
      });
    }
  } catch (error) {
    logger.error('Error capturing PayPal payment:', error);
    return res.status(500).json({ error: 'Failed to capture PayPal payment', details: error.message });
  }
});

module.exports = router; 