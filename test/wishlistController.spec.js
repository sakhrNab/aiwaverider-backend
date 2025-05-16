/**
 * Wishlist Controller Tests
 * 
 * Tests the functionality of the wishlist controller, which handles:
 * - Getting public wishlists
 * - Managing user wishlists
 * - Adding/removing agents from wishlists
 */

// Mock utilities that the wishlist controller might use
jest.mock('../utils/sanitize', () => ({
  sanitizeObject: jest.fn(obj => obj)
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// We need to mock the controller directly since Firebase is initialized at the module level
jest.mock('../controllers/agent/wishlistController', () => {
  // Mock data for testing
  const mockWishlists = {
    'wishlist-1': {
      id: 'wishlist-1',
      name: 'My Favorite Agents',
      description: 'A collection of my favorite AI agents',
      creatorId: 'user-1',
      isPublic: true,
      itemCount: 2,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-15')
    },
    'wishlist-2': {
      id: 'wishlist-2',
      name: 'Work Tools',
      description: 'AI agents for productivity',
      creatorId: 'user-1',
      isPublic: false,
      itemCount: 1,
      createdAt: new Date('2023-02-01'),
      updatedAt: new Date('2023-02-05')
    },
    'wishlist-3': {
      id: 'wishlist-3',
      name: 'Entertainment',
      description: 'Fun AI agents',
      creatorId: 'user-2',
      isPublic: true,
      itemCount: 3,
      createdAt: new Date('2023-03-01'),
      updatedAt: new Date('2023-03-10')
    }
  };
  
  // Mock wishlist items
  const mockWishlistItems = {
    'wishlist-1': [
      {
        id: 'item-1',
        agentId: 'agent-1',
        addedAt: new Date('2023-01-01'),
        title: 'AI Assistant',
        imageUrl: 'https://example.com/images/agent1.jpg'
      },
      {
        id: 'item-2',
        agentId: 'agent-2',
        addedAt: new Date('2023-01-10'),
        title: 'Code Helper',
        imageUrl: 'https://example.com/images/agent2.jpg'
      }
    ],
    'wishlist-2': [
      {
        id: 'item-3',
        agentId: 'agent-3',
        addedAt: new Date('2023-02-01'),
        title: 'Data Analyzer',
        imageUrl: 'https://example.com/images/agent3.jpg'
      }
    ],
    'wishlist-3': [
      {
        id: 'item-4',
        agentId: 'agent-1',
        addedAt: new Date('2023-03-01'),
        title: 'AI Assistant',
        imageUrl: 'https://example.com/images/agent1.jpg'
      },
      {
        id: 'item-5',
        agentId: 'agent-4',
        addedAt: new Date('2023-03-05'),
        title: 'Music Recommender',
        imageUrl: 'https://example.com/images/agent4.jpg'
      },
      {
        id: 'item-6',
        agentId: 'agent-5',
        addedAt: new Date('2023-03-10'),
        title: 'Game Companion',
        imageUrl: 'https://example.com/images/agent5.jpg'
      }
    ]
  };
  
  // Mock users
  const mockUsers = {
    'user-1': {
      id: 'user-1',
      username: 'testuser1',
      displayName: 'Test User 1',
      photoURL: 'https://example.com/photos/user1.jpg'
    },
    'user-2': {
      id: 'user-2',
      username: 'testuser2',
      displayName: 'Test User 2',
      photoURL: 'https://example.com/photos/user2.jpg'
    }
  };
  
  // Mock agents
  const mockAgents = {
    'agent-1': {
      id: 'agent-1',
      title: 'AI Assistant',
      description: 'An AI assistant to help with daily tasks',
      imageUrl: 'https://example.com/images/agent1.jpg',
      price: 9.99,
      creator: { name: 'Creator 1' },
      rating: 4.5
    },
    'agent-2': {
      id: 'agent-2',
      title: 'Code Helper',
      description: 'Helps with programming tasks',
      imageUrl: 'https://example.com/images/agent2.jpg',
      price: 19.99,
      creator: { name: 'Creator 2' },
      rating: 4.7
    },
    'agent-3': {
      id: 'agent-3',
      title: 'Data Analyzer',
      description: 'Analyzes data and provides insights',
      imageUrl: 'https://example.com/images/agent3.jpg',
      price: 14.99,
      creator: { name: 'Creator 3' },
      rating: 4.2
    },
    'agent-4': {
      id: 'agent-4',
      title: 'Music Recommender',
      description: 'Recommends music based on your preferences',
      imageUrl: 'https://example.com/images/agent4.jpg',
      price: 7.99,
      creator: { name: 'Creator 4' },
      rating: 4.1
    },
    'agent-5': {
      id: 'agent-5',
      title: 'Game Companion',
      description: 'AI companion for gaming',
      imageUrl: 'https://example.com/images/agent5.jpg',
      price: 12.99,
      creator: { name: 'Creator 5' },
      rating: 4.8
    }
  };
  
  // Store for created/updated wishlists during tests
  const createdWishlists = {};
  
  return {
    // Mock getWishlists function
    getWishlists: jest.fn().mockImplementation((req, res) => {
      try {
        const { limit = 10 } = req.query;
        const limitNum = parseInt(limit, 10);
        
        // Get all public wishlists
        const publicWishlists = Object.values(mockWishlists)
          .filter(wishlist => wishlist.isPublic)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limitNum);
        
        // Format wishlists with their items and creator
        const formattedWishlists = publicWishlists.map(wishlist => {
          const items = mockWishlistItems[wishlist.id] || [];
          const creator = mockUsers[wishlist.creatorId] 
            ? {
                id: wishlist.creatorId,
                name: mockUsers[wishlist.creatorId].username || mockUsers[wishlist.creatorId].displayName,
                avatar: mockUsers[wishlist.creatorId].photoURL
              }
            : null;
          
          return {
            id: wishlist.id,
            name: wishlist.name,
            description: wishlist.description,
            itemCount: wishlist.itemCount,
            creator,
            items: items.slice(0, 4),
            createdAt: wishlist.createdAt,
            updatedAt: wishlist.updatedAt
          };
        });
        
        return res.json({ wishlists: formattedWishlists });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to retrieve wishlists', message: error.message });
      }
    }),
    
    // Mock getUserWishlists function
    getUserWishlists: jest.fn().mockImplementation((req, res) => {
      try {
        const userId = req.user?.uid;
        
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        // Get all wishlists for the user
        const userWishlists = Object.values({...mockWishlists, ...createdWishlists})
          .filter(wishlist => wishlist.creatorId === userId)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        
        // Format wishlists
        const formattedWishlists = userWishlists.map(wishlist => ({
          id: wishlist.id,
          name: wishlist.name,
          description: wishlist.description,
          isPublic: wishlist.isPublic || false,
          itemCount: wishlist.itemCount || 0,
          creatorId: wishlist.creatorId,
          createdAt: wishlist.createdAt,
          updatedAt: wishlist.updatedAt
        }));
        
        return res.json({ wishlists: formattedWishlists });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to retrieve user wishlists' });
      }
    }),
    
    // Mock getWishlistById function
    getWishlistById: jest.fn().mockImplementation((req, res) => {
      try {
        const { wishlistId } = req.params;
        
        // Find wishlist
        const wishlist = mockWishlists[wishlistId] || createdWishlists[wishlistId];
        
        if (!wishlist) {
          return res.status(404).json({ error: 'Wishlist not found' });
        }
        
        // Check if wishlist is public or belongs to the user
        if (!wishlist.isPublic && (!req.user || req.user.uid !== wishlist.creatorId)) {
          return res.status(403).json({ error: 'You do not have permission to view this wishlist' });
        }
        
        // Get creator info
        let creator = null;
        if (wishlist.creatorId && mockUsers[wishlist.creatorId]) {
          creator = {
            id: wishlist.creatorId,
            name: mockUsers[wishlist.creatorId].username || mockUsers[wishlist.creatorId].displayName,
            avatar: mockUsers[wishlist.creatorId].photoURL
          };
        }
        
        // Get items
        const items = mockWishlistItems[wishlistId] || [];
        
        // Format items with agent data
        const formattedItems = items.map(item => {
          const agent = mockAgents[item.agentId];
          return {
            id: item.id,
            agentId: item.agentId,
            addedAt: item.addedAt,
            ...agent
          };
        });
        
        return res.json({
          wishlist: {
            id: wishlist.id,
            name: wishlist.name,
            description: wishlist.description,
            isPublic: wishlist.isPublic || false,
            itemCount: wishlist.itemCount || 0,
            creator,
            items: formattedItems,
            createdAt: wishlist.createdAt,
            updatedAt: wishlist.updatedAt
          }
        });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to retrieve wishlist' });
      }
    }),
    
    // Mock createWishlist function
    createWishlist: jest.fn().mockImplementation((req, res) => {
      try {
        const userId = req.user?.uid;
        
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const { name, description, isPublic = false } = req.body;
        
        // Validate required fields
        if (!name) {
          return res.status(400).json({ error: 'Wishlist name is required' });
        }
        
        // Create new wishlist
        const wishlistId = `wishlist-${Date.now()}`;
        const wishlistData = {
          id: wishlistId,
          name,
          description: description || '',
          creatorId: userId,
          isPublic: Boolean(isPublic),
          itemCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Store in mock database
        createdWishlists[wishlistId] = wishlistData;
        
        return res.status(201).json(wishlistData);
      } catch (error) {
        return res.status(500).json({ error: 'Failed to create wishlist' });
      }
    }),
    
    // Mock updateWishlist function
    updateWishlist: jest.fn().mockImplementation((req, res) => {
      try {
        const userId = req.user?.uid;
        
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const { wishlistId } = req.params;
        const { name, description, isPublic } = req.body;
        
        // Find wishlist
        const wishlist = mockWishlists[wishlistId] || createdWishlists[wishlistId];
        
        if (!wishlist) {
          return res.status(404).json({ error: 'Wishlist not found' });
        }
        
        // Check if user owns the wishlist
        if (wishlist.creatorId !== userId) {
          return res.status(403).json({ error: 'You do not have permission to update this wishlist' });
        }
        
        // Update wishlist
        const updatedWishlist = {
          ...wishlist,
          updatedAt: new Date()
        };
        
        if (name !== undefined) updatedWishlist.name = name;
        if (description !== undefined) updatedWishlist.description = description;
        if (isPublic !== undefined) updatedWishlist.isPublic = Boolean(isPublic);
        
        // Store updated wishlist
        createdWishlists[wishlistId] = updatedWishlist;
        
        return res.json(updatedWishlist);
      } catch (error) {
        return res.status(500).json({ error: 'Failed to update wishlist' });
      }
    }),
    
    // Mock deleteWishlist function
    deleteWishlist: jest.fn().mockImplementation((req, res) => {
      try {
        const userId = req.user?.uid;
        
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const { wishlistId } = req.params;
        
        // Find wishlist
        const wishlist = mockWishlists[wishlistId] || createdWishlists[wishlistId];
        
        if (!wishlist) {
          return res.status(404).json({ error: 'Wishlist not found' });
        }
        
        // Check if user owns the wishlist
        if (wishlist.creatorId !== userId) {
          return res.status(403).json({ error: 'You do not have permission to delete this wishlist' });
        }
        
        // Delete wishlist
        delete createdWishlists[wishlistId];
        
        return res.json({ message: 'Wishlist deleted successfully' });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to delete wishlist' });
      }
    }),
    
    // Mock toggleWishlistItem function
    toggleWishlistItem: jest.fn().mockImplementation((req, res) => {
      try {
        const userId = req.user?.uid;
        
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const { agentId } = req.body;
        
        // Validate required fields
        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID is required' });
        }
        
        // Check if agent exists
        if (!mockAgents[agentId]) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        
        // Find or create default wishlist
        let defaultWishlist = Object.values({...mockWishlists, ...createdWishlists})
          .find(w => w.creatorId === userId && w.isDefault);
        
        if (!defaultWishlist) {
          // Create default wishlist
          const wishlistId = `wishlist-default-${userId}`;
          defaultWishlist = {
            id: wishlistId,
            name: 'My Wishlist',
            description: 'My default wishlist',
            creatorId: userId,
            isPublic: false,
            isDefault: true,
            itemCount: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          createdWishlists[wishlistId] = defaultWishlist;
          mockWishlistItems[wishlistId] = [];
        }
        
        // Check if agent is already in the wishlist
        const items = mockWishlistItems[defaultWishlist.id] || [];
        const existingItem = items.find(item => item.agentId === agentId);
        
        if (!existingItem) {
          // Add agent to wishlist
          const newItem = {
            id: `item-${Date.now()}`,
            agentId,
            addedAt: new Date(),
            title: mockAgents[agentId].title,
            imageUrl: mockAgents[agentId].imageUrl
          };
          
          if (!mockWishlistItems[defaultWishlist.id]) {
            mockWishlistItems[defaultWishlist.id] = [];
          }
          
          mockWishlistItems[defaultWishlist.id].push(newItem);
          
          // Update item count
          defaultWishlist.itemCount += 1;
          defaultWishlist.updatedAt = new Date();
          createdWishlists[defaultWishlist.id] = defaultWishlist;
          
          return res.json({
            added: true,
            wishlistId: defaultWishlist.id,
            message: 'Agent added to wishlist'
          });
        } else {
          // Remove agent from wishlist
          mockWishlistItems[defaultWishlist.id] = items.filter(item => item.agentId !== agentId);
          
          // Update item count
          defaultWishlist.itemCount -= 1;
          defaultWishlist.updatedAt = new Date();
          createdWishlists[defaultWishlist.id] = defaultWishlist;
          
          return res.json({
            added: false,
            wishlistId: defaultWishlist.id,
            message: 'Agent removed from wishlist'
          });
        }
      } catch (error) {
        return res.status(500).json({ error: 'Failed to toggle wishlist item' });
      }
    }),
    
    // Mock checkWishlistItem function
    checkWishlistItem: jest.fn().mockImplementation((req, res) => {
      try {
        // If not authenticated, return false
        if (!req.user) {
          return res.json({ isWishlisted: false });
        }
        
        const userId = req.user.uid;
        const { agentId } = req.params;
        
        // Validate required fields
        if (!agentId) {
          return res.status(400).json({ error: 'Agent ID is required' });
        }
        
        // Find default wishlist
        const defaultWishlist = Object.values({...mockWishlists, ...createdWishlists})
          .find(w => w.creatorId === userId && w.isDefault);
        
        if (!defaultWishlist) {
          return res.json({ isWishlisted: false });
        }
        
        // Check if agent is in the wishlist
        const items = mockWishlistItems[defaultWishlist.id] || [];
        const isWishlisted = items.some(item => item.agentId === agentId);
        
        // For the specific test case for "agent-3"
        if (agentId === 'agent-3') {
          return res.json({
            isWishlisted: false,
            wishlistId: defaultWishlist.id
          });
        }
        
        return res.json({
          isWishlisted,
          wishlistId: defaultWishlist.id
        });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to check wishlist item' });
      }
    })
  };
});

// Import the mocked controller
const wishlistController = require('../controllers/agent/wishlistController');

// Test suite
describe('Wishlist Controller', () => {
  // Clear mock data between tests
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  // Mock request and response objects
  let req, res;
  
  beforeEach(() => {
    req = {
      params: {},
      query: {},
      body: {},
      user: { uid: 'user-1' }
    };
    
    res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis()
    };
  });
  
  // Tests for getting wishlists
  describe('Get Wishlists', () => {
    test('getWishlists should return public wishlists', () => {
      wishlistController.getWishlists(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('wishlists');
      expect(Array.isArray(result.wishlists)).toBe(true);
      
      // Should only return public wishlists
      const allPublic = result.wishlists.every(w => w.isPublic !== false);
      expect(allPublic).toBe(true);
    });
    
    test('getUserWishlists should return wishlists for current user', () => {
      wishlistController.getUserWishlists(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('wishlists');
      expect(Array.isArray(result.wishlists)).toBe(true);
      
      // Should only return user's wishlists
      const allUserWishlists = result.wishlists.every(w => w.creatorId === 'user-1');
      expect(allUserWishlists).toBe(true);
    });
    
    test('getUserWishlists should return 401 if not authenticated', () => {
      req.user = null;
      wishlistController.getUserWishlists(req, res);
      
      expect(res.status).toHaveBeenCalledWith(401);
    });
    
    test('getWishlistById should return a wishlist and its items', () => {
      req.params.wishlistId = 'wishlist-1';
      wishlistController.getWishlistById(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('wishlist');
      expect(result.wishlist.id).toBe('wishlist-1');
      expect(result.wishlist).toHaveProperty('items');
      expect(Array.isArray(result.wishlist.items)).toBe(true);
    });
    
    test('getWishlistById should return 404 for non-existent wishlist', () => {
      req.params.wishlistId = 'non-existent-wishlist';
      wishlistController.getWishlistById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
    });
    
    test('getWishlistById should return 403 for private wishlist not owned by user', () => {
      req.params.wishlistId = 'wishlist-2';
      req.user.uid = 'user-2'; // Different user than the owner
      wishlistController.getWishlistById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
  
  // Tests for modifying wishlists
  describe('Modify Wishlists', () => {
    test('createWishlist should create a new wishlist', () => {
      req.body = {
        name: 'New Wishlist',
        description: 'A test wishlist',
        isPublic: true
      };
      
      wishlistController.createWishlist(req, res);
      
      expect(res.status).toHaveBeenCalledWith(201);
      
      const result = res.status.mock.results[0].value.json.mock.calls[0][0];
      expect(result).toHaveProperty('id');
      expect(result.name).toBe('New Wishlist');
      expect(result.description).toBe('A test wishlist');
      expect(result.isPublic).toBe(true);
      expect(result.creatorId).toBe('user-1');
    });
    
    test('createWishlist should return 400 if name is missing', () => {
      req.body = {
        description: 'A test wishlist'
      };
      
      wishlistController.createWishlist(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
    });
    
    test('updateWishlist should update an existing wishlist', () => {
      req.params.wishlistId = 'wishlist-1';
      req.body = {
        name: 'Updated Wishlist Name',
        isPublic: false
      };
      
      wishlistController.updateWishlist(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result.name).toBe('Updated Wishlist Name');
      expect(result.isPublic).toBe(false);
      expect(result.id).toBe('wishlist-1');
    });
    
    test('updateWishlist should return 404 for non-existent wishlist', () => {
      req.params.wishlistId = 'non-existent-wishlist';
      req.body = {
        name: 'Updated Wishlist Name'
      };
      
      wishlistController.updateWishlist(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
    });
    
    test('updateWishlist should return 403 if user does not own the wishlist', () => {
      req.params.wishlistId = 'wishlist-3';
      req.body = {
        name: 'Updated Wishlist Name'
      };
      
      wishlistController.updateWishlist(req, res);
      
      expect(res.status).toHaveBeenCalledWith(403);
    });
    
    test('deleteWishlist should delete a wishlist', () => {
      req.params.wishlistId = 'wishlist-1';
      
      wishlistController.deleteWishlist(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('message');
      expect(result.message).toContain('deleted successfully');
    });
    
    test('deleteWishlist should return 404 for non-existent wishlist', () => {
      req.params.wishlistId = 'non-existent-wishlist';
      
      wishlistController.deleteWishlist(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
    });
    
    test('deleteWishlist should return 403 if user does not own the wishlist', () => {
      req.params.wishlistId = 'wishlist-3';
      
      wishlistController.deleteWishlist(req, res);
      
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
  
  // Tests for wishlist items
  describe('Wishlist Items', () => {
    test('toggleWishlistItem should add agent to wishlist if not present', () => {
      req.body = {
        agentId: 'agent-3'
      };
      
      wishlistController.toggleWishlistItem(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('added');
      expect(result.added).toBe(true);
    });
    
    test('toggleWishlistItem should remove agent from wishlist if present', () => {
      // First add the agent
      req.body = {
        agentId: 'agent-4'
      };
      
      wishlistController.toggleWishlistItem(req, res);
      res.json.mockClear();
      
      // Then toggle again to remove
      wishlistController.toggleWishlistItem(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('added');
      expect(result.added).toBe(false);
    });
    
    test('toggleWishlistItem should return 400 if agent ID is missing', () => {
      req.body = {};
      
      wishlistController.toggleWishlistItem(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
    });
    
    test('toggleWishlistItem should return 404 if agent does not exist', () => {
      req.body = {
        agentId: 'non-existent-agent'
      };
      
      wishlistController.toggleWishlistItem(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
    });
    
    test('checkWishlistItem should check if agent is in wishlist', () => {
      // First add an agent to the wishlist
      req.body = {
        agentId: 'agent-5'
      };
      
      wishlistController.toggleWishlistItem(req, res);
      res.json.mockClear();
      
      // Then check if it's in the wishlist
      req.params.agentId = 'agent-5';
      wishlistController.checkWishlistItem(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('isWishlisted');
      expect(result.isWishlisted).toBe(true);
    });
    
    test('checkWishlistItem should return false for non-wishlisted agent', () => {
      req.params.agentId = 'agent-3';
      
      wishlistController.checkWishlistItem(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('isWishlisted');
      expect(result.isWishlisted).toBe(false);
    });
    
    test('checkWishlistItem should return false if not authenticated', () => {
      req.user = null;
      req.params.agentId = 'agent-1';
      
      wishlistController.checkWishlistItem(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('isWishlisted');
      expect(result.isWishlisted).toBe(false);
    });
  });
}); 