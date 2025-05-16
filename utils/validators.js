/**
 * Validators Utility
 * 
 * Collection of validation functions for various data types
 */

/**
 * Validate an email address
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if email is valid
 */
exports.validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  
  // Simple regex for email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate a URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if URL is valid
 */
exports.validateUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Validate a user ID
 * @param {string} userId - User ID to validate
 * @returns {boolean} - True if user ID is valid
 */
exports.validateUserId = (userId) => {
  if (!userId || typeof userId !== 'string') return false;
  
  // Firebase IDs are typically at least 20 characters
  return userId.length >= 20;
};

/**
 * Sanitize HTML content to prevent XSS
 * @param {string} html - HTML content to sanitize
 * @returns {string} - Sanitized HTML
 */
exports.sanitizeHtml = (html) => {
  if (!html || typeof html !== 'string') return '';
  
  // Basic sanitization (in a real app, use a library like DOMPurify)
  return html
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/**
 * Validate that an object has required fields
 * @param {Object} obj - Object to validate
 * @param {Array} requiredFields - Array of required field names
 * @returns {boolean} - True if all required fields are present and non-empty
 */
exports.hasRequiredFields = (obj, requiredFields) => {
  if (!obj || typeof obj !== 'object') return false;
  
  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      return false;
    }
  }
  
  return true;
};

/**
 * Validate a password
 * @param {string} password - Password to validate
 * @param {Object} options - Validation options
 * @returns {Object} - Validation result with isValid and message
 */
exports.validatePassword = (password, options = {}) => {
  const {
    minLength = 8,
    requireNumbers = true,
    requireUppercase = true,
    requireLowercase = true,
    requireSpecialChars = true
  } = options;
  
  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      message: 'Password is required'
    };
  }
  
  if (password.length < minLength) {
    return {
      isValid: false,
      message: `Password must be at least ${minLength} characters long`
    };
  }
  
  if (requireNumbers && !/\d/.test(password)) {
    return {
      isValid: false,
      message: 'Password must contain at least one number'
    };
  }
  
  if (requireUppercase && !/[A-Z]/.test(password)) {
    return {
      isValid: false,
      message: 'Password must contain at least one uppercase letter'
    };
  }
  
  if (requireLowercase && !/[a-z]/.test(password)) {
    return {
      isValid: false,
      message: 'Password must contain at least one lowercase letter'
    };
  }
  
  if (requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return {
      isValid: false,
      message: 'Password must contain at least one special character'
    };
  }
  
  return {
    isValid: true,
    message: 'Password is valid'
  };
}; 