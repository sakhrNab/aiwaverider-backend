// backend/utils/sanitize.js

const sanitizeHtml = require('sanitize-html');

/**
 * Sanitize content using sanitize-html
 * @param {string} content - Content to sanitize
 * @param {object} options - Sanitize options
 * @returns {string} - Sanitized content
 */
const sanitizeContent = (content, options = {}) => {
  return sanitizeHtml(content, {
    allowedTags: options.allowedTags || [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'p', 'a', 'ul', 'ol', 'nl', 'li', 'b', 'i', 'strong',
      'em', 'strike', 'code', 'hr', 'br', 'div', 'table',
      'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'span', 'img'
    ],
    allowedAttributes: options.allowedAttributes || {
      'a': ['href', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height'],
      '*': ['class', 'id', 'style']
    },
    allowedStyles: options.allowedStyles || {
      '*': {
        'color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/],
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        'font-size': [/^\d+(?:px|em|rem|%)$/]
      }
    }
  });
};

/**
 * Sanitize user input (very strict, no HTML allowed)
 * @param {string} input - User input to sanitize
 * @returns {string} - Sanitized input
 */
const sanitize = (input) => {
  if (typeof input !== 'string') {
    return input;
  }
  
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard'
  });
};

/**
 * Sanitize an object by recursively sanitizing all string properties
 * @param {object} obj - Object to sanitize
 * @returns {object} - Sanitized object
 */
const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  const result = {};
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      
      if (typeof value === 'string') {
        result[key] = sanitize(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeObject(value);
      } else {
        result[key] = value;
      }
    }
  }
  
  return result;
};

/**
 * Helper function to safely format timestamps
 * @param {*} timestamp - Timestamp to format (could be Firestore timestamp, Date, string, etc.)
 * @returns {string|null} - Formatted ISO string or null
 */
const formatTimestamp = (timestamp) => {
  if (!timestamp) return null;
  
  // Check if it's a Firestore timestamp with toDate function
  if (timestamp && typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  
  // If it's already a Date object
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  
  // If it's a string that might be ISO format already
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  
  // Fallback
  return null;
};

/**
 * Sanitize user data to return a clean object without sensitive info
 * @param {object} user - User object
 * @returns {object} - Sanitized user object
 */
const sanitizeUser = (user) => {
  if (!user) return null;
  
  // Create a clean object with only the fields we want to expose
  const sanitizedUser = {
    id: user.id,
    username: user.username || user.displayName,
    email: user.email,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    photoURL: user.photoURL,
    role: user.role,
    status: user.status || 'active',
    createdAt: formatTimestamp(user.createdAt),
    updatedAt: formatTimestamp(user.updatedAt)
  };
  
  // Remove any undefined fields
  Object.keys(sanitizedUser).forEach(key => {
    if (sanitizedUser[key] === undefined) {
      delete sanitizedUser[key];
    }
  });
  
  return sanitizedUser;
};

module.exports = {
  sanitizeContent,
  sanitize,
  sanitizeObject,
  sanitizeUser,
  formatTimestamp
};
