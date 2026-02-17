console.log('Loading appsController.js');

const { db } = require('../../config/firebase');
const admin = require('firebase-admin');
const logger = require('../../utils/logger');

// ==========================================
// IN-MEMORY CACHE FOR ALL APPS
// ==========================================
let allAppsCache = null;
let cacheLastUpdated = null;
const CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load all apps from Firebase into memory cache
 */
const refreshAppsCache = async () => {
  try {
    logger.info('Refreshing apps cache from Firebase...');
    const startTime = Date.now();

    const snapshot = await db.collection('apps')
      .orderBy('createdAt', 'desc')
      .get();

    allAppsCache = [];
    snapshot.forEach(doc => {
      const data = doc.data();

      // Convert Firestore timestamps
      if (data.createdAt) {
        if (data.createdAt.toDate && typeof data.createdAt.toDate === 'function') {
          data.createdAt = data.createdAt.toDate();
        } else if (data.createdAt._seconds) {
          data.createdAt = new Date(data.createdAt._seconds * 1000);
        } else if (typeof data.createdAt === 'string') {
          data.createdAt = new Date(data.createdAt);
        }
      }
      if (data.updatedAt) {
        if (data.updatedAt.toDate && typeof data.updatedAt.toDate === 'function') {
          data.updatedAt = data.updatedAt.toDate();
        } else if (data.updatedAt._seconds) {
          data.updatedAt = new Date(data.updatedAt._seconds * 1000);
        } else if (typeof data.updatedAt === 'string') {
          data.updatedAt = new Date(data.updatedAt);
        }
      }

      allAppsCache.push({
        id: doc.id,
        ...data
      });
    });

    cacheLastUpdated = new Date();
    const loadTime = Date.now() - startTime;
    logger.info(`Loaded ${allAppsCache.length} apps into memory cache in ${loadTime}ms`);
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
    logger.info('Apps cache needs refresh, loading from Firebase...');
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
 */
const createApp = async (req, res) => {
  try {
    const appData = req.body;

    // Handle file uploads
    if (req.files) {
      if (req.files.image) appData.imageUrl = req.files.image[0].path || req.files.image[0].location;
      if (req.files.icon) appData.iconUrl = req.files.icon[0].path || req.files.icon[0].location;
      if (req.files.downloadFile) appData.downloadUrl = req.files.downloadFile[0].path || req.files.downloadFile[0].location;
    }

    // Parse JSON fields that come as strings from FormData
    if (typeof appData.categories === 'string') appData.categories = JSON.parse(appData.categories);
    if (typeof appData.tags === 'string') appData.tags = JSON.parse(appData.tags);
    if (typeof appData.features === 'string') appData.features = JSON.parse(appData.features);
    if (typeof appData.screenshots === 'string') appData.screenshots = JSON.parse(appData.screenshots);
    if (typeof appData.platformSupport === 'string') appData.platformSupport = JSON.parse(appData.platformSupport);
    if (typeof appData.resources === 'string') appData.resources = JSON.parse(appData.resources);
    if (typeof appData.priceDetails === 'string') appData.priceDetails = JSON.parse(appData.priceDetails);

    // Convert boolean strings
    if (typeof appData.isFeatured === 'string') appData.isFeatured = appData.isFeatured === 'true';
    if (typeof appData.isPublished === 'string') appData.isPublished = appData.isPublished === 'true';

    // Set defaults
    appData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    appData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    appData.downloadCount = 0;
    appData.views = 0;
    appData.rating = appData.rating || { average: 0, count: 0 };
    appData.price = Number(appData.price) || 0;

    // Generate slug from title
    if (appData.title && !appData.slug) {
      appData.slug = appData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    const docRef = await db.collection('apps').add(appData);

    // Invalidate cache
    allAppsCache = null;

    res.status(201).json({ id: docRef.id, ...appData });
  } catch (error) {
    logger.error('Error creating app:', error);
    res.status(500).json({ error: 'Failed to create app' });
  }
};

/**
 * PUT /api/apps/:appId - Update app (admin only)
 */
const updateApp = async (req, res) => {
  try {
    const { appId } = req.params;
    const updateData = req.body;

    // Handle file uploads
    if (req.files) {
      if (req.files.image) updateData.imageUrl = req.files.image[0].path || req.files.image[0].location;
      if (req.files.icon) updateData.iconUrl = req.files.icon[0].path || req.files.icon[0].location;
      if (req.files.downloadFile) updateData.downloadUrl = req.files.downloadFile[0].path || req.files.downloadFile[0].location;
    }

    // Parse JSON fields
    if (typeof updateData.categories === 'string') updateData.categories = JSON.parse(updateData.categories);
    if (typeof updateData.tags === 'string') updateData.tags = JSON.parse(updateData.tags);
    if (typeof updateData.features === 'string') updateData.features = JSON.parse(updateData.features);
    if (typeof updateData.screenshots === 'string') updateData.screenshots = JSON.parse(updateData.screenshots);
    if (typeof updateData.platformSupport === 'string') updateData.platformSupport = JSON.parse(updateData.platformSupport);
    if (typeof updateData.resources === 'string') updateData.resources = JSON.parse(updateData.resources);
    if (typeof updateData.priceDetails === 'string') updateData.priceDetails = JSON.parse(updateData.priceDetails);

    // Convert boolean strings
    if (typeof updateData.isFeatured === 'string') updateData.isFeatured = updateData.isFeatured === 'true';
    if (typeof updateData.isPublished === 'string') updateData.isPublished = updateData.isPublished === 'true';

    if (updateData.price !== undefined) updateData.price = Number(updateData.price) || 0;

    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('apps').doc(appId).update(updateData);

    // Invalidate cache
    allAppsCache = null;

    res.status(200).json({ id: appId, ...updateData });
  } catch (error) {
    logger.error('Error updating app:', error);
    res.status(500).json({ error: 'Failed to update app' });
  }
};

/**
 * DELETE /api/apps/:appId - Delete app (admin only)
 */
const deleteApp = async (req, res) => {
  try {
    const { appId } = req.params;
    await db.collection('apps').doc(appId).delete();

    // Invalidate cache
    allAppsCache = null;

    res.status(200).json({ message: 'App deleted successfully' });
  } catch (error) {
    logger.error('Error deleting app:', error);
    res.status(500).json({ error: 'Failed to delete app' });
  }
};

/**
 * POST /api/apps/:appId/download - Track free download
 */
const freeDownload = async (req, res) => {
  try {
    const { appId } = req.params;

    const appRef = db.collection('apps').doc(appId);
    const appDoc = await appRef.get();

    if (!appDoc.exists) {
      return res.status(404).json({ error: 'App not found' });
    }

    const appData = appDoc.data();

    // Increment download count
    await appRef.update({
      downloadCount: admin.firestore.FieldValue.increment(1)
    });

    // Invalidate cache to reflect new count
    allAppsCache = null;

    res.status(200).json({
      downloadUrl: appData.downloadUrl,
      message: 'Download tracked successfully'
    });
  } catch (error) {
    logger.error('Error processing download:', error);
    res.status(500).json({ error: 'Failed to process download' });
  }
};

/**
 * POST /api/apps/:appId/views - Increment view count
 */
const incrementViews = async (req, res) => {
  try {
    const { appId } = req.params;

    await db.collection('apps').doc(appId).update({
      views: admin.firestore.FieldValue.increment(1)
    });

    res.status(200).json({ message: 'View counted' });
  } catch (error) {
    logger.error('Error incrementing views:', error);
    res.status(500).json({ error: 'Failed to increment views' });
  }
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
