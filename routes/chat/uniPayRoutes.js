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
const { pool } = require('../../config/database');

// In-memory webhook event deduplication (acceptable for single-server deployments)
// TODO: For multi-server deployments, consider using a dedicated PostgreSQL table for webhook deduplication
const processedWebhookEvents = new Set();

// PayPal configuration (direct integration) - keeping existing PayPal code
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'test_client_id';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'test_client_secret';
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

/**
 * Health check endpoint
 */
/**
 * @swagger
 * /api/chat/unipay/health:
 *   get:
 *     summary: UniPay health check
 *     description: Check the health of the UniPay service
 *     tags: [UniPay Integration]
 *     responses:
 *       200:
 *         description: UniPay service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 service:
 *                   type: string
 *                   example: "unipay"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: UniPay service unhealthy
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
 * Get available payment methods for session
 */
/**
 * @swagger
 * /api/chat/unipay/methods/{orderHashId}:
 *   get:
 *     summary: Get payment methods
 *     description: Get available payment methods for an order
 *     tags: [UniPay Integration]
 *     parameters:
 *       - in: path
 *         name: orderHashId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order hash ID
 *         example: "order_hash_123"
 *     responses:
 *       200:
 *         description: Payment methods retrieved successfully
 *       400:
 *         description: Bad request - Invalid order hash
 *       500:
 *         description: Internal server error
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
/**
 * @swagger
 * /api/chat/unipay/process-redirect:
 *   post:
 *     summary: Process payment redirect
 *     description: Process a payment redirect from UniPay
 *     tags: [UniPay Integration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderHashId
 *               - paymentMethod
 *             properties:
 *               orderHashId:
 *                 type: string
 *                 description: Order hash ID
 *                 example: "order_hash_123"
 *               paymentMethod:
 *                 type: string
 *                 description: Payment method
 *                 example: "card"
 *               redirectData:
 *                 type: object
 *                 description: Redirect data from payment provider
 *     responses:
 *       200:
 *         description: Payment redirect processed successfully
 *       400:
 *         description: Bad request - Invalid redirect data
 *       500:
 *         description: Internal server error
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
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE unipay_order_hash_id = $1',
      [orderHashId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Order not found'
      });
    }

    const orderData = rows[0];
    const metadata = orderData.metadata || {};

    logger.info(`Processing redirect payment for order: ${orderHashId}`);

    return res.status(200).json({
      success: true,
      orderHashId,
      paymentUrl: metadata.paymentUrl,
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
/**
 * @swagger
 * /api/chat/unipay/confirm-order:
 *   post:
 *     summary: Confirm order
 *     description: Confirm a payment order
 *     tags: [UniPay Integration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderHashId
 *               - paymentId
 *             properties:
 *               orderHashId:
 *                 type: string
 *                 description: Order hash ID
 *                 example: "order_hash_123"
 *               paymentId:
 *                 type: string
 *                 description: Payment ID
 *                 example: "payment_123"
 *               amount:
 *                 type: number
 *                 description: Payment amount
 *                 example: 29.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *     responses:
 *       200:
 *         description: Order confirmed successfully
 *       400:
 *         description: Bad request - Invalid order data
 *       500:
 *         description: Internal server error
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
    await pool.query(
      `UPDATE orders
         SET status = $1,
             metadata = metadata || $2::jsonb,
             updated_at = NOW()
       WHERE unipay_order_hash_id = $3`,
      [
        'confirmed',
        JSON.stringify({ confirmedAt: new Date().toISOString(), confirmedAmount: amount }),
        orderHashId
      ]
    );

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
/**
 * @swagger
 * /api/chat/unipay/status/{orderHashId}:
 *   get:
 *     summary: Get payment status
 *     description: Get the status of a payment by order hash ID
 *     tags: [UniPay Integration]
 *     parameters:
 *       - in: path
 *         name: orderHashId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order hash ID
 *         example: "order_hash_123"
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
router.get('/status/:orderHashId', async (req, res) => {
  try {
    const { orderHashId } = req.params;
    
    // Get UniPay status
    const uniPayStatus = await uniPayService.getPaymentStatus(orderHashId);
    
    // Get order data from our database
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE unipay_order_hash_id = $1',
      [orderHashId]
    );
    const orderData = rows.length > 0 ? rows[0] : null;
    
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
/**
 * @swagger
 * /api/chat/unipay/refund:
 *   post:
 *     summary: Create refund
 *     description: Create a refund for a payment
 *     tags: [UniPay Integration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - paymentId
 *               - amount
 *             properties:
 *               paymentId:
 *                 type: string
 *                 description: Payment ID to refund
 *                 example: "payment_123"
 *               amount:
 *                 type: number
 *                 description: Refund amount
 *                 example: 29.99
 *               reason:
 *                 type: string
 *                 description: Refund reason
 *                 example: "Customer requested refund"
 *     responses:
 *       200:
 *         description: Refund created successfully
 *       400:
 *         description: Bad request - Invalid refund data
 *       500:
 *         description: Internal server error
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
    const { rows: refundRows } = await pool.query(
      `UPDATE orders
         SET status = $1,
             refunded_at = NOW(),
             refund_amount = $2,
             refund_reason = $3,
             refund_id = $4,
             metadata = metadata || $5::jsonb,
             updated_at = NOW()
       WHERE unipay_order_hash_id = $6
       RETURNING *`,
      [
        'refunded',
        amount,
        reason || null,
        `unipay_${orderHashId}`,
        JSON.stringify({ refundedAt: new Date().toISOString() }),
        orderHashId
      ]
    );

    // Process order refund
    if (refundRows.length > 0) {
      const orderData = refundRows[0];
      if (orderData.id) {
        try {
          await orderController.processOrderRefund(orderData.id, {
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
/**
 * @swagger
 * /api/chat/unipay/webhook:
 *   post:
 *     summary: UniPay webhook handler
 *     description: Handle UniPay webhook events
 *     tags: [UniPay Integration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: UniPay webhook event data
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Bad request - Invalid webhook data
 *       500:
 *         description: Internal server error
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
    // TODO: For multi-server deployments, replace in-memory Set with a PostgreSQL webhook_events table
    if (event.id) {
      if (processedWebhookEvents.has(event.id)) {
        logger.info(`Duplicate webhook event ignored: ${event.id}`);
        return res.status(200).json({ received: true, duplicate: true });
      }

      // Store event ID for deduplication
      processedWebhookEvents.add(event.id);

      // Prevent unbounded memory growth - keep last 10,000 events
      if (processedWebhookEvents.size > 10000) {
        const firstEntry = processedWebhookEvents.values().next().value;
        processedWebhookEvents.delete(firstEntry);
      }

      logger.info(`Processing webhook event: ${event.id}`, {
        type: event.type || 'unknown',
        orderHashId: event.OrderHashID
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
/**
 * @swagger
 * /api/chat/unipay/success:
 *   get:
 *     summary: Payment success callback
 *     description: Handle successful payment redirect
 *     tags: [UniPay Integration]
 *     parameters:
 *       - in: query
 *         name: orderHashId
 *         schema:
 *           type: string
 *         description: Order hash ID
 *         example: "order_hash_123"
 *       - in: query
 *         name: paymentId
 *         schema:
 *           type: string
 *         description: Payment ID
 *         example: "payment_123"
 *     responses:
 *       200:
 *         description: Success page displayed
 *       400:
 *         description: Bad request - Missing parameters
 *       500:
 *         description: Internal server error
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
/**
 * @swagger
 * /api/chat/unipay/cancel:
 *   get:
 *     summary: Payment cancel callback
 *     description: Handle canceled payment redirect
 *     tags: [UniPay Integration]
 *     parameters:
 *       - in: query
 *         name: orderHashId
 *         schema:
 *           type: string
 *         description: Order hash ID
 *         example: "order_hash_123"
 *     responses:
 *       200:
 *         description: Cancel page displayed
 *       500:
 *         description: Internal server error
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
      await pool.query(
        `UPDATE orders
           SET status = $1,
               metadata = metadata || $2::jsonb,
               updated_at = NOW()
         WHERE unipay_order_hash_id = $3`,
        [
          'cancelled',
          JSON.stringify({ cancelledAt: new Date().toISOString() }),
          order_hash_id
        ]
      );
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
/**
 * @swagger
 * /api/chat/unipay/errors:
 *   get:
 *     summary: Get error list
 *     description: Get list of payment errors
 *     tags: [UniPay Integration]
 *     responses:
 *       200:
 *         description: Error list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         example: "PAYMENT_FAILED"
 *                       message:
 *                         type: string
 *                         example: "Payment processing failed"
 *                       description:
 *                         type: string
 *                         example: "The payment could not be processed"
 *       500:
 *         description: Internal server error
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
/**
 * @swagger
 * /api/chat/unipay/statuses:
 *   get:
 *     summary: Get status list
 *     description: Get list of payment statuses
 *     tags: [UniPay Integration]
 *     responses:
 *       200:
 *         description: Status list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 statuses:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         example: "PENDING"
 *                       name:
 *                         type: string
 *                         example: "Pending"
 *                       description:
 *                         type: string
 *                         example: "Payment is pending"
 *       500:
 *         description: Internal server error
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
/**
 * @swagger
 * /api/chat/unipay/paypal/create-order:
 *   post:
 *     summary: Create PayPal order via UniPay
 *     description: Create a PayPal order through UniPay integration
 *     tags: [UniPay Integration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - currency
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Order amount
 *                 example: 29.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: "AI Agent License"
 *                     quantity:
 *                       type: integer
 *                       example: 1
 *                     price:
 *                       type: number
 *                       example: 29.99
 *     responses:
 *       200:
 *         description: PayPal order created successfully
 *       400:
 *         description: Bad request - Invalid order data
 *       500:
 *         description: Internal server error
 */
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

    // Store PayPal order in the orders table
    await pool.query(
      `INSERT INTO orders (id, user_id, user_email, items, total, currency, status, payment_id, payment_processor, payment_method, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         payment_id = EXCLUDED.payment_id,
         metadata = orders.metadata || EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        orderId,
        customerInfo?.userId || null,
        customerInfo?.email || null,
        JSON.stringify(items),
        totalAmount,
        (currency || 'USD').toUpperCase(),
        'created',
        response.data.id,
        'paypal',
        'paypal',
        JSON.stringify({
          ...metadata,
          paypalOrderId: response.data.id,
          customerInfo,
          createdAt: new Date().toISOString()
        })
      ]
    );

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
/**
 * @swagger
 * /api/chat/unipay/paypal/capture:
 *   post:
 *     summary: Capture PayPal payment via UniPay
 *     description: Capture a PayPal payment through UniPay integration
 *     tags: [UniPay Integration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: string
 *                 description: PayPal order ID
 *                 example: "PAYPAL-ORDER-123"
 *               amount:
 *                 type: number
 *                 description: Capture amount
 *                 example: 29.99
 *     responses:
 *       200:
 *         description: PayPal payment captured successfully
 *       400:
 *         description: Bad request - Invalid capture data
 *       500:
 *         description: Internal server error
 */
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
    const { rows: paypalRows } = await pool.query(
      'SELECT * FROM orders WHERE payment_id = $1 AND payment_processor = $2',
      [orderID, 'paypal']
    );
    const paypalOrderData = paypalRows.length > 0 ? paypalRows[0] : null;

    if (!paypalOrderData) {
      logger.error(`PayPal order data not found: ${orderID}`);
      return res.status(404).json({ error: 'PayPal order not found' });
    }

    const paypalMetadata = paypalOrderData.metadata || {};
    const customerInfo = paypalMetadata.customerInfo || {};

    // Update PayPal order status
    await pool.query(
      `UPDATE orders
         SET status = $1,
             metadata = metadata || $2::jsonb,
             updated_at = NOW()
       WHERE payment_id = $3 AND payment_processor = $4`,
      [
        'captured',
        JSON.stringify({ capturedAt: new Date().toISOString(), paypalResponse: response.data }),
        orderID,
        'paypal'
      ]
    );

    // Process the order
    try {
      const orderResult = await orderController.processPaymentSuccess({
        id: orderID,
        amount: paypalOrderData.total * 100, // Convert to cents
        currency: paypalOrderData.currency.toLowerCase(),
        status: 'succeeded',
        payment_method_types: ['paypal'],
        customer: {
          id: customerInfo.userId || paypalOrderData.user_id || null,
          email: customerInfo.email || paypalOrderData.user_email || null
        },
        metadata: {
          ...paypalMetadata,
          payment_method: 'paypal',
          order_id: paypalOrderData.id
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
          orderId: paypalOrderData.id,
          items: paypalOrderData.items,
          total: paypalOrderData.total,
          currency: paypalOrderData.currency,
          metadata: paypalMetadata
        },
        customerInfo
      );

      logger.info(`Successfully processed PayPal order: ${orderID}`, {
        orderId: paypalOrderData.id,
        invoiceId: invoice.invoiceId
      });

      return res.json({
        success: true,
        orderID,
        orderId: paypalOrderData.id,
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
        orderId: paypalOrderData.id,
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
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE unipay_order_hash_id = $1',
      [orderHashId]
    );

    if (rows.length === 0) {
      logger.error(`UniPay webhook: Order not found in orders table: ${orderHashId}. Webhook event may have arrived before order creation.`);
      return;
    }

    // Determine the new status and metadata updates
    let newStatus = event.Status || 'unknown';
    const metadataUpdate = {
      lastWebhookAt: new Date().toISOString(),
      webhookData: event
    };

    // Handle different event types
    if (event.Status === 'Success' || event.Status === 'success' || event.Status === 'Succeeded') {
      newStatus = 'success';
      metadataUpdate.paidAt = new Date().toISOString();

      // Process successful payment
      await handlePaymentSuccess(orderHashId);
    } else if (event.Status === 'Failed' || event.Status === 'failed' || event.Status === 'Error') {
      newStatus = 'failed';
      metadataUpdate.failedAt = new Date().toISOString();
      metadataUpdate.failureReason = event.FailureReason || event.ErrorMessage || 'Unknown';
    }

    await pool.query(
      `UPDATE orders
         SET status = $1,
             metadata = metadata || $2::jsonb,
             updated_at = NOW()
       WHERE unipay_order_hash_id = $3`,
      [newStatus, JSON.stringify(metadataUpdate), orderHashId]
    );

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
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE unipay_order_hash_id = $1',
      [orderHashId]
    );

    if (rows.length === 0) {
      throw new Error(`Order not found: ${orderHashId}`);
    }

    const orderData = rows[0];
    const metadata = orderData.metadata || {};
    const customerInfo = metadata.customerInfo || {};
    const vatInfo = orderData.vat_info || metadata.vatInfo || null;
    // Original amount/currency may be stored in metadata (from UniPay order creation) or use table columns
    const originalAmount = metadata.originalAmount || orderData.total;
    const originalCurrency = metadata.originalCurrency || orderData.currency;

    // Process order success
    const orderResult = await orderController.processPaymentSuccess({
      id: orderHashId,
      amount: originalAmount * 100, // Convert to cents using original amount
      currency: originalCurrency?.toLowerCase() || 'usd',
      status: 'succeeded',
      payment_method_types: ['unipay'],
      customer: {
        id: customerInfo.userId || orderData.user_id || null,
        email: customerInfo.email || orderData.user_email || null
      },
      metadata: {
        ...metadata,
        order_hash_id: orderHashId,
        order_id: orderData.id
      },
      items: orderData.items,
      processor: 'unipay',
      vatInfo: vatInfo
    });

    // Create invoice
    const invoice = await invoiceService.createInvoice(
      {
        id: orderHashId,
        processor: 'unipay',
        paymentMethod: 'unipay',
        transaction_id: orderHashId,
        vatInfo: vatInfo
      },
      {
        orderId: orderData.id,
        items: orderData.items,
        total: originalAmount,
        currency: originalCurrency,
        metadata: metadata
      },
      customerInfo
    );

    // Update order with processing results
    await pool.query(
      `UPDATE orders
         SET invoice_id = $1,
             metadata = metadata || $2::jsonb,
             updated_at = NOW()
       WHERE unipay_order_hash_id = $3`,
      [
        invoice.invoiceId,
        JSON.stringify({
          orderProcessed: true,
          processedAt: new Date().toISOString(),
          orderResult: orderResult
        }),
        orderHashId
      ]
    );

    logger.info(`Successfully processed UniPay payment: ${orderHashId}`, {
      orderId: orderData.id,
      invoiceId: invoice.invoiceId
    });

    return { orderResult, invoice };
  } catch (error) {
    logger.error(`Error processing UniPay payment success for ${orderHashId}:`, error);
    throw error;
  }
}

module.exports = router;