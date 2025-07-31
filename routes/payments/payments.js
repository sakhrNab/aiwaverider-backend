/**
 * Updated Payment Routes - Main Payment Handler (Updated for UniPay v3 API)
 * 
 * This file integrates UniPay with existing payment systems
 * and provides a unified payment interface
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Import UniPay routes
const unipayRoutes = require('./unipay');

// Services and Controllers
const logger = require('../../utils/logger');
const orderController = require('../../controllers/payment/orderController');
const invoiceService = require('../../services/invoice/invoiceService');
const uniPayService = require('../../services/payment/uniPayService');
const { db } = require('../../config/firebase');

/**
 * PAYMENT SYSTEM CONFIGURATION (UPDATED)
 * ========================================
 * 
 * Environment Variables Required:
 * 
 * UniPay Configuration (NEW):
 * - UNIPAY_ENVIRONMENT: 'production' or 'test'
 * - UNIPAY_TEST_MERCHANT_ID: Test merchant ID
 * - UNIPAY_TEST_API_KEY: Test API key
 * - UNIPAY_MERCHANT_ID: Production merchant ID
 * - UNIPAY_API_KEY: Production API key
 * 
 * PayPal Configuration (Direct):
 * - PAYPAL_CLIENT_ID: PayPal client ID
 * - PAYPAL_CLIENT_SECRET: PayPal client secret
 * 
 * Company Information:
 * - COMPANY_NAME, COMPANY_ADDRESS, COMPANY_TAX_ID, etc.
 * 
 * URLs:
 * - FRONTEND_URL: Your frontend URL
 * - BACKEND_URL: Your backend URL
 */

// Environment check
const isProduction = process.env.NODE_ENV === 'production' && process.env.UNIPAY_ENVIRONMENT === 'production';

// Log environment on startup
logger.info(`Payment system initialized in ${isProduction ? 'PRODUCTION' : 'TEST'} mode`, {
  uniPayConfigured: !!(process.env.UNIPAY_MERCHANT_ID || process.env.UNIPAY_TEST_MERCHANT_ID),
  paypalConfigured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_ID !== 'test_client_id'),
  environment: isProduction ? 'production' : 'test'
});

/**
 * Test endpoint - health check for the entire payment system
 */
router.get('/test', (req, res) => {
  logger.info('Payment routes test endpoint accessed');
  
  return res.status(200).json({
    status: 'success',
    message: 'Payment routes are working correctly',
    environment: isProduction ? 'production' : 'test',
    timestamp: new Date().toISOString(),
    availableProviders: {
      unipay: !!(process.env.UNIPAY_MERCHANT_ID || process.env.UNIPAY_TEST_MERCHANT_ID),
      paypal: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_ID !== 'test_client_id'),
      directGooglePay: true, // Available through frontend SDK
      directApplePay: true   // Available through frontend SDK
    }
  });
});

/**
 * Get supported payment methods for a region/country
 */
router.get('/payment-methods', async (req, res) => {
  try {
    const { countryCode = 'US', amount, currency } = req.query;
    
    // Base payment methods always available
    const methods = {
      unipay_card: {
        name: 'Credit/Debit Card (UniPay)',
        provider: 'unipay',
        available: !!(process.env.UNIPAY_MERCHANT_ID || process.env.UNIPAY_TEST_MERCHANT_ID),
        requirements: ['Any country'],
        description: 'Pyment gateway - Visa, Mastercard, and other major cards',
        redirect: true // UniPay uses redirect flow
      },
      paypal: {
        name: 'PayPal',
        provider: 'paypal_direct',
        available: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_ID !== 'test_client_id'),
        requirements: ['Any country'],
        description: 'Pay with your PayPal account'
      },
      google_pay: {
        name: 'Google Pay',
        provider: 'google_direct',
        available: true,
        requirements: ['Android devices', 'Chrome browser'],
        description: 'Pay with Google Pay wallet'
      },
      apple_pay: {
        name: 'Apple Pay',
        provider: 'apple_direct',
        available: true,
        requirements: ['iOS devices', 'Safari browser', 'macOS Safari'],
        description: 'Pay with Apple Pay wallet'
      }
    };

    // UniPay is primarily for Georgian and regional markets
    if (['GE', 'AM', 'AZ', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'].includes(countryCode)) {
      methods.unipay_card.priority = 1;
      methods.unipay_card.recommended = true;
    }

    logger.info(`Payment methods requested for country: ${countryCode}`);

    return res.status(200).json({
      status: 'success',
      countryCode,
      currency: currency || 'USD',
      amount: amount || null,
      availableMethods: Object.keys(methods).filter(key => methods[key].available),
      methodDetails: methods,
      recommendation: getRecommendedMethod(countryCode),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting payment methods:', error);
    return res.status(500).json({
      error: 'Failed to get payment methods',
      details: error.message
    });
  }
});

/**
 * Create unified payment session (Updated for UniPay v3)
 */
router.post('/create-session', async (req, res) => {
  try {
    const { amount, currency, items, customerInfo, metadata = {}, preferredProvider } = req.body;
    
    if (!amount || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Invalid request: amount and items are required'
      });
    }

    const orderId = metadata.orderId || uuidv4();
    
    logger.info('Creating unified payment session', {
      orderId,
      amount,
      currency: currency || 'USD',
      itemCount: items.length,
      preferredProvider
    });

    // Default to UniPay for card payments (Updated)
    if (!preferredProvider || preferredProvider === 'unipay') {
      try {
        // Create UniPay session (Updated API call)
        const result = await uniPayService.createPaymentSession({
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
        });

        return res.status(200).json({
          success: true,
          provider: 'unipay',
          sessionType: 'unipay',
          sessionId: result.orderHashId, // Updated: UniPay uses orderHashId
          orderHashId: result.orderHashId,
          merchantOrderId: result.merchantOrderId,
          orderId,
          paymentUrl: result.paymentUrl, // Redirect URL for payment
          amount: result.amount,
          originalAmount: result.originalAmount,
          currency: result.currency,
          originalCurrency: result.originalCurrency,
          vatInfo: result.vatInfo,
          conversionInfo: result.conversionInfo,
          redirect: true, // Indicate this needs redirect
          ...result
        });
      } catch (uniPayError) {
        logger.error('UniPay session creation failed:', uniPayError);
        return res.status(500).json({
          error: 'Failed to create payment session',
          details: uniPayError.message
        });
      }
    }

    // Handle other providers (unchanged)
    switch (preferredProvider) {
      case 'paypal_direct':
        return res.status(200).json({
          success: true,
          provider: 'paypal_direct',
          sessionType: 'paypal',
          orderId,
          message: 'Use /api/payments/unipay/paypal/create-order to create PayPal order'
        });
        
      case 'google_direct':
        return res.status(200).json({
          success: true,
          provider: 'google_direct',
          sessionType: 'google_pay',
          orderId,
          message: 'Initialize Google Pay on frontend'
        });
        
      case 'apple_direct':
        return res.status(200).json({
          success: true,
          provider: 'apple_direct',
          sessionType: 'apple_pay',
          orderId,
          message: 'Initialize Apple Pay on frontend'
        });
        
      default:
        return res.status(400).json({
          error: `Unsupported provider: ${preferredProvider}`
        });
    }
  } catch (error) {
    logger.error('Error creating payment session:', error);
    return res.status(500).json({
      error: 'Failed to create payment session',
      details: error.message
    });
  }
});

/**
 * Direct Google Pay processing (cost-optimized) - UNCHANGED
 */
router.post('/process-google-pay-direct', async (req, res) => {
  try {
    const { paymentData, orderDetails, customerInfo, metadata = {} } = req.body;

    if (!paymentData || !paymentData.paymentMethodData) {
      return res.status(400).json({ error: 'Invalid Google Pay payment data' });
    }

    const orderId = metadata.orderId || uuidv4();
    const amount = parseFloat(orderDetails.amount);
    const currency = (orderDetails.currency || 'USD').toUpperCase();

    logger.info('Processing direct Google Pay payment', {
      orderId,
      amount,
      currency,
      customerEmail: customerInfo?.email
    });

    // Process order immediately (since Google Pay is validated on frontend)
    const orderResult = await orderController.processPaymentSuccess({
      id: `gpay_${orderId}`,
      amount: amount * 100, // Convert to cents
      currency: currency.toLowerCase(),
      status: 'succeeded',
      payment_method_types: ['google_pay'],
      customer: {
        id: customerInfo?.userId || null,
        email: customerInfo?.email || null
      },
      metadata: {
        ...metadata,
        payment_method: 'google_pay_direct',
        order_id: orderId
      },
      items: orderDetails.items || [],
      processor: 'google_direct'
    });

    // Create invoice
    const invoice = await invoiceService.createInvoice(
      {
        id: `gpay_${orderId}`,
        processor: 'google_direct',
        paymentMethod: 'google_pay',
        transaction_id: `gpay_${orderId}`
      },
      {
        orderId,
        items: orderDetails.items || [],
        total: amount,
        currency,
        metadata
      },
      customerInfo
    );

    logger.info(`Successfully processed Google Pay direct payment: ${orderId}`, {
      invoiceId: invoice.invoiceId
    });

    return res.status(200).json({
      success: true,
      provider: 'google_direct',
      orderId,
      transactionId: `gpay_${orderId}`,
      orderResult,
      invoice: invoice.invoice,
      message: 'Google Pay payment processed successfully'
    });
  } catch (error) {
    logger.error('Error processing direct Google Pay payment:', error);
    return res.status(500).json({
      error: 'Google Pay payment processing failed',
      details: error.message
    });
  }
});

/**
 * Direct Apple Pay processing (cost-optimized) - UNCHANGED
 */
router.post('/process-apple-pay-direct', async (req, res) => {
  try {
    const { paymentData, orderDetails, customerInfo, metadata = {} } = req.body;

    if (!paymentData || !paymentData.token) {
      return res.status(400).json({ error: 'Invalid Apple Pay payment data' });
    }

    const orderId = metadata.orderId || uuidv4();
    const amount = parseFloat(orderDetails.amount);
    const currency = (orderDetails.currency || 'USD').toUpperCase();

    logger.info('Processing direct Apple Pay payment', {
      orderId,
      amount,
      currency,
      customerEmail: customerInfo?.email
    });

    // Process order immediately (since Apple Pay is validated on frontend)
    const orderResult = await orderController.processPaymentSuccess({
      id: `apay_${orderId}`,
      amount: amount * 100, // Convert to cents
      currency: currency.toLowerCase(),
      status: 'succeeded',
      payment_method_types: ['apple_pay'],
      customer: {
        id: customerInfo?.userId || null,
        email: customerInfo?.email || null
      },
      metadata: {
        ...metadata,
        payment_method: 'apple_pay_direct',
        order_id: orderId
      },
      items: orderDetails.items || [],
      processor: 'apple_direct'
    });

    // Create invoice
    const invoice = await invoiceService.createInvoice(
      {
        id: `apay_${orderId}`,
        processor: 'apple_direct',
        paymentMethod: 'apple_pay',
        transaction_id: `apay_${orderId}`
      },
      {
        orderId,
        items: orderDetails.items || [],
        total: amount,
        currency,
        metadata
      },
      customerInfo
    );

    logger.info(`Successfully processed Apple Pay direct payment: ${orderId}`, {
      invoiceId: invoice.invoiceId
    });

    return res.status(200).json({
      success: true,
      provider: 'apple_direct',
      orderId,
      transactionId: `apay_${orderId}`,
      orderResult,
      invoice: invoice.invoice,
      message: 'Apple Pay payment processed successfully'
    });
  } catch (error) {
    logger.error('Error processing direct Apple Pay payment:', error);
    return res.status(500).json({
      error: 'Apple Pay payment processing failed',
      details: error.message
    });
  }
});

/**
 * Get payment/order status by ID (Updated for UniPay)
 */
router.get('/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query; // 'session', 'order', 'transaction', 'unipay'

    logger.info(`Checking payment status: ${id} (type: ${type || 'auto'})`);

    let result = {
      id,
      type: type || 'unknown',
      found: false
    };

    // Try UniPay orders first if specified or auto-detecting
    if (!type || type === 'unipay' || type === 'session') {
      try {
        const uniPayDoc = await db.collection('uniPayOrders').doc(id).get();
        if (uniPayDoc.exists) {
          result = {
            ...result,
            type: 'unipay_order',
            found: true,
            data: uniPayDoc.data(),
            provider: 'unipay'
          };
        }
      } catch (uniPayError) {
        logger.debug(`UniPay order check failed for ${id}:`, uniPayError.message);
      }
    }

    // Try legacy payment sessions if not found
    if (!result.found && (!type || type === 'session')) {
      try {
        const sessionDoc = await db.collection('paymentSessions').doc(id).get();
        if (sessionDoc.exists) {
          result = {
            ...result,
            type: 'session',
            found: true,
            data: sessionDoc.data(),
            provider: 'legacy'
          };
        }
      } catch (sessionError) {
        logger.debug(`Session check failed for ${id}:`, sessionError.message);
      }
    }

    if (!result.found && (!type || type === 'order')) {
      // Check orders
      try {
        const orderDoc = await db.collection('orders').doc(id).get();
        if (orderDoc.exists) {
          result = {
            ...result,
            type: 'order',
            found: true,
            data: orderDoc.data()
          };
        }
      } catch (orderError) {
        logger.debug(`Order check failed for ${id}:`, orderError.message);
      }
    }

    if (!result.found && (!type || type === 'paypal')) {
      // Check PayPal orders
      try {
        const paypalDoc = await db.collection('paypalOrders').doc(id).get();
        if (paypalDoc.exists) {
          result = {
            ...result,
            type: 'paypal_order',
            found: true,
            data: paypalDoc.data(),
            provider: 'paypal'
          };
        }
      } catch (paypalError) {
        logger.debug(`PayPal check failed for ${id}:`, paypalError.message);
      }
    }

    if (!result.found) {
      return res.status(404).json({
        error: 'Payment/order not found',
        id,
        searched: ['unipay_orders', 'sessions', 'orders', 'paypal_orders']
      });
    }

    return res.status(200).json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error checking payment status for ${req.params.id}:`, error);
    return res.status(500).json({
      error: 'Failed to check payment status',
      details: error.message
    });
  }
});

/**
 * Environment switching endpoint (admin only) - UNCHANGED
 */
router.post('/switch-environment', async (req, res) => {
  try {
    const { environment, adminKey } = req.body;
    
    // Basic admin key check (implement proper admin authentication)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!['production', 'test'].includes(environment)) {
      return res.status(400).json({ error: 'Invalid environment. Use "production" or "test"' });
    }

    // This would require restarting the server with new environment variables
    // For now, just return the instruction
    logger.info(`Environment switch requested: ${environment}`);

    return res.status(200).json({
      success: true,
      message: `To switch to ${environment} environment:`,
      instructions: [
        `Set UNIPAY_ENVIRONMENT=${environment}`,
        `Restart the server`,
        `Verify with GET /api/payments/test`
      ],
      currentEnvironment: isProduction ? 'production' : 'test',
      requestedEnvironment: environment
    });
  } catch (error) {
    logger.error('Error switching environment:', error);
    return res.status(500).json({
      error: 'Failed to switch environment',
      details: error.message
    });
  }
});

/**
 * System health check - all payment providers (Updated)
 */
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      environment: isProduction ? 'production' : 'test',
      timestamp: new Date().toISOString(),
      providers: {}
    };

    // Check UniPay (Updated)
    try {
      const uniPayHealth = await uniPayService.healthCheck();
      health.providers.unipay = {
        status: uniPayHealth.success ? 'healthy' : 'unhealthy',
        ...uniPayHealth
      };
    } catch (uniPayError) {
      health.providers.unipay = {
        status: 'unhealthy',
        error: uniPayError.message
      };
    }

    // Check PayPal configuration
    health.providers.paypal = {
      status: (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_ID !== 'test_client_id') ? 'configured' : 'not_configured',
      configured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_ID !== 'test_client_id')
    };

    // Direct providers (always available)
    health.providers.google_pay_direct = { status: 'available' };
    health.providers.apple_pay_direct = { status: 'available' };

    // Overall status
    const unhealthyProviders = Object.values(health.providers).filter(p => p.status === 'unhealthy');
    if (unhealthyProviders.length > 0) {
      health.status = 'degraded';
    }

    return res.status(200).json(health);
  } catch (error) {
    logger.error('Error checking payment system health:', error);
    return res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Helper functions
 */

function getRecommendedMethod(countryCode) {
  // Updated recommendation logic including UniPay
  const recommendations = {
    'GE': 'unipay_card', // Georgia - UniPay is local
    'AM': 'unipay_card', // Armenia - Regional coverage
    'AZ': 'unipay_card', // Azerbaijan - Regional coverage
    'US': 'apple_pay',   // High Apple Pay adoption
    'DE': 'google_pay',  // Google Pay popular in Germany
    'GB': 'google_pay',  // Google Pay popular in UK
    'FR': 'paypal',      // PayPal popular in France
    'IT': 'paypal',       // PayPal popular in Italy
    'US': 'apple_pay', // High Apple Pay adoption
  };
  
  return recommendations[countryCode] || 'unipay_card';
}

// Mount UniPay routes
router.use('/unipay', unipayRoutes);

module.exports = router;