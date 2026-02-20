const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');
const upload = require('../../middleware/upload');
const logger = require('../../utils/logger');
const { uploadImageToStorage, deleteImageFromStorage } = require('../../utils/storage');
const {
  getCache,
  setCache,
  deleteCacheByPattern,
  TTL
} = require('../../utils/cache');

const COLLECTION_NAME = 'apps';

// ==========================================
// IN-MEMORY CACHE FOR ALL APPS
// ==========================================
let allAppsCache = null;
let cacheLastUpdated = null;
const CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

const APP_TTL = {
  LISTINGS: TTL.LONG,
  DETAILS: TTL.VERY_LONG,
  SEARCH: 3600,
  FEATURED: 3600,
};

/**
 * Load all apps from Firestore into memory cache
 */
const refreshAppsCache = async () => {
  try {
    logger.info('Refreshing apps cache from Firebase...');
    const startTime = Date.now();

    const snapshot = await admin.firestore().collection(COLLECTION_NAME)
      .orderBy('createdAt', 'desc')
      .get();

    allAppsCache = [];
    snapshot.forEach(doc => {
      allAppsCache.push({ id: doc.id, ...doc.data() });
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

const ensureCacheLoaded = async () => {
  const needsRefresh = !allAppsCache ||
    !cacheLastUpdated ||
    (new Date() - cacheLastUpdated) > CACHE_REFRESH_INTERVAL;

  if (needsRefresh) {
    await refreshAppsCache();
  }
  return allAppsCache !== null;
};

/**
 * Search apps by query across multiple fields
 */
const searchApps = (apps, searchQuery) => {
  if (!searchQuery || !searchQuery.trim()) return apps;

  const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/);
  return apps.filter(app => {
    return searchTerms.every(term => {
      if (app.title && app.title.toLowerCase().includes(term)) return true;
      if (app.shortDescription && app.shortDescription.toLowerCase().includes(term)) return true;
      if (app.description && app.description.toLowerCase().includes(term)) return true;
      if (app.category && app.category.toLowerCase().includes(term)) return true;
      if (app.tags && app.tags.some(t => t.toLowerCase().includes(term))) return true;
      return false;
    });
  });
};

/**
 * Upload a file to Firebase Storage under apps/ folder
 */
const uploadAppFile = async (file, subfolder = 'images') => {
  const result = await uploadImageToStorage(
    file.buffer,
    file.originalname,
    `apps/${subfolder}`
  );
  return result;
};

/**
 * Parse JSON fields that come as strings from FormData
 */
const parseJsonField = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : fallback;
  }
};

const parseJsonObject = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// ==========================================
// GET / - List apps with search, filter, pagination
// ==========================================
router.get('/', async (req, res) => {
  try {
    const {
      searchQuery,
      category,
      type,
      sort = 'newest',
      page = 1,
      limit = 12,
      minPrice,
      maxPrice
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 12;

    // Build cache key
    const cacheKey = `apps:results:${JSON.stringify({ searchQuery, category, type, sort, page: pageNum, limit: limitNum, minPrice, maxPrice })}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    await ensureCacheLoaded();
    let results = [...(allAppsCache || [])];

    // Only show published apps on public endpoint
    results = results.filter(app => app.isPublished !== false);

    // Search
    if (searchQuery) {
      results = searchApps(results, searchQuery);
    }

    // Filter by category
    if (category && category !== 'All') {
      results = results.filter(app =>
        app.category === category ||
        (app.categories && app.categories.includes(category))
      );
    }

    // Filter by type
    if (type && type !== 'All') {
      results = results.filter(app => app.type === type);
    }

    // Price range filter
    if (minPrice !== undefined) {
      const min = parseFloat(minPrice);
      results = results.filter(app => (app.price || 0) >= min);
    }
    if (maxPrice !== undefined) {
      const max = parseFloat(maxPrice);
      results = results.filter(app => (app.price || 0) <= max);
    }

    // Sort
    switch (sort) {
      case 'popular':
        results.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));
        break;
      case 'rating':
        results.sort((a, b) => (b.rating?.average || 0) - (a.rating?.average || 0));
        break;
      case 'price-low':
        results.sort((a, b) => (a.price || 0) - (b.price || 0));
        break;
      case 'price-high':
        results.sort((a, b) => (b.price || 0) - (a.price || 0));
        break;
      case 'newest':
      default:
        results.sort((a, b) => {
          const dateA = a.createdAt?._seconds || a.createdAt?.seconds || 0;
          const dateB = b.createdAt?._seconds || b.createdAt?.seconds || 0;
          return dateB - dateA;
        });
        break;
    }

    const totalCount = results.length;
    const totalPages = Math.ceil(totalCount / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const paginatedResults = results.slice(offset, offset + limitNum);

    const response = {
      apps: paginatedResults,
      totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasMore: pageNum < totalPages
    };

    await setCache(cacheKey, response, APP_TTL.SEARCH);
    res.json(response);
  } catch (error) {
    logger.error('Error fetching apps:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch apps' });
  }
});

// ==========================================
// GET /featured - Featured apps
// ==========================================
router.get('/featured', async (req, res) => {
  try {
    const cacheKey = 'apps:featured';
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ apps: cached, fromCache: true });
    }

    await ensureCacheLoaded();
    const featured = (allAppsCache || [])
      .filter(app => app.isFeatured && app.isPublished !== false)
      .slice(0, 10);

    await setCache(cacheKey, featured, APP_TTL.FEATURED);
    res.json({ apps: featured });
  } catch (error) {
    logger.error('Error fetching featured apps:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch featured apps' });
  }
});

// ==========================================
// GET /:id - Single app by ID
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `app:${id}`;

    if (!req.query.skipCache) {
      const cached = await getCache(cacheKey);
      if (cached) {
        return res.json({ ...cached, fromCache: true });
      }
    }

    const doc = await admin.firestore().collection(COLLECTION_NAME).doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'App not found' });
    }

    const app = { id: doc.id, ...doc.data() };
    await setCache(cacheKey, app, APP_TTL.DETAILS);
    res.json(app);
  } catch (error) {
    logger.error('Error fetching app:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch app' });
  }
});

// ==========================================
// POST / - Create app (admin only, multipart)
// ==========================================
router.post('/', auth, upload.appFields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'downloadFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    }

    const { title, shortDescription, description, type, category, version, externalUrl,
      systemRequirements, videoUrl } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    // Handle file uploads
    let imageUrl = '';
    let imageFilename = '';
    let iconUrl = '';
    let iconFilename = '';
    let downloadFileUrl = '';
    let downloadFilename = '';

    if (req.files?.image) {
      const result = await uploadAppFile(req.files.image[0], 'images');
      imageUrl = result.url;
      imageFilename = result.filename;
    }

    if (req.files?.icon) {
      const result = await uploadAppFile(req.files.icon[0], 'icons');
      iconUrl = result.url;
      iconFilename = result.filename;
    }

    if (req.files?.downloadFile) {
      const result = await uploadAppFile(req.files.downloadFile[0], 'downloads');
      downloadFileUrl = result.url;
      downloadFilename = result.filename;
    }

    const appData = {
      title: title.trim(),
      shortDescription: (shortDescription || '').trim(),
      description: (description || '').trim(),
      type: type || 'app',
      category: category || '',
      categories: parseJsonField(req.body.categories),
      tags: parseJsonField(req.body.tags),
      features: parseJsonField(req.body.features),
      price: parseFloat(req.body.price) || 0,
      priceDetails: parseJsonObject(req.body.priceDetails, {
        basePrice: 0,
        discountedPrice: null,
        currency: 'USD',
        isFree: true,
        freeForSkool: false
      }),
      externalUrl: externalUrl || '',
      version: version || '',
      platformSupport: parseJsonField(req.body.platformSupport),
      systemRequirements: systemRequirements || '',
      videoUrl: videoUrl || '',
      resources: parseJsonField(req.body.resources),
      imageUrl,
      imageFilename,
      iconUrl,
      iconFilename,
      downloadFileUrl,
      downloadFilename,
      isFeatured: req.body.isFeatured === 'true' || req.body.isFeatured === true,
      isPublished: req.body.isPublished !== 'false' && req.body.isPublished !== false,
      downloadCount: 0,
      viewCount: 0,
      rating: { average: 0, count: 0 },
      createdBy: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await admin.firestore().collection(COLLECTION_NAME).add(appData);
    logger.info(`App created: ${docRef.id} - ${title}`);

    // Invalidate caches
    await refreshAppsCache();
    await deleteCacheByPattern('apps:*');

    res.status(201).json({
      success: true,
      id: docRef.id,
      ...appData
    });
  } catch (error) {
    logger.error('Error creating app:', error);
    res.status(500).json({ success: false, error: 'Failed to create app' });
  }
});

// ==========================================
// PUT /:id - Update app (admin only, multipart)
// ==========================================
router.put('/:id', auth, upload.appFields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'downloadFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    }

    const { id } = req.params;
    const docRef = admin.firestore().collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'App not found' });
    }

    const existingData = doc.data();
    const updateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    // Text fields
    const textFields = ['title', 'shortDescription', 'description', 'type', 'category',
      'version', 'externalUrl', 'systemRequirements', 'videoUrl'];
    textFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
      }
    });

    // JSON array fields
    const arrayFields = ['categories', 'tags', 'features', 'platformSupport', 'resources'];
    arrayFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = parseJsonField(req.body[field]);
      }
    });

    // Numeric fields
    if (req.body.price !== undefined) {
      updateData.price = parseFloat(req.body.price) || 0;
    }

    // Object fields
    if (req.body.priceDetails !== undefined) {
      updateData.priceDetails = parseJsonObject(req.body.priceDetails);
    }

    // Boolean fields
    if (req.body.isFeatured !== undefined) {
      updateData.isFeatured = req.body.isFeatured === 'true' || req.body.isFeatured === true;
    }
    if (req.body.isPublished !== undefined) {
      updateData.isPublished = req.body.isPublished !== 'false' && req.body.isPublished !== false;
    }

    // File uploads - replace old files
    if (req.files?.image) {
      if (existingData.imageFilename) {
        try { await deleteImageFromStorage(existingData.imageFilename); } catch (e) { logger.warn('Failed to delete old image:', e.message); }
      }
      const result = await uploadAppFile(req.files.image[0], 'images');
      updateData.imageUrl = result.url;
      updateData.imageFilename = result.filename;
    }

    if (req.files?.icon) {
      if (existingData.iconFilename) {
        try { await deleteImageFromStorage(existingData.iconFilename); } catch (e) { logger.warn('Failed to delete old icon:', e.message); }
      }
      const result = await uploadAppFile(req.files.icon[0], 'icons');
      updateData.iconUrl = result.url;
      updateData.iconFilename = result.filename;
    }

    if (req.files?.downloadFile) {
      if (existingData.downloadFilename) {
        try { await deleteImageFromStorage(existingData.downloadFilename); } catch (e) { logger.warn('Failed to delete old download file:', e.message); }
      }
      const result = await uploadAppFile(req.files.downloadFile[0], 'downloads');
      updateData.downloadFileUrl = result.url;
      updateData.downloadFilename = result.filename;
    }

    await docRef.update(updateData);
    logger.info(`App updated: ${id}`);

    // Invalidate caches
    await refreshAppsCache();
    await deleteCacheByPattern('apps:*');
    await deleteCacheByPattern(`app:${id}`);

    res.json({ success: true, id, ...existingData, ...updateData });
  } catch (error) {
    logger.error('Error updating app:', error);
    res.status(500).json({ success: false, error: 'Failed to update app' });
  }
});

// ==========================================
// DELETE /:id - Delete app (admin only)
// ==========================================
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    }

    const { id } = req.params;
    const docRef = admin.firestore().collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'App not found' });
    }

    const appData = doc.data();

    // Delete files from storage
    const filenames = [appData.imageFilename, appData.iconFilename, appData.downloadFilename].filter(Boolean);
    for (const filename of filenames) {
      try { await deleteImageFromStorage(filename); } catch (e) { logger.warn('Failed to delete file:', filename, e.message); }
    }

    await docRef.delete();
    logger.info(`App deleted: ${id} - ${appData.title}`);

    // Invalidate caches
    await refreshAppsCache();
    await deleteCacheByPattern('apps:*');
    await deleteCacheByPattern(`app:${id}`);

    res.json({ success: true, message: 'App deleted successfully' });
  } catch (error) {
    logger.error('Error deleting app:', error);
    res.status(500).json({ success: false, error: 'Failed to delete app' });
  }
});

// ==========================================
// POST /:id/download - Track download + return file URL
// ==========================================
router.post('/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = admin.firestore().collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'App not found' });
    }

    const appData = doc.data();

    // Increment download count
    await docRef.update({
      downloadCount: admin.firestore.FieldValue.increment(1)
    });

    // Update memory cache
    if (allAppsCache) {
      const cached = allAppsCache.find(a => a.id === id);
      if (cached) cached.downloadCount = (cached.downloadCount || 0) + 1;
    }

    res.json({
      success: true,
      downloadUrl: appData.downloadFileUrl || appData.externalUrl || '',
      downloadCount: (appData.downloadCount || 0) + 1
    });
  } catch (error) {
    logger.error('Error tracking download:', error);
    res.status(500).json({ success: false, error: 'Failed to track download' });
  }
});

// ==========================================
// POST /:id/views - Increment view count
// ==========================================
router.post('/:id/views', async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = admin.firestore().collection(COLLECTION_NAME).doc(id);

    await docRef.update({
      viewCount: admin.firestore.FieldValue.increment(1)
    });

    // Update memory cache
    if (allAppsCache) {
      const cached = allAppsCache.find(a => a.id === id);
      if (cached) cached.viewCount = (cached.viewCount || 0) + 1;
    }

    res.json({ success: true });
  } catch (error) {
    // Silently handle - view tracking is not critical
    logger.warn('Error incrementing view count:', error.message);
    res.json({ success: true });
  }
});

// ==========================================
// POST /cache/refresh - Clear cache (admin only)
// ==========================================
router.post('/cache/refresh', auth, async (req, res) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    }

    await refreshAppsCache();
    await deleteCacheByPattern('apps:*');
    await deleteCacheByPattern('app:*');

    res.json({
      success: true,
      message: 'Apps cache refreshed',
      totalApps: allAppsCache ? allAppsCache.length : 0
    });
  } catch (error) {
    logger.error('Error refreshing cache:', error);
    res.status(500).json({ success: false, error: 'Failed to refresh cache' });
  }
});

module.exports = router;
