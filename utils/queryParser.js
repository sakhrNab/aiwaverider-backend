/**
 * Utility functions for parsing query parameters
 */

/**
 * Parse custom filters from query parameters
 * @param {Object} queryParams - Query parameters from request
 * @returns {Object} - Parsed filter object
 */
const parseCustomFilters = (queryParams) => {
  const filters = {};
  
  // Handle category filter
  if (queryParams.category && queryParams.category !== 'All') {
    filters.category = queryParams.category;
  }
  
  // Handle price range filters
  if (queryParams.priceMin || queryParams.priceMax) {
    filters.price = {};
    
    if (queryParams.priceMin) {
      filters.price.min = parseFloat(queryParams.priceMin);
    }
    
    if (queryParams.priceMax) {
      filters.price.max = parseFloat(queryParams.priceMax);
    }
  }
  
  // Handle rating filter
  if (queryParams.rating) {
    filters.rating = parseFloat(queryParams.rating);
  }
  
  // Handle tag filters
  if (queryParams.tags) {
    filters.tags = queryParams.tags.split(',').map(tag => tag.trim());
  }
  
  // Handle feature filters
  if (queryParams.features) {
    filters.features = queryParams.features.split(',').map(feature => feature.trim());
  }
  
  // Handle search term
  if (queryParams.search) {
    filters.search = queryParams.search.trim().toLowerCase();
  }
  
  return filters;
};

module.exports = {
  parseCustomFilters
}; 