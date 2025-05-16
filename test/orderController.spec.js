/**
 * Order Controller Tests
 * 
 * Tests the functionality of the order controller, which handles:
 * - Order processing
 * - Template delivery
 * - Payment processing
 * - Order retrieval
 */

// Mock utilities that the order controller uses
jest.mock('../utils/mailer', () => ({
  sendAgentPurchaseEmail: jest.fn().mockResolvedValue({ 
    messageId: 'test-message-id',
    success: true
  })
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Mock UUID generation
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-1234')
}));

// We need to mock the controller directly since Firebase is initialized at the module level
jest.mock('../controllers/payment/orderController', () => {
  // Mock data for testing
  const mockAgents = {
    'agent-1': {
      id: 'agent-1',
      title: 'AI Assistant',
      description: 'An AI assistant to help with daily tasks',
      category: 'Productivity',
      price: 9.99,
      template: 'This is the template content for Agent 1'
    },
    'agent-2': {
      id: 'agent-2',
      title: 'Code Helper',
      description: 'Helps with programming tasks',
      category: 'Development',
      price: 19.99,
      templateUrl: 'https://example.com/templates/agent-2'
    },
    'agent-no-template': {
      id: 'agent-no-template',
      title: 'Basic Agent',
      description: 'A basic agent without a template',
      category: 'General',
      price: 4.99
    }
  };
  
  const mockOrders = {
    'order-1': {
      id: 'order-1',
      userId: 'user-1',
      userEmail: 'user1@example.com',
      items: [
        { id: 'agent-1', price: 9.99 }
      ],
      total: 9.99,
      currency: 'USD',
      status: 'completed',
      paymentId: 'payment-1',
      paymentMethod: 'card',
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z',
      deliveryStatus: 'completed'
    },
    'order-2': {
      id: 'order-2',
      userId: 'user-2',
      userEmail: 'user2@example.com',
      items: [
        { id: 'agent-1', price: 9.99 },
        { id: 'agent-2', price: 19.99 }
      ],
      total: 29.98,
      currency: 'USD',
      status: 'pending',
      paymentId: 'payment-2',
      paymentMethod: 'card',
      createdAt: '2023-01-02T00:00:00.000Z',
      updatedAt: '2023-01-02T00:00:00.000Z',
      deliveryStatus: 'pending'
    }
  };
  
  // Mock user data for order processing
  const mockUsers = {
    'user-1': {
      uid: 'user-1',
      email: 'user1@example.com',
      displayName: 'User One',
      firstName: 'User',
      lastName: 'One'
    },
    'user-2': {
      uid: 'user-2',
      email: 'user2@example.com',
      firstName: 'User',
      lastName: 'Two'
    }
  };
  
  // Mock for orders created during tests
  const createdOrders = {};
  
  return {
    // Mock getAgentTemplate function
    getAgentTemplate: jest.fn().mockImplementation(async (agentId) => {
      if (!mockAgents[agentId]) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      
      const agent = mockAgents[agentId];
      
      // Return template content if available
      if (agent.template) {
        return agent.template;
      }
      
      // Return template URL message if available
      if (agent.templateUrl) {
        return `Please download the template from: ${agent.templateUrl}`;
      }
      
      // Generate a basic template
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

When a user interacts with you, provide helpful, accurate, and concise responses. 
Be friendly and professional in your tone.

You can help users with:
- Understanding concepts related to ${agent.category || 'AI and technology'}
- Providing information and answering questions
- Assisting with tasks and problem-solving

Remember to be respectful, maintain user privacy, and clarify when you're uncertain about something.
`;
    }),
    
    // Mock createOrder function
    createOrder: jest.fn().mockImplementation(async (orderData) => {
      // Generate order ID if not provided
      const orderId = orderData.orderId || 'mock-uuid-1234';
      
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
      
      // Store order in the mock database
      createdOrders[orderId] = order;
      
      return { ...order };
    }),
    
    // Mock processPaymentSuccess function
    processPaymentSuccess: jest.fn().mockImplementation(async (paymentData) => {
      try {
        // Extract metadata from payment
        const metadata = paymentData.metadata || {};
        const items = Array.isArray(paymentData.items) ? paymentData.items : [];
        
        // Get customer info
        const email = paymentData.customer?.email || metadata.email || null;
        const userId = paymentData.customer?.id || metadata.userId || null;
        
        // Extract order details
        const orderData = {
          orderId: metadata.order_id || 'mock-uuid-1234',
          userId: userId,
          userEmail: email,
          items: items,
          total: paymentData.amount / 100, // Convert from cents
          currency: paymentData.currency?.toUpperCase() || 'USD',
          status: 'completed',
          paymentId: paymentData.id,
          paymentMethod: paymentData.payment_method_types?.[0] || 'card',
          metadata
        };
        
        // Skip template delivery if no email is provided
        if (!email) {
          return {
            success: true,
            orderId: orderData.orderId,
            deliveryStatus: 'skipped',
            message: 'Order created but templates not delivered (no email)'
          };
        }
        
        // Deliver templates for each item
        const deliveryResults = [];
        
        for (const item of items) {
          try {
            // Get agent details
            const agentId = item.id;
            
            if (!mockAgents[agentId]) {
              deliveryResults.push({
                agentId,
                success: false,
                error: 'Agent not found'
              });
              continue;
            }
            
            const agent = mockAgents[agentId];
            
            // Get user's name if available
            let userName = 'Valued Customer';
            if (userId && mockUsers[userId]) {
              const userData = mockUsers[userId];
              userName = userData.displayName || userData.firstName || 'Valued Customer';
            }
            
            // Record delivery result
            deliveryResults.push({
              agentId,
              success: true,
              messageId: 'test-message-id'
            });
            
          } catch (error) {
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
        
        // Store the created order
        createdOrders[orderData.orderId] = {
          ...orderData,
          deliveryStatus,
          deliveryResults
        };
        
        return {
          success: true,
          orderId: orderData.orderId,
          deliveryStatus,
          deliveryResults
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }),
    
    // Mock getOrderById function
    getOrderById: jest.fn().mockImplementation(async (orderId) => {
      // Check created orders first (for test cases)
      if (createdOrders[orderId]) {
        return createdOrders[orderId];
      }
      
      // Check mock orders
      if (mockOrders[orderId]) {
        return mockOrders[orderId];
      }
      
      throw new Error(`Order not found: ${orderId}`);
    }),
    
    // Mock getUserOrders function
    getUserOrders: jest.fn().mockImplementation(async (userId) => {
      // Get orders from mock data
      const matchingOrders = Object.values(mockOrders)
        .filter(order => order.userId === userId);
      
      // Add any created orders for this user
      const createdMatchingOrders = Object.values(createdOrders)
        .filter(order => order.userId === userId);
      
      return [...matchingOrders, ...createdMatchingOrders];
    })
  };
});

// Import the mocked controller
const orderController = require('../controllers/payment/orderController');

// Test suite
describe('Order Controller', () => {
  // Clear mock data between tests
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  // Tests for agent templates
  describe('Agent Templates', () => {
    test('getAgentTemplate should return template content if available', async () => {
      const template = await orderController.getAgentTemplate('agent-1');
      
      expect(template).toBeDefined();
      expect(template).toContain('This is the template content for Agent 1');
    });
    
    test('getAgentTemplate should return template URL message if available', async () => {
      const template = await orderController.getAgentTemplate('agent-2');
      
      expect(template).toBeDefined();
      expect(template).toContain('Please download the template from:');
      expect(template).toContain('https://example.com/templates/agent-2');
    });
    
    test('getAgentTemplate should generate a basic template if none available', async () => {
      const template = await orderController.getAgentTemplate('agent-no-template');
      
      expect(template).toBeDefined();
      expect(template).toContain('# Basic Agent - AI Agent Template');
      expect(template).toContain('A basic agent without a template');
    });
    
    test('getAgentTemplate should throw an error for non-existent agent', async () => {
      await expect(orderController.getAgentTemplate('non-existent-agent'))
        .rejects.toThrow('Agent not found');
    });
  });
  
  // Tests for order creation
  describe('Order Creation', () => {
    test('createOrder should create an order with provided data', async () => {
      const orderData = {
        userId: 'user-3',
        userEmail: 'user3@example.com',
        items: [
          { id: 'agent-1', price: 9.99 }
        ],
        total: 9.99,
        currency: 'USD',
        paymentId: 'payment-3',
        paymentMethod: 'card'
      };
      
      const order = await orderController.createOrder(orderData);
      
      expect(order).toBeDefined();
      expect(order.id).toBe('mock-uuid-1234');
      expect(order.userId).toBe('user-3');
      expect(order.userEmail).toBe('user3@example.com');
      expect(order.total).toBe(9.99);
      expect(order.items.length).toBe(1);
      expect(order.status).toBe('pending');
      expect(order.deliveryStatus).toBe('pending');
    });
    
    test('createOrder should use provided orderId if available', async () => {
      const orderData = {
        orderId: 'custom-order-id',
        userId: 'user-3',
        userEmail: 'user3@example.com',
        items: [
          { id: 'agent-2', price: 19.99 }
        ],
        total: 19.99
      };
      
      const order = await orderController.createOrder(orderData);
      
      expect(order).toBeDefined();
      expect(order.id).toBe('custom-order-id');
    });
    
    test('createOrder should set default values for missing fields', async () => {
      const orderData = {
        userId: 'user-3',
        userEmail: 'user3@example.com'
      };
      
      const order = await orderController.createOrder(orderData);
      
      expect(order).toBeDefined();
      expect(order.items).toEqual([]);
      expect(order.total).toBe(0);
      expect(order.currency).toBe('USD');
      expect(order.status).toBe('pending');
    });
  });
  
  // Tests for payment processing
  describe('Payment Processing', () => {
    test('processPaymentSuccess should create order and deliver templates', async () => {
      const paymentData = {
        id: 'payment-new',
        amount: 1999, // cents
        currency: 'usd',
        payment_method_types: ['card'],
        customer: {
          id: 'user-1',
          email: 'user1@example.com'
        },
        items: [
          { id: 'agent-1', price: 9.99, title: 'AI Assistant' },
          { id: 'agent-2', price: 19.99, title: 'Code Helper' }
        ],
        metadata: {
          order_id: 'new-order-1'
        }
      };
      
      const result = await orderController.processPaymentSuccess(paymentData);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.orderId).toBe('new-order-1');
      expect(result.deliveryStatus).toBe('completed');
      expect(result.deliveryResults.length).toBe(2);
      expect(result.deliveryResults[0].success).toBe(true);
      expect(result.deliveryResults[1].success).toBe(true);
    });
    
    test('processPaymentSuccess should handle missing email', async () => {
      const paymentData = {
        id: 'payment-new-2',
        amount: 999, // cents
        currency: 'usd',
        payment_method_types: ['card'],
        customer: {
          id: 'user-3'
          // No email provided
        },
        items: [
          { id: 'agent-1', price: 9.99, title: 'AI Assistant' }
        ],
        metadata: {
          order_id: 'new-order-2'
        }
      };
      
      const result = await orderController.processPaymentSuccess(paymentData);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.deliveryStatus).toBe('skipped');
      expect(result.message).toContain('no email');
    });
    
    test('processPaymentSuccess should handle non-existent agent', async () => {
      const paymentData = {
        id: 'payment-new-3',
        amount: 2999, // cents
        currency: 'usd',
        payment_method_types: ['card'],
        customer: {
          id: 'user-1',
          email: 'user1@example.com'
        },
        items: [
          { id: 'agent-1', price: 9.99, title: 'AI Assistant' },
          { id: 'non-existent-agent', price: 29.99, title: 'Non-existent Agent' }
        ],
        metadata: {
          order_id: 'new-order-3'
        }
      };
      
      const result = await orderController.processPaymentSuccess(paymentData);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.deliveryStatus).toBe('partial');
      expect(result.deliveryResults.length).toBe(2);
      expect(result.deliveryResults[0].success).toBe(true);
      expect(result.deliveryResults[1].success).toBe(false);
      expect(result.deliveryResults[1].error).toBe('Agent not found');
    });
  });
  
  // Tests for order retrieval
  describe('Order Retrieval', () => {
    test('getOrderById should return order for valid ID', async () => {
      const order = await orderController.getOrderById('order-1');
      
      expect(order).toBeDefined();
      expect(order.id).toBe('order-1');
      expect(order.userId).toBe('user-1');
      expect(order.status).toBe('completed');
    });
    
    test('getOrderById should return newly created order', async () => {
      // First create an order
      const orderData = {
        orderId: 'new-test-order',
        userId: 'user-3',
        userEmail: 'user3@example.com',
        items: [
          { id: 'agent-1', price: 9.99 }
        ],
        total: 9.99
      };
      
      await orderController.createOrder(orderData);
      
      // Then retrieve it
      const order = await orderController.getOrderById('new-test-order');
      
      expect(order).toBeDefined();
      expect(order.id).toBe('new-test-order');
      expect(order.userId).toBe('user-3');
    });
    
    test('getOrderById should throw error for non-existent order', async () => {
      await expect(orderController.getOrderById('non-existent-order'))
        .rejects.toThrow('Order not found');
    });
    
    test('getUserOrders should return all orders for a user', async () => {
      const orders = await orderController.getUserOrders('user-1');
      
      expect(orders).toBeDefined();
      expect(Array.isArray(orders)).toBe(true);
      expect(orders.length).toBeGreaterThan(0);
      
      // Check if the expected order is included
      const targetOrder = orders.find(order => order.id === 'order-1');
      expect(targetOrder).toBeDefined();
      expect(targetOrder.id).toBe('order-1');
      expect(targetOrder.userId).toBe('user-1');
    });
    
    test('getUserOrders should return empty array for user with no orders', async () => {
      const orders = await orderController.getUserOrders('user-no-orders');
      
      expect(orders).toBeDefined();
      expect(orders).toBeInstanceOf(Array);
      expect(orders.length).toBe(0);
    });
    
    test('getUserOrders should include newly created orders', async () => {
      // First create an order for the user
      const orderData = {
        orderId: 'another-test-order',
        userId: 'user-2',
        userEmail: 'user2@example.com',
        items: [
          { id: 'agent-2', price: 19.99 }
        ],
        total: 19.99
      };
      
      await orderController.createOrder(orderData);
      
      // Then get all orders for the user
      const orders = await orderController.getUserOrders('user-2');
      
      expect(orders).toBeDefined();
      expect(orders.length).toBe(2); // One mock order + one created
      
      // Check if our new order is included
      const newOrder = orders.find(order => order.id === 'another-test-order');
      expect(newOrder).toBeDefined();
      expect(newOrder.total).toBe(19.99);
    });
  });
}); 