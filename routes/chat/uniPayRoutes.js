/**
 * UniPay Routes - Payment Processing Endpoints (Updated for Official API v3)
 * 
 * Handles all UniPay payment processing, webhooks, and status checks
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// Services
const uniPayService = require('../../services/payment/uniPayService');
const invoiceService = require('../../services/invoice/invoiceService');
const orderController = require('../../controllers/payment/orderController');
const emailService = require('../../services/email/emailService');
const logger = require('../../utils/logger');
const { db } = require('../../config/firebase');

// PayPal configuration (direct integration) - keeping existing PayPal code
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'test_client_id';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'test_client_secret';
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

/**
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const healthCheck = await uniPayService.healthCheck();
    
    return res.status(200).json({
      status: 'success',
      service: 'unipay',
      ...healthCheck,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('UniPay health check failed:', error);
    return res.status(500).json({
      status: 'error',
      service: 'unipay',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Create payment session (Updated for Official API)
 */
router.post('/create-session', async (req, res) => {
  try {
    const { amount, currency, items, customerInfo, metadata = {} } = req.body;
    
    if (!amount || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request: amount and items are required' 
      });
    }

    // Generate order ID
    const orderId = metadata.orderId || uuidv4();
    
    // Log payment session creation
    logger.info('Creating UniPay payment session', {
      orderId,
      amount,
      currency: currency || 'USD',
      itemCount: items.length,
      customerCountry: customerInfo?.country
    });

    // Prepare order data
    const orderData = {
      amount: parseFloat(amount),
      currency: currency?.toUpperCase() || 'USD',
      orderId,
      items,
      customerInfo: customerInfo || {},
      metadata: {
        ...metadata,
        items: JSON.stringify(items),
        orderId
      }
    };

    // Create UniPay session
    const sessionResult = await uniPayService.createPaymentSession(orderData);
    
    // Get available payment methods
    const methodsResult = await uniPayService.getPaymentMethods(sessionResult.orderHashId);
    
    // Store session in database for tracking
    const sessionData = {
      orderHashId: sessionResult.orderHashId,
      merchantOrderId: sessionResult.merchantOrderId,
      orderId,
      amount: sessionResult.amount,
      originalAmount: sessionResult.originalAmount,
      originalCurrency: sessionResult.originalCurrency,
      currency: sessionResult.currency,
      items,
      customerInfo,
      metadata,
      status: 'created',
      createdAt: new Date().toISOString(),
      vatInfo: sessionResult.vatInfo || null,
      conversionInfo: sessionResult.conversionInfo || null,
      paymentUrl: sessionResult.paymentUrl || null
    };
    
    await db.collection('uniPayOrders').doc(sessionResult.orderHashId).set(sessionData);
    
    logger.info(`Created UniPay session: ${sessionResult.orderHashId}`, {
      merchantOrderId: sessionResult.merchantOrderId,
      orderId,
      availableMethods: methodsResult.methods,
      amount: sessionResult.amount
    });

    return res.status(200).json({
      success: true,
      sessionId: sessionResult.orderHashId, // For compatibility with existing frontend
      orderHashId: sessionResult.orderHashId,
      merchantOrderId: sessionResult.merchantOrderId,
      orderId,
      amount: sessionResult.amount,
      originalAmount: sessionResult.originalAmount,
      currency: sessionResult.currency,
      originalCurrency: sessionResult.originalCurrency,
      paymentUrl: sessionResult.paymentUrl,
      availableMethods: methodsResult.methods || [],
      vatInfo: sessionResult.vatInfo || null,
      conversionInfo: sessionResult.conversionInfo || null,
      ...sessionResult
    });
  } catch (error) {
    logger.error('Error creating UniPay session:', error);
    return res.status(500).json({
      error: 'Failed to create payment session',
      details: error.message
    });
  }
});

/**
 * Get available payment methods for session
 */
router.get('/methods/:orderHashId', async (req, res) => {
  try {
    const { orderHashId } = req.params;
    
    const result = await uniPayService.getPaymentMethods(orderHashId);
    
    return res.status(200).json({
      success: true,
      orderHashId,
      methods: result.methods || [],
      ...result
    });
  } catch (error) {
    logger.error(`Error getting payment methods for order ${req.params.orderHashId}:`, error);
    return res.status(500).json({
      error: 'Failed to get payment methods',
      details: error.message
    });
  }
});

/**
 * Process payment redirect (UniPay specific)
 */
router.post('/process-redirect', async (req, res) => {
  try {
    const { orderHashId } = req.body;
    
    if (!orderHashId) {
      return res.status(400).json({
        error: 'Order Hash ID is required'
      });
    }

    // Get order data from database
    const orderDoc = await db.collection('uniPayOrders').doc(orderHashId).get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        error: 'Order not found'
      });
    }

    const orderData = orderDoc.data();
    
    logger.info(`Processing redirect payment for order: ${orderHashId}`);

    return res.status(200).json({
      success: true,
      orderHashId,
      paymentUrl: orderData.paymentUrl,
      message: 'Redirect to payment URL to complete payment'
    });
  } catch (error) {
    logger.error(`Error processing redirect payment for order ${req.body.orderHashId}:`, error);
    return res.status(500).json({
      error: 'Payment processing failed',
      details: error.message
    });
  }
});

/**
 * Confirm order (for preauth)
 */
router.post('/confirm-order', async (req, res) => {
  try {
    const { orderHashId, amount = 0 } = req.body;
    
    if (!orderHashId) {
      return res.status(400).json({
        error: 'Order Hash ID is required'
      });
    }

    logger.info(`Confirming UniPay order: ${orderHashId}`);

    const result = await uniPayService.confirmOrder(orderHashId, amount);
    
    // Update order status in database
    await db.collection('uniPayOrders').doc(orderHashId).update({
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      confirmedAmount: amount
    });

    logger.info(`Confirmed UniPay order: ${orderHashId}`, {
      amount
    });

    return res.status(200).json({
      success: true,
      orderHashId,
      ...result
    });
  } catch (error) {
    logger.error(`Error confirming UniPay order ${req.body.orderHashId}:`, error);
    return res.status(500).json({
      error: 'Order confirmation failed',
      details: error.message
    });
  }
});

/**
 * Get payment status
 */
router.get('/status/:orderHashId', async (req, res) => {
  try {
    const { orderHashId } = req.params;
    
    // Get UniPay status
    const uniPayStatus = await uniPayService.getPaymentStatus(orderHashId);
    
    // Get order data from our database
    const orderDoc = await db.collection('uniPayOrders').doc(orderHashId).get();
    const orderData = orderDoc.exists ? orderDoc.data() : null;
    
    return res.status(200).json({
      success: true,
      orderHashId,
      orderData,
      uniPayStatus: uniPayStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting payment status for order ${req.params.orderHashId}:`, error);
    return res.status(500).json({
      error: 'Failed to get payment status',
      details: error.message
    });
  }
});

/**
 * Create refund
 */
router.post('/refund', async (req, res) => {
  try {
    const { orderHashId, amount, reason } = req.body;
    
    if (!orderHashId || !amount) {
      return res.status(400).json({
        error: 'Order Hash ID and amount are required for refund'
      });
    }

    logger.info(`Creating refund for UniPay order: ${orderHashId}`, {
      amount,
      reason
    });

    const result = await uniPayService.createRefund(orderHashId, amount, reason);
    
    // Update order status in database
    await db.collection('uniPayOrders').doc(orderHashId).update({
      status: 'refunded',
      refundedAt: new Date().toISOString(),
      refundAmount: amount,
      refundReason: reason || null
    });

    // Process order refund
    const orderDoc = await db.collection('uniPayOrders').doc(orderHashId).get();
    if (orderDoc.exists) {
      const orderData = orderDoc.data();
      if (orderData.orderId) {
        try {
          await orderController.processOrderRefund(orderData.orderId, {
            refund_id: `unipay_${orderHashId}`,
            amount: amount,
            reason: reason
          });
        } catch (orderError) {
          logger.error(`Error processing order refund: ${orderError.message}`);
        }
      }
    }
    
    logger.info(`Refund created: ${orderHashId}`, {
      amount,
      status: result.success
    });

    return res.status(200).json({
      success: true,
      orderHashId,
      ...result
    });
  } catch (error) {
    logger.error(`Error creating refund for order ${req.body.orderHashId}:`, error);
    return res.status(500).json({
      error: 'Refund creation failed',
      details: error.message
    });
  }
});

/**
 * Webhook handler for UniPay events
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const payload = req.body.toString();
    let event;
    
    try {
      event = JSON.parse(payload);
    } catch (parseError) {
      logger.error('Invalid webhook payload:', parseError);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    
    logger.info(`Received UniPay webhook:`, {
      event: event
    });

    // Check for duplicate processing if webhook has ID
    if (event.id) {
      const eventDoc = await db.collection('webhookEvents').doc(event.id).get();
      if (eventDoc.exists) {
        logger.info(`Duplicate webhook event ignored: ${event.id}`);
        return res.status(200).json({ received: true, duplicate: true });
      }

      // Store event for deduplication
      await db.collection('webhookEvents').doc(event.id).set({
        eventId: event.id,
        type: event.type || 'unknown',
        orderHashId: event.OrderHashID,
        processedAt: new Date().toISOString(),
        data: event
      });
    }

    // Process the webhook event
    if (event.OrderHashID) {
      await handleUniPayWebhook(event);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error processing UniPay webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Success callback endpoint (for redirect handling)
 */
router.get('/success', async (req, res) => {
  try {
    const { payment_id, status, order_hash_id } = req.query;
    
    logger.info('UniPay success callback received', {
      payment_id,
      status,
      order_hash_id
    });

    if (order_hash_id && status === 'success') {
      // Process successful payment
      await handlePaymentSuccess(order_hash_id);
    }

    // Redirect to frontend success page
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id=${payment_id}&status=${status}&type=unipay`;
    return res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Error handling UniPay success callback:', error);
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?error=callback_error`;
    return res.redirect(redirectUrl);
  }
});

/**
 * Cancel callback endpoint
 */
router.get('/cancel', async (req, res) => {
  try {
    const { payment_id, order_hash_id } = req.query;
    
    logger.info('UniPay cancel callback received', {
      payment_id,
      order_hash_id
    });

    if (order_hash_id) {
      // Update order status
      await db.collection('uniPayOrders').doc(order_hash_id).update({
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
      });
    }

    // Redirect to frontend
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?canceled=true`;
    return res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Error handling UniPay cancel callback:', error);
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?error=callback_error`;
    return res.redirect(redirectUrl);
  }
});

/**
 * Get error list
 */
router.get('/errors', async (req, res) => {
  try {
    const result = await uniPayService.getErrorList();
    
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error getting UniPay error list:', error);
    return res.status(500).json({
      error: 'Failed to get error list',
      details: error.message
    });
  }
});

/**
 * Get status list
 */
router.get('/statuses', async (req, res) => {
  try {
    const result = await uniPayService.getStatusList();
    
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error getting UniPay status list:', error);
    return res.status(500).json({
      error: 'Failed to get status list',
      details: error.message
    });
  }
});

/**
 * PayPal direct integration endpoints (keeping existing code)
 */

// Generate PayPal access token
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
router.post('/paypal/create-order', async (req, res) => {
  try {
    const { amount, currency, items, customerInfo, metadata = {} } = req.body;
    
    if (!amount || !items) {
      return res.status(400).json({ error: 'Amount and items are required' });
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
        currency_code: (currency || 'USD').toUpperCase(),
        value: (item.price || 0).toFixed(2)
      },
      quantity: (item.quantity || 1).toString(),
      category: 'DIGITAL_GOODS'
    }));

    const totalAmount = lineItems.reduce((sum, item) => {
      return sum + (parseFloat(item.unit_amount.value) * parseInt(item.quantity));
    }, 0);

    // Create PayPal order payload
    const payload = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: orderId,
        amount: {
          currency_code: (currency || 'USD').toUpperCase(),
          value: totalAmount.toFixed(2),
          breakdown: {
            item_total: {
              currency_code: (currency || 'USD').toUpperCase(),
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
      currency: (currency || 'USD').toUpperCase(),
      items,
      customerInfo,
      metadata,
      status: 'created',
      createdAt: new Date().toISOString()
    });

    logger.info(`Created PayPal order: ${response.data.id}`, { orderId, amount: totalAmount });

    return res.json({
      success: true,
      id: response.data.id,
      orderId
    });
  } catch (error) {
    logger.error('Error creating PayPal order:', error);
    return res.status(500).json({
      error: 'Failed to create PayPal order',
      details: error.message
    });
  }
});

// Capture PayPal payment
router.post('/paypal/capture', async (req, res) => {
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

    // Process the order
    try {
      const orderResult = await orderController.processPaymentSuccess({
        id: orderID,
        amount: paypalOrderData.amount * 100, // Convert to cents
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
        items: paypalOrderData.items
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
    return res.status(500).json({
      error: 'Failed to capture PayPal payment',
      details: error.message
    });
  }
});

/**
 * Helper functions
 */

// Handle UniPay webhook event
async function handleUniPayWebhook(event) {
  try {
    const orderHashId = event.OrderHashID;
    
    // Get order data
    const orderDoc = await db.collection('uniPayOrders').doc(orderHashId).get();
    if (!orderDoc.exists) {
      logger.error(`UniPay webhook: Order not found: ${orderHashId}`);
      return;
    }

    const orderData = orderDoc.data();
    
    // Update order status based on event
    const updateData = {
      status: event.Status || 'unknown',
      lastWebhookAt: new Date().toISOString(),
      webhookData: event
    };

    // Handle different event types
    if (event.Status === 'Success' || event.Status === 'success' || event.Status === 'Succeeded') {
      updateData.status = 'success';
      updateData.paidAt = new Date().toISOString();
      
      // Process successful payment
      await handlePaymentSuccess(orderHashId);
    } else if (event.Status === 'Failed' || event.Status === 'failed' || event.Status === 'Error') {
      updateData.status = 'failed';
      updateData.failedAt = new Date().toISOString();
      updateData.failureReason = event.FailureReason || event.ErrorMessage || 'Unknown';
    }

    await db.collection('uniPayOrders').doc(orderHashId).update(updateData);
    
    logger.info(`UniPay webhook processed: ${orderHashId}`, {
      status: event.Status
    });
  } catch (error) {
    logger.error('Error handling UniPay webhook:', error);
  }
}

// Handle successful payment
async function handlePaymentSuccess(orderHashId) {
  try {
    // Get order data
    const orderDoc = await db.collection('uniPayOrders').doc(orderHashId).get();
    if (!orderDoc.exists) {
      throw new Error(`Order not found: ${orderHashId}`);
    }
    
    const orderData = orderDoc.data();
    
    // Process order success
    const orderResult = await orderController.processPaymentSuccess({
      id: orderHashId,
      amount: orderData.originalAmount * 100, // Convert to cents using original amount
      currency: orderData.originalCurrency?.toLowerCase() || 'usd',
      status: 'succeeded',
      payment_method_types: ['unipay'],
      customer: {
        id: orderData.customerInfo?.userId || null,
        email: orderData.customerInfo?.email || null
      },
      metadata: {
        ...orderData.metadata,
        order_hash_id: orderHashId,
        order_id: orderData.orderId
      },
      items: orderData.items,
      processor: 'unipay',
      vatInfo: orderData.vatInfo
    });

    // Create invoice
    const invoice = await invoiceService.createInvoice(
      {
        id: orderHashId,
        processor: 'unipay',
        paymentMethod: 'unipay',
        transaction_id: orderHashId,
        vatInfo: orderData.vatInfo
      },
      {
        orderId: orderData.orderId,
        items: orderData.items,
        total: orderData.originalAmount,
        currency: orderData.originalCurrency,
        metadata: orderData.metadata
      },
      orderData.customerInfo
    );

    // Update UniPay order with processing results
    await db.collection('uniPayOrders').doc(orderHashId).update({
      orderProcessed: true,
      processedAt: new Date().toISOString(),
      invoiceId: invoice.invoiceId,
      orderResult: orderResult
    });

    logger.info(`Successfully processed UniPay payment: ${orderHashId}`, {
      orderId: orderData.orderId,
      invoiceId: invoice.invoiceId
    });

    return { orderResult, invoice };
  } catch (error) {
    logger.error(`Error processing UniPay payment success for ${orderHashId}:`, error);
    throw error;
  }
}

module.exports = router;