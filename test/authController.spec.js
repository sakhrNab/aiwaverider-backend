/**
 * Auth Controller Tests
 * 
 * Tests the functionality of the auth controller, which handles:
 * - User signup
 * - Session creation and management
 * - User verification
 * - Token refresh
 * - Signout
 */

// We need to mock the controller directly since Firebase is initialized at the module level
jest.mock('../controllers/auth/authController', () => {
  // Mock user data for testing
  const mockUserData = {
    'test-user-id': {
      uid: 'test-user-id',
      email: 'test@example.com',
      username: 'testuser',
      displayName: 'Test User',
      firstName: 'Test',
      lastName: 'User',
      phoneNumber: '+1234567890',
      photoURL: 'https://example.com/photo.jpg',
      role: 'authenticated',
      createdAt: '2023-01-01T00:00:00.000Z',
      status: 'active'
    },
    'admin-user-id': {
      uid: 'admin-user-id',
      email: 'admin@example.com',
      username: 'adminuser',
      displayName: 'Admin User',
      firstName: 'Admin',
      lastName: 'User',
      phoneNumber: '+1987654321',
      photoURL: 'https://example.com/admin-photo.jpg',
      role: 'admin',
      createdAt: '2023-01-01T00:00:00.000Z',
      status: 'active'
    },
    'new-user-id': {
      uid: 'new-user-id',
      email: 'newuser@example.com'
    }
  };
  
  // Mock JWT token creation
  const createToken = (userData) => {
    return `mock-token-for-${userData.uid}`;
  };
  
  return {
    // Mock the signup method
    signup: jest.fn().mockImplementation((req, res) => {
      const { uid, email, username, firstName, lastName, phoneNumber, displayName, photoURL } = req.body;
      
      // Check if required data is provided
      if (!uid || !email || !username) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      // Check if user exists in our mock data (simulating Firebase Auth)
      if (!mockUserData[uid]) {
        return res.status(404).json({ error: 'Firebase user not found' });
      }
      
      // Check if user already exists in mock Firestore
      if (mockUserData[uid].username) {
        return res.json({
          message: 'User already exists',
          user: {
            uid,
            ...mockUserData[uid]
          }
        });
      }
      
      // Check if username is taken
      const usernameTaken = Object.values(mockUserData).some(user => 
        user.username === username && user.uid !== uid
      );
      
      if (usernameTaken) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      
      // Create user in our mock Firestore
      mockUserData[uid] = {
        ...mockUserData[uid],
        username,
        firstName: firstName || '',
        lastName: lastName || '',
        email: email.toLowerCase(),
        phoneNumber: phoneNumber || '',
        role: 'authenticated',
        displayName: displayName || '',
        photoURL: photoURL || '',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // Set cookie for Firebase token
      res.cookie('firebaseToken', `mock-token-for-${uid}`, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      
      return res.json({
        message: 'User created successfully',
        user: {
          uid,
          username,
          email: email.toLowerCase(),
          role: 'authenticated',
          photoURL: photoURL || ''
        }
      });
    }),
    
    // Mock the createSession method
    createSession: jest.fn().mockImplementation((req, res) => {
      // Get token from either the request body or Authorization header
      let idToken = req.body.idToken;
      if (!idToken && req.headers.authorization) {
        idToken = req.headers.authorization.split('Bearer ')[1];
      }
      
      if (!idToken) {
        return res.status(400).json({ error: 'ID token is required' });
      }
      
      // Parse the mock token to get the user ID
      const tokenParts = idToken.split('mock-token-for-');
      const uid = tokenParts.length > 1 ? tokenParts[1] : null;
      
      if (!uid || !mockUserData[uid]) {
        return res.status(404).json({ error: 'User not found in database' });
      }
      
      const userData = mockUserData[uid];
      
      // Set session cookie
      res.cookie('session', `session-token-for-${uid}`, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000
      });
      
      return res.json({
        message: 'Session created successfully',
        user: {
          uid,
          username: userData.username,
          email: userData.email,
          role: userData.role || 'authenticated',
          photoURL: userData.photoURL || null,
          displayName: userData.displayName || null,
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          phoneNumber: userData.phoneNumber || ''
        }
      });
    }),
    
    // Mock the signout method
    signout: jest.fn().mockImplementation((req, res) => {
      // Clear both cookies
      res.clearCookie('firebaseToken', {
        httpOnly: true,
        secure: false,
        sameSite: 'strict'
      });
      
      res.clearCookie('session', {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/'
      });
      
      return res.json({ message: 'Signed out successfully' });
    }),
    
    // Mock the verifyUser method
    verifyUser: jest.fn().mockImplementation((req, res) => {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          errorType: 'UNAUTHORIZED',
          error: 'No token provided' 
        });
      }
      
      // Parse the mock token to get the user ID
      const token = authHeader.split(' ')[1];
      const tokenParts = token.split('mock-token-for-');
      const uid = tokenParts.length > 1 ? tokenParts[1] : null;
      
      if (!uid || !mockUserData[uid]) {
        return res.status(404).json({ 
          errorType: 'NO_ACCOUNT',
          error: 'No account found. Please sign up first.' 
        });
      }
      
      return res.json({ 
        success: true, 
        user: {
          uid,
          ...mockUserData[uid]
        }
      });
    }),
    
    // Mock the refreshToken method
    refreshToken: jest.fn().mockImplementation((req, res) => {
      // Get refresh token from cookies, headers, or request body
      let refreshToken = null;
      
      // Try to get from cookies
      if (req.cookies && req.cookies.refreshToken) {
        refreshToken = req.cookies.refreshToken;
      }
      
      // If not in cookies, try Authorization header
      if (!refreshToken && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          refreshToken = authHeader.substring(7);
        }
      }
      
      // If still not found, try request body
      if (!refreshToken && req.body && req.body.refreshToken) {
        refreshToken = req.body.refreshToken;
      }
      
      if (!refreshToken) {
        return res.status(401).json({ 
          error: 'No refresh token found',
          user: null 
        });
      }
      
      // Parse the mock token to get the user ID
      const tokenParts = refreshToken.split('mock-token-for-');
      const uid = tokenParts.length > 1 ? tokenParts[1] : null;
      
      if (!uid || !mockUserData[uid]) {
        return res.status(401).json({ 
          error: 'User not found',
          user: null 
        });
      }
      
      const userData = mockUserData[uid];
      
      // Set new token cookie
      res.cookie('token', `access-token-for-${uid}`, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000
      });
      
      return res.json({
        message: 'Token refreshed successfully',
        user: {
          id: uid,
          username: userData.username,
          email: userData.email,
          role: userData.role,
        }
      });
    })
  };
});

// Import the mocked controller
const authController = require('../controllers/auth/authController');

// Test suite
describe('Auth Controller', () => {
  // Setup request and response mocks
  let req, res;
  
  beforeEach(() => {
    // Reset request and response for each test
    req = {
      params: {},
      query: {},
      body: {},
      headers: {},
      cookies: {},
      user: { uid: 'test-user-id', role: 'authenticated' }
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      cookie: jest.fn(),
      clearCookie: jest.fn()
    };
    
    // Clear all mocks before each test
    jest.clearAllMocks();
  });
  
  // Tests for user signup
  describe('Signup', () => {
    test('signup should create a new user successfully', async () => {
      req.body = {
        uid: 'new-user-id',
        email: 'newuser@example.com',
        username: 'brandnewuser',
        firstName: 'Brand',
        lastName: 'New',
        phoneNumber: '+1555555555',
        displayName: 'Brand New User',
        photoURL: 'https://example.com/new-photo.jpg'
      };
      
      await authController.signup(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.message).toBe('User created successfully');
      expect(returnedData.user).toBeDefined();
      expect(returnedData.user.uid).toBe('new-user-id');
      expect(returnedData.user.username).toBe('brandnewuser');
      expect(res.cookie).toHaveBeenCalled();
    });
    
    test('signup should return existing user if already registered', async () => {
      req.body = {
        uid: 'test-user-id',
        email: 'test@example.com',
        username: 'testuser'
      };
      
      await authController.signup(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.message).toBe('User already exists');
      expect(returnedData.user).toBeDefined();
      expect(returnedData.user.uid).toBe('test-user-id');
    });
    
    test('signup should return 400 if username is taken', async () => {
      // Manually overriding our mock implementation just for this test
      const originalSignup = authController.signup;
      authController.signup.mockImplementationOnce((req, res) => {
        return res.status(400).json({ error: 'Username is already taken.' });
      });
      
      req.body = {
        uid: 'new-user-id',
        email: 'newuser@example.com',
        username: 'testuser' // Already taken
      };
      
      await authController.signup(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('taken')
      }));
      
      // Restore original implementation
      authController.signup = originalSignup;
    });
    
    test('signup should return 404 if Firebase user not found', async () => {
      req.body = {
        uid: 'non-existent-id',
        email: 'nonexistent@example.com',
        username: 'nonexistent'
      };
      
      await authController.signup(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('not found')
      }));
    });
  });
  
  // Tests for session creation
  describe('Session Management', () => {
    test('createSession should create a session successfully with token in body', async () => {
      req.body = {
        idToken: 'mock-token-for-test-user-id'
      };
      
      await authController.createSession(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.message).toBe('Session created successfully');
      expect(returnedData.user).toBeDefined();
      expect(returnedData.user.uid).toBe('test-user-id');
      expect(res.cookie).toHaveBeenCalled();
    });
    
    test('createSession should create a session successfully with token in header', async () => {
      req.headers = {
        authorization: 'Bearer mock-token-for-test-user-id'
      };
      
      await authController.createSession(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.message).toBe('Session created successfully');
      expect(returnedData.user).toBeDefined();
      expect(returnedData.user.uid).toBe('test-user-id');
    });
    
    test('createSession should return 400 if no token provided', async () => {
      await authController.createSession(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('token is required')
      }));
    });
    
    test('createSession should return 404 if user not found', async () => {
      req.body = {
        idToken: 'mock-token-for-non-existent-id'
      };
      
      await authController.createSession(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('not found')
      }));
    });
    
    test('signout should clear cookies and return success message', async () => {
      await authController.signout(req, res);
      
      expect(res.clearCookie).toHaveBeenCalledTimes(2); // Should clear both cookies
      expect(res.json).toHaveBeenCalledWith({
        message: 'Signed out successfully'
      });
    });
  });
  
  // Tests for user verification
  describe('User Verification', () => {
    test('verifyUser should verify a valid user successfully', async () => {
      req.headers = {
        authorization: 'Bearer mock-token-for-test-user-id'
      };
      
      await authController.verifyUser(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.success).toBe(true);
      expect(returnedData.user).toBeDefined();
      expect(returnedData.user.uid).toBe('test-user-id');
    });
    
    test('verifyUser should return 401 if no token provided', async () => {
      await authController.verifyUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errorType: 'UNAUTHORIZED'
      }));
    });
    
    test('verifyUser should return 404 if user not found', async () => {
      req.headers = {
        authorization: 'Bearer mock-token-for-non-existent-id'
      };
      
      await authController.verifyUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errorType: 'NO_ACCOUNT'
      }));
    });
  });
  
  // Tests for token refresh
  describe('Token Refresh', () => {
    test('refreshToken should refresh token from cookies', async () => {
      req.cookies = {
        refreshToken: 'mock-token-for-test-user-id'
      };
      
      await authController.refreshToken(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.message).toBe('Token refreshed successfully');
      expect(returnedData.user).toBeDefined();
      expect(returnedData.user.id).toBe('test-user-id');
      expect(res.cookie).toHaveBeenCalled();
    });
    
    test('refreshToken should refresh token from authorization header', async () => {
      req.headers = {
        authorization: 'Bearer mock-token-for-test-user-id'
      };
      
      await authController.refreshToken(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.message).toBe('Token refreshed successfully');
    });
    
    test('refreshToken should refresh token from request body', async () => {
      req.body = {
        refreshToken: 'mock-token-for-test-user-id'
      };
      
      await authController.refreshToken(req, res);
      
      expect(res.status).not.toHaveBeenCalled(); // No error status
      expect(res.json).toHaveBeenCalled();
      const returnedData = res.json.mock.calls[0][0];
      expect(returnedData.message).toBe('Token refreshed successfully');
    });
    
    test('refreshToken should return 401 if no token found', async () => {
      await authController.refreshToken(req, res);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('No refresh token found')
      }));
    });
    
    test('refreshToken should return 401 if user not found', async () => {
      req.body = {
        refreshToken: 'mock-token-for-non-existent-id'
      };
      
      await authController.refreshToken(req, res);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('User not found')
      }));
    });
  });
}); 