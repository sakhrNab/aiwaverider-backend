// Import the mock first
const mockFirebase = require('./mockFirebase');

// Mock the Firebase module
jest.mock('../config/firebase', () => mockFirebase);

// Import the controller under test
const agentsController = require('../controllers/agent/agentsController');

describe('Agent Controller', () => {
  let req;
  let res;
  
  beforeEach(() => {
    // Reset mocks before each test
    req = {
      params: {},
      query: {},
      user: { uid: 'test-user-id' },
      app: {
        get: jest.fn().mockReturnValue(null) // Mock Redis client
      }
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });
  
  describe('getAgents', () => {
    it('should return a list of agents', async () => {
      // Set up query parameters
      req.query = { page: 1, limit: 10 };
      
      // Call the controller method
      await agentsController.getAgents(req, res);
      
      // Assertions
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      
      // Get the argument passed to res.json
      const responseData = res.json.mock.calls[0][0];
      
      // Verify the structure of the response
      expect(responseData).toHaveProperty('agents');
      expect(responseData).toHaveProperty('total');
      expect(responseData).toHaveProperty('page', 1);
      expect(responseData).toHaveProperty('limit', 10);
    });
    
    it('should apply filters correctly', async () => {
      // Set up query parameters with filters
      req.query = { 
        category: 'Test',
        filter: 'Hot & Now',
        priceMin: '5',
        priceMax: '100'
      };
      
      // Call the controller method
      await agentsController.getAgents(req, res);
      
      // Assertions
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
    });
  });
  
  describe('getAgentById', () => {
    it('should return an agent when given a valid ID', async () => {
      // Set up params
      req.params = { id: 'agent-1' };
      
      // Call the controller method
      await agentsController.getAgentById(req, res);
      
      // Assertions
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      
      const responseData = res.json.mock.calls[0][0];
      expect(responseData).toHaveProperty('success', true);
      expect(responseData).toHaveProperty('data');
      expect(responseData.data).toHaveProperty('name', 'Test Agent');
    });
    
    it('should return 404 when given an invalid ID', async () => {
      // Set up params with invalid ID
      req.params = { id: 'non-existent-id' };
      
      // Call the controller method
      await agentsController.getAgentById(req, res);
      
      // Assertions
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalled();
      
      const responseData = res.json.mock.calls[0][0];
      expect(responseData).toHaveProperty('success', false);
      expect(responseData).toHaveProperty('message', 'Agent not found');
    });
  });
  
  describe('getDownloadCount', () => {
    it('should return download count for a valid agent', async () => {
      // Set up params
      req.params = { agentId: 'agent-1' };
      
      // Call the controller method
      await agentsController.getDownloadCount(req, res);
      
      // Assertions
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      
      const responseData = res.json.mock.calls[0][0];
      expect(responseData).toHaveProperty('downloads');
      expect(responseData).toHaveProperty('agentId', 'agent-1');
    });
    
    it('should return 400 when no agent ID is provided', async () => {
      // Set up params with no ID
      req.params = {};
      
      // Call the controller method
      await agentsController.getDownloadCount(req, res);
      
      // Assertions
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
      
      const responseData = res.json.mock.calls[0][0];
      expect(responseData).toHaveProperty('error', 'Agent ID is required');
    });
  });
}); 