/**
 * Order Controller
 * 
 * Handles order processing, template delivery, and related functionalities
 */

const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../../services/email/emailService');
const logger = require('../../utils/logger');

// Initialize Firestore
const db = admin.firestore();

/**
 * Get agent template content
 * @param {string} agentId - The agent ID
 * @returns {Promise<Object>} - The template content as an object with all agent data
 */
const getAgentTemplate = async (agentId) => {
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
      templateObject.templateContent = generateBasicTemplate(agent);
      templateObject.isGenerated = true;
    }
    
    return JSON.stringify(templateObject, null, 2);
  } catch (error) {
    logger.error(`Error getting agent template: ${error.message}`);
    throw error;
  }
};

/**
 * Generate a basic template based on agent information
 * @param {Object} agent - The agent data
 * @returns {string} - A basic template
 */
const generateBasicTemplate = (agent) => {
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
};

/**
 * Create a new order record
 * @param {Object} orderData - The order data
 * @returns {Promise<Object>} - The created order
 */
const createOrder = async (orderData) => {
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deliveryStatus: 'pending',
      metadata: orderData.metadata || {}
    };
    
    // Save order to database
    await db.collection('orders').doc(orderId).set(order);
    
    return { ...order };
  } catch (error) {
    logger.error(`Error creating order: ${error.message}`);
    throw error;
  }
};

/**
 * Process payment success and deliver templates
 * @param {Object} paymentData - Payment data from the payment provider
 * @returns {Promise<Object>} - Processing result
 */
const processPaymentSuccess = async (paymentData) => {
  try {
    // Extract metadata from payment
    const metadata = paymentData.metadata || {};
    const items = Array.isArray(paymentData.items) ? paymentData.items : [];
    
    // Get customer info - prioritize customer email, then metadata email, never use hardcoded default
    const email = paymentData.customer?.email || metadata.email || null;
    
    // Log email being used for confirmation
    if (email) {
      logger.info(`Using email address for order confirmation: ${email}`);
    } else {
      logger.warn(`No email address available for order confirmation - unable to send template`);
    }
    
    const userId = paymentData.customer?.id || metadata.userId || null;
    
    // Check if this is a SEPA payment
    const isSepaPayment = 
      paymentData.payment_method_types?.includes('sepa_credit_transfer') || 
      paymentData.payment_method_types?.includes('sepa_debit') ||
      metadata.payment_method === 'sepa_credit_transfer';
    
    // Check for PayPal payments
    const isPayPalPayment = 
      paymentData.payment_method_types?.includes('paypal') || 
      metadata.payment_method === 'paypal' ||
      paymentData.payment_method === 'paypal';
    
    // Check if immediate delivery is requested
    const immediateDelivery = (isSepaPayment && metadata.immediate_delivery === true) || 
                             metadata.immediate_delivery === true || 
                             isPayPalPayment || 
                             !isSepaPayment; // Immediate delivery for all except pending SEPA
    
    // Extract order details
    const orderData = {
      orderId: metadata.order_id || uuidv4(),
      userId: userId,
      userEmail: email,
      items: items,
      total: paymentData.amount / 100, // Convert from cents
      currency: paymentData.currency?.toUpperCase() || 'USD',
      status: 'completed', // Use completed status for all payment types
      paymentId: paymentData.id,
      paymentMethod: paymentData.payment_method_types?.[0] || metadata.payment_method || 'card',
      metadata
    };
    
    // Create order record
    const order = await createOrder(orderData);
    
    // If immediate delivery, generate download links for templates
    const templates = [];
    
    if (immediateDelivery) {
      logger.info(`Preparing templates for immediate delivery for order ${order.id}`);
      
      // Process each item to create template access
      for (const item of items) {
        try {
          const agentId = item.id;
          
          // Get template content
          const templateContent = await getAgentTemplate(agentId);
          
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
            used: false
          });
          
          // Add template to list
          templates.push({
            agentId,
            agentName,
            accessToken,
            downloadUrl: `/api/templates/download/${agentId}?orderId=${order.id}&token=${accessToken}`
          });
          
          logger.info(`Template access created for agent ${agentId} in order ${order.id}`);
        } catch (templateError) {
          logger.error(`Error preparing template for agent ${item.id}: ${templateError.message}`);
        }
      }
    }
    
    // If we have a notification service, send a success notification
    try {
      // Check if we should skip email sending (used to prevent duplicates)
      const skipEmailSending = metadata.skipEmailSending === true;
      
      if (skipEmailSending) {
        logger.info(`Skipping email sending for order ${order.id} due to skipEmailSending flag`);
        
        return {
          success: true,
          orderId: order.id,
          deliveryStatus: 'skipped_by_flag',
          message: 'Order created but email skipped due to skipEmailSending flag',
          templates: immediateDelivery ? templates : []
        };
      }
      
      // Skip template delivery if no email is provided
      if (!email) {
        logger.warn(`Cannot deliver templates: No email provided for order ${order.id}`);
        
        return {
          success: true,
          orderId: order.id,
          deliveryStatus: 'skipped',
          message: 'Order created but templates not delivered (no email)',
          templates: immediateDelivery ? templates : []
        };
      }
      
      // Deliver templates for each item
      const deliveryResults = [];
      
      for (const item of items) {
        try {
          // Get agent details
          const agentId = item.id;
          const agentDoc = await db.collection('agents').doc(agentId).get();
          
          if (!agentDoc.exists) {
            deliveryResults.push({
              agentId,
              success: false,
              error: 'Agent not found'
            });
            continue;
          }
          
          const agent = agentDoc.data();
          
          // Get template content
          const templateContent = await getAgentTemplate(agentId);
          
          // Get user's name if available
          let userName = 'Valued Customer';
          if (userId) {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
              const userData = userDoc.data();
              userName = userData.displayName || userData.firstName || 'Valued Customer';
            }
          }
          
          // Send email with template
          let emailSubject = 'Your AI Agent Purchase';
          let receiptUrl = '';
          
          // Add payment reference to receipt URL if available
          if (paymentData.id) {
            receiptUrl = `/account/orders/${orderData.orderId}?payment_ref=${paymentData.id}`;
          }
          
          // Find template download link if available
          const templateLink = templates.find(t => t.agentId === agentId)?.downloadUrl || '';
          
          // Send email with template
          const emailResult = await emailService.sendAgentPurchaseEmail({
            email: email,
            firstName: userName,
            agentName: agent.title || 'AI Agent',
            agentDescription: agent.description || 'Your new AI agent',
            price: item.price || 0,
            currency: orderData.currency || 'USD',
            receiptUrl: receiptUrl,
            orderId: orderData.orderId,
            orderDate: new Date().toLocaleDateString(), 
            paymentMethod: orderData.paymentMethod,
            paymentStatus: 'successful', // Always use successful status
            isSepaPayment: true, // Always use the same email structure for all payment types
            immediateDownload: immediateDelivery,
            downloadUrl: templateLink,
            templateContent: templateContent, // Pass the template content
            agentId: agentId // Pass the agent ID
          });
          
          // Record delivery result
          deliveryResults.push({
            agentId,
            success: true,
            messageId: emailResult.messageId
          });
          
        } catch (error) {
          logger.error(`Error delivering template for agent ${item.id}: ${error.message}`);
          
          deliveryResults.push({
            agentId: item.id,
            success: false,
            error: error.message
          });
        }
      }
      
      // Update order with delivery results
      const deliveryStatus = deliveryResults.every(r => r.success) ? 'completed' : 
                            deliveryResults.some(r => r.success) ? 'partial' : 'failed';
      
      await db.collection('orders').doc(order.id).update({
        deliveryStatus,
        deliveryResults,
        updatedAt: new Date().toISOString()
      });
      
      return {
        success: true,
        orderId: order.id,
        deliveryStatus,
        deliveryResults,
        templates: immediateDelivery ? templates : []
      };
    } catch (error) {
      logger.error(`Error processing payment success: ${error.message}`);
      throw error;
    }
  } catch (error) {
    logger.error(`Error processing payment success: ${error.message}`);
    throw error;
  }
};

/**
 * Get order by ID
 * @param {string} orderId - The order ID
 * @returns {Promise<Object>} - The order
 */
const getOrderById = async (orderId) => {
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
};

/**
 * Get orders for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} - Array of orders
 */
const getUserOrders = async (userId) => {
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
};

module.exports = {
  processPaymentSuccess,
  createOrder,
  getOrderById,
  getUserOrders,
  getAgentTemplate
}; 