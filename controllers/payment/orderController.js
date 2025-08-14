/**
 * Updated Order Controller - Enhanced for UniPay v3 Integration
 * 
 * Handles order processing, template delivery, and invoice creation
 * for the corrected UniPay payment system and other providers
 */

const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../../services/email/emailService');
const configEmail = require('../../config/email');
const invoiceService = require('../../services/invoice/invoiceService');
const logger = require('../../utils/logger');
const { deleteCache } = require('../../utils/cache');

// Initialize Firestore
const db = admin.firestore();

class OrderController {
  constructor() {
    this.supportedProcessors = ['paypal', 'google_direct'];
  }

  /**
   * Get agent template content
   * @param {string} agentId - The agent ID
   * @returns {Promise<Object>} - The template content as an object with all agent data
   */
  async getAgentTemplate(agentId) {
    try {
      // Get agent from database
      const agentDoc = await db.collection('agents').doc(agentId).get();
      
      if (!agentDoc.exists) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      
      const agent = agentDoc.data();
      
      // Prepare a full agent template object
      const templateObject = {
        id: agentId,
        name: agent.title || agent.name || 'AI Agent',
        description: agent.description || 'No description available',
        version: "1.0",
        created: new Date().toISOString(),
        type: "agent_template",
        category: agent.category || "AI Agent",
        tags: agent.tags || [],
        // Include all agent properties, removing any that are undefined
        ...Object.fromEntries(
          Object.entries(agent).filter(([_, value]) => value !== undefined)
        ),
      };
      
      // If agent has a template field, use that as the template content
      if (agent.template) {
        // If template is already JSON, parse it and include it
        if (typeof agent.template === 'string' && agent.template.trim().startsWith('{')) {
          try {
            const parsedTemplate = JSON.parse(agent.template);
            templateObject.templateContent = parsedTemplate;
          } catch (e) {
            // If parsing fails, use it as is
            templateObject.templateContent = agent.template;
          }
        } else {
          // Use the template string directly
          templateObject.templateContent = agent.template;
        }
      } else if (agent.templateUrl) {
        // Include the template URL if available
        templateObject.templateUrl = agent.templateUrl;
      } else {
        // Generate a basic template only as last resort
        templateObject.templateContent = this.generateBasicTemplate(agent);
        templateObject.isGenerated = true;
      }
      
      return JSON.stringify(templateObject, null, 2);
    } catch (error) {
      logger.error(`Error getting agent template: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a basic template based on agent information
   * @param {Object} agent - The agent data
   * @returns {string} - A basic template
   */
  generateBasicTemplate(agent) {
    return `
# ${agent.title} - AI Agent Template

## Description
${agent.description || 'An AI agent to assist with your tasks.'}

## Instructions
1. Copy the entire content below this line into your favorite AI platform
2. Modify any details specific to your needs
3. Enjoy using your new AI agent!

---

You are ${agent.title}, an AI agent designed to ${agent.description || 'assist users with various tasks'}.

${agent.features ? 'Your key features include:\n' + agent.features.map(f => `- ${f}`).join('\n') : ''}

When a user interacts with you, provide helpful, accurate, and concise responses. 
Be friendly and professional in your tone.

You can help users with:
- Understanding concepts related to ${agent.category || 'AI and technology'}
- Providing information and answering questions
- Assisting with tasks and problem-solving

Remember to be respectful, maintain user privacy, and clarify when you're uncertain about something.
`;
  }

  /**
   * Create a new order record
   * @param {Object} orderData - The order data
   * @returns {Promise<Object>} - The created order
   */
  async createOrder(orderData) {
    try {
      // Generate order ID if not provided
      const orderId = orderData.orderId || uuidv4();
      
      // Create order object
      const order = {
        id: orderId,
        userId: orderData.userId,
        userEmail: orderData.userEmail,
        items: orderData.items || [],
        total: orderData.total || 0,
        currency: orderData.currency || 'USD',
        status: orderData.status || 'pending',
        paymentId: orderData.paymentId,
        paymentMethod: orderData.paymentMethod,
        paymentProcessor: orderData.processor || 'unipay',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deliveryStatus: 'pending',
        metadata: orderData.metadata || {},
        // Enhanced fields for new system
        vatInfo: orderData.vatInfo || null,
        invoiceId: null, // Will be set when invoice is created
        templateAccessTokens: [],
        
        // UniPay specific fields (NEW)
        uniPayOrderHashId: orderData.uniPayOrderHashId || null,
        merchantOrderId: orderData.merchantOrderId || null,
        conversionInfo: orderData.conversionInfo || null
      };
      
      // Save order to database
      await db.collection('orders').doc(orderId).set(order);
      
      logger.info(`Created order: ${orderId}`, {
        processor: order.paymentProcessor,
        amount: order.total,
        currency: order.currency,
        itemCount: order.items.length,
        uniPayOrderHashId: order.uniPayOrderHashId
      });
      
      return { ...order };
    } catch (error) {
      logger.error(`Error creating order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process payment success and deliver templates
   * @param {Object} paymentData - Payment data from the payment provider
   * @returns {Promise<Object>} - Processing result
   */
  async processPaymentSuccess(paymentData) {
    try {
      // Extract metadata from payment
      const metadata = paymentData.metadata || {};
      const items = Array.isArray(paymentData.items) ? paymentData.items : [];
      const processor = paymentData.processor || 'unipay';
      
      // Get customer info - prioritize customer email, then metadata email
      const email = paymentData.customer?.email || metadata.email || null;
      
      // Enhanced email validation and logging
      if (email && this.isValidEmail(email)) {
        logger.info(`Processing order with email: ${email} (processor: ${processor})`);
      } else if (email) {
        logger.warn(`Invalid email format provided: ${email} (processor: ${processor})`);
      } else {
        logger.warn(`No email address available for order confirmation (processor: ${processor})`);
      }
      
      const userId = paymentData.customer?.id || metadata.userId || null;
      
      // Determine payment characteristics
      const paymentInfo = this.analyzePaymentMethod(paymentData, processor);
      
      // Extract order details with UniPay specific handling
      const orderData = {
        orderId: metadata.order_id || uuidv4(),
        userId: userId,
        userEmail: email,
        items: items,
        total: paymentData.amount / 100, // Convert from cents
        currency: paymentData.currency?.toUpperCase() || 'USD',
        status: 'completed',
        paymentId: paymentData.id,
        paymentMethod: paymentInfo.method,
        processor: processor,
        metadata: {
          ...metadata,
          processor,
          originalPaymentData: {
            id: paymentData.id,
            session_id: paymentData.session_id || null,
            transaction_id: paymentData.transaction_id || null,
            order_hash_id: metadata.order_hash_id || null // UniPay specific
          }
        },
        vatInfo: paymentData.vatInfo || null,
        
        // UniPay specific fields (NEW)
        uniPayOrderHashId: metadata.order_hash_id || paymentData.orderHashId || null,
        merchantOrderId: metadata.merchant_order_id || paymentData.merchantOrderId || null,
        conversionInfo: paymentData.conversionInfo || null
      };
      
      // Create order record
      const order = await this.createOrder(orderData);

      // Persist purchases on user profile (entitlement) if we have a userId
      if (userId && items.length > 0) {
        try {
          const userRef = db.collection('users').doc(userId);
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.exists ? snap.data() : {};
            const purchases = Array.isArray(data.purchases) ? [...data.purchases] : [];
            const existingAgentIds = new Set(
              purchases.map((p) => (p.agentId || p.productId)).filter(Boolean)
            );
            const nowIso = new Date().toISOString();
            for (const item of items) {
              const agentId = item.id || item.agentId || item.productId;
              if (!agentId) continue;
              if (existingAgentIds.has(agentId)) continue;
              purchases.push({
                agentId,
                productId: agentId,
                orderId: order.id,
                price: item.price || (order.total || 0),
                currency: order.currency,
                processor: processor,
                paymentId: order.paymentId,
                purchasedAt: nowIso
              });
              existingAgentIds.add(agentId);
            }
            tx.set(userRef, { purchases }, { merge: true });
          });
          // Invalidate entitlement cache so UI reflects purchase immediately
          try { await deleteCache(`user:${userId}:entitlements`); } catch (e) { logger.warn('Failed to invalidate entitlement cache after purchase:', e.message); }
          logger.info(`Recorded purchases for user ${userId} on order ${order.id}`);
        } catch (purchaseErr) {
          logger.error('Failed to record purchases on user profile:', purchaseErr);
        }
      }

      // Create invoice immediately for all successful payments
      let invoice = null;
      try {
        invoice = await invoiceService.createInvoice(
          {
            ...paymentData,
            processor,
            paymentMethod: paymentInfo.method
          },
          orderData,
          this.extractCustomerInfo(paymentData, metadata)
        );
        
        // Update order with invoice ID
        await db.collection('orders').doc(order.id).update({
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          updatedAt: new Date().toISOString()
        });
        
        logger.info(`Invoice created for order: ${order.id}`, {
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          processor
        });
      } catch (invoiceError) {
        logger.error(`Failed to create invoice for order ${order.id}:`, invoiceError);
        // Continue processing even if invoice creation fails
      }
      
      // Generate download links for templates (immediate delivery for most payment methods)
      const templates = [];
      const shouldDeliverImmediately = paymentInfo.immediateDelivery;
      
      if (shouldDeliverImmediately) {
        logger.info(`Preparing templates for immediate delivery for order ${order.id}`);
        
        // Process each item to create template access
        for (const item of items) {
          try {
            const templateResult = await this.createTemplateAccess(item, order, email, userId);
            if (templateResult) {
              templates.push(templateResult);
            }
          } catch (templateError) {
            logger.error(`Error preparing template for agent ${item.id}: ${templateError.message}`);
          }
        }
      }
      
      // Handle email delivery
      const deliveryResult = await this.handleEmailDelivery(
        order, 
        templates, 
        email, 
        userId, 
        paymentInfo,
        metadata
      );
      
      // Update order with final delivery status
      await db.collection('orders').doc(order.id).update({
        deliveryStatus: deliveryResult.status,
        deliveryResults: deliveryResult.results || [],
        templateAccessTokens: templates.map(t => t.accessToken),
        updatedAt: new Date().toISOString()
      });
      
      const result = {
        success: true,
        orderId: order.id,
        invoiceId: invoice?.invoiceId || null,
        deliveryStatus: deliveryResult.status,
        deliveryResults: deliveryResult.results || [],
        templates: shouldDeliverImmediately ? templates : [],
        paymentProcessor: processor,
        paymentMethod: paymentInfo.method,
        // UniPay specific fields
        uniPayOrderHashId: order.uniPayOrderHashId,
        merchantOrderId: order.merchantOrderId
      };
      
      logger.info(`Order processing completed: ${order.id}`, {
        deliveryStatus: result.deliveryStatus,
        templateCount: templates.length,
        processor,
        invoiceCreated: !!invoice,
        uniPayOrderHashId: order.uniPayOrderHashId
      });
      
      return result;
    } catch (error) {
      logger.error(`Error processing payment success: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Analyze payment method and determine characteristics (Updated for UniPay)
   */
  analyzePaymentMethod(paymentData, processor) {
    const paymentTypes = paymentData.payment_method_types || [];
    const metadata = paymentData.metadata || {};
    
    // Determine method name
    let method = 'unknown';
    
    // UniPay handling (NEW)
    if (metadata.payment_method === 'paypal' || processor === 'paypal' || paymentTypes.includes('paypal')) {
      method = 'paypal';
    } else if (metadata.payment_method === 'google_direct' || processor === 'google_direct' || paymentTypes.includes('google_direct')) {
      method = 'google_direct';
    }
    
    // Determine if immediate delivery should happen
    const immediateDelivery = true;
    
    return {
      method,
      immediateDelivery,
      processor,
      isAsynchronous: false
    };
  }

  /**
   * Create template access for an item
   */
  async createTemplateAccess(item, order, email, userId) {
    try {
      const agentId = item.id;
      
      // Get template content
      const templateContent = await this.getAgentTemplate(agentId);
      
      // Get agent details
      let agentName = item.title || 'AI Agent';
      try {
        const agentDoc = await db.collection('agents').doc(agentId).get();
        if (agentDoc.exists) {
          const agent = agentDoc.data();
          agentName = agent.title || agent.name || agentName;
        }
      } catch (agentError) {
        logger.warn(`Couldn't fetch agent details for ${agentId}: ${agentError.message}`);
      }

      // Generate a secure token for template access
      const accessToken = uuidv4();
      
      // Store the template access token in the database
      await db.collection('templateAccess').doc(accessToken).set({
        orderId: order.id,
        agentId,
        userId,
        email,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days expiry
        used: false,
        invoiceId: order.invoiceId || null,
        // UniPay specific tracking
        uniPayOrderHashId: order.uniPayOrderHashId || null,
        merchantOrderId: order.merchantOrderId || null
      });
      
      const result = {
        agentId,
        agentName,
        accessToken,
        downloadUrl: `/api/templates/download/${agentId}?orderId=${order.id}&token=${accessToken}`,
        templateContent
      };
      
      logger.info(`Template access created for agent ${agentId} in order ${order.id}`, {
        uniPayOrderHashId: order.uniPayOrderHashId
      });
      return result;
    } catch (error) {
      logger.error(`Error creating template access for agent ${item.id}:`, error);
      return null;
    }
  }

  /**
   * Handle email delivery for order
   */
  async handleEmailDelivery(order, templates, email, userId, paymentInfo, metadata) {
    try {
      // Check if we should skip email sending
      const skipEmailSending = metadata.skipEmailSending === true;
      
      if (skipEmailSending) {
        logger.info(`Skipping email sending for order ${order.id} due to skipEmailSending flag`);
        return {
          status: 'skipped_by_flag',
          message: 'Email skipped due to skipEmailSending flag'
        };
      }
      
      // Skip if no valid email
      if (!email || !this.isValidEmail(email)) {
        logger.warn(`Cannot deliver templates: No valid email for order ${order.id}`);
        return {
          status: 'skipped',
          message: 'No valid email provided'
        };
      }
      
      // Deliver templates for each item
      const deliveryResults = [];
      
      for (const item of order.items) {
        try {
          const result = await this.deliverTemplateByEmail(
            item, 
            order, 
            templates, 
            email, 
            userId, 
            paymentInfo
          );
          
          deliveryResults.push({
            agentId: item.id,
            success: result.success,
            messageId: result.messageId || null,
            error: result.error || null
          });
        } catch (deliveryError) {
          logger.error(`Error delivering template for agent ${item.id}:`, deliveryError);
          
          deliveryResults.push({
            agentId: item.id,
            success: false,
            error: deliveryError.message
          });
        }
      }
      
      // Determine overall delivery status
      const deliveryStatus = deliveryResults.every(r => r.success) ? 'completed' : 
                            deliveryResults.some(r => r.success) ? 'partial' : 'failed';
      
      return {
        status: deliveryStatus,
        results: deliveryResults
      };
    } catch (error) {
      logger.error(`Error handling email delivery for order ${order.id}:`, error);
      return {
        status: 'failed',
        message: error.message
      };
    }
  }

  /**
   * Deliver template by email (Enhanced for UniPay)
   */
  async deliverTemplateByEmail(item, order, templates, email, userId, paymentInfo) {
    try {
      // Get agent details
      const agentId = item.id;
      const agentDoc = await db.collection('agents').doc(agentId).get();
      
      if (!agentDoc.exists) {
        throw new Error('Agent not found');
      }
      
      const agent = agentDoc.data();
      
      // Get template content
      const templateContent = await this.getAgentTemplate(agentId);
      
      // Get user's name if available
      let userName = 'Valued Customer';
      if (userId) {
        try {
          const userDoc = await db.collection('users').doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            userName = userData.displayName || userData.firstName || userData.name || 'Valued Customer';
          }
        } catch (userError) {
          logger.debug(`Could not fetch user data for ${userId}:`, userError.message);
        }
      }
      
      // Create receipt URL
      const receiptUrl = order.invoiceId 
        ? `/account/orders/${order.id}?invoice=${order.invoiceId}`
        : `/account/orders/${order.id}`;
      
      // Find template download link if available and make it absolute for emails
      const rawTemplateLink = templates.find(t => t.agentId === agentId)?.downloadUrl || '';
      const templateLink = rawTemplateLink 
        ? (rawTemplateLink.startsWith('http') 
            ? rawTemplateLink 
            : `${configEmail.websiteUrl}${rawTemplateLink.startsWith('/') ? '' : '/'}${rawTemplateLink}`)
        : '';
      
      // Enhanced email data for new system (Updated for UniPay)
      const emailData = {
        email: email,
        firstName: userName,
        agentName: agent.title || 'AI Agent',
        agentDescription: agent.description || 'Your new AI agent',
        price: item.price || 0,
        currency: order.currency || 'USD',
        receiptUrl: receiptUrl,
        orderId: order.id,
        orderDate: new Date().toLocaleDateString(),
        paymentMethod: paymentInfo.method,
        paymentProcessor: paymentInfo.processor,
        paymentStatus: 'successful',
        isSepaPayment: paymentInfo.method === 'sepa',
        immediateDownload: paymentInfo.immediateDelivery,
        downloadUrl: templateLink,
        templateContent: templateContent,
        agentId: agentId,
        // Enhanced fields
        invoiceNumber: order.invoiceNumber || null,
        vatInfo: order.vatInfo || null,
        // UniPay specific fields
        uniPayOrderHashId: order.uniPayOrderHashId || null,
        merchantOrderId: order.merchantOrderId || null,
        conversionInfo: order.conversionInfo || null
      };
      
      // Send email with template
      const emailResult = await emailService.sendAgentPurchaseEmail(emailData);
      
      logger.info(`Template delivery email sent for agent ${agentId} in order ${order.id}`, {
        email,
        messageId: emailResult.messageId,
        paymentProcessor: paymentInfo.processor,
        uniPayOrderHashId: order.uniPayOrderHashId
      });
      
      return {
        success: true,
        messageId: emailResult.messageId
      };
    } catch (error) {
      logger.error(`Error delivering template by email for agent ${item.id}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract customer information from payment data (Enhanced for UniPay)
   */
  extractCustomerInfo(paymentData, metadata) {
    return {
      userId: paymentData.customer?.id || metadata.userId || null,
      email: paymentData.customer?.email || metadata.email || null,
      name: paymentData.customer?.name || metadata.customerName || null,
      phone: paymentData.customer?.phone || metadata.customerPhone || null,
      country: metadata.customerCountry || metadata.country || null,
      address: metadata.customerAddress || null,
      city: metadata.customerCity || null,
      postalCode: metadata.customerPostalCode || null,
      // UniPay specific fields
      uniPayOrderHashId: metadata.order_hash_id || paymentData.orderHashId || null,
      merchantOrderId: metadata.merchant_order_id || paymentData.merchantOrderId || null
    };
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Get order by ID
   * @param {string} orderId - The order ID
   * @returns {Promise<Object>} - The order
   */
  async getOrderById(orderId) {
    try {
      const orderDoc = await db.collection('orders').doc(orderId).get();
      
      if (!orderDoc.exists) {
        throw new Error(`Order not found: ${orderId}`);
      }
      
      return orderDoc.data();
    } catch (error) {
      logger.error(`Error getting order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get orders for a user
   * @param {string} userId - The user ID
   * @returns {Promise<Array>} - Array of orders
   */
  async getUserOrders(userId) {
    try {
      const ordersSnapshot = await db.collection('orders')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();
      
      const orders = [];
      ordersSnapshot.forEach(doc => {
        orders.push(doc.data());
      });
      
      return orders;
    } catch (error) {
      logger.error(`Error getting user orders: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update order status
   */
  async updateOrderStatus(orderId, status, metadata = {}) {
    try {
      const updateData = {
        status,
        updatedAt: new Date().toISOString(),
        ...metadata
      };

      await db.collection('orders').doc(orderId).update(updateData);
      
      logger.info(`Updated order status: ${orderId} -> ${status}`);

      return {
        success: true,
        orderId,
        status
      };
    } catch (error) {
      logger.error(`Error updating order status for ${orderId}:`, error);
      throw error;
    }
  }

  /**
   * Process refund for order (Enhanced for UniPay)
   */
  async processOrderRefund(orderId, refundData) {
    try {
      const order = await this.getOrderById(orderId);
      
      // Update order status
      await this.updateOrderStatus(orderId, 'refunded', {
        refundId: refundData.refund_id,
        refundAmount: refundData.amount,
        refundedAt: new Date().toISOString(),
        refundReason: refundData.reason || null
      });

      // Update invoice if exists
      if (order.invoiceId) {
        await invoiceService.updateInvoiceStatus(order.invoiceId, 'refunded', {
          refundId: refundData.refund_id,
          refundedAt: new Date().toISOString()
        });
      }

      // Update UniPay order if exists (NEW)
      if (order.uniPayOrderHashId) {
        try {
          await db.collection('uniPayOrders').doc(order.uniPayOrderHashId).update({
            status: 'refunded',
            refundedAt: new Date().toISOString(),
            refundAmount: refundData.amount,
            refundReason: refundData.reason || null
          });
        } catch (uniPayError) {
          logger.error(`Error updating UniPay order ${order.uniPayOrderHashId} for refund:`, uniPayError);
        }
      }

      // Revoke template access tokens
      if (order.templateAccessTokens && order.templateAccessTokens.length > 0) {
        const batch = db.batch();
        
        for (const token of order.templateAccessTokens) {
          const tokenRef = db.collection('templateAccess').doc(token);
          batch.update(tokenRef, {
            revoked: true,
            revokedAt: new Date().toISOString(),
            revokedReason: 'order_refunded'
          });
        }
        
        await batch.commit();
      }

      logger.info(`Processed refund for order: ${orderId}`, {
        refundId: refundData.refund_id,
        amount: refundData.amount,
        uniPayOrderHashId: order.uniPayOrderHashId
      });

      return {
        success: true,
        orderId,
        refundId: refundData.refund_id,
        uniPayOrderHashId: order.uniPayOrderHashId
      };
    } catch (error) {
      logger.error(`Error processing refund for order ${orderId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new OrderController();