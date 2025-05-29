const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * PAYMENT SYSTEM MIGRATION TO PRODUCTION
 * ======================================
 * 
 * This file contains server-side payment route handlers. Below are the necessary steps
 * to migrate from test to production:
 * 
 * 1. STRIPE API KEYS
 *    - Replace the test secret key with a production key from your Stripe dashboard
 *    - Set STRIPE_SECRET_KEY in your production environment to your "sk_live_..." key
 *    - Ensure you NEVER commit live API keys to your repository
 *    - Consider using a secrets manager service for production keys
 * 
 * 2. WEBHOOK HANDLING
 *    - Create a new webhook endpoint in your Stripe dashboard pointing to your production URL:
 *      https://your-production-domain.com/api/payments/stripe-webhook
 *    - Set the new webhook signing secret as STRIPE_WEBHOOK_SECRET in your production environment
 *    - Test your webhook with the Stripe CLI using your live webhook secret:
 *      stripe listen --forward-to your-production-domain.com/api/payments/stripe-webhook
 * 
 * 3. PAYMENT PROCESSING
 *    - The logic in the test and production environments is the same, but ensure:
 *      - Error logging is properly set up for production
 *      - Proper monitoring is established to track payment failures
 *      - Financial reconciliation processes are in place
 * 
 * 4. SUPPORTED PAYMENT METHODS
 *    - Verify that all payment methods you're using are activated in your Stripe dashboard
 *    - Some payment methods may require additional application forms or verification:
 *      - SEPA Direct Debit requires a registered SEPA Creditor ID
 *      - iDEAL requires activation and potentially additional verification
 *      - ACH, Alipay, and other methods may have unique requirements
 * 
 * 5. SECURITY CONSIDERATIONS
 *    - Ensure PCI compliance requirements are met for your level of processing
 *    - Set up fraud detection tools like Stripe Radar or configure risk rules
 *    - Implement proper logging of sensitive operations (without logging card details)
 *    - Ensure you're storing no sensitive payment details in your own database
 * 
 * 6. TESTING BEFORE GOING LIVE
 *    - Perform test transactions using Stripe's test clock feature
 *    - Test the complete user journey in staging with both successful and failed payments
 *    - Test refund and dispute handling processes
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test..');
const logger = require('../../utils/logger');
const orderController = require('../../controllers/payment/orderController');
const notificationService = require('../../services/updates/notificationService');
const { db } = require('../../config/firebase');

// Diagnostic endpoint - always responds with 200 OK to verify route is working
router.get('/test', (req, res) => {
  logger.info('Payment routes test endpoint reached successfully');
  console.log('Payment routes test endpoint reached successfully');
  return res.status(200).json({ 
    status: 'success', 
    message: 'Payment routes are working correctly',
    timestamp: new Date().toISOString()
  });
});

// Provider-specific health check endpoint for Stripe
router.get('/providers/stripe/health', async (req, res) => {
  try {
    // Check if Stripe is configured
    const stripeIsConfigured = !!process.env.STRIPE_SECRET_KEY;
    
    // Try to access Stripe API (lightweight check)
    let stripeApiAccessible = false;
    if (stripeIsConfigured) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          limit: 1,
        });
        stripeApiAccessible = true;
      } catch (stripeError) {
        logger.error('Stripe API access error:', stripeError);
        stripeApiAccessible = false;
      }
    }
    
    logger.info('Stripe health check performed');
    return res.status(200).json({
      status: 'success',
      healthy: stripeApiAccessible,
      provider: 'stripe',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error checking Stripe health:', error);
    return res.status(500).json({ 
      status: 'error',
      healthy: false,
      provider: 'stripe',
      error: 'Failed to check Stripe health',
      timestamp: new Date().toISOString()
    });
  }
});

// Provider-specific health check endpoint for PayPal
router.get('/providers/paypal/health', async (req, res) => {
  try {
    // Check if PayPal is configured
    const paypalIsConfigured = !(!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === 'test_client_id');
    
    // Check if we can connect to PayPal API
    let paypalApiAccessible = false;
    if (paypalIsConfigured) {
      try {
        // Attempt to generate an access token to verify connectivity
        const accessToken = await generateAccessToken();
        paypalApiAccessible = !!accessToken;
      } catch (paypalError) {
        logger.error('PayPal API access error:', paypalError);
        paypalApiAccessible = false;
      }
    }
    
    logger.info('PayPal health check performed');
    return res.status(200).json({
      status: 'success',
      healthy: paypalApiAccessible,
      provider: 'paypal',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error checking PayPal health:', error);
    return res.status(500).json({ 
      status: 'error',
      healthy: false,
      provider: 'paypal',
      error: 'Failed to check PayPal health',
      timestamp: new Date().toISOString()
    });
  }
});

// Provider-specific health check endpoint for SEPA
router.get('/providers/sepa/health', async (req, res) => {
  try {
    // SEPA works through Stripe, so we check Stripe configuration
    const stripeIsConfigured = !!process.env.STRIPE_SECRET_KEY;
    
    // Check if Stripe supports SEPA
    let sepaSupported = false;
    if (stripeIsConfigured) {
      try {
        // Try to access payment methods with SEPA capability
        const paymentMethods = await stripe.paymentMethods.list({
          limit: 1,
          type: 'sepa_debit'
        });
        sepaSupported = true;
      } catch (sepaError) {
        // If this specific error occurs, Stripe is working but SEPA might not be enabled
        if (sepaError.code === 'parameter_unknown') {
          sepaSupported = false;
          logger.warn('SEPA may not be enabled for this Stripe account:', sepaError);
        } else {
          // Other errors indicate potential connection issues
          logger.error('SEPA API access error:', sepaError);
          sepaSupported = false;
        }
      }
    }
    
    logger.info('SEPA health check performed');
    return res.status(200).json({
      status: 'success',
      healthy: sepaSupported,
      provider: 'sepa',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error checking SEPA health:', error);
    return res.status(500).json({ 
      status: 'error',
      healthy: false,
      provider: 'sepa',
      error: 'Failed to check SEPA health',
      timestamp: new Date().toISOString()
    });
  }
});

// Stripe status endpoint
router.get('/stripe-status', async (req, res) => {
  try {
    // Check if Stripe is configured
    const stripeIsConfigured = !!process.env.STRIPE_SECRET_KEY;
    
    // Try to access Stripe API (lightweight check)
    let stripeApiAccessible = false;
    if (stripeIsConfigured) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          limit: 1,
        });
        stripeApiAccessible = true;
      } catch (stripeError) {
        logger.error('Stripe API access error:', stripeError);
        stripeApiAccessible = false;
      }
    }
    
    logger.info('Stripe status check performed');
    return res.status(200).json({
      status: 'success',
      stripe: {
        configured: stripeIsConfigured,
        apiAccessible: stripeApiAccessible,
        publishableKeyLength: process.env.STRIPE_PUBLISHABLE_KEY ? process.env.STRIPE_PUBLISHABLE_KEY.length : 0,
        secretKeyLength: process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.length : 0,
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error checking Stripe status:', error);
    return res.status(500).json({ error: 'Failed to check Stripe status' });
  }
});

// Create a Stripe PaymentIntent for SEPA transfers
router.post('/stripe/create-sepa-intent', async (req, res) => {
  try {
    const { amount, currency, description, metadata } = req.body;
    
    if (!amount || !currency) {
      return res.status(400).json({ error: 'Amount and currency are required' });
    }
    
    logger.info('Creating SEPA Stripe intent', { amount, currency, description });
    console.log('Creating SEPA Stripe intent:', { amount, currency, description });
    
    let paymentIntent;
    
    try {
      // First try with SEPA debit payment method
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        description,
        metadata,
        payment_method_types: ['sepa_debit'],
        capture_method: 'automatic', // Changed from 'manual' to 'automatic' as required by Stripe for 'sepa_debit'
        confirm: false
      });
    } catch (paymentMethodError) {
      // If SEPA debit is not available, try without specifying payment_method_types
      if (paymentMethodError.message && paymentMethodError.message.includes('payment_method_types')) {
        console.log('SEPA debit payment method not available, falling back to standard payment intent');
        logger.warn('SEPA debit payment method not available, falling back to standard payment intent', { error: paymentMethodError.message });
        
        paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: currency.toLowerCase(),
          description,
          metadata: {
            ...metadata,
            fallback_payment: 'true', // Mark this as a fallback payment
            original_error: paymentMethodError.message.substring(0, 100) // Include partial error message
          },
          capture_method: 'automatic', // Changed to automatic for consistency
          confirm: false
        });
      } else {
        // If it's a different error, rethrow it
        throw paymentMethodError;
      }
    }
    
    logger.info('Created SEPA Stripe intent', { id: paymentIntent.id });
    console.log('Created SEPA Stripe intent:', paymentIntent.id);
    
    return res.json({
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret
    });
  } catch (error) {
    logger.error('Error creating SEPA Stripe intent:', error);
    console.error('Error creating SEPA Stripe intent:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Log helper
const logPayment = (type, action, data, error = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${type} PAYMENT ${action}: ${error ? 'ERROR' : 'SUCCESS'}`);
  
  if (error) {
    console.error(`Payment error details:`, error);
  }
  
  // Also log to logger if available
  if (logger) {
    logger.info(`[${timestamp}] ${type} PAYMENT ${action}: ${error ? 'ERROR' : 'SUCCESS'}`);
    if (error) {
      logger.error(`Payment error details: ${error.message}`);
    }
  }
};

// === PayPal Integration ===
// PayPal credentials from .env
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'test_client_id';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'test_client_secret';
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Generate an access token for PayPal API calls
async function generateAccessToken() {
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
    console.error('Failed to generate PayPal access token:', error);
    if (logger) logger.error('Failed to generate PayPal access token:', error);
    throw new Error('Failed to generate PayPal access token');
  }
}

// Create a PayPal order
router.post('/create-paypal-order', async (req, res) => {
  try {
    const { cartTotal, items } = req.body;
    
    if (!cartTotal || !items || !items.length) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    // For testing/development, we can mock a successful response if credentials aren't set
    if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === 'test_client_id') {
      console.log('Using mock PayPal order (no real credentials)');
      return res.json({ id: `MOCK-PAYPAL-ORDER-${uuidv4()}` });
    }
    
    const accessToken = await generateAccessToken();
    
    // Format line items for PayPal
    const lineItems = items.map(item => ({
      name: item.title || 'Product',
      unit_amount: {
        currency_code: 'USD',
        value: (item.price || 0).toFixed(2)
      },
      quantity: (item.quantity || 1).toString(),
      category: 'DIGITAL_GOODS'
    }));

    // Calculate total amount to ensure it matches
    const calculatedTotal = lineItems.reduce((sum, item) => {
      return sum + (parseFloat(item.unit_amount.value) * parseInt(item.quantity));
    }, 0);
    
    // Create order payload
    const payload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: uuidv4(),
          amount: {
            currency_code: 'USD',
            value: calculatedTotal.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: 'USD',
                value: calculatedTotal.toFixed(2)
              }
            }
          },
          items: lineItems
        }
      ],
      application_context: {
        brand_name: 'AI Waverider',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id=${uuidv4()}&status=success&type=paypal_order`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?canceled=true`
      }
    };
    
    try {
      // Make API request to create order
      const response = await axios({
        method: 'post',
        url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        data: payload
      });
      
      logPayment('PAYPAL', 'ORDER_CREATED', { id: response.data.id });
      return res.json({ id: response.data.id });
    } catch (apiError) {
      // Log detailed API error
      console.error('PayPal API Error:', apiError.response ? {
        status: apiError.response.status,
        data: apiError.response.data
      } : apiError.message);
      
      logPayment('PAYPAL', 'ORDER_CREATION_FAILED', null, apiError);
      return res.status(500).json({ error: 'Failed to create PayPal order: ' + (apiError.response?.data?.message || apiError.message) });
    }
  } catch (error) {
    logPayment('PAYPAL', 'ORDER_CREATION_FAILED', null, error);
    return res.status(500).json({ error: 'Failed to create PayPal order' });
  }
});

// Capture a PayPal payment
router.post('/capture-paypal-payment', async (req, res) => {
  try {
    const { orderID } = req.body;
    
    if (!orderID) {
      return res.status(400).json({ error: 'Order ID is required' });
    }
    
    const accessToken = await generateAccessToken();
    
    // Make API request to capture payment
    const response = await axios({
      method: 'post',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    // Extract order details from the PayPal response
    const paypalOrderData = response.data;
    const purchaseUnits = paypalOrderData.purchase_units || [];
    const payer = paypalOrderData.payer || {};
    
    // Get metadata from the request if available
    const metadata = req.body.metadata || {};
    
    // Extract customer information
    const email = payer.email_address || metadata.email || '';
    
    // Extract payment amount
    let amount = 0;
    let currency = 'USD';
    
    if (purchaseUnits.length > 0 && purchaseUnits[0].payments && purchaseUnits[0].payments.captures) {
      const capture = purchaseUnits[0].payments.captures[0];
      amount = parseFloat(capture.amount.value) * 100; // Convert to cents for consistency
      currency = capture.amount.currency_code || 'USD';
    }
    
    // Extract order items if available
    let items = [];
    if (metadata.items) {
      try {
        items = typeof metadata.items === 'string' ? JSON.parse(metadata.items) : metadata.items;
      } catch (e) {
        logger.error('Failed to parse items from metadata', e);
      }
    }
    
    // Process the order using orderController
    try {
      const orderResult = await orderController.processPaymentSuccess({
        id: orderID,
        amount: amount,
        currency: currency.toLowerCase(),
        status: 'succeeded',
        payment_method_types: ['paypal'],
        customer: {
          id: payer.payer_id,
          email: email
        },
        metadata: {
          ...metadata,
          email: email,
          payment_method: 'paypal',
          order_id: metadata.order_id || orderID
        },
        items: items
      });
      
      logger.info(`Successfully processed PayPal order ${orderID}`);
      
      // Include the order processing result in the response
      return res.json({
        ...response.data,
        order_processing: orderResult
      });
    } catch (orderError) {
      logger.error(`Error processing PayPal order ${orderID}:`, orderError);
      
      // Still return success to the client as the payment was successful
      return res.json({
        ...response.data,
        order_processing: {
          success: false,
          error: orderError.message
        }
      });
    }
  } catch (error) {
    logPayment('PAYPAL', 'PAYMENT_CAPTURE_FAILED', { id: req.body.orderID }, error);
    return res.status(500).json({ error: 'Failed to capture PayPal payment' });
  }
});

// === Stripe Integration ===

// Helper to format amount for Stripe (converts dollars to cents)
const formatAmountForStripe = (amount, currency = 'usd') => {
  const multiplier = 100;
  return Math.round(amount * multiplier);
};

// Get supported payment methods based on country
const getPaymentMethodsForCountry = (countryCode = 'US') => {
  // Default payment methods (available everywhere)
  const methods = ['card'];
  
  // Add region-specific payment methods
  switch(countryCode) {
    case 'NL':
    case 'BE':
    case 'DE':
      methods.push('ideal'); // Netherlands, Belgium, Germany
      methods.push('sepa_debit'); // EU countries
      break;
    case 'IN':
      methods.push('upi'); // India
      break;
    case 'US':
    case 'CA':
    case 'GB':
    case 'AU':
      methods.push('afterpay_clearpay'); // US, CA, UK, AU
      break;
  }
  
  // Note: google_pay and apple_pay are not direct payment methods in Stripe
  // They are handled through the card payment method with specific configuration
  
  return methods;
};

// Create Stripe checkout session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { items, successUrl, cancelUrl, customerId, metadata = {} } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty items array' });
    }
    
    // Create line items for the checkout session
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          description: item.description || '',
          images: item.image ? [item.image] : [],
        },
        unit_amount: formatAmountForStripe(item.price, 'usd'),
      },
      quantity: item.quantity || 1,
    }));
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer: customerId || undefined,
      success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id={CHECKOUT_SESSION_ID}&status=success&type=checkout_session`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?canceled=true`,
      metadata: {
        ...metadata,
        order_id: uuidv4()
      },
    });
    
    logPayment('STRIPE', 'CHECKOUT_SESSION_CREATED', { id: session.id });
    return res.json({ id: session.id, url: session.url });
  } catch (error) {
    logPayment('STRIPE', 'CHECKOUT_SESSION_FAILED', null, error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * Create a Stripe Payment Intent for card payments and SEPA transfers
 * @route POST /api/payments/create-payment-intent
 */
router.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd', email, metadata = {}, paymentMethodTypes } = req.body;
    
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }
    
    logger.info('Creating payment intent', { amount, currency, email, paymentMethodTypes });
    console.log('Creating payment intent:', { amount, currency, email, paymentMethodTypes });
    
    // Convert amount to cents/smallest currency unit for Stripe
    const amountInCents = Math.round(parseFloat(amount) * 100);
    
    // Add basic validation
    if (isNaN(amountInCents) || amountInCents <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    // Default to card payment method if not specified
    const paymentTypes = paymentMethodTypes || ['card'];
    
    // Generate an order ID for tracking
    const orderId = metadata.orderId || uuidv4();
    
    // Create the payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      payment_method_types: paymentTypes,
      metadata: {
        ...metadata,
        email: email || '',
        createdAt: new Date().toISOString(),
        paymentType: paymentTypes.includes('sepa_debit') ? 'sepa_debit' : 'card',
        order_id: orderId // Ensure order_id is included for webhook processing
      },
      receipt_email: email
    });
    
    logger.info('Payment intent created', { id: paymentIntent.id, paymentTypes });
    console.log('Created payment intent:', paymentIntent.id);
    
    // Store the payment intent in the database for tracking
    try {
      // Create a record in the database with basic status information
      const paymentRecord = {
        id: paymentIntent.id,
        amount: amountInCents / 100, // Convert back to decimal for storage
        currency: currency.toLowerCase(),
        status: paymentIntent.status,
        paymentType: paymentTypes.includes('sepa_debit') ? 'sepa_debit' : 'card',
        metadata: {
          ...metadata,
          email: email || '',
          order_id: orderId
        },
        createdAt: new Date().toISOString(),
        paymentMethod: paymentTypes.includes('sepa_debit') ? 'sepa_debit' : 'card',
        clientSecret: paymentIntent.client_secret, // Important for status checking
        emailSent: false // Initialize with email not sent
      };
      
      // Store in database (adjust according to your actual database implementation)
      if (db && db.collection) {
        await db.collection('payments').doc(paymentIntent.id).set(paymentRecord);
        logger.info(`Created payment record in database for ${paymentIntent.id}`);
      }
    } catch (dbError) {
      logger.error('Error storing payment record in database', dbError);
      // Continue even if database storage fails - payment can still succeed
    }
    
    // For credit card payments, we need to process them here since the webhook might not be reliable
    if (paymentTypes.includes('card') && !paymentTypes.includes('sepa_debit')) {
      try {
        logger.info(`Processing card payment for order ${orderId}`);
        
        // Parse items from metadata
        let orderItems = [];
        
        if (metadata.items) {
          if (typeof metadata.items === 'string') {
            try {
              orderItems = JSON.parse(metadata.items);
              logger.info(`Successfully parsed items from metadata string, found ${orderItems.length} items`);
            } catch (parseError) {
              logger.error(`Failed to parse items from metadata string: ${parseError.message}`);
              // Continue with empty items array
            }
          } else if (Array.isArray(metadata.items)) {
            orderItems = metadata.items;
          }
        }
        
        // Process the order
        const result = await orderController.processPaymentSuccess({
          id: paymentIntent.id,
          amount: amountInCents,
          currency: currency.toLowerCase(),
          payment_method_types: paymentTypes,
          metadata: {
            ...metadata,
            order_id: orderId
          },
          customer: {
            id: metadata.userId || null,
            email: email || metadata.userEmail
          },
          items: orderItems
        });
        
        logger.info(`Order processed: ${result.orderId}`, {
          orderId: result.orderId,
          deliveryStatus: result.deliveryStatus
        });
        
        // Update database record
        try {
          await db.collection('payments').doc(paymentIntent.id).update({
            emailSent: true,
            emailSentAt: new Date().toISOString(),
            processedAt: new Date().toISOString(),
            orderId: result.orderId
          });
          logger.info(`Updated payment record for ${paymentIntent.id} - email sent status recorded`);
        } catch (dbUpdateError) {
          logger.error(`Error updating payment record: ${dbUpdateError.message}`);
          // Non-critical error, continue
        }
      } catch (processingError) {
        logger.error(`Error processing card payment: ${processingError.message}`);
        // Continue - don't fail the payment intent creation
      }
    }
    
    // Return the client secret to the client
    return res.json({
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id,
      orderId: orderId
    });
  } catch (error) {
    logger.error('Error creating payment intent:', error);
    console.error('Error creating payment intent:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Diagnostic endpoint for payment methods
router.get('/payment-methods', (req, res) => {
  try {
    const { countryCode = 'US' } = req.query;
    
    // Get payment methods for the specified country
    const paymentMethods = getPaymentMethodsForCountry(countryCode);
    
    // Get detailed information about available payment methods
    const methodDetails = {
      card: {
        name: 'Credit or Debit Card',
        available: true,
        requirements: ['Any country'],
        endpoint: '/api/payments/create-stripe-checkout'
      },
      ideal: {
        name: 'iDEAL',
        available: paymentMethods.includes('ideal'),
        requirements: ['Netherlands or Belgium', 'EUR currency'],
        endpoint: '/api/payments/create-stripe-checkout'
      },
      sepa_debit: {
        name: 'SEPA Direct Debit',
        available: paymentMethods.includes('sepa_debit'),
        requirements: ['EU countries', 'EUR currency'],
        endpoint: '/api/payments/create-stripe-checkout'
      },
      upi: {
        name: 'UPI',
        available: paymentMethods.includes('upi'),
        requirements: ['India'],
        endpoint: '/api/payments/create-stripe-checkout'
      },
      afterpay_clearpay: {
        name: 'Afterpay/Clearpay',
        available: paymentMethods.includes('afterpay_clearpay'),
        requirements: ['US, CA, UK, AU'],
        endpoint: '/api/payments/create-stripe-checkout'
      },
      paypal: {
        name: 'PayPal',
        available: true,
        requirements: ['Any country'],
        endpoint: '/api/payments/create-paypal-order'
      }
    };
    
    console.log(`Payment methods diagnostic for country ${countryCode}: ${paymentMethods.join(', ')}`);
    if (logger) logger.info(`Payment methods diagnostic for country ${countryCode}: ${paymentMethods.join(', ')}`);
    
    return res.status(200).json({
      status: 'success',
      countryCode,
      availablePaymentMethods: paymentMethods,
      methodDetails,
      apiEndpoints: {
        stripeCheckout: '/api/payments/create-stripe-checkout',
        paypalOrder: '/api/payments/create-paypal-order',
        diagnostic: '/api/payments/payment-methods'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in payment methods diagnostic endpoint:', error);
    if (logger) logger.error('Error in payment methods diagnostic endpoint:', error);
    return res.status(500).json({ error: 'Error getting payment methods' });
  }
});

// Test connectivity to payment APIs
router.get('/test-connectivity', async (req, res) => {
  try {
    console.log('Payment API connectivity test requested');
    
    const results = {
      stripe: {
        status: 'unknown',
        error: null
      },
      paypal: {
        status: 'unknown',
        error: null
      },
      backend: {
        status: 'connected',  // We know backend is working if this endpoint is reached
        routes: [
          '/api/payments/test',
          '/api/payments/payment-methods', 
          '/api/payments/test-connectivity',
          '/api/payments/create-stripe-checkout',
          '/api/payments/create-paypal-order'
        ]
      }
    };
    
    // Test Stripe connectivity
    try {
      // If no API key is set, report a configuration issue rather than a connection error
      if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_51R2ydLCWt3snxVwEJxJQNsGNifhLhfQrJEBJgPPr9W4dRDfbjh11FvYLrxQ') {
        results.stripe.status = 'not_configured';
        results.stripe.error = 'Stripe API key not configured';
      } else {
        // Try to access Stripe API (lightweight check)
        const paymentMethods = await stripe.paymentMethods.list({
          limit: 1,
        });
        results.stripe.status = 'connected';
      }
    } catch (stripeError) {
      results.stripe.status = 'error';
      results.stripe.error = stripeError.message;
      console.error('Stripe API connection test failed:', stripeError);
      if (logger) logger.error('Stripe API connection test failed:', stripeError);
    }
    
    // Test PayPal connectivity
    try {
      if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === 'test_client_id') {
        results.paypal.status = 'not_configured';
        results.paypal.error = 'PayPal client ID not configured';
      } else {
        const accessToken = await generateAccessToken();
        results.paypal.status = 'connected';
      }
    } catch (paypalError) {
      results.paypal.status = 'error';
      results.paypal.error = paypalError.message;
      console.error('PayPal API connection test failed:', paypalError);
      if (logger) logger.error('PayPal API connection test failed:', paypalError);
    }
    
    console.log('Payment API connectivity test results:', results);
    if (logger) logger.info('Payment API connectivity test results:', JSON.stringify(results));
    
    return res.status(200).json({
      status: 'success',
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in payment connectivity test endpoint:', error);
    if (logger) logger.error('Error in payment connectivity test endpoint:', error);
    return res.status(500).json({ error: 'Error testing payment API connectivity' });
  }
});

// Redirect handler for thank you page after payment
router.get('/thankyou', (req, res) => {
  const { session_id } = req.query;
  // Get the frontend URL (default to localhost:5173 for development)
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  // Redirect to the new checkout success page with the session_id
  const redirectUrl = `${frontendUrl}/checkout/success?payment_id=${session_id}&status=success&type=checkout_session`;
  console.log(`Redirecting payment success to: ${redirectUrl}`);
  if (logger) logger.info(`Redirecting payment success to: ${redirectUrl}`);
  
  return res.redirect(redirectUrl);
});

/**
 * Process Google Pay payment
 * @route POST /api/payments/process-google-pay
 */
router.post('/process-google-pay', async (req, res) => {
  try {
    // Extract payment data from request
    const { paymentData, orderDetails, email, metadata = {} } = req.body;

    if (!paymentData || !paymentData.paymentMethodData) {
      return res.status(400).json({ error: 'Invalid Google Pay payment data' });
    }

    // Extract email from various possible sources 
    const customerEmail = email || metadata.email || paymentData.email || '';
    
    // Validate email
    if (!customerEmail || !customerEmail.includes('@')) {
      logger.warn('Google Pay payment attempted without valid email', { 
        emailProvided: !!customerEmail,
        emailValid: customerEmail && customerEmail.includes('@'),
        email: customerEmail ? customerEmail.substring(0, 3) + '...' : 'none' 
      });
    } else {
      logger.info('Processing Google Pay payment with email', { email: customerEmail });
    }

    // Log the payment attempt
    logger.info('Processing Google Pay payment', { 
      email: customerEmail || 'not provided', 
      amount: orderDetails?.amount || 'unknown',
      hasPaymentData: !!paymentData
    });

    // Extract token from Google Pay response
    const token = paymentData.paymentMethodData.tokenizationData.token;
    
    // Parse the token which is a JSON string
    let tokenData;
    try {
      tokenData = typeof token === 'string' ? JSON.parse(token) : token;
    } catch (e) {
      logger.error('Failed to parse Google Pay token', e);
      return res.status(400).json({ error: 'Invalid payment token format' });
    }

    // Create a payment method using the token
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        token: tokenData.id || tokenData
      },
      billing_details: {
        email: email || 'customer@example.com'
      }
    });

    // Create a payment intent with the payment method
    const amount = parseFloat(orderDetails?.amount || 0) * 100; // Convert to cents
    const currency = (orderDetails?.currency || 'USD').toLowerCase();
    
    // Generate order ID if not provided
    const orderId = metadata.order_id || 
                   metadata.orderId || 
                   `ord_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency,
      payment_method: paymentMethod.id,
      confirm: true,
      return_url: `${req.headers.origin || process.env.FRONTEND_URL}/checkout/success`,
      metadata: {
        ...metadata,
        payment_method: 'google_pay',
        order_id: orderId,
        email: email
      }
    });

    // Check payment intent status
    if (
      paymentIntent.status === 'succeeded' ||
      paymentIntent.status === 'processing' ||
      paymentIntent.next_action
    ) {
      // Process the order using orderController to send emails
      try {
        // Get proper customer email
        const customerEmail = email || metadata.email || paymentData.email || '';
        
        if (!customerEmail || !customerEmail.includes('@')) {
          logger.warn('No valid email for Google Pay order confirmation', { orderId });
        }
        
        const orderResult = await orderController.processPaymentSuccess({
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
          payment_method_types: ['card'],
          customer: {
            id: metadata.userId || 'google_pay_customer',
            email: customerEmail
          },
          metadata: {
            ...metadata,
            email: customerEmail,
            payment_method: 'google_pay',
            orderId: orderId
          }
        });

        // Return success response with order details
        return res.status(200).json({
          success: true,
          message: 'Google Pay payment processed successfully',
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          client_secret: paymentIntent.client_secret,
          amount: amount / 100,
          currency: currency,
          orderId: orderId,
          orderDetails: orderResult || {}
        });
      } catch (orderError) {
        logger.error('Error processing order after Google Pay payment', orderError);
        // Continue with payment success even if order processing fails
        // This prevents charging the customer but not giving them their product
      }
    } else {
      // Payment failed or canceled
      logger.error('Google Pay payment failed', { status: paymentIntent.status });
      return res.status(400).json({
        error: 'Payment failed',
        status: paymentIntent.status,
        details: paymentIntent.last_payment_error?.message || 'Unknown error'
      });
    }
  } catch (error) {
    logger.error('Error processing Google Pay payment', error);
    return res.status(500).json({
      error: error.message || 'Failed to process Google Pay payment'
    });
  }
});

// Validate Apple Pay merchant
router.post('/validate-apple-pay-merchant', async (req, res) => {
  try {
    const { validationURL } = req.body;
    
    if (!validationURL) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing validation URL' 
      });
    }
    
    console.log('Validating Apple Pay merchant with URL:', validationURL);
    if (logger) logger.info(`Validating Apple Pay merchant with URL: ${validationURL}`);
    
    // Get the merchant session from Stripe
    const merchantSession = await stripe.applePayDomains.create({
      domain_name: req.get('host')
    });
    
    return res.json({
      success: true,
      merchantSession
    });
  } catch (error) {
    console.error('Apple Pay merchant validation error:', error);
    if (logger) logger.error(`Apple Pay merchant validation error: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Merchant validation failed'
    });
  }
});

// Process Apple Pay payment
router.post('/process-apple-pay', async (req, res) => {
  try {
    const { payment, amount, currency, items, email } = req.body;
    
    if (!payment || !payment.token) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing payment token' 
      });
    }
    
    // Log the payment attempt
    console.log('Processing Apple Pay payment:', {
      amount,
      currency,
      email: email || 'not provided',
      items: items ? items.length : 0
    });
    
    if (logger) {
      logger.info(`Processing Apple Pay payment: ${JSON.stringify({
        amount,
        currency,
        email: email ? 'provided' : 'not provided'
      })}`);
    }
    
    // Create a payment method using the token
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        token: payment.token.id
      }
    });
    
    // Create a payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: formatAmountForStripe(amount, currency),
      currency: currency.toLowerCase(),
      payment_method: paymentMethod.id,
      confirmation_method: 'manual',
      confirm: true,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id={PAYMENT_INTENT_ID}&status=success&type=payment_intent`,
      metadata: {
        order_id: uuidv4(),
        email: email || 'anonymous',
        items: JSON.stringify(items)
      }
    });
    
    // Check payment intent status
    if (
      paymentIntent.status === 'succeeded' ||
      paymentIntent.status === 'processing' ||
      paymentIntent.next_action
    ) {
      // Generate order ID
      const orderId = paymentIntent.metadata.order_id;
      
      // Process the order using orderController to send emails
      try {
        const orderResult = await orderController.processPaymentSuccess({
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
          payment_method_types: ['card'],
          customer: {
            id: metadata.userId || 'apple_pay_customer',
            email: email
          },
          metadata: {
            ...metadata,
            email: email,
            payment_method: 'apple_pay',
            order_id: orderId
          },
          items: items
        });
        
        logger.info(`Successfully processed Apple Pay order ${orderId}`);
      } catch (orderError) {
        logger.error(`Error processing Apple Pay order: ${orderError.message}`);
        // Continue anyway since the payment was successful
      }
      
      // Prepare the redirect URL
      const successUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id=${paymentIntent.id}&status=success&type=payment_intent`;
      
      return res.json({
        success: true,
        orderId,
        status: paymentIntent.status,
        clientSecret: paymentIntent.client_secret,
        redirectUrl: successUrl
      });
    } else {
      throw new Error(`Payment failed with status: ${paymentIntent.status}`);
    }
  } catch (error) {
    console.error('Apple Pay payment processing error:', error);
    if (logger) logger.error(`Apple Pay payment error: ${error.message}`);
    
    // Return detailed error information
    return res.status(500).json({
      success: false,
      error: error.message || 'Payment processing failed',
      details: error.type ? {
        type: error.type,
        code: error.code,
        param: error.param
      } : undefined
    });
  }
});

// Stripe webhook handler
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('Stripe webhook received');
  const sig = req.headers['stripe-signature'];
  
  try {
    // Log the raw body for debugging
    console.log(`Webhook body length: ${req.body.length} bytes`);
    console.log(`Webhook signature: ${sig ? 'present' : 'missing'}`);
    console.log(`Webhook secret: ${endpointSecret ? 'configured' : 'missing'}`);
    
    let event;
    
    // Verify webhook signature
    if (endpointSecret) {
      try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log(`Webhook verified! Event type: ${event.type}`);
  } catch (err) {
        console.log(`⚠️ Webhook signature verification failed: ${err.message}`);
    logPayment('STRIPE', 'WEBHOOK_SIGNATURE_FAILED', null, err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else {
      // For development without a webhook secret
      try {
        event = JSON.parse(req.body.toString());
        console.log(`Webhook parsed without verification. Event type: ${event.type}`);
      } catch (parseError) {
        console.log(`⚠️ Webhook parsing failed: ${parseError.message}`);
        return res.status(400).send(`Webhook Error: ${parseError.message}`);
      }
  }
  
  // Handle the event
  switch (event.type) {
      case 'payment_intent.created':
        const createdIntent = event.data.object;
        logPayment('STRIPE', 'PAYMENT_INTENT_CREATED', { id: createdIntent.id });
        
        // Check if this is a SEPA Credit Transfer or a fallback payment for SEPA
        if (createdIntent.metadata && (
            createdIntent.metadata.paymentType === 'sepa_credit_transfer' || 
            createdIntent.metadata.fallback_payment === 'true')
        ) {
          console.log(`Webhook: SEPA Payment Intent created for order ${createdIntent.metadata.orderReference}`);
          logger.info(`SEPA Payment Intent created via webhook: ${createdIntent.id}`, {
            orderReference: createdIntent.metadata.orderReference,
            endToEndId: createdIntent.metadata.endToEndId,
            simulationMode: createdIntent.metadata.simulationMode,
            fallback: createdIntent.metadata.fallback_payment === 'true'
          });
          
          try {
            // Store the Stripe reference with the order if needed
            // This could be a database update or other tracking mechanism
            if (createdIntent.metadata.orderReference) {
              // You might want to implement this
              // await updateOrderWithStripeReference(
              //   createdIntent.metadata.orderReference,
              //   createdIntent.id
              // );
              
              logger.info(`Associated Stripe reference ${createdIntent.id} with order ${createdIntent.metadata.orderReference}`);
            }
          } catch (error) {
            logger.error(`Error processing SEPA payment intent created webhook: ${error.message}`, error);
          }
        }
        break;
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      // Log the successful payment
      logPayment('STRIPE', 'PAYMENT_SUCCEEDED', { id: paymentIntent.id });
      
      try {
        // First check if this payment was already processed and email sent
        let paymentRecord = null;
        let emailAlreadySent = false;
        
        try {
          const paymentDoc = await db.collection('payments').doc(paymentIntent.id).get();
          if (paymentDoc.exists) {
            paymentRecord = paymentDoc.data();
            if (paymentRecord.emailSent === true) {
              logger.info(`Skipping duplicate processing for payment ${paymentIntent.id} - email already sent`);
              emailAlreadySent = true;
            }
          }
        } catch (dbError) {
          logger.error(`Error checking payment record: ${dbError.message}`);
          // Continue processing even if DB check fails
        }
        
        // Only process if email wasn't already sent
        if (!emailAlreadySent) {
          // Get cart items from metadata or fetch them based on the order ID
          const metadata = paymentIntent.metadata || {};
          const orderId = metadata.order_id || uuidv4();
          logger.info(`Processing payment intent with order ID: ${orderId}`);
          
          // Check if this is a SEPA payment
          const isSepaPayment = 
            paymentIntent.payment_method_types?.includes('sepa_debit') || 
            paymentIntent.payment_method_types?.includes('sepa_credit_transfer') ||
            metadata.payment_method === 'sepa_credit_transfer';
          
          // Be careful with SEPA payments - they might have already been processed manually
          if (isSepaPayment && paymentRecord && paymentRecord.orderId) {
            logger.info(`SEPA payment ${paymentIntent.id} has already been manually processed with order ${paymentRecord.orderId}`);
            return res.status(200).send({ received: true }); // Exit early - SEPA payment already handled manually
          }
          
          // Try to retrieve items from metadata
          let items = [];
          try {
            if (metadata.items) {
              // Always treat items as a string that needs parsing
              if (typeof metadata.items === 'string') {
                try {
                  items = JSON.parse(metadata.items);
                  logger.info(`Successfully parsed ${items.length} items from webhook metadata`);
                } catch (parseError) {
                  logger.error(`Error parsing items metadata in webhook: ${parseError.message}`);
                  console.error(`Error parsing items from metadata: ${parseError.message}`);
                  // Continue with empty items array
                }
              } else if (Array.isArray(metadata.items)) {
                items = metadata.items;
              }
            } else if (metadata.cart_id) {
              // Fetch cart items from database using cart_id
              items = await fetchCartItemsFromDatabase(metadata.cart_id);
            }
          } catch (parseError) {
            logger.error(`Error parsing items metadata in webhook: ${parseError.message}`, parseError);
          }
          
          // Process the payment and deliver agent templates
          const result = await orderController.processPaymentSuccess({
            id: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            payment_method_types: paymentIntent.payment_method_types,
            metadata: {
              ...metadata,
              order_id: orderId
            },
            customer: {
              id: metadata.userId || paymentIntent.customer,
              email: metadata.email || metadata.userEmail
            },
            items: items
          });
          
          // Log success with the order ID from the result
          logger.info(`Order processed successfully via webhook: ${result.orderId}`, {
            orderId: result.orderId,
            deliveryStatus: result.deliveryStatus
          });
          
          // Mark in database that the order was processed and email sent
          try {
            await db.collection('payments').doc(paymentIntent.id).update({
              emailSent: true, 
              emailSentAt: new Date().toISOString(),
              processedAt: new Date().toISOString(),
              orderId: result.orderId,
              webhookProcessed: true
            });
            logger.info(`Marked payment ${paymentIntent.id} as processed by webhook`);
          } catch (dbUpdateError) {
            logger.error(`Error updating payment record: ${dbUpdateError.message}`);
            // Non-critical error, continue
          }
        }
      } catch (error) {
        logger.error(`Error processing order after payment: ${error.message}`, error);
      }
      break;
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      // Handle failed payment
      logPayment('STRIPE', 'PAYMENT_FAILED', { id: failedPayment.id });
      break;
    case 'checkout.session.completed':
      const session = event.data.object;
      // Fulfill the purchase
      logPayment('STRIPE', 'CHECKOUT_COMPLETED', { id: session.id });
      
      try {
        // Extract orderId from metadata
        const metadata = session.metadata || {};
        const orderId = metadata.order_id || uuidv4();
        logger.info(`Processing checkout session with order ID: ${orderId}`);
        
        // Check if we have items in metadata and parse them if needed
        let items = [];
        
        if (metadata.items) {
          try {
            if (typeof metadata.items === 'string') {
              items = JSON.parse(metadata.items);
              logger.info(`Using ${items.length} items from checkout session metadata`);
            } else if (typeof metadata.items === 'object') {
              items = metadata.items;
              logger.info(`Using items object directly from checkout session metadata`);
            }
          } catch (itemsError) {
            logger.error(`Error parsing items from checkout session metadata: ${itemsError.message}`);
          }
        }
        
        // If no items in metadata, get line items from the checkout session
        if (items.length === 0) {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
          items = lineItems.data.map(item => ({
            id: item.price?.product || item.price?.id || uuidv4(),
            name: item.description,
            price: item.price?.unit_amount / 100,
            quantity: item.quantity || 1
          }));
        }
        
        // Process the payment and deliver agent templates
        const result = await orderController.processPaymentSuccess({
          id: session.id,
          amount: session.amount_total,
          currency: session.currency,
          payment_method_types: [session.payment_method_types?.[0] || 'card'],
          metadata: {
            ...metadata,
            order_id: orderId // Ensure the orderId is passed to the controller
          },
          customer: session.customer ? {
            id: session.customer,
            email: session.customer_email || session.customer_details?.email
          } : null,
          items: items
        });
        
        // Log success with the order ID from the result
        logger.info(`Checkout order processed successfully: ${result.orderId}`, {
          orderId: result.orderId, // Include orderId in the log data
          deliveryStatus: result.deliveryStatus,
          successCount: result.deliveryResults?.filter(r => r.success).length || 0,
          failureCount: result.deliveryResults?.filter(r => !r.success).length || 0
        });
        
        // If we have a notification service, send a success notification
        try {
          // This could be an internal notification service or a third-party service
          if (process.env.ENABLE_NOTIFICATIONS !== 'false' && (metadata.email || session.customer_email || session.customer_details?.email)) {
            // Get the customer email from various possible sources
            const customerEmail = metadata.email || session.customer_email || session.customer_details?.email;
            logger.info(`Sending order success notification for order: ${result.orderId} to ${customerEmail}`);
            
            // Send order success notification
            await notificationService.sendOrderSuccessNotification({
              orderId: result.orderId,
              email: customerEmail,
              userId: metadata.userId,
              items: items,
              orderTotal: session.amount_total / 100, // Convert cents to dollars
              agent: items.length === 1 ? items[0] : null
            });
          }
        } catch (notificationError) {
          logger.error(`Failed to send notification for order ${result.orderId}: ${notificationError.message}`);
          // Non-critical error, don't throw
        }
      } catch (error) {
        logger.error(`Error processing order after checkout: ${error.message}`, error);
      }
      break;
      // Add specific handlers for SEPA payments
      case 'payment_intent.processing':
        const processingPayment = event.data.object;
        // This is particularly important for SEPA payments which can take days to process
        if (processingPayment.payment_method_types.includes('sepa_debit') ||
            processingPayment.metadata?.payment_method === 'sepa_credit_transfer') {
          
          logPayment('STRIPE', 'SEPA_PAYMENT_PROCESSING', { id: processingPayment.id });
          
          try {
            // Update the payment status in your database
            const paymentRef = db.collection('payments').doc(processingPayment.id);
            const paymentDoc = await paymentRef.get();
            
            if (paymentDoc.exists) {
              await paymentRef.update({
                status: 'processing',
                updatedAt: new Date().toISOString(),
                stripeEvent: event.type,
                lastProcessedAt: new Date().toISOString()
              });
              
              logger.info(`Updated SEPA payment status to processing: ${processingPayment.id}`);
            } else {
              logger.warn(`Could not find payment document for processing SEPA payment: ${processingPayment.id}`);
            }
          } catch (updateError) {
            logger.error(`Error updating SEPA payment status: ${updateError.message}`);
          }
        }
        break;
      case 'charge.succeeded':
        // This event occurs when a payment charge succeeds
        const charge = event.data.object;
        
        // Check if this is related to a SEPA payment
        if (charge.payment_method_details?.type === 'sepa_debit' || 
            charge.metadata?.payment_method === 'sepa_credit_transfer') {
          
          logPayment('STRIPE', 'SEPA_CHARGE_SUCCEEDED', { id: charge.payment_intent });
          
          try {
            // Get the payment intent ID
            const paymentIntentId = charge.payment_intent;
            
            if (paymentIntentId) {
              // Update the payment status in your database
              const paymentRef = db.collection('payments').doc(paymentIntentId);
              const paymentDoc = await paymentRef.get();
              
              if (paymentDoc.exists) {
                await paymentRef.update({
                  status: 'completed',
                  chargeId: charge.id,
                  updatedAt: new Date().toISOString(),
                  stripeEvent: event.type,
                  lastProcessedAt: new Date().toISOString()
                });
                
                logger.info(`Updated SEPA payment status to completed: ${paymentIntentId}`);
                
                // If we haven't delivered the order yet, do it now
                const paymentData = paymentDoc.data();
                if (paymentData.orderProcessed !== true) {
                  // Process the order - this will deliver templates and send emails
                  const metadata = paymentData.metadata || {};
                  let items = [];
                  
                  try {
                    items = metadata.items || [];
                  } catch (e) {
                    logger.error(`Error parsing items for SEPA fulfillment: ${e.message}`);
                  }
                  
                  // Get user email
                  const userEmail = paymentData.customerEmail || metadata.email || charge.receipt_email;
                  
                  // Process the payment success
                  const orderResult = await orderController.processPaymentSuccess({
                    id: paymentIntentId,
                    amount: charge.amount,
                    currency: charge.currency,
                    payment_method_types: ['sepa_debit'],
                    metadata: {
                      ...metadata,
                      email: userEmail
                    },
                    customer: {
                      id: charge.customer || null,
                      email: userEmail
                    },
                    items: items
                  });
                  
                  // Update the payment with order information
                  await paymentRef.update({
                    orderProcessed: true,
                    orderId: orderResult.orderId,
                    templates: orderResult.templates || [],
                    deliveryStatus: orderResult.deliveryStatus
                  });
                  
                  logger.info(`Processed delayed SEPA order fulfillment: ${orderResult.orderId}`);
                }
              } else {
                logger.warn(`Could not find payment document for completed SEPA charge: ${paymentIntentId}`);
              }
            }
          } catch (fulfillError) {
            logger.error(`Error fulfilling SEPA order after charge: ${fulfillError.message}`);
          }
        }
        break;
    default:
      // Unexpected event type
      logPayment('STRIPE', `UNHANDLED_EVENT_${event.type}`, { id: event.id });
  }
  
  // Return a 200 response to acknowledge receipt of the event
  res.status(200).send({ received: true });
  } catch (error) {
    console.error('Error in Stripe webhook handler:', error);
    if (logger) logger.error('Error in Stripe webhook handler:', error);
    return res.status(500).json({ error: 'Error processing Stripe webhook' });
  }
});

/**
 * Fetch cart items from database
 * @param {string} cartId - Cart ID
 * @returns {Promise<Array>} - Cart items
 */
const fetchCartItemsFromDatabase = async (cartId) => {
  try {
    if (!cartId) {
      logger.warn('No cart ID provided to fetchCartItemsFromDatabase');
      return [];
    }
    
    logger.info(`Fetching cart items for cart_id: ${cartId}`);
    
    // Try to find cart in Firestore - first check the carts collection
    const cartDoc = await db.collection('carts').doc(cartId).get();
    
    if (cartDoc.exists) {
      const cartData = cartDoc.data();
      logger.info(`Found cart in 'carts' collection: ${cartId}, items: ${cartData.items?.length || 0}`);
      return Array.isArray(cartData.items) ? cartData.items : [];
    }
    
    // If not found in carts collection, check if it's stored in userCarts subcollection
    // Some implementations store carts under user documents
    const userCartsQuery = await db.collectionGroup('userCarts')
      .where('id', '==', cartId)
      .limit(1)
      .get();
    
    if (!userCartsQuery.empty) {
      const cartData = userCartsQuery.docs[0].data();
      logger.info(`Found cart in 'userCarts' subcollection: ${cartId}, items: ${cartData.items?.length || 0}`);
      return Array.isArray(cartData.items) ? cartData.items : [];
    }
    
    // As a last resort, check if it's a userId instead of cartId (some implementations store the cart directly on the user)
    const userDoc = await db.collection('users').doc(cartId).get();
    
    if (userDoc.exists && userDoc.data().cart) {
      const userData = userDoc.data();
      logger.info(`Found cart in 'users' collection: ${cartId}, items: ${userData.cart.items?.length || 0}`);
      return Array.isArray(userData.cart.items) ? userData.cart.items : [];
    }
    
    logger.warn(`Cart not found for cart_id: ${cartId}`);
    return [];
  } catch (error) {
    logger.error(`Error fetching cart items from database: ${error.message}`, error);
    return [];
  }
};

/**
 * Get payment status for a payment intent or checkout session
 * @route GET /api/payments/payment-status/:id
 */
router.get('/payment-status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'payment_intent' } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }
    
    console.log(`Checking payment status for ${type} ${id}`);
    if (logger) logger.info(`Checking payment status for ${type} ${id}`);
    
    let result;
    
    // Handle different payment types
    switch(type) {
      case 'payment_intent':
        // Get the payment intent from Stripe
        result = await stripe.paymentIntents.retrieve(id);
        break;
        
      case 'checkout_session':
        // Get the checkout session from Stripe
        result = await stripe.checkout.sessions.retrieve(id);
        break;
        
      case 'paypal_order':
        // Get PayPal order status
        const accessToken = await generateAccessToken();
        const response = await axios({
          method: 'get',
          url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${id}`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          }
        });
        result = response.data;
        break;
        
      case 'sepa_credit_transfer':
        // Get SEPA Credit Transfer status from our own database
        try {
          const paymentDoc = await db.collection('payments').doc(id).get();
          
          if (!paymentDoc.exists) {
            return res.status(404).json({ 
              success: false,
              error: 'SEPA payment not found'
            });
          }
          
          const payment = paymentDoc.data();
          
          // If in simulation mode, determine status based on time elapsed
          if (payment.simulationMode) {
            const createdAt = new Date(payment.createdAt);
            const now = new Date();
            const minutesElapsed = (now - createdAt) / (1000 * 60);
            
            // Simulate status progression
            let updatedStatus = payment.status;
            if (minutesElapsed > 30) {
              updatedStatus = 'completed';
            } else if (minutesElapsed > 5) {
              updatedStatus = 'processing';
            } else {
              updatedStatus = 'pending';
            }
            
            // Update status in database if it has changed
            if (updatedStatus !== payment.status) {
              await db.collection('payments').doc(id).update({
                status: updatedStatus,
                updatedAt: new Date().toISOString()
              });
              payment.status = updatedStatus;
            }
          }
          
          // Format response to match other payment types
          result = {
            id: payment.id,
            status: payment.status,
            amount: payment.amount,
            currency: payment.currency,
            bankDetails: payment.bankDetails,
            debtorInfo: payment.debtorInfo,
            metadata: payment.metadata || {},
            created: payment.createdAt,
            updated: payment.updatedAt || payment.createdAt
          };
        } catch (dbError) {
          console.error(`Error retrieving SEPA payment from database: ${dbError.message}`);
          return res.status(500).json({ 
            success: false,
            error: 'Error retrieving SEPA payment details',
            details: dbError.message
          });
        }
        break;
        
      default:
        return res.status(400).json({ error: `Unsupported payment type: ${type}` });
    }
    
    return res.status(200).json({
      success: true,
      id,
      type,
      status: result.status,
      data: result,  // Keep data for backward compatibility
      result         // Include result as an additional field
    });
  } catch (error) {
    console.error(`Error getting payment status: ${error.message}`, error);
    if (logger) logger.error(`Error getting payment status: ${error.message}`);
    
    // Handle specific error types
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(404).json({ 
        success: false,
        error: 'Payment not found or invalid ID',
        details: error.message
      });
    }
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to get payment status',
      details: error.message
    });
  }
});

/**
 * Create a crypto payment (BitPay)
 * @route POST /api/payments/create-crypto-payment
 */
router.post('/create-crypto-payment', async (req, res) => {
  try {
    const { cartTotal, items, currency = 'USD', successUrl, cancelUrl, metadata = {} } = req.body;
    
    if (!cartTotal || !items) {
      return res.status(400).json({ error: 'Invalid request body. cartTotal and items are required.' });
    }
    
    // Check if BitPay is configured
    const BITPAY_TOKEN = process.env.BITPAY_TOKEN;
    const BITPAY_ENVIRONMENT = process.env.NODE_ENV === 'production' ? 'prod' : 'test';
    
    if (!BITPAY_TOKEN) {
      console.warn('BitPay token not configured. Using mock response for development.');
      // Return a mock response for development
      const mockInvoiceId = `MOCK-BITPAY-${uuidv4()}`;
      
      return res.status(200).json({
        success: true,
        id: mockInvoiceId,
        paymentUrl: `https://test.bitpay.com/invoice?id=${mockInvoiceId}`,
        status: 'created',
        message: 'Mock crypto payment created. BitPay is not configured.'
      });
    }
    
    // In a real implementation, you would:
    // 1. Initialize BitPay client using their SDK
    // 2. Create a new invoice
    // 3. Return the payment URL and ID
    
    // For now, we'll log the attempt and return a mock response
    console.log('Crypto payment requested:', {
      amount: cartTotal,
      currency,
      itemCount: items.length
    });
    if (logger) logger.info(`Crypto payment requested: ${cartTotal} ${currency}`);
    
    // Create order ID that will be used to track this payment
    const orderId = metadata.order_id || uuidv4();
    
    // Return a simulated response
    return res.status(200).json({
      success: true,
      id: `BITPAY-${orderId}`,
      paymentUrl: `https://test.bitpay.com/invoice?id=${orderId}`,
      status: 'created',
      orderId,
      message: 'This is a simulated crypto payment endpoint. Integrate with BitPay SDK in production.'
    });
  } catch (error) {
    console.error(`Error creating crypto payment: ${error.message}`, error);
    if (logger) logger.error(`Error creating crypto payment: ${error.message}`);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to create crypto payment',
      details: error.message
    });
  }
});

/**
 * Check crypto payment status
 * @route GET /api/payments/crypto-payment-status/:id
 */
router.get('/crypto-payment-status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }
    
    console.log(`Checking crypto payment status for ${id}`);
    if (logger) logger.info(`Checking crypto payment status for ${id}`);
    
    // Check if BitPay is configured
    const BITPAY_TOKEN = process.env.BITPAY_TOKEN;
    
    if (!BITPAY_TOKEN) {
      console.warn('BitPay token not configured. Using mock response for development.');
      
      // For development/testing, return a mock status
      return res.status(200).json({
        success: true,
        id,
        status: 'confirmed',
        message: 'This is a mock status. BitPay is not configured.'
      });
    }
    
    // In a real implementation, you would:
    // 1. Initialize BitPay client
    // 2. Fetch the invoice status
    // 3. Return the current status
    
    // For now, simulate a random status for demonstration
    const possibleStatuses = ['new', 'paid', 'confirmed', 'complete', 'expired', 'invalid'];
    const randomStatus = possibleStatuses[Math.floor(Math.random() * possibleStatuses.length)];
    
    return res.status(200).json({
      success: true,
      id,
      status: randomStatus,
      message: 'This is a simulated crypto payment status. Integrate with BitPay SDK in production.'
    });
  } catch (error) {
    console.error(`Error checking crypto payment status: ${error.message}`, error);
    if (logger) logger.error(`Error checking crypto payment status: ${error.message}`);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to check crypto payment status',
      details: error.message
    });
  }
});

/**
 * Create a Stripe checkout session
 * Alternative endpoint name for create-checkout-session
 * @route POST /api/payments/create-stripe-checkout
 */
router.post('/create-stripe-checkout', async (req, res) => {
  try {
    const { items, successUrl, cancelUrl, customerId, metadata = {} } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty items array' });
    }
    
    // Log the request
    console.log('Creating Stripe checkout with items:', items.length);
    if (logger) logger.info(`Creating Stripe checkout with ${items.length} items`);
    
    // Create line items for the checkout session
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          description: item.description || '',
          images: item.image ? [item.image] : [],
        },
        unit_amount: formatAmountForStripe(item.price, 'usd'),
      },
      quantity: item.quantity || 1,
    }));
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer: customerId || undefined,
      success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id={CHECKOUT_SESSION_ID}&status=success&type=checkout_session`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?canceled=true`,
      metadata: {
        ...metadata,
        order_id: metadata.order_id || uuidv4()
      },
    });
    
    logPayment('STRIPE', 'CHECKOUT_SESSION_CREATED', { id: session.id });
    return res.json({ id: session.id, url: session.url });
  } catch (error) {
    logPayment('STRIPE', 'CHECKOUT_SESSION_FAILED', null, error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * SEPA Credit Transfer payment endpoint
 * @route POST /api/payments/sepa-credit-transfer
 */
router.post('/sepa-credit-transfer', async (req, res) => {
  try {
    const sepaPayload = req.body;
    
    // Log the received request (with sensitive data redacted)
    console.log('Processing SEPA Credit Transfer payment request:', {
      paymentType: sepaPayload.paymentType,
      amount: sepaPayload.paymentInfo?.amount,
      currency: sepaPayload.paymentInfo?.currency,
      debtorName: sepaPayload.debtorInfo?.name || 'not provided',
      hasIban: !!sepaPayload.debtorInfo?.iban,
      hasBic: !!sepaPayload.debtorInfo?.bic,
      email: sepaPayload.debtorInfo?.email || 'not provided',
      endToEndId: sepaPayload.paymentInfo?.endToEndId,
      metadata: sepaPayload.metadata ? 'provided' : 'not provided',
      items: sepaPayload.metadata?.items ? sepaPayload.metadata.items.length : 0,
      userId: sepaPayload.metadata?.userId || 'not provided'
    });
    
    // Validate required fields
    if (!sepaPayload.paymentInfo?.amount || !sepaPayload.metadata?.items) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: amount and items are required' 
      });
    }
    
    if (!sepaPayload.debtorInfo?.iban) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: debtor IBAN is required'
      });
    }
    
    // Extract user information for email
    const userEmail = sepaPayload.metadata?.userId ? null : sepaPayload.debtorInfo?.email;
    const isAuthenticated = !!sepaPayload.metadata?.userId;
    
    // For authenticated users, we'll get their email from their user record later
    if (isAuthenticated) {
      console.log(`Processing payment for authenticated user: ${sepaPayload.metadata.userId}`);
    } else if (userEmail && userEmail.includes('@')) {
      console.log(`Processing payment for non-authenticated user with email: ${userEmail}`);
    } else {
      console.log('Processing payment without a valid email address');
    }
    
    // Check if email is provided but invalid (has @ symbol) for non-authenticated users
    if (!isAuthenticated && userEmail && !userEmail.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format: If providing an email, it must include @ symbol'
      });
    }
    
    if (logger) {
      logger.info(`Processing SEPA Credit Transfer payment: ${JSON.stringify({
        amount: sepaPayload.paymentInfo.amount,
        currency: sepaPayload.paymentInfo.currency,
        email: sepaPayload.debtorInfo.email ? 'provided' : 'not provided',
        endToEndId: sepaPayload.paymentInfo.endToEndId,
        userId: sepaPayload.metadata?.userId || 'not provided'
      })}`);
    }
    
    // Use the provided endToEndId or generate a unique reference ID
    const transferReference = sepaPayload.paymentInfo?.endToEndId || `SEPA-${uuidv4()}`;
    
    // Use the provided orderId or generate a new one
    const orderId = sepaPayload.metadata?.orderId || uuidv4();
    
    // Determine if we're in test mode or production
    const isTestMode = process.env.NODE_ENV !== 'production' || process.env.SEPA_SIMULATION_MODE === 'true';
    
    // Set up Stripe payment based on the mode
    let stripePaymentData;
    let setupStripeCustomer = false;
    
    try {
      // For SEPA payments, we need to create a PaymentIntent with sepa_debit payment method
      // or use Stripe's source API for SEPA Credit Transfer
      
      // If the customer is authenticated, try to get or create their Stripe customer
      let stripeCustomerId = null;
      if (isAuthenticated && sepaPayload.metadata?.userId) {
        // Get the user's Stripe customer ID from your database
        const userDoc = await db.collection('users').doc(sepaPayload.metadata.userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          stripeCustomerId = userData.stripeCustomerId;
          
          // If user doesn't have a Stripe customer ID, create one
          if (!stripeCustomerId) {
            setupStripeCustomer = true;
          }
        }
      }
      
      // Create the payment with Stripe
      if (sepaPayload.paymentType === 'sepa_credit_transfer') {
        // For SEPA Credit Transfer, we create a PaymentIntent with manual confirmation
        // This represents the customer's intention to pay via bank transfer
        
        // Calculate amount in cents for Stripe
        const amountInCents = Math.round(parseFloat(sepaPayload.paymentInfo.amount) * 100);
        
        // Create PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: 'eur', // SEPA is EUR only
          payment_method_types: ['sepa_debit'], // Only use sepa_debit, not customer_balance
          capture_method: 'automatic', // SEPA requires automatic capture
          confirm: false,
          customer: stripeCustomerId || undefined,
          metadata: {
            orderId: orderId,
            transferReference: transferReference,
            userEmail: userEmail || '',
            userId: sepaPayload.metadata?.userId || '',
            items: JSON.stringify(sepaPayload.metadata?.items || [])
          }
        });
        
        stripePaymentData = {
          id: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          status: paymentIntent.status
        };
      }
      
      console.log('Created Stripe payment:', stripePaymentData);
    } catch (stripeError) {
      console.error('Error creating Stripe payment:', stripeError);
      logger.error(`Error creating Stripe SEPA payment: ${stripeError.message}`);
      
      // Proceed with non-Stripe flow if Stripe fails
      console.log('Falling back to manual SEPA payment tracking');
    }
    
    // Create payment data for the response
    const paymentData = {
      id: stripePaymentData?.id || transferReference,
      amount: parseFloat(sepaPayload.paymentInfo.amount),
      currency: sepaPayload.paymentInfo.currency.toLowerCase(),
      type: 'sepa_credit_transfer',
      reference: transferReference,
      orderId,
      status: 'pending',
      bankDetails: {
        beneficiary: process.env.SEPA_BENEFICIARY_NAME || sepaPayload.creditorInfo?.name || 'AI Waverider Ltd',
        iban: process.env.SEPA_IBAN || sepaPayload.creditorInfo?.iban || 'DE89370400440532013000',
        bic: process.env.SEPA_BIC || sepaPayload.creditorInfo?.bic || 'DEUTDEFFXXX',
        bankName: process.env.SEPA_BANK_NAME || 'Example Bank',
        reference: transferReference
      },
      debtorInfo: {
        name: sepaPayload.debtorInfo.name,
        iban: sepaPayload.debtorInfo.iban,
        bic: sepaPayload.debtorInfo.bic
      },
      remittanceInfo: sepaPayload.paymentInfo.remittanceInfo,
      instructions: 'Please transfer the exact amount using the provided reference number.',
      stripePaymentIntent: stripePaymentData?.id,
      stripeClientSecret: stripePaymentData?.clientSecret,
      testMode: isTestMode
    };
    
    // Build the URL for the success page, including the payment ID and order ID
    const redirectUrl = sepaPayload.successUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id=${stripePaymentData?.id || transferReference}&order_id=${orderId}&status=pending&type=sepa_credit_transfer`;
    
    // Store transfer in database for reference
    try {
      const paymentDocData = {
        ...paymentData,
        createdAt: new Date().toISOString(),
        metadata: {
          ...sepaPayload.metadata,
          orderId,
          items: Array.isArray(sepaPayload.metadata?.items) 
            ? sepaPayload.metadata.items 
            : []
        },
        customerEmail: userEmail || null,
        customerName: sepaPayload.debtorInfo.name || null,
        userId: sepaPayload.metadata?.userId || null
      };
      
      await db.collection('payments').doc(stripePaymentData?.id || transferReference).set(paymentDocData);
      
      // If we have simulation mode enabled, process the order now
      if (isTestMode) {
        try {
          // For order processing, get email for authenticated users from their profile
          let customerEmail = userEmail;
          
          // If user is authenticated, get their email from database
          if (isAuthenticated && sepaPayload.metadata?.userId) {
            try {
              customerEmail = await getUserEmailById(sepaPayload.metadata.userId);
              console.log(`Retrieved email ${customerEmail} for authenticated user ${sepaPayload.metadata.userId}`);
            } catch (userError) {
              console.error(`Error retrieving user email: ${userError.message}`);
              // Use email from payload as fallback if authenticated user lookup fails
              customerEmail = userEmail || sepaPayload.metadata?.userEmail || null;
              console.log(`Using fallback email from payload: ${customerEmail}`);
            }
          } else if (!customerEmail) {
            // For non-authenticated users, try to get email from metadata if not already set
            customerEmail = sepaPayload.metadata?.userEmail || null;
            console.log(`Using non-authenticated user email from metadata: ${customerEmail}`);
          }
          
          // Process the simulated payment
          const orderResult = await orderController.processPaymentSuccess({
            id: stripePaymentData?.id || transferReference,
            amount: parseFloat(sepaPayload.paymentInfo.amount) * 100, // Convert to cents for consistency
            currency: sepaPayload.paymentInfo.currency.toLowerCase(),
            payment_method_types: ['sepa_credit_transfer'],
            metadata: {
              ...sepaPayload.metadata,
              order_id: orderId,
              email: customerEmail || null, // Include email in metadata for order processing
              immediate_delivery: true // Flag for immediate template delivery
            },
            customer: {
              id: sepaPayload.metadata?.userId || null,
              email: customerEmail || null
            },
            items: sepaPayload.metadata.items
          });
          
          // Add the order result to the response
          paymentData.orderProcessed = true;
          paymentData.orderId = orderResult.orderId;
          paymentData.emailStatus = 'unknown';
          
          // Add immediate download URLs for templates if available
          if (orderResult.templates && orderResult.templates.length > 0) {
            paymentData.templates = orderResult.templates.map(template => ({
              agentId: template.agentId,
              agentName: template.agentName,
              downloadUrl: template.downloadUrl || `/api/templates/download/${template.agentId}?orderId=${orderResult.orderId}&token=${template.accessToken || ''}`
            }));
            
            // Add a direct download URL for the first template (common case)
            if (orderResult.templates[0]) {
              paymentData.directDownloadUrl = orderResult.templates[0].downloadUrl || 
                `/api/templates/download/${orderResult.templates[0].agentId}?orderId=${orderResult.orderId}&token=${orderResult.templates[0].accessToken || ''}`;
            }

            logger.info(`SEPA payment - ${orderResult.templates.length} template(s) prepared for immediate download`);
            console.log(`Templates prepared for order ${orderResult.orderId}`);
          } else {
            logger.warn(`SEPA payment - No templates available for immediate download for order ${orderResult.orderId}`);
          }

          // Detailed logging for email delivery status
          if (orderResult.deliveryStatus === 'skipped') {
            console.log('Agent purchase email was skipped due to missing email address');
            logger.warn(`SEPA payment - Email sending skipped - no valid email address for order ${orderResult.orderId}`);
            paymentData.emailStatus = 'skipped';
            paymentData.emailMessage = 'No valid email address provided';
          } else if (orderResult.deliveryStatus === 'completed') {
            console.log(`Agent purchase email delivery completed successfully for order ${orderResult.orderId}`);
            logger.info(`SEPA payment - Email sent successfully to ${customerEmail} for order ${orderResult.orderId}`);
            paymentData.emailStatus = 'sent';
            paymentData.emailMessage = `Confirmation email sent to ${customerEmail}`;
          } else if (orderResult.deliveryStatus === 'partial') {
            console.log(`Agent purchase email delivery partially completed for order ${orderResult.orderId}`);
            logger.warn(`SEPA payment - Email partially sent for order ${orderResult.orderId} - some items failed`);
            paymentData.emailStatus = 'partial';
            paymentData.emailMessage = 'Email delivery partially completed';
          } else if (orderResult.deliveryStatus === 'failed') {
            // This is a serious issue that should be logged with high visibility
            console.error(`Agent purchase email delivery failed for order ${orderResult.orderId}`);
            logger.error(`SEPA payment - Email sending FAILED for order ${orderResult.orderId} to ${customerEmail}`);
            
            // Add detailed failure information
            const failureReasons = orderResult.deliveryResults
              ?.filter(r => !r.success)
              ?.map(r => r.error || 'Unknown error')
              ?.join('; ');
            
            logger.error(`Email failure reasons: ${failureReasons || 'No specific reason provided'}`);
            
            paymentData.emailStatus = 'failed';
            paymentData.emailMessage = 'Failed to send confirmation email';
            paymentData.emailError = failureReasons || 'Email delivery failed';
          } else {
            console.log(`Agent purchase email delivery status: ${orderResult.deliveryStatus}`);
            logger.info(`SEPA payment - Email status: ${orderResult.deliveryStatus} for order ${orderResult.orderId}`);
            paymentData.emailStatus = orderResult.deliveryStatus;
          }
        } catch (orderError) {
          logger.error(`Error processing simulated SEPA order: ${orderError.message}`);
          // Don't fail the response, just note the error
          paymentData.orderProcessed = false;
          paymentData.orderError = orderError.message;
        }
      }
    } catch (dbError) {
      logger.error(`Error storing SEPA payment in database: ${dbError.message}`);
      // Continue anyway as this is not critical for the user flow
    }
    
    logPayment('SEPA', 'CREDIT_TRANSFER_INITIATED', paymentData);
    
    return res.status(200).json({
      success: true,
      payment: paymentData,
      redirectUrl
    });
  } catch (error) {
    console.error('SEPA Credit Transfer processing error:', error);
    if (logger) logger.error(`SEPA Credit Transfer error: ${error.message}`);
    
    // Return detailed error information
    return res.status(500).json({
      success: false,
      error: error.message || 'Payment processing failed',
      details: error.code ? {
        code: error.code,
        type: error.type
      } : undefined
    });
  }
});

/**
 * Helper function to get a user's email by their ID
 * @param {string} userId - The user ID
 * @returns {Promise<string|null>} - The user's email or null if not found
 */
async function getUserEmailById(userId) {
  if (!userId) return null;
  
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`User ${userId} not found`);
      return null;
    }
    
    const userData = userDoc.data();
    return userData.email || null;
  } catch (error) {
    console.error(`Error getting user email: ${error.message}`);
    return null;
  }
}

/**
 * Check SEPA Credit Transfer status
 * @route GET /api/payments/sepa-credit-transfer/:id
 */
router.get('/sepa-credit-transfer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }
    
    console.log(`Checking SEPA Credit Transfer status for ${id}`);
    if (logger) logger.info(`Checking SEPA Credit Transfer status for ${id}`);
    
    let payment;
    try {
      const paymentDoc = await db.collection('payments').doc(id).get();
      
      if (!paymentDoc.exists) {
        return res.status(404).json({ 
          success: false,
          error: 'Payment not found'
        });
      }
      
      payment = paymentDoc.data();
    } catch (dbError) {
      logger.error(`Error retrieving SEPA payment from database: ${dbError.message}`);
      return res.status(500).json({ 
        success: false,
        error: 'Error retrieving payment details',
        details: dbError.message
      });
    }
    
    // Determine payment status based on Stripe or simulation
    let status = payment.status;
    let paymentDetails = {};
    
    // Check if this payment has a Stripe Payment Intent ID
    if (payment.stripePaymentIntent || id.startsWith('pi_')) {
      try {
        // This is a Stripe-based payment, get real-time status from Stripe
        const paymentIntentId = payment.stripePaymentIntent || id;
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        // Map Stripe payment status to our status format
        switch (paymentIntent.status) {
          case 'succeeded':
            status = 'completed';
            break;
          case 'processing':
            status = 'processing';
            break;
          case 'requires_payment_method':
          case 'requires_confirmation':
          case 'requires_action':
            status = 'pending';
            break;
          case 'canceled':
            status = 'cancelled';
            break;
          default:
            status = paymentIntent.status; // Use Stripe's status directly
        }
        
        // Add Stripe payment details for the frontend
        paymentDetails = {
          stripeStatus: paymentIntent.status,
          lastUpdated: new Date(paymentIntent.created * 1000).toISOString(),
          paymentMethodDetails: paymentIntent.payment_method_details
        };
        
        // Update the status in our database if it has changed
        if (status !== payment.status) {
          try {
            await db.collection('payments').doc(id).update({
              status,
              updatedAt: new Date().toISOString(),
              stripeStatus: paymentIntent.status
            });
            
            // Update our local payment object too
            payment.status = status;
            logger.info(`Updated SEPA payment status from Stripe: ${id} => ${status}`);
          } catch (updateError) {
            logger.error(`Error updating SEPA payment status: ${updateError.message}`);
            // Continue anyway since we're returning the current status
          }
        }
      } catch (stripeError) {
        logger.error(`Error retrieving Stripe payment: ${stripeError.message}`);
        // Fall back to current stored status if Stripe API fails
        console.log(`Falling back to stored payment status: ${payment.status}`);
      }
    } else if (payment.testMode || payment.simulationMode) {
      // If in simulation mode, transition the status based on creation time
      const createdAt = new Date(payment.createdAt);
      const now = new Date();
      const minutesElapsed = (now - createdAt) / (1000 * 60);
      
      // Simulate status progression
      if (minutesElapsed > 30) {
        status = 'completed';
      } else if (minutesElapsed > 5) {
        status = 'processing';
      } else {
        status = 'pending';
      }
      
      // Update status in database if it has changed
      if (status !== payment.status) {
        try {
          await db.collection('payments').doc(id).update({
            status,
            updatedAt: new Date().toISOString()
          });
          payment.status = status;
        } catch (updateError) {
          logger.error(`Error updating SEPA payment status: ${updateError.message}`);
          // Continue anyway
        }
      }
    }
    
    return res.status(200).json({
      success: true,
      id,
      status,
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      bankDetails: payment.bankDetails,
      testMode: payment.testMode || payment.simulationMode,
      createdAt: payment.createdAt,
      ...paymentDetails,
      // Include additional details from our payment record
      orderId: payment.orderId,
      // Include template download links if they exist
      templates: payment.templates || [],
      directDownloadUrl: payment.directDownloadUrl
    });
  } catch (error) {
    console.error(`Error checking SEPA Credit Transfer status: ${error.message}`, error);
    if (logger) logger.error(`Error checking SEPA Credit Transfer status: ${error.message}`);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to check payment status',
      details: error.message
    });
  }
});

/**
 * Check the status of a card payment
 * @route GET /api/payments/payment-status/:id
 */
router.get('/payment-status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'payment_intent' } = req.query;
    
    logger.info('Checking payment status', { id, type });
    console.log('Checking payment status:', { id, type });
    
    if (!id) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }
    
    let status = 'unknown';
    let paymentData = null;
    
    // Find payment record in database first (for faster response)
    try {
      if (db && db.collection) {
        const doc = await db.collection('payments').doc(id).get();
        if (doc.exists) {
          paymentData = doc.data();
          status = paymentData.status;
        }
      }
    } catch (dbError) {
      logger.error('Error retrieving payment from database', dbError);
      // Continue to check with Stripe if database lookup fails
    }
    
    // If not found in database or type is explicitly payment_intent, check with Stripe
    if (!paymentData || type === 'payment_intent') {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(id);
        status = paymentIntent.status;
        
        // Update database record if needed
        if (db && db.collection && status !== paymentData?.status) {
          await db.collection('payments').doc(id).update({
            status,
            lastUpdated: new Date().toISOString()
          });
        }
        
        paymentData = {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
          metadata: paymentIntent.metadata,
          lastUpdated: new Date().toISOString()
        };
      } catch (stripeError) {
        // If not found in Stripe, try other payment processors or return unknown
        logger.error('Error retrieving payment from Stripe', stripeError);
        
        if (!paymentData) {
          return res.status(404).json({ error: 'Payment not found' });
        }
      }
    }
    
    return res.json({
      id,
      status,
      paymentData
    });
  } catch (error) {
    logger.error('Error checking payment status:', error);
    console.error('Error checking payment status:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router; 