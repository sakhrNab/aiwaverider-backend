console.log('Loading appsController.js');

// TODO: Create an `apps` table in PostgreSQL to fully migrate this controller.
// The apps collection was excluded from the Firestore-to-PostgreSQL migration as low priority.
// Until the table is created, write operations return 501 and reads return empty results.
const { pool } = require('../../config/database');
const logger = require('../../utils/logger');

// ==========================================
// IN-MEMORY CACHE FOR ALL APPS
// ==========================================
let allAppsCache = null;
let cacheLastUpdated = null;
const CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load all apps into memory cache
 * TODO: Implement actual PostgreSQL query once the `apps` table is created
 */
const refreshAppsCache = async () => {
  try {
    logger.warn('Apps table not yet migrated to PostgreSQL — returning empty cache');
    allAppsCache = [];
    cacheLastUpdated = new Date();
    return true;
  } catch (error) {
    logger.error('Error refreshing apps cache:', error);
    return false;
  }
};

/**
 * Ensure cache is loaded and fresh
 */
const ensureCacheLoaded = async () => {
  const needsRefresh = !allAppsCache ||
    !cacheLastUpdated ||
    (new Date() - cacheLastUpdated) > CACHE_REFRESH_INTERVAL;

  if (needsRefresh) {
    logger.info('Apps cache needs refresh, loading...');
    await refreshAppsCache();
  }

  return allAppsCache !== null;
};

/**
 * Search apps in memory
 */
const searchApps = (apps, searchQuery) => {
  if (!searchQuery || !searchQuery.trim()) return apps;

  const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/);

  return apps.filter(app => {
    const searchableText = [
      app.title,
      app.description,
      app.shortDescription,
      app.category,
      ...(app.categories || []),
      ...(app.tags || []),
      ...(app.features || [])
    ].filter(Boolean).join(' ').toLowerCase();

    return searchTerms.every(term => searchableText.includes(term));
  });
};

/**
 * GET /api/apps - List apps with filtering and pagination
 */
const getApps = async (req, res) => {
  try {
    await ensureCacheLoaded();

    const {
      page = 1,
      limit = 12,
      searchQuery = '',
      category,
      type,
      sort = 'newest',
      minPrice,
      maxPrice
    } = req.query;

    let filteredApps = [...(allAppsCache || [])];

    // Only show published apps for public requests
    filteredApps = filteredApps.filter(app => app.isPublished !== false);

    // Search
    if (searchQuery) {
      filteredApps = searchApps(filteredApps, searchQuery);
    }

    // Category filter
    if (category && category !== 'All') {
      filteredApps = filteredApps.filter(app =>
        app.category === category ||
        (app.categories && app.categories.includes(category))
      );
    }

    // Type filter (app/tool)
    if (type && type !== 'All') {
      filteredApps = filteredApps.filter(app => app.type === type.toLowerCase());
    }

    // Price range filter
    if (minPrice !== undefined) {
      filteredApps = filteredApps.filter(app => (app.price || 0) >= Number(minPrice));
    }
    if (maxPrice !== undefined) {
      filteredApps = filteredApps.filter(app => (app.price || 0) <= Number(maxPrice));
    }

    // Sort
    switch (sort) {
      case 'newest':
        filteredApps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'oldest':
        filteredApps.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'price-low':
        filteredApps.sort((a, b) => (a.price || 0) - (b.price || 0));
        break;
      case 'price-high':
        filteredApps.sort((a, b) => (b.price || 0) - (a.price || 0));
        break;
      case 'popular':
        filteredApps.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));
        break;
      case 'rating':
        filteredApps.sort((a, b) => (b.rating?.average || 0) - (a.rating?.average || 0));
        break;
      default:
        break;
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedApps = filteredApps.slice(startIndex, startIndex + limitNum);

    res.status(200).json({
      apps: paginatedApps,
      pagination: {
        currentPage: pageNum,
        pageSize: limitNum,
        totalItems: filteredApps.length,
        totalPages: Math.ceil(filteredApps.length / limitNum),
        hasMore: startIndex + limitNum < filteredApps.length
      }
    });
  } catch (error) {
    logger.error('Error fetching apps:', error);
    res.status(500).json({ error: 'Failed to fetch apps' });
  }
};

/**
 * GET /api/apps/featured - Get featured apps
 */
const getFeaturedApps = async (req, res) => {
  try {
    await ensureCacheLoaded();

    const featuredApps = (allAppsCache || []).filter(
      app => app.isFeatured && app.isPublished !== false
    );

    res.status(200).json({ apps: featuredApps });
  } catch (error) {
    logger.error('Error fetching featured apps:', error);
    res.status(500).json({ error: 'Failed to fetch featured apps' });
  }
};

/**
 * GET /api/apps/:appId - Get single app by ID
 */
const getAppById = async (req, res) => {
  try {
    await ensureCacheLoaded();

    const { appId } = req.params;
    const app = (allAppsCache || []).find(a => a.id === appId || a.slug === appId);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    res.status(200).json(app);
  } catch (error) {
    logger.error('Error fetching app:', error);
    res.status(500).json({ error: 'Failed to fetch app' });
  }
};

/**
 * POST /api/apps - Create new app (admin only)
 * TODO: Implement once the `apps` table is created in PostgreSQL
 */
const createApp = async (req, res) => {
  logger.warn('createApp called but apps table not yet migrated to PostgreSQL');
  return res.status(501).json({ error: 'Apps feature not yet migrated to PostgreSQL' });
};

/**
 * PUT /api/apps/:appId - Update app (admin only)
 * TODO: Implement once the `apps` table is created in PostgreSQL
 */
const updateApp = async (req, res) => {
  logger.warn('updateApp called but apps table not yet migrated to PostgreSQL');
  return res.status(501).json({ error: 'Apps feature not yet migrated to PostgreSQL' });
};

/**
 * DELETE /api/apps/:appId - Delete app (admin only)
 * TODO: Implement once the `apps` table is created in PostgreSQL
 */
const deleteApp = async (req, res) => {
  logger.warn('deleteApp called but apps table not yet migrated to PostgreSQL');
  return res.status(501).json({ error: 'Apps feature not yet migrated to PostgreSQL' });
};

/**
 * POST /api/apps/:appId/download - Track free download
 * TODO: Implement once the `apps` table is created in PostgreSQL
 */
const freeDownload = async (req, res) => {
  logger.warn('freeDownload called but apps table not yet migrated to PostgreSQL');
  return res.status(501).json({ error: 'Apps feature not yet migrated to PostgreSQL' });
};

/**
 * POST /api/apps/:appId/views - Increment view count
 * TODO: Implement once the `apps` table is created in PostgreSQL
 */
const incrementViews = async (req, res) => {
  logger.warn('incrementViews called but apps table not yet migrated to PostgreSQL');
  return res.status(501).json({ error: 'Apps feature not yet migrated to PostgreSQL' });
};

/**
 * POST /api/apps/cache/refresh - Admin cache refresh
 */
const refreshCache = async (req, res) => {
  try {
    await refreshAppsCache();
    res.status(200).json({
      message: 'Apps cache refreshed successfully',
      count: allAppsCache ? allAppsCache.length : 0,
      lastUpdated: cacheLastUpdated
    });
  } catch (error) {
    logger.error('Error refreshing cache:', error);
    res.status(500).json({ error: 'Failed to refresh cache' });
  }
};

module.exports = {
  getApps,
  getAppById,
  getFeaturedApps,
  createApp,
  updateApp,
  deleteApp,
  freeDownload,
  incrementViews,
  refreshCache
};
