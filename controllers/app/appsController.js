console.log('Loading appsController.js');

const fs = require('fs');
const { pool } = require('../../config/database');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { uploadFileFromPath, deleteImageFromStorage } = require('../../utils/storage');
const { indexSingleApp, removeFromIndex } = require('../../services/rag/qdrantService');

/**
 * Clean up temp files written by multer diskStorage.
 */
const cleanupTempFiles = (files) => {
  if (!files) return;
  for (const fieldFiles of Object.values(files)) {
    for (const file of fieldFiles) {
      if (file.path) {
        fs.unlink(file.path, (err) => {
          if (err) logger.warn(`Failed to clean up temp file: ${file.path}`);
        });
      }
    }
  }
};

// ==========================================
// HELPERS
// ==========================================

/**
 * Map a PostgreSQL row (snake_case) to camelCase for API responses.
 */
const mapRowToApp = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    category: row.category,
    categories: row.categories || [],
    description: row.description,
    shortDescription: row.short_description,
    version: row.version,
    price: row.price != null ? parseFloat(row.price) : 0,
    isFree: row.is_free,
    priceDetails: row.price_details || {},
    imageUrl: row.image_url,
    iconUrl: row.icon_url,
    externalUrl: row.external_url,
    downloadUrl: row.download_url,
    videoUrl: row.video_url,
    screenshots: row.screenshots || [],
    features: row.features || [],
    tags: row.tags || [],
    platformSupport: row.platform_support || [],
    systemRequirements: row.system_requirements,
    resources: row.resources || [],
    relatedApps: row.related_apps || [],
    isFeatured: row.is_featured,
    isPublished: row.is_published,
    downloadCount: row.download_count,
    viewCount: row.view_count,
    likes: row.likes || [],
    rating: {
      average: row.rating_average != null ? parseFloat(row.rating_average) : 0,
      count: row.rating_count || 0,
    },
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Parse JSON fields from multipart form data.
 */
const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// ==========================================
// GET /api/apps — List apps with filtering and pagination
// ==========================================
const getApps = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      searchQuery = '',
      category,
      type,
      sort = 'newest',
      minPrice,
      maxPrice,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build dynamic WHERE clauses
    const conditions = ['is_published = TRUE'];
    const values = [];
    let paramIdx = 1;

    if (searchQuery) {
      conditions.push(`(title ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR short_description ILIKE $${paramIdx})`);
      values.push(`%${searchQuery}%`);
      paramIdx++;
    }
    if (category && category !== 'All') {
      conditions.push(`(category = $${paramIdx} OR $${paramIdx} = ANY(categories))`);
      values.push(category);
      paramIdx++;
    }
    if (type && type !== 'All') {
      conditions.push(`type = $${paramIdx}`);
      values.push(type.toLowerCase());
      paramIdx++;
    }
    if (minPrice !== undefined) {
      conditions.push(`price >= $${paramIdx}`);
      values.push(Number(minPrice));
      paramIdx++;
    }
    if (maxPrice !== undefined) {
      conditions.push(`price <= $${paramIdx}`);
      values.push(Number(maxPrice));
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Sort mapping
    const sortMap = {
      newest: 'created_at DESC',
      oldest: 'created_at ASC',
      'price-low': 'price ASC',
      'price-high': 'price DESC',
      popular: 'download_count DESC',
      rating: 'rating_average DESC',
    };
    const orderBy = sortMap[sort] || 'created_at DESC';

    // Count query
    const countResult = await pool.query(`SELECT COUNT(*) FROM apps ${whereClause}`, values);
    const totalItems = parseInt(countResult.rows[0].count);

    // Data query
    const dataValues = [...values, limitNum, offset];
    const dataResult = await pool.query(
      `SELECT * FROM apps ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      dataValues
    );

    const apps = dataResult.rows.map(mapRowToApp);

    res.status(200).json({
      apps,
      pagination: {
        currentPage: pageNum,
        pageSize: limitNum,
        totalItems,
        totalPages: Math.ceil(totalItems / limitNum),
        hasMore: offset + limitNum < totalItems,
      },
    });
  } catch (error) {
    logger.error('Error fetching apps:', error);
    res.status(500).json({ error: 'Failed to fetch apps' });
  }
};

// ==========================================
// GET /api/apps/featured — Get featured apps
// ==========================================
const getFeaturedApps = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM apps WHERE is_featured = TRUE AND is_published = TRUE ORDER BY created_at DESC'
    );
    res.status(200).json({ apps: result.rows.map(mapRowToApp) });
  } catch (error) {
    logger.error('Error fetching featured apps:', error);
    res.status(500).json({ error: 'Failed to fetch featured apps' });
  }
};

// ==========================================
// GET /api/apps/:appId — Get single app
// ==========================================
const getAppById = async (req, res) => {
  try {
    const { appId } = req.params;
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [appId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    res.status(200).json(mapRowToApp(result.rows[0]));
  } catch (error) {
    logger.error('Error fetching app:', error);
    res.status(500).json({ error: 'Failed to fetch app' });
  }
};

// ==========================================
// POST /api/apps — Create new app (admin only)
// ==========================================
const createApp = async (req, res) => {
  try {
    const body = req.body;
    const files = req.files || {};

    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const id = uuidv4();

    // Handle file uploads (all files are on disk via multer diskStorage)
    let imageUrl = null, imageFilename = null;
    let iconUrl = null, iconFilename = null;
    let downloadUrl = null, downloadFilename = null;

    if (files.image && files.image[0]) {
      const result = await uploadFileFromPath(files.image[0].path, files.image[0].originalname, 'apps/images');
      imageUrl = result.url;
      imageFilename = result.filename;
    }
    if (files.icon && files.icon[0]) {
      const result = await uploadFileFromPath(files.icon[0].path, files.icon[0].originalname, 'apps/icons');
      iconUrl = result.url;
      iconFilename = result.filename;
    }
    if (files.downloadFile && files.downloadFile[0]) {
      const result = await uploadFileFromPath(files.downloadFile[0].path, files.downloadFile[0].originalname, 'apps/downloads');
      downloadUrl = result.url;
      downloadFilename = result.filename;
    }

    // Parse JSON/array fields from form data
    const categories = parseJsonField(body.categories, []);
    const tags = parseJsonField(body.tags, []);
    const features = parseJsonField(body.features, []);
    const platformSupport = parseJsonField(body.platformSupport, []);
    const resources = parseJsonField(body.resources, []);
    const priceDetails = parseJsonField(body.priceDetails, {});
    const isFree = body.isFree === 'true' || body.isFree === true;
    const isPublished = body.isPublished !== 'false' && body.isPublished !== false;
    const isFeatured = body.isFeatured === 'true' || body.isFeatured === true;

    const query = `
      INSERT INTO apps (
        id, title, type, category, categories, description, short_description,
        version, price, is_free, price_details,
        image_url, image_filename, icon_url, icon_filename,
        external_url, download_url, download_filename, video_url,
        features, tags, platform_support, system_requirements, resources,
        is_featured, is_published, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25, $26, $27
      ) RETURNING *`;

    const values = [
      id,
      body.title.trim(),
      body.type || 'app',
      body.category || null,
      categories,
      body.description || null,
      body.shortDescription || null,
      body.version || '1.0.0',
      isFree ? 0 : (parseFloat(body.price) || 0),
      isFree,
      JSON.stringify(priceDetails),
      imageUrl || body.imageUrl || null,
      imageFilename,
      iconUrl || body.iconUrl || null,
      iconFilename,
      body.externalUrl || null,
      downloadUrl || body.downloadUrl || null,
      downloadFilename,
      body.videoUrl || null,
      features,
      tags,
      platformSupport,
      body.systemRequirements || null,
      JSON.stringify(resources),
      isFeatured,
      isPublished,
      req.user?.uid || null,
    ];

    const result = await pool.query(query, values);
    const newApp = mapRowToApp(result.rows[0]);

    // Auto-index into Qdrant (fire-and-forget)
    indexSingleApp(result.rows[0]).catch(() => {});

    logger.info(`App created: ${id} — "${body.title}"`);
    cleanupTempFiles(files);
    res.status(201).json({ message: 'App created successfully', app: newApp });
  } catch (error) {
    cleanupTempFiles(req.files);
    logger.error('Error creating app:', error);
    res.status(500).json({ error: 'Failed to create app' });
  }
};

// ==========================================
// PUT /api/apps/:appId — Update app (admin only)
// ==========================================
const updateApp = async (req, res) => {
  try {
    const { appId } = req.params;
    const body = req.body;
    const files = req.files || {};

    // Check app exists
    const existing = await pool.query('SELECT * FROM apps WHERE id = $1', [appId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }
    const oldApp = existing.rows[0];

    // Handle file uploads (replace old files)
    let imageUrl = oldApp.image_url, imageFilename = oldApp.image_filename;
    let iconUrl = oldApp.icon_url, iconFilename = oldApp.icon_filename;
    let downloadUrl = oldApp.download_url, downloadFilename = oldApp.download_filename;

    if (files.image && files.image[0]) {
      if (oldApp.image_filename) deleteImageFromStorage(oldApp.image_filename).catch(() => {});
      const result = await uploadFileFromPath(files.image[0].path, files.image[0].originalname, 'apps/images');
      imageUrl = result.url;
      imageFilename = result.filename;
    }
    if (files.icon && files.icon[0]) {
      if (oldApp.icon_filename) deleteImageFromStorage(oldApp.icon_filename).catch(() => {});
      const result = await uploadFileFromPath(files.icon[0].path, files.icon[0].originalname, 'apps/icons');
      iconUrl = result.url;
      iconFilename = result.filename;
    }
    if (files.downloadFile && files.downloadFile[0]) {
      if (oldApp.download_filename) deleteImageFromStorage(oldApp.download_filename).catch(() => {});
      const result = await uploadFileFromPath(files.downloadFile[0].path, files.downloadFile[0].originalname, 'apps/downloads');
      downloadUrl = result.url;
      downloadFilename = result.filename;
    }

    const categories = parseJsonField(body.categories, oldApp.categories);
    const tags = parseJsonField(body.tags, oldApp.tags);
    const features = parseJsonField(body.features, oldApp.features);
    const platformSupport = parseJsonField(body.platformSupport, oldApp.platform_support);
    const resources = parseJsonField(body.resources, oldApp.resources);
    const priceDetails = parseJsonField(body.priceDetails, oldApp.price_details);
    const isFree = body.isFree !== undefined ? (body.isFree === 'true' || body.isFree === true) : oldApp.is_free;
    const isPublished = body.isPublished !== undefined ? (body.isPublished !== 'false' && body.isPublished !== false) : oldApp.is_published;
    const isFeatured = body.isFeatured !== undefined ? (body.isFeatured === 'true' || body.isFeatured === true) : oldApp.is_featured;

    const query = `
      UPDATE apps SET
        title = $1, type = $2, category = $3, categories = $4,
        description = $5, short_description = $6, version = $7,
        price = $8, is_free = $9, price_details = $10,
        image_url = $11, image_filename = $12, icon_url = $13, icon_filename = $14,
        external_url = $15, download_url = $16, download_filename = $17, video_url = $18,
        features = $19, tags = $20, platform_support = $21,
        system_requirements = $22, resources = $23,
        is_featured = $24, is_published = $25
      WHERE id = $26 RETURNING *`;

    const values = [
      body.title !== undefined ? body.title.trim() : oldApp.title,
      body.type || oldApp.type,
      body.category !== undefined ? body.category : oldApp.category,
      categories,
      body.description !== undefined ? body.description : oldApp.description,
      body.shortDescription !== undefined ? body.shortDescription : oldApp.short_description,
      body.version || oldApp.version,
      isFree ? 0 : (body.price !== undefined ? parseFloat(body.price) || 0 : parseFloat(oldApp.price) || 0),
      isFree,
      JSON.stringify(priceDetails),
      imageUrl,
      imageFilename,
      iconUrl,
      iconFilename,
      body.externalUrl !== undefined ? body.externalUrl : oldApp.external_url,
      downloadUrl,
      downloadFilename,
      body.videoUrl !== undefined ? body.videoUrl : oldApp.video_url,
      features,
      tags,
      platformSupport,
      body.systemRequirements !== undefined ? body.systemRequirements : oldApp.system_requirements,
      JSON.stringify(resources),
      isFeatured,
      isPublished,
      appId,
    ];

    const result = await pool.query(query, values);
    const updatedApp = mapRowToApp(result.rows[0]);

    // Auto-index into Qdrant (fire-and-forget)
    indexSingleApp(result.rows[0]).catch(() => {});

    logger.info(`App updated: ${appId}`);
    cleanupTempFiles(files);
    res.status(200).json({ message: 'App updated successfully', app: updatedApp });
  } catch (error) {
    cleanupTempFiles(req.files);
    logger.error('Error updating app:', error);
    res.status(500).json({ error: 'Failed to update app' });
  }
};

// ==========================================
// DELETE /api/apps/:appId — Delete app (admin only)
// ==========================================
const deleteApp = async (req, res) => {
  try {
    const { appId } = req.params;

    const existing = await pool.query('SELECT * FROM apps WHERE id = $1', [appId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }
    const app = existing.rows[0];

    // Delete uploaded files
    if (app.image_filename) deleteImageFromStorage(app.image_filename).catch(() => {});
    if (app.icon_filename) deleteImageFromStorage(app.icon_filename).catch(() => {});
    if (app.download_filename) deleteImageFromStorage(app.download_filename).catch(() => {});

    await pool.query('DELETE FROM apps WHERE id = $1', [appId]);

    // Remove from Qdrant (fire-and-forget)
    removeFromIndex('apps', appId).catch(() => {});

    logger.info(`App deleted: ${appId}`);
    res.status(200).json({ success: true, message: 'App deleted successfully' });
  } catch (error) {
    logger.error('Error deleting app:', error);
    res.status(500).json({ error: 'Failed to delete app' });
  }
};

// ==========================================
// POST /api/apps/:appId/download — Track free download
// ==========================================
const freeDownload = async (req, res) => {
  try {
    const { appId } = req.params;
    const result = await pool.query(
      'UPDATE apps SET download_count = download_count + 1 WHERE id = $1 RETURNING download_count',
      [appId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }
    res.status(200).json({ downloadCount: result.rows[0].download_count });
  } catch (error) {
    logger.error('Error tracking download:', error);
    res.status(500).json({ error: 'Failed to track download' });
  }
};

// ==========================================
// GET /api/apps/:appId/download-link — Get download URL (purchased apps only)
// ==========================================
const getDownloadLink = async (req, res) => {
  try {
    const { appId } = req.params;
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if user has purchased this app
    const userResult = await pool.query('SELECT subscription FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(403).json({ error: 'Purchase required' });
    }

    const subscription = userResult.rows[0].subscription || {};
    const purchases = Array.isArray(subscription.purchases) ? subscription.purchases : [];
    const hasPurchased = purchases.some(p => (p.agentId === appId || p.productId === appId));

    if (!hasPurchased) {
      return res.status(403).json({ error: 'You have not purchased this app' });
    }

    // Get the app's download URL
    const appResult = await pool.query('SELECT title, download_url FROM apps WHERE id = $1', [appId]);
    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    const app = appResult.rows[0];
    if (!app.download_url) {
      return res.status(404).json({ error: 'No download file available for this app' });
    }

    // Increment download count
    await pool.query('UPDATE apps SET download_count = download_count + 1 WHERE id = $1', [appId]);

    res.status(200).json({ downloadUrl: app.download_url, title: app.title });
  } catch (error) {
    logger.error('Error getting download link:', error);
    res.status(500).json({ error: 'Failed to get download link' });
  }
};

// ==========================================
// POST /api/apps/:appId/views — Increment view count
// ==========================================
const incrementViews = async (req, res) => {
  try {
    const { appId } = req.params;
    await pool.query('UPDATE apps SET view_count = view_count + 1 WHERE id = $1', [appId]);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Error incrementing views:', error);
    res.status(500).json({ error: 'Failed to increment views' });
  }
};

// ==========================================
// POST /api/apps/cache/refresh — No-op (no cache needed with PG)
// ==========================================
const refreshCache = async (req, res) => {
  const countResult = await pool.query('SELECT COUNT(*) FROM apps');
  res.status(200).json({
    message: 'Apps served directly from PostgreSQL — no cache needed',
    count: parseInt(countResult.rows[0].count),
  });
};

module.exports = {
  getApps,
  getAppById,
  getFeaturedApps,
  createApp,
  updateApp,
  deleteApp,
  freeDownload,
  getDownloadLink,
  incrementViews,
  refreshCache,
};
