const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * UNIPAY BACKEND INTEGRATION
 * ==========================
 * 
 * This file contains server-side UniPay route handlers for the Georgian
 * payment gateway (https://unipay.com/).
 * 
 * Environment Variables Required:
 * - UNIPAY_API_URL: UniPay API endpoint (default: https://api.unipay.com)
 * - UNIPAY_MERCHANT_ID: Your UniPay merchant ID
 * - UNIPAY_SECRET_KEY: Your UniPay secret key
 * - UNIPAY_PUBLIC_KEY: Your UniPay public key
 * - UNIPAY_WEBHOOK_SECRET: Webhook secret for validating callbacks
 * 
 * Supported Payment Methods:
 * - Credit/Debit Cards (Visa, Mastercard)
 * - SEPA Transfers (EUR only)
 * - PayPal
 * - Google Pay
 */

// Logger setup
const logger = console; // Replace with your logger if you have one

// UniPay configuration
const UNIPAY_CONFIG = {
  apiUrl: process.env.UNIPAY_API_URL || 'https://api.unipay.com',
  merchantId: process.env.UNIPAY_MERCHANT_ID,
  secretKey: process.env.UNIPAY_SECRET_KEY,
  publicKey: process.env.UNIPAY_PUBLIC_KEY,
  webhookSecret: process.env.UNIPAY_WEBHOOK_SECRET,
  version: 'v1'
};

// Create UniPay API client
const unipayClient = axios.create({
  baseURL: UNIPAY_CONFIG.apiUrl,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${UNIPAY_CONFIG.secretKey}`,
    'X-Merchant-ID': UNIPAY_CONFIG.merchantId,
  },
  timeout: 30000, // 30 second timeout
});

// Helper function for logging payments
const logPayment = (type, action, data, error = null) => {
  const logData = {
    type,
    action,
    timestamp: new Date().toISOString(),
    data: {
      ...data,
      // Remove sensitive data from logs
      card: data.card ? { ...data.card, number: '****' } : undefined,
      secretKey: undefined,
      cvv: undefined,
    },
    error: error ? error.message : null
  };
  
  if (error) {
    logger.error('UniPay Payment Error:', logData);
  } else {
    logger.info('UniPay Payment Log:', logData);
  }
};

// Helper function to format amount for UniPay
const formatAmountForUnipay = (amount, currency = 'USD') => {
  const decimalCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'GEL'];
  const isDecimalCurrency = decimalCurrencies.includes(currency.toUpperCase());
  
  if (isDecimalCurrency) {
    return Math.round(parseFloat(amount) * 100); // Convert to cents
  }
  
  return Math.round(parseFloat(amount)); // For currencies without decimals
};

// Helper function to get supported payment methods by country
const getPaymentMethodsForCountry = (countryCode = 'US') => {
  const methods = ['card']; // Card is available everywhere
  
  // Add region-specific payment methods
  switch(countryCode.toUpperCase()) {
    case 'DE':
    case 'FR':
    case 'NL':
    case 'BE':
    case 'ES':
    case 'IT':
    case 'AT':
      methods.push('sepa'); // SEPA for EU countries
      break;
    case 'GE':
      methods.push('gel_bank_transfer'); // Georgia-specific
      break;
  }
  
  // PayPal and Google Pay are available in most countries
  methods.push('paypal', 'google_pay');
  
  return methods;
};

/**
 * Health check endpoint for UniPay integration
 * @route GET /api/payments/unipay/health
 */
router.get('/health', async (req, res) => {
  try {
    logger.info('UniPay health check requested');
    
    // Check if configuration is present
    const configStatus = {
      apiUrl: !!UNIPAY_CONFIG.apiUrl,
      merchantId: !!UNIPAY_CONFIG.merchantId,
      secretKey: !!UNIPAY_CONFIG.secretKey,
      publicKey: !!UNIPAY_CONFIG.publicKey,
    };
    
    let apiStatus = 'unknown';
    let apiError = null;
    
    // Test API connectivity if credentials are available
    if (configStatus.secretKey && configStatus.merchantId) {
      try {
        // Make a simple API call to check connectivity
        const response = await unipayClient.get('/health', { timeout: 5000 });
        apiStatus = response.status === 200 ? 'connected' : 'error';
      } catch (error) {
        apiStatus = 'error';
        apiError = error.message;
        logger.warn('UniPay API connectivity test failed:', error.message);
      }
    } else {
      apiStatus = 'not_configured';
      apiError = 'Missing required configuration';
    }
    
    const healthStatus = {
      status: 'success',
      provider: 'unipay',
      timestamp: new Date().toISOString(),
      configuration: configStatus,
      api: {
        status: apiStatus,
        error: apiError,
        endpoint: UNIPAY_CONFIG.apiUrl,
      },
      supportedMethods: ['card', 'sepa', 'paypal', 'google_pay'],
    };
    
    logger.info('UniPay health check completed:', healthStatus);
    return res.status(200).json(healthStatus);
  } catch (error) {
    logger.error('Error checking UniPay health:', error);
    return res.status(500).json({
      status: 'error',
      provider: 'unipay',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get supported payment methods for a country
 * @route GET /api/payments/unipay/methods
 */
router.get('/methods', async (req, res) => {
  try {
    const { country = 'US' } = req.query;
    
    const methods = getPaymentMethodsForCountry(country);
    
    const methodDetails = {
      card: {
        name: 'Credit/Debit Card',
        currencies: ['USD', 'EUR', 'GBP', 'GEL'],
        available: true,
      },
      sepa: {
        name: 'SEPA Transfer',
        currencies: ['EUR'],
        available: methods.includes('sepa'),
        requirements: ['EU country', 'EUR currency'],
      },
      paypal: {
        name: 'PayPal',
        currencies: ['USD', 'EUR', 'GBP'],
        available: methods.includes('paypal'),
      },
      google_pay: {
        name: 'Google Pay',
        currencies: ['USD', 'EUR', 'GBP', 'GEL'],
        available: methods.includes('google_pay'),
      },
    };
    
    logger.info(`Payment methods for country ${country}:`, methods);
    
    return res.status(200).json({
      success: true,
      country,
      methods,
      methodDetails,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting payment methods:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get payment methods',
    });
  }
});

/**
 * Create a general UniPay payment session
 * @route POST /api/payments/unipay/create
 */
router.post('/create', async (req, res) => {
  try {
    const {
      amount,
      currency = 'USD',
      paymentMethod = 'card',
      items = [],
      email,
      metadata = {},
      successUrl,
      cancelUrl
    } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be provided and greater than 0'
      });
    }

    const orderId = metadata.orderId || uuidv4();
    const formattedAmount = formatAmountForUnipay(amount, currency);

    logPayment('create_payment', 'initiated', {
      orderId,
      amount: formattedAmount,
      currency,
      paymentMethod,
      email
    });

    // Prepare UniPay request
    const unipayRequest = {
      merchant_id: UNIPAY_CONFIG.merchantId,
      order_id: orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      payment_method: paymentMethod,
      description: `Order ${orderId}`,
      customer: {
        email: email || '',
      },
      items: items.map(item => ({
        name: item.title || item.name || 'Product',
        quantity: item.quantity || 1,
        price: formatAmountForUnipay(item.price || 0, currency),
      })),
      return_url: successUrl,
      cancel_url: cancelUrl,
      webhook_url: `${process.env.API_URL || 'http://localhost:4000'}/api/payments/unipay/webhook`,
      metadata: {
        ...metadata,
        created_at: new Date().toISOString(),
      },
    };

    // Make request to UniPay API
    const response = await unipayClient.post('/payments', unipayRequest);

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.message || 'UniPay payment creation failed');
    }

    const result = {
      success: true,
      paymentId: response.data.payment_id,
      orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      status: response.data.status || 'created',
      checkoutUrl: response.data.checkout_url,
      paymentUrl: response.data.payment_url,
      expiresAt: response.data.expires_at,
      provider: 'unipay',
    };

    logPayment('create_payment', 'success', result);
    return res.status(200).json(result);
  } catch (error) {
    logPayment('create_payment', 'error', req.body, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create UniPay payment',
    });
  }
});

/**
 * Process a credit card payment through UniPay
 * @route POST /api/payments/unipay/process-card
 */
router.post('/process-card', async (req, res) => {
  try {
    const {
      amount,
      currency = 'USD',
      card,
      billing = {},
      email,
      items = [],
      metadata = {}
    } = req.body;

    if (!amount || !card || !card.number) {
      return res.status(400).json({
        success: false,
        error: 'Amount and card details are required'
      });
    }

    const orderId = metadata.orderId || uuidv4();
    const formattedAmount = formatAmountForUnipay(amount, currency);

    logPayment('process_card', 'initiated', {
      orderId,
      amount: formattedAmount,
      currency,
      email,
      cardLast4: card.number.slice(-4)
    });

    // Prepare UniPay card payment request
    const unipayRequest = {
      merchant_id: UNIPAY_CONFIG.merchantId,
      order_id: orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      payment_method: 'card',
      card: {
        number: card.number.replace(/\s/g, ''),
        expiry_month: card.expiryMonth,
        expiry_year: card.expiryYear,
        cvv: card.cvv,
        holder_name: card.holderName,
      },
      billing_address: {
        country: billing.country || '',
        postal_code: billing.postalCode || '',
        address_line_1: billing.addressLine1 || '',
        city: billing.city || '',
      },
      customer: {
        email: email || '',
      },
      items: items.map(item => ({
        name: item.title || item.name || 'Product',
        quantity: item.quantity || 1,
        price: formatAmountForUnipay(item.price || 0, currency),
      })),
      webhook_url: `${process.env.API_URL || 'http://localhost:4000'}/api/payments/unipay/webhook`,
      metadata: {
        ...metadata,
        payment_type: 'card',
        created_at: new Date().toISOString(),
      },
    };

    // Make request to UniPay API
    const response = await unipayClient.post('/payments/card', unipayRequest);

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.message || 'Card payment failed');
    }

    const result = {
      success: true,
      paymentId: response.data.payment_id,
      orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      status: response.data.status || 'completed',
      transactionId: response.data.transaction_id,
      cardLast4: card.number.slice(-4),
      provider: 'unipay',
      receiptUrl: response.data.receipt_url,
    };

    logPayment('process_card', 'success', result);
    return res.status(200).json(result);
  } catch (error) {
    logPayment('process_card', 'error', req.body, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Card payment failed',
    });
  }
});

/**
 * Process a SEPA payment through UniPay
 * @route POST /api/payments/unipay/process-sepa
 */
router.post('/process-sepa', async (req, res) => {
  try {
    const {
      amount,
      currency = 'EUR',
      sepa,
      email,
      items = [],
      metadata = {}
    } = req.body;

    if (currency !== 'EUR') {
      return res.status(400).json({
        success: false,
        error: 'SEPA payments only support EUR currency'
      });
    }

    if (!amount || !sepa || !sepa.iban) {
      return res.status(400).json({
        success: false,
        error: 'Amount and SEPA details (IBAN) are required'
      });
    }

    const orderId = metadata.orderId || uuidv4();
    const formattedAmount = formatAmountForUnipay(amount, currency);

    logPayment('process_sepa', 'initiated', {
      orderId,
      amount: formattedAmount,
      currency,
      email,
      iban: sepa.iban.replace(/(.{4})/g, '$1 ').trim()
    });

    // Prepare UniPay SEPA payment request
    const unipayRequest = {
      merchant_id: UNIPAY_CONFIG.merchantId,
      order_id: orderId,
      amount: formattedAmount,
      currency: 'EUR',
      payment_method: 'sepa',
      sepa: {
        iban: sepa.iban,
        bic: sepa.bic || '',
        account_holder_name: sepa.accountHolderName,
      },
      customer: {
        email: email || '',
      },
      items: items.map(item => ({
        name: item.title || item.name || 'Product',
        quantity: item.quantity || 1,
        price: formatAmountForUnipay(item.price || 0, currency),
      })),
      webhook_url: `${process.env.API_URL || 'http://localhost:4000'}/api/payments/unipay/webhook`,
      metadata: {
        ...metadata,
        payment_type: 'sepa',
        created_at: new Date().toISOString(),
      },
    };

    // Make request to UniPay API
    const response = await unipayClient.post('/payments/sepa', unipayRequest);

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.message || 'SEPA payment failed');
    }

    const result = {
      success: true,
      paymentId: response.data.payment_id,
      orderId,
      amount: formattedAmount,
      currency: 'EUR',
      status: response.data.status || 'pending',
      mandateUrl: response.data.mandate_url,
      mandateId: response.data.mandate_id,
      provider: 'unipay',
      instructions: response.data.instructions || 'Please complete the SEPA mandate',
    };

    logPayment('process_sepa', 'success', result);
    return res.status(200).json(result);
  } catch (error) {
    logPayment('process_sepa', 'error', req.body, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'SEPA payment failed',
    });
  }
});

/**
 * Process a PayPal payment through UniPay
 * @route POST /api/payments/unipay/process-paypal
 */
router.post('/process-paypal', async (req, res) => {
  try {
    const {
      amount,
      currency = 'USD',
      email,
      items = [],
      metadata = {},
      successUrl,
      cancelUrl
    } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: 'Amount is required'
      });
    }

    const orderId = metadata.orderId || uuidv4();
    const formattedAmount = formatAmountForUnipay(amount, currency);

    logPayment('process_paypal', 'initiated', {
      orderId,
      amount: formattedAmount,
      currency,
      email
    });

    // Prepare UniPay PayPal payment request
    const unipayRequest = {
      merchant_id: UNIPAY_CONFIG.merchantId,
      order_id: orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      payment_method: 'paypal',
      customer: {
        email: email || '',
      },
      items: items.map(item => ({
        name: item.title || item.name || 'Product',
        quantity: item.quantity || 1,
        price: formatAmountForUnipay(item.price || 0, currency),
      })),
      return_url: successUrl,
      cancel_url: cancelUrl,
      webhook_url: `${process.env.API_URL || 'http://localhost:4000'}/api/payments/unipay/webhook`,
      metadata: {
        ...metadata,
        payment_type: 'paypal',
        created_at: new Date().toISOString(),
      },
    };

    // Make request to UniPay API
    const response = await unipayClient.post('/payments/paypal', unipayRequest);

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.message || 'PayPal payment failed');
    }

    const result = {
      success: true,
      paymentId: response.data.payment_id,
      orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      status: response.data.status || 'created',
      approvalUrl: response.data.approval_url,
      paypalOrderId: response.data.paypal_order_id,
      provider: 'unipay',
    };

    logPayment('process_paypal', 'success', result);
    return res.status(200).json(result);
  } catch (error) {
    logPayment('process_paypal', 'error', req.body, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'PayPal payment failed',
    });
  }
});

/**
 * Process Google Pay through UniPay
 * @route POST /api/payments/unipay/process-google-pay
 */
router.post('/process-google-pay', async (req, res) => {
  try {
    const {
      amount,
      currency = 'USD',
      googlePay,
      email,
      items = [],
      metadata = {}
    } = req.body;

    if (!amount || !googlePay || !googlePay.paymentData) {
      return res.status(400).json({
        success: false,
        error: 'Amount and Google Pay data are required'
      });
    }

    const orderId = metadata.orderId || uuidv4();
    const formattedAmount = formatAmountForUnipay(amount, currency);

    logPayment('process_google_pay', 'initiated', {
      orderId,
      amount: formattedAmount,
      currency,
      email
    });

    // Prepare UniPay Google Pay payment request
    const unipayRequest = {
      merchant_id: UNIPAY_CONFIG.merchantId,
      order_id: orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      payment_method: 'google_pay',
      google_pay: {
        payment_data: googlePay.paymentData,
        signature: googlePay.signature,
      },
      customer: {
        email: email || '',
      },
      items: items.map(item => ({
        name: item.title || item.name || 'Product',
        quantity: item.quantity || 1,
        price: formatAmountForUnipay(item.price || 0, currency),
      })),
      webhook_url: `${process.env.API_URL || 'http://localhost:4000'}/api/payments/unipay/webhook`,
      metadata: {
        ...metadata,
        payment_type: 'google_pay',
        created_at: new Date().toISOString(),
      },
    };

    // Make request to UniPay API
    const response = await unipayClient.post('/payments/google-pay', unipayRequest);

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.message || 'Google Pay payment failed');
    }

    const result = {
      success: true,
      paymentId: response.data.payment_id,
      orderId,
      amount: formattedAmount,
      currency: currency.toUpperCase(),
      status: response.data.status || 'completed',
      transactionId: response.data.transaction_id,
      provider: 'unipay',
      receiptUrl: response.data.receipt_url,
    };

    logPayment('process_google_pay', 'success', result);
    return res.status(200).json(result);
  } catch (error) {
    logPayment('process_google_pay', 'error', req.body, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Google Pay payment failed',
    });
  }
});

/**
 * Get payment status
 * @route GET /api/payments/unipay/status/:paymentId
 */
router.get('/status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { type = 'payment' } = req.query;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: 'Payment ID is required'
      });
    }

    logger.info(`Checking UniPay payment status: ${paymentId}`);

    // Make request to UniPay API
    const response = await unipayClient.get(`/payments/${paymentId}`);

    if (!response.data) {
      throw new Error('No payment data received');
    }

    const result = {
      success: true,
      paymentId,
      status: response.data.status,
      amount: response.data.amount,
      currency: response.data.currency,
      paymentMethod: response.data.payment_method,
      createdAt: response.data.created_at,
      updatedAt: response.data.updated_at,
      provider: 'unipay',
      details: response.data,
    };

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error checking UniPay payment status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to check payment status',
      paymentId: req.params.paymentId,
    });
  }
});

/**
 * Create a refund
 * @route POST /api/payments/unipay/refund
 */
router.post('/refund', async (req, res) => {
  try {
    const { paymentId, amount, reason = '' } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: 'Payment ID is required'
      });
    }

    logger.info(`Creating UniPay refund for payment: ${paymentId}`);

    const unipayRequest = {
      payment_id: paymentId,
      amount: amount ? Math.round(parseFloat(amount) * 100) : null, // Full refund if no amount
      reason: reason,
    };

    // Make request to UniPay API
    const response = await unipayClient.post('/refunds', unipayRequest);

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.message || 'Refund failed');
    }

    const result = {
      success: true,
      refundId: response.data.refund_id,
      paymentId,
      amount: response.data.amount,
      status: response.data.status,
      reason: reason,
      createdAt: response.data.created_at,
      provider: 'unipay',
    };

    logPayment('refund', 'success', result);
    return res.status(200).json(result);
  } catch (error) {
    logPayment('refund', 'error', req.body, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Refund failed',
    });
  }
});

/**
 * Handle UniPay webhooks
 * @route POST /api/payments/unipay/webhook
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-unipay-signature'];
    const body = req.body;

    // Verify webhook signature if webhook secret is configured
    if (UNIPAY_CONFIG.webhookSecret && signature) {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', UNIPAY_CONFIG.webhookSecret)
        .update(body)
        .digest('hex');

      if (signature !== expectedSignature) {
        logger.warn('Invalid UniPay webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = JSON.parse(body.toString());
    logger.info('UniPay webhook received:', {
      type: event.type,
      paymentId: event.payment_id,
      status: event.status,
    });

    // Handle different webhook events
    switch (event.type) {
      case 'payment.completed':
        // Handle successful payment
        logger.info(`Payment completed: ${event.payment_id}`);
        // TODO: Update order status, send confirmation email, etc.
        break;

      case 'payment.failed':
        // Handle failed payment
        logger.warn(`Payment failed: ${event.payment_id}`);
        // TODO: Update order status, notify customer, etc.
        break;

      case 'payment.refunded':
        // Handle refund
        logger.info(`Payment refunded: ${event.payment_id}`);
        // TODO: Update order status, process refund, etc.
        break;

      case 'sepa.mandate_signed':
        // Handle SEPA mandate completion
        logger.info(`SEPA mandate signed: ${event.payment_id}`);
        break;

      default:
        logger.info(`Unhandled webhook event: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error processing UniPay webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Detect user's country for payment methods
 * @route GET /api/payments/detect-country
 */
router.get('/detect-country', async (req, res) => {
  try {
    // Get country from IP or headers
    const clientIP = req.headers['x-forwarded-for'] || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress;
    
    const acceptLanguage = req.headers['accept-language'];
    let countryCode = 'US'; // Default

    // Try to extract country from Accept-Language header
    if (acceptLanguage) {
      const match = acceptLanguage.match(/[a-z]{2}-([A-Z]{2})/);
      if (match) {
        countryCode = match[1];
      }
    }

    // TODO: Implement IP geolocation if needed
    // For now, return based on Accept-Language header

    return res.status(200).json({
      success: true,
      countryCode,
      detectionMethod: 'accept-language',
      clientIP: clientIP ? clientIP.replace(/:\d+$/, '') : 'unknown',
    });
  } catch (error) {
    logger.error('Error detecting country:', error);
    return res.status(200).json({
      success: true,
      countryCode: 'US',
      detectionMethod: 'fallback',
    });
  }
});

module.exports = router; 