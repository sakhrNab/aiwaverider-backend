// jest.config.js
module.exports = {
  // Set the test environment to Node.js
  testEnvironment: 'node',
  
  // Run tests in the test directory with these patterns
  testMatch: [
    '**/__tests__/**/*.js?(x)',
    '**/?(*.)+(spec|test).js?(x)'
  ],
  
  // Exclude test files that don't use Jest's describe/it pattern
  testPathIgnorePatterns: [
    '/node_modules/',
    'test/agentController.test.js',  // Exclude our custom non-Jest test
    'routes/test.js'                 // Exclude empty test file
  ],
  
  // Mock modules to avoid network calls and database connections
  moduleNameMapper: {
    '^../config/firebase$': '<rootDir>/test/mockFirebase.js'
  },
  
  // Collect test coverage
  collectCoverage: false,
  coverageDirectory: '<rootDir>/coverage',
  
  // Set up transformation for files
  transform: {},
  
  // Add verbose output
  verbose: true,
  
  // Setup and teardown files
  setupFiles: [],
  setupFilesAfterEnv: [],
  
  // Automatically clear mocks between tests
  clearMocks: true,
  
  // Run tests in parallel
  maxWorkers: '50%',
  
  // Configure test timeouts (5 seconds per test)
  testTimeout: 5000
}; 