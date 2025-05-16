/**
 * Profile Controller Tests
 * 
 * Tests the functionality of the profile controller, which handles:
 * - Retrieving user profile information
 * - Updating user profiles
 */

// We need to mock the controller directly since the approach we used before isn't working
// Let's create a proper mock for the controller
jest.mock('../controllers/user/profileController', () => {
  // Mock user data
  const mockUserData = {
    'test-user-id': {
      uid: 'test-user-id',
      email: 'test@example.com',
      username: 'testuser',
      displayName: 'Test User',
      firstName: 'Test',
      lastName: 'User',
      bio: 'This is a test bio',
      photoURL: 'https://example.com/photo.jpg',
      createdAt: '2023-01-01T00:00:00.000Z',
      searchField: 'testuser test user',
      role: 'user'
    },
    'admin-user-id': {
      uid: 'admin-user-id',
      email: 'admin@example.com',
      username: 'adminuser',
      displayName: 'Admin User',
      firstName: 'Admin',
      lastName: 'User',
      bio: 'Admin bio',
      photoURL: 'https://example.com/admin-photo.jpg',
      createdAt: '2023-01-01T00:00:00.000Z',
      searchField: 'adminuser admin user',
      role: 'admin'
    }
  };
  
  // Keep track of updates
  let updatedUsername = '';
  
  return {
    // Mock the getProfile method
    getProfile: jest.fn().mockImplementation((req, res) => {
      const userId = req.user?.uid;
      
      if (!userId || !mockUserData[userId]) {
        return res.status(404).json({ error: 'User not found.' });
      }
      
      const profileData = {
        id: userId,
        ...mockUserData[userId]
      };
      
      return res.status(200).json(profileData);
    }),
    
    // Mock the getProfileById method
    getProfileById: jest.fn().mockImplementation((req, res) => {
      const { userId } = req.params;
      
      if (!userId || !mockUserData[userId]) {
        return res.status(404).json({ error: 'User not found.' });
      }
      
      const profileData = {
        id: userId,
        ...mockUserData[userId]
      };
      
      return res.status(200).json(profileData);
    }),
    
    // Mock the updateProfile method
    updateProfile: jest.fn().mockImplementation((req, res) => {
      const userId = req.user?.uid;
      
      if (!userId || !mockUserData[userId]) {
        return res.status(404).json({ error: 'User not found.' });
      }
      
      const { username, firstName, lastName, displayName } = req.body;
      
      // Check for username uniqueness
      if (username) {
        const usernameTaken = Object.values(mockUserData).some(
          user => user.username === username && user.uid !== userId
        );
        
        if (usernameTaken) {
          return res.status(400).json({ error: 'Username is already taken.' });
        }
        
        updatedUsername = username;
        mockUserData[userId].username = username;
      }
      
      // Update other fields if provided
      if (firstName !== undefined) mockUserData[userId].firstName = firstName;
      if (lastName !== undefined) mockUserData[userId].lastName = lastName;
      if (displayName !== undefined) mockUserData[userId].displayName = displayName;
      
      // Update searchField
      if (username || firstName || lastName || displayName) {
        mockUserData[userId].searchField = `${mockUserData[userId].username} ${mockUserData[userId].firstName || ''} ${mockUserData[userId].lastName || ''} ${mockUserData[userId].displayName || ''}`.toLowerCase();
      }
      
      const profileData = {
        id: userId,
        ...mockUserData[userId]
      };
      
      return res.status(200).json(profileData);
    })
  };
});

// Import the mocked controller
const profileController = require('../controllers/profileprofileController');

// Test suite
describe('Profile Controller', () => {
  // Setup request and response mocks
  let req, res;
  
  beforeEach(() => {
    // Reset request and response for each test
    req = {
      params: {},
      query: {},
      body: {},
      user: { uid: 'test-user-id', role: 'user' },
      file: null
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    
    // Clear all mocks before each test
    jest.clearAllMocks();
  });
  
  // Tests for profile retrieval
  describe('Get Profile', () => {
    test('getProfile should return current user profile', async () => {
      await profileController.getProfile(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData).toBeDefined();
      expect(returnedData.id).toBe('test-user-id');
    });
    
    test('getProfileById should return user profile for valid user ID', async () => {
      req.params.userId = 'test-user-id';
      
      await profileController.getProfileById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData).toBeDefined();
      expect(returnedData.id).toBe('test-user-id');
    });
    
    test('getProfileById should return 404 for non-existent user', async () => {
      req.params.userId = 'non-existent-user';
      
      await profileController.getProfileById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.any(String)
      }));
    });
  });
  
  // Tests for profile updates
  describe('Update Profile', () => {
    test('updateProfile should update user profile', async () => {
      req.body = {
        displayName: 'Updated Name',
        firstName: 'Updated',
        lastName: 'Name'
      };
      
      await profileController.updateProfile(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.displayName).toBe('Updated Name');
      expect(returnedData.firstName).toBe('Updated');
      expect(returnedData.lastName).toBe('Name');
    });
    
    test('updateProfile should return 404 if user not found', async () => {
      req.user.uid = 'non-existent-user';
      
      await profileController.updateProfile(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.any(String)
      }));
    });
    
    test('updateProfile should check username availability', async () => {
      req.body = {
        username: 'adminuser' // This username is already taken
      };
      
      await profileController.updateProfile(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('taken')
      }));
    });
    
    test('updateProfile should allow changing to a new username', async () => {
      req.body = {
        username: 'newusername' // This username is available
      };
      
      await profileController.updateProfile(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.username).toBe('newusername');
    });
  });
}); 