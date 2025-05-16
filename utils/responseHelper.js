/**
 * Generate a standardized success response
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code (default: 200)
 * @param {string} message - Success message
 * @param {object|array} data - Response data
 * @param {object} meta - Additional metadata (pagination, etc.)
 * @returns {object} Express response
 */
const successResponse = (res, statusCode = 200, message = 'Success', data = null, meta = null) => {
  const response = {
    success: true,
    message
  };

  if (data !== null) {
    response.data = data;
  }

  if (meta !== null) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
};

/**
 * Generate a standardized error response
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {string} message - Error message
 * @param {string|object} error - Error details (will be converted to string in production)
 * @param {object} meta - Additional metadata
 * @returns {object} Express response
 */
const errorResponse = (res, statusCode = 500, message = 'An error occurred', error = null, meta = null) => {
  const response = {
    success: false,
    message
  };

  // In production, we might want to hide detailed error messages
  if (error !== null) {
    const isDev = process.env.NODE_ENV !== 'production';
    response.error = isDev ? error : 'See server logs for details';
  }

  if (meta !== null) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
};

module.exports = {
  successResponse,
  errorResponse
}; 