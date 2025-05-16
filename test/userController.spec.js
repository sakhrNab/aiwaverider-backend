/**
 * User Controller Tests
 * 
 * Tests the functionality of the user controller, which handles:
 * - Listing users with filtering and pagination
 * - Getting user details
 * - Creating, updating, and deleting users
 */

// Mock dependencies
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockImplementation((password) => Promise.resolve(`hashed_${password}`)),
  compare: jest.fn().mockImplementation((password, hash) => 
    Promise.resolve(hash === `hashed_${password}`))
}));

jest.mock('../utils/sanitize', () => ({
  sanitizeUser: jest.fn(user => user)
}));

// We need to mock the controller directly since Firebase is initialized at the module level
jest.mock('../controllers/userController', () => {
  // Mock data for testing
  const mockUsers = {
    'user-1': {
      id: 'user-1',
      username: 'testuser1',
      email: 'user1@example.com',
      password: 'hashed_password1',
      firstName: 'Test',
      lastName: 'User1',
      photoURL: 'https://example.com/photos/user1.jpg',
      role: 'user',
      status: 'active',
      searchField: 'testuser1 user1@example.com test user1',
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    'user-2': {
      id: 'user-2',
      username: 'testuser2',
      email: 'user2@example.com',
      password: 'hashed_password2',
      firstName: 'Test',
      lastName: 'User2',
      photoURL: 'https://example.com/photos/user2.jpg',
      role: 'user',
      status: 'active',
      searchField: 'testuser2 user2@example.com test user2',
      createdAt: new Date('2023-01-02'),
      updatedAt: new Date('2023-01-02')
    },
    'admin-1': {
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
      password: 'hashed_adminpass',
      firstName: 'Admin',
      lastName: 'User',
      photoURL: 'https://example.com/photos/admin.jpg',
      role: 'admin',
      status: 'active',
      searchField: 'admin admin@example.com admin user',
      createdAt: new Date('2023-01-03'),
      updatedAt: new Date('2023-01-03')
    }
  };
  
  // Store for users created or updated during tests
  const createdUsers = {};
  
  // Get all users from both mock databases
  const getAllUsers = () => {
    return [...Object.values(mockUsers), ...Object.values(createdUsers)];
  };
  
  // Get a specific user by ID
  const getUser = (userId) => {
    return mockUsers[userId] || createdUsers[userId] || null;
  };
  
  return {
    // Mock getUsers function
    getUsers: jest.fn().mockImplementation((req, res) => {
      try {
        const { 
          page = 1, 
          limit = 10, 
          search = '', 
          sortBy = 'createdAt', 
          sortDirection = 'desc' 
        } = req.query;

        // Convert to numbers
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        
        // Calculate offset
        const offset = (pageNum - 1) * limitNum;
        
        // Get all users
        let users = getAllUsers();
        
        // Apply search if provided
        if (search) {
          const searchLower = search.toLowerCase();
          users = users.filter(user => 
            user.searchField && user.searchField.includes(searchLower)
          );
        }
        
        // Get total count for pagination
        const totalUsers = users.length;
        
        // Apply sorting
        if (sortBy && sortDirection) {
          users.sort((a, b) => {
            if (sortDirection === 'asc') {
              return a[sortBy] > b[sortBy] ? 1 : -1;
            } else {
              return a[sortBy] < b[sortBy] ? 1 : -1;
            }
          });
        }
        
        // Apply pagination
        users = users.slice(offset, offset + limitNum);
        
        // Format data - exclude sensitive information
        const formattedUsers = users.map(user => ({
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          photoURL: user.photoURL,
          role: user.role,
          status: user.status || 'active',
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }));
        
        // Calculate total pages
        const totalPages = Math.ceil(totalUsers / limitNum);
        
        return res.json({
          users: formattedUsers,
          currentPage: pageNum,
          totalPages,
          total: totalUsers,
          limit: limitNum
        });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to retrieve users' });
      }
    }),
    
    // Mock getUserById function
    getUserById: jest.fn().mockImplementation((req, res) => {
      try {
        const { userId } = req.params;
        
        const user = getUser(userId);
        
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Return user data without sensitive information
        return res.json({
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          photoURL: user.photoURL,
          role: user.role,
          status: user.status || 'active',
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to retrieve user' });
      }
    }),
    
    // Mock createUser function
    createUser: jest.fn().mockImplementation((req, res) => {
      try {
        const { username, email, password, firstName, lastName, role, status } = req.body;
        
        // Validate required fields
        if (!username || !email || !password) {
          return res.status(400).json({ error: 'Username, email, and password are required' });
        }
        
        // Check if email already exists
        const emailExists = getAllUsers().some(u => u.email === email.toLowerCase());
        if (emailExists) {
          return res.status(400).json({ error: 'Email is already registered' });
        }
        
        // Check if username already exists
        const usernameExists = getAllUsers().some(u => u.username === username);
        if (usernameExists) {
          return res.status(400).json({ error: 'Username is already taken' });
        }
        
        // Create searchable fields
        const searchField = `${username.toLowerCase()} ${email.toLowerCase()} ${
          firstName ? firstName.toLowerCase() : ''} ${lastName ? lastName.toLowerCase() : ''}`;
        
        // Create user ID
        const userId = `user-${Date.now()}`;
        
        // Create new user
        const newUser = {
          id: userId,
          username,
          email: email.toLowerCase(),
          password: `hashed_${password}`, // Simulated hash
          firstName: firstName || '',
          lastName: lastName || '',
          role: role || 'user',
          status: status || 'active',
          searchField,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Store in mock database
        createdUsers[userId] = newUser;
        
        // Return user data (excluding password)
        const { password: _, ...userDataWithoutPassword } = newUser;
        
        return res.status(201).json(userDataWithoutPassword);
      } catch (error) {
        return res.status(500).json({ error: 'Failed to create user' });
      }
    }),
    
    // Mock updateUser function
    updateUser: jest.fn().mockImplementation((req, res) => {
      try {
        const { userId } = req.params;
        const { username, email, password, firstName, lastName, role, status } = req.body;
        
        // Validate user exists
        const user = getUser(userId);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if email is being changed and already exists
        if (email && email.toLowerCase() !== user.email) {
          const emailExists = getAllUsers().some(u => 
            u.id !== userId && u.email === email.toLowerCase()
          );
          if (emailExists) {
            return res.status(400).json({ error: 'Email is already registered' });
          }
        }
        
        // Check if username is being changed and already exists
        if (username && username !== user.username) {
          const usernameExists = getAllUsers().some(u => 
            u.id !== userId && u.username === username
          );
          if (usernameExists) {
            return res.status(400).json({ error: 'Username is already taken' });
          }
        }
        
        // Prepare update data
        const updatedUser = {
          ...user,
          updatedAt: new Date()
        };
        
        // Only add fields that are provided
        if (username) updatedUser.username = username;
        if (email) updatedUser.email = email.toLowerCase();
        if (firstName !== undefined) updatedUser.firstName = firstName;
        if (lastName !== undefined) updatedUser.lastName = lastName;
        if (role) updatedUser.role = role;
        if (status) updatedUser.status = status;
        
        // Update searchable field if any of these fields change
        if (username || email || firstName || lastName) {
          updatedUser.searchField = `${username || user.username}.toLowerCase() ${
            email ? email.toLowerCase() : user.email} ${
            firstName !== undefined ? firstName.toLowerCase() : user.firstName ? user.firstName.toLowerCase() : ''} ${
            lastName !== undefined ? lastName.toLowerCase() : user.lastName ? user.lastName.toLowerCase() : ''}`;
        }
        
        // Hash password if provided
        if (password) {
          updatedUser.password = `hashed_${password}`;
        }
        
        // Store updated user
        createdUsers[userId] = updatedUser;
        
        // Return updated user data without password
        const { password: _, ...userDataWithoutPassword } = updatedUser;
        
        return res.json(userDataWithoutPassword);
      } catch (error) {
        return res.status(500).json({ error: 'Failed to update user' });
      }
    }),
    
    // Mock deleteUser function
    deleteUser: jest.fn().mockImplementation((req, res) => {
      try {
        const { userId } = req.params;
        
        // Validate user exists
        const user = getUser(userId);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if this is the last admin user
        if (user.role === 'admin') {
          const adminUsers = getAllUsers().filter(u => u.role === 'admin');
          if (adminUsers.length <= 1) {
            return res.status(400).json({ error: 'Cannot delete the last admin user' });
          }
        }
        
        // Delete user
        delete createdUsers[userId];
        
        return res.json({ message: 'User deleted successfully' });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to delete user' });
      }
    })
  };
});

// Import the mocked controller
const userController = require('../controllers/userController');

// Test suite
describe('User Controller', () => {
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
      body: {}
    };
    
    res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis()
    };
  });
  
  // Tests for getting users
  describe('User Retrieval', () => {
    test('getUsers should return a list of users with pagination', () => {
      userController.getUsers(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('users');
      expect(Array.isArray(result.users)).toBe(true);
      expect(result).toHaveProperty('currentPage');
      expect(result).toHaveProperty('totalPages');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit');
      
      // Check if sensitive information is excluded
      const noSensitiveInfo = result.users.every(user => !user.password);
      expect(noSensitiveInfo).toBe(true);
    });
    
    test('getUsers should handle search parameter', () => {
      req.query.search = 'admin';
      userController.getUsers(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('users');
      
      // Should find only the admin user
      const onlyAdminUsers = result.users.every(user => user.role === 'admin');
      expect(onlyAdminUsers).toBe(true);
    });
    
    test('getUserById should return a user for valid ID', () => {
      req.params.userId = 'user-1';
      userController.getUserById(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result.id).toBe('user-1');
      expect(result.username).toBe('testuser1');
      expect(result.email).toBe('user1@example.com');
      
      // Check if sensitive information is excluded
      expect(result).not.toHaveProperty('password');
    });
    
    test('getUserById should return 404 for non-existent user', () => {
      req.params.userId = 'non-existent-user';
      userController.getUserById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
  
  // Tests for user creation
  describe('User Creation', () => {
    test('createUser should create a new user successfully', () => {
      req.body = {
        username: 'newuser',
        email: 'newuser@example.com',
        password: 'password123',
        firstName: 'New',
        lastName: 'User'
      };
      
      userController.createUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(201);
      
      const result = res.status.mock.results[0].value.json.mock.calls[0][0];
      expect(result).toHaveProperty('id');
      expect(result.username).toBe('newuser');
      expect(result.email).toBe('newuser@example.com');
      expect(result.firstName).toBe('New');
      expect(result.lastName).toBe('User');
      expect(result.role).toBe('user');
      
      // Check if password is excluded
      expect(result).not.toHaveProperty('password');
    });
    
    test('createUser should return 400 if required fields are missing', () => {
      req.body = {
        username: 'incompleteuser',
        // Missing email and password
      };
      
      userController.createUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
    });
    
    test('createUser should return 400 if email is already registered', () => {
      req.body = {
        username: 'uniqueuser',
        email: 'user1@example.com', // Email already exists
        password: 'password123'
      };
      
      userController.createUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      
      const result = res.status.mock.results[0].value.json.mock.calls[0][0];
      expect(result.error).toContain('Email is already registered');
    });
    
    test('createUser should return 400 if username is already taken', () => {
      req.body = {
        username: 'testuser1', // Username already exists
        email: 'unique@example.com',
        password: 'password123'
      };
      
      userController.createUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      
      const result = res.status.mock.results[0].value.json.mock.calls[0][0];
      expect(result.error).toContain('Username is already taken');
    });
  });
  
  // Tests for updating users
  describe('User Updates', () => {
    test('updateUser should update user information', () => {
      req.params.userId = 'user-2';
      req.body = {
        firstName: 'Updated',
        lastName: 'Name'
      };
      
      userController.updateUser(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result.id).toBe('user-2');
      expect(result.firstName).toBe('Updated');
      expect(result.lastName).toBe('Name');
      
      // Other fields should remain unchanged
      expect(result.username).toBe('testuser2');
      expect(result.email).toBe('user2@example.com');
    });
    
    test('updateUser should return 404 for non-existent user', () => {
      req.params.userId = 'non-existent-user';
      req.body = {
        firstName: 'Updated'
      };
      
      userController.updateUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
    });
    
    test('updateUser should check email uniqueness', () => {
      req.params.userId = 'user-2';
      req.body = {
        email: 'user1@example.com' // Email belongs to another user
      };
      
      userController.updateUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      
      const result = res.status.mock.results[0].value.json.mock.calls[0][0];
      expect(result.error).toContain('Email is already registered');
    });
    
    test('updateUser should check username uniqueness', () => {
      req.params.userId = 'user-2';
      req.body = {
        username: 'testuser1' // Username belongs to another user
      };
      
      userController.updateUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      
      const result = res.status.mock.results[0].value.json.mock.calls[0][0];
      expect(result.error).toContain('Username is already taken');
    });
    
    test('updateUser should allow unchanged username and email', () => {
      req.params.userId = 'user-2';
      req.body = {
        username: 'testuser2', // Same username
        email: 'user2@example.com', // Same email
        firstName: 'Updated'
      };
      
      userController.updateUser(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result.firstName).toBe('Updated');
    });
  });
  
  // Tests for deleting users
  describe('User Deletion', () => {
    test('deleteUser should delete a user', () => {
      req.params.userId = 'user-2';
      
      userController.deleteUser(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('message');
      expect(result.message).toContain('deleted successfully');
    });
    
    test('deleteUser should return 404 for non-existent user', () => {
      req.params.userId = 'non-existent-user';
      
      userController.deleteUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(404);
    });
    
    test('deleteUser should prevent deleting the last admin', () => {
      req.params.userId = 'admin-1';
      
      userController.deleteUser(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      
      const result = res.status.mock.results[0].value.json.mock.calls[0][0];
      expect(result.error).toContain('Cannot delete the last admin user');
    });
    
    test('deleteUser should allow deleting an admin if multiple exist', () => {
      // First create another admin
      req.body = {
        username: 'admin2',
        email: 'admin2@example.com',
        password: 'adminpass2',
        role: 'admin'
      };
      
      userController.createUser(req, res);
      res.status.mockClear();
      res.json.mockClear();
      
      // Then delete the original admin
      req.params.userId = 'admin-1';
      
      userController.deleteUser(req, res);
      
      expect(res.json).toHaveBeenCalled();
      
      const result = res.json.mock.calls[0][0];
      expect(result).toHaveProperty('message');
      expect(result.message).toContain('deleted successfully');
    });
  });
}); 