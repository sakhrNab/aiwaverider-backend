/**
 * UniPay Service - Core API Integration (Updated for Official API v3)
 * 
 * Handles all UniPay API calls for Georgian payment processing
 */

const axios = require('axios');
const logger = require('../../utils/logger');

class UniPayService {
  constructor() {
    // Environment configuration
    this.isProduction = process.env.NODE_ENV === 'production' && process.env.UNIPAY_ENVIRONMENT === 'production';
    
    // Credentials based on environment
    this.merchantId = this.isProduction 
      ? process.env.UNIPAY_MERCHANT_ID
      : process.env.UNIPAY_TEST_MERCHANT_ID;
    
    this.apiKey = this.isProduction 
      ? process.env.UNIPAY_API_KEY 
      : process.env.UNIPAY_TEST_API_KEY;
    
    // API base URL
    this.baseURL = 'https://apiv2.unipay.com/v3';
    
    // Access token management
    this.accessToken = null;
    this.tokenExpiresAt = null;
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AI-Waverider/1.0'
      },
      timeout: 30000
    });

    // Request interceptor for logging and auth
    this.client.interceptors.request.use(
      async config => {
        // Add bearer token to requests (except auth endpoint)
        if (!config.url.includes('/auth') && !config.url.includes('/auth/logout')) {
          await this.ensureAuthenticated();
          if (this.accessToken) {
            config.headers.Authorization = `Bearer ${this.accessToken}`;
          }
        }
        
        logger.info(`UniPay API Request: ${config.method?.toUpperCase()} ${config.url}`, {
          data: this.sanitizeLogData(config.data)
        });
        return config;
      },
      error => {
        logger.error('UniPay API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      response => {
        logger.info(`UniPay API Response: ${response.status}`, {
          data: this.sanitizeLogData(response.data)
        });
        return response;
      },
      error => {
        logger.error(`UniPay API Error: ${error.response?.status}`, {
          data: error.response?.data,
          message: error.message
        });
        return Promise.reject(error);
      }
    );

    logger.info(`UniPay Service initialized in ${this.isProduction ? 'PRODUCTION' : 'TEST'} mode`);
  }

  /**
   * Authenticate with UniPay API
   */
  async authenticate() {
    try {
      if (!this.merchantId || !this.apiKey) {
        throw new Error('UniPay credentials not configured');
      }

      const response = await this.client.post('/auth', {
        merchant_id: this.merchantId,
        api_key: this.apiKey
      });

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        // Set expiration time (assuming 1 hour, adjust based on actual API behavior)
        this.tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000); // 55 minutes
        
        logger.info('UniPay authentication successful');
        return {
          success: true,
          accessToken: this.accessToken
        };
      } else {
        throw new Error('Invalid authentication response');
      }
    } catch (error) {
      logger.error('UniPay authentication failed:', error);
      this.accessToken = null;
      this.tokenExpiresAt = null;
      throw new Error(`Authentication failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Ensure we have a valid access token
   */
  async ensureAuthenticated() {
    if (!this.accessToken || (this.tokenExpiresAt && new Date() >= this.tokenExpiresAt)) {
      await this.authenticate();
    }
  }

  /**
   * Logout from UniPay API
   */
  async logout() {
    try {
      if (this.accessToken) {
        await this.client.post('/auth/logout');
      }
    } catch (error) {
      logger.error('Error during logout:', error);
    } finally {
      this.accessToken = null;
      this.tokenExpiresAt = null;
    }
  }

  /**
   * Sanitize sensitive data for logging
   */
  sanitizeLogData(data) {
    if (!data) return data;
    
    const sanitized = { ...data };
    
    // Remove sensitive fields
    const sensitiveFields = ['api_key', 'access_token', 'merchant_id'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    });

    return sanitized;
  }

  /**
   * Calculate VAT for EU countries
   */
  calculateVAT(netAmount, countryCode) {
    const euCountries = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
    ];

    if (!euCountries.includes(countryCode)) {
      return { vatAmount: 0, grossAmount: netAmount, vatRate: 0 };
    }

    // Default VAT rates by country
    const vatRates = {
      'DE': 0.19, 'FR': 0.20, 'IT': 0.22, 'ES': 0.21, 'NL': 0.21,
      'BE': 0.21, 'AT': 0.20, 'SE': 0.25, 'DK': 0.25, 'FI': 0.24,
      'PL': 0.23, 'CZ': 0.21, 'HU': 0.27, 'SK': 0.20, 'SI': 0.22,
      'EE': 0.20, 'LV': 0.21, 'LT': 0.21, 'IE': 0.23, 'LU': 0.17,
      'MT': 0.18, 'CY': 0.19, 'BG': 0.20, 'RO': 0.19, 'HR': 0.25,
      'PT': 0.23, 'GR': 0.24
    };

    const vatRate = vatRates[countryCode] || 0.20; // Default 20%
    const vatAmount = netAmount * vatRate;
    const grossAmount = netAmount + vatAmount;

    return { vatAmount, grossAmount, vatRate };
  }

  /**
   * Generate unique merchant order ID
   */
  generateMerchantOrderId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORDER-${timestamp}-${random}`;
  }

  /**
   * Encode URL for UniPay (base64)
   */
  encodeUrl(url) {
    return Buffer.from(url).toString('base64');
  }

  /**
   * Convert currency (basic implementation - implement proper conversion as needed)
   */
  async convertCurrencyToGEL(amount, fromCurrency) {
    // Basic conversion rates - implement real-time conversion as needed
    const conversionRates = {
      'USD': 2.65,
      'EUR': 2.90,
      'GBP': 3.35,
      'GEL': 1.00
    };

    const rate = conversionRates[fromCurrency] || 1;
    const convertedAmount = amount * rate;

    return {
      originalAmount: amount,
      originalCurrency: fromCurrency,
      convertedAmount: convertedAmount,
      currency: 'GEL',
      conversionRate: rate
    };
  }

  /**
   * Create payment session (Updated for Official API)
   */
  async createPaymentSession(orderData) {
    try {
      const { amount, currency, orderId, items = [], customerInfo = {}, metadata = {} } = orderData;

      // Generate merchant order ID
      const merchantOrderId = this.generateMerchantOrderId();
      
      // Calculate VAT if customer is in EU
      let finalAmount = amount;
      let vatInfo = {};
      
      if (customerInfo.country) {
        vatInfo = this.calculateVAT(amount, customerInfo.country);
        finalAmount = vatInfo.grossAmount;
      }

      // Convert to GEL (UniPay's primary currency)
      const conversionInfo = await this.convertCurrencyToGEL(finalAmount, currency || 'USD');

      // Prepare order name and description
      const orderName = items.length > 0 ? items[0].title || items[0].name || 'Purchase' : 'AI Agent Purchase';
      const orderDescription = items.map(item => item.title || item.name).join(', ') || 'AI Agent Template Purchase';

      // Prepare URLs (base64 encoded as required by UniPay)
      const successUrl = this.encodeUrl(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/success?payment_id=${orderId}&status=success&type=unipay`);
      const cancelUrl = this.encodeUrl(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout?canceled=true`);
      const callbackUrl = this.encodeUrl(`${process.env.API_URL || 'http://localhost:4000'}/api/payments/unipay/webhook`);

      const payload = {
        MerchantUser: customerInfo.email || 'customer@example.com',
        MerchantOrderID: merchantOrderId,
        OrderPrice: conversionInfo.convertedAmount,
        OrderCurrency: 'GEL',
        OrderName: orderName,
        OrderDescription: orderDescription,
        SuccessRedirectUrl: successUrl,
        CancelRedirectUrl: cancelUrl,
        CallBackUrl: callbackUrl,
        InApp: 0, // Set to 1 for mobile apps
        Language: 'EN' // or 'GE' for Georgian
      };

      const response = await this.client.post('/api/order/create', payload);
      
      if (response.data && response.data.OrderHashID) {
        const result = {
          success: true,
          orderHashId: response.data.OrderHashID,
          merchantOrderId: merchantOrderId,
          amount: conversionInfo.convertedAmount,
          originalAmount: amount,
          originalCurrency: currency,
          currency: 'GEL',
          paymentUrl: response.data.PaymentUrl || null,
          vatInfo,
          conversionInfo,
          ...response.data
        };

        logger.info(`Created UniPay order: ${response.data.OrderHashID}`, {
          merchantOrderId,
          amount: conversionInfo.convertedAmount,
          currency: 'GEL',
          vatInfo
        });

        return result;
      } else {
        throw new Error('Invalid order creation response');
      }
    } catch (error) {
      logger.error('Error creating UniPay order:', error);
      throw new Error(`Failed to create payment session: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get payment methods (UniPay doesn't have separate methods endpoint, return default)
   */
  async getPaymentMethods(orderHashId) {
    try {
      // UniPay handles payment methods internally, return standard Georgian methods
      const methods = [
        {
          type: 'card',
          name: 'Credit/Debit Card',
          description: 'Visa, Mastercard, and other cards',
          available: true
        },
        {
          type: 'bank_transfer',
          name: 'Bank Transfer',
          description: 'Direct bank transfer',
          available: true
        }
      ];

      return {
        success: true,
        orderHashId,
        methods
      };
    } catch (error) {
      logger.error(`Error getting payment methods for order ${orderHashId}:`, error);
      throw new Error(`Failed to get payment methods: ${error.message}`);
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(orderHashId) {
    try {
      // UniPay doesn't have a direct status endpoint in the docs provided
      // Status is typically handled via webhooks
      // For now, return basic info from our database
      logger.info(`Status check requested for order: ${orderHashId}`);
      
      return {
        success: true,
        orderHashId,
        message: 'Status updates are handled via webhooks'
      };
    } catch (error) {
      logger.error(`Error getting payment status for order ${orderHashId}:`, error);
      throw new Error(`Failed to get payment status: ${error.message}`);
    }
  }

  /**
   * Confirm preauth order
   */
  async confirmOrder(orderHashId, amount = 0) {
    try {
      const payload = {
        OrderHashID: orderHashId,
        Amount: amount
      };

      const response = await this.client.post('/api/order/confirm', payload);
      
      logger.info(`Confirmed UniPay order: ${orderHashId}`, {
        amount
      });

      return {
        success: true,
        orderHashId,
        ...response.data
      };
    } catch (error) {
      logger.error(`Error confirming UniPay order ${orderHashId}:`, error);
      throw new Error(`Order confirmation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create refund
   */
  async createRefund(orderHashId, amount, reason = null) {
    try {
      const payload = {
        OrderHashID: orderHashId,
        Amount: amount.toString(),
        Reason: reason || 'Customer request',
        Note: ''
      };

      const response = await this.client.post('/api/order/refund', payload);
      
      logger.info(`Created refund for order: ${orderHashId}`, {
        amount,
        reason
      });

      return {
        success: true,
        orderHashId,
        refundAmount: amount,
        ...response.data
      };
    } catch (error) {
      logger.error(`Error creating refund for order ${orderHashId}:`, error);
      throw new Error(`Refund failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get card details (for regular payments)
   */
  async getCardDetails(regularPaymentId) {
    try {
      const payload = {
        RegularpaymentID: regularPaymentId
      };

      const response = await this.client.post('/card/get-details', payload);
      
      return {
        success: true,
        cardDetails: response.data
      };
    } catch (error) {
      logger.error(`Error getting card details for ${regularPaymentId}:`, error);
      throw new Error(`Failed to get card details: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get error list
   */
  async getErrorList() {
    try {
      const response = await this.client.get('/info/error-list');
      
      return {
        success: true,
        errors: response.data
      };
    } catch (error) {
      logger.error('Error getting error list:', error);
      throw new Error(`Failed to get error list: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get status list
   */
  async getStatusList() {
    try {
      const response = await this.client.get('/info/status-list');
      
      return {
        success: true,
        statuses: response.data
      };
    } catch (error) {
      logger.error('Error getting status list:', error);
      throw new Error(`Failed to get status list: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Verify webhook signature (placeholder - implement based on UniPay webhook docs)
   */
  verifyWebhookSignature(payload, signature) {
    // UniPay webhook signature verification would go here
    // Implementation depends on how UniPay signs webhooks
    logger.info('Webhook signature verification - implement based on UniPay docs');
    return true; // For now, accept all webhooks
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      // Test authentication
      await this.ensureAuthenticated();
      
      return {
        success: true,
        environment: this.isProduction ? 'production' : 'test',
        authenticated: !!this.accessToken,
        merchantId: this.merchantId ? this.merchantId.substring(0, 4) + '***' : null
      };
    } catch (error) {
      logger.error('UniPay health check failed:', error);
      return {
        success: false,
        environment: this.isProduction ? 'production' : 'test',
        authenticated: false,
        error: error.message
      };
    }
  }
}

module.exports = new UniPayService();