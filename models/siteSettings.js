/**
 * Site Settings Model
 *
 * This file defines the default site settings and utility functions
 * to handle site-wide configuration.
 */

const { pool } = require('../config/database');

// Validate a single rate limit entry (windowMinutes + maxRequests)
const validateRateLimit = (input, fallback) => {
  if (!input || typeof input !== 'object') return fallback;
  const windowMinutes = Number(input.windowMinutes);
  const maxRequests = Number(input.maxRequests);
  return {
    windowMinutes: (windowMinutes >= 1 && windowMinutes <= 1440) ? windowMinutes : fallback.windowMinutes,
    maxRequests: (maxRequests >= 1 && maxRequests <= 100000) ? maxRequests : fallback.maxRequests
  };
};

// In-memory cache for rate limit settings (avoids DB reads on every request)
let _cachedRateLimits = null;
let _rateLimitsCacheTime = null;
const RATE_LIMITS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Default settings object
const defaultSettings = {
  theme: {
    primaryColor: '#4A66A0',
    secondaryColor: '#7533A8',
    backgroundColor: '#1a0b2e',
    textColor: '#ffffff',
    accentColor: '#00bcd4'
  },
  notifications: {
    enableEmailNotifications: true,
    enableMarketingEmails: true,
    enableNewUserAlerts: true,
    enableNewContentAlerts: true
  },
  advertisement: {
    enableAds: false,
    adFrequency: 'low',
    adPositions: ['sidebar', 'footer']
  },
  rateLimits: {
    globalApi: { windowMinutes: 15, maxRequests: 1000 },
    authRoutes: { windowMinutes: 15, maxRequests: 5 },
    chatOpenAI: { windowMinutes: 15, maxRequests: 20 }
  }
};

// Initialize settings in the database if they don't exist
const initializeSettings = async () => {
  try {
    // Ensure rate_limits column exists (safe migration for existing deployments)
    await pool.query(`
      ALTER TABLE site_config ADD COLUMN IF NOT EXISTS rate_limits JSONB DEFAULT '{}'
    `).catch(() => { /* column may already exist */ });

    const { rows } = await pool.query(
      'SELECT id FROM site_config WHERE id = $1',
      ['settings']
    );

    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO site_config (id, theme, notifications, advertisement, rate_limits)
         VALUES ($1, $2, $3, $4, $5)`,
        ['settings', JSON.stringify(defaultSettings.theme), JSON.stringify(defaultSettings.notifications), JSON.stringify(defaultSettings.advertisement), JSON.stringify(defaultSettings.rateLimits)]
      );
      console.log('Site settings initialized with default values');
    } else {
      // Backfill rate_limits for existing deployments if null
      await pool.query(
        `UPDATE site_config SET rate_limits = $1 WHERE id = 'settings' AND (rate_limits IS NULL OR rate_limits = '{}')`,
        [JSON.stringify(defaultSettings.rateLimits)]
      );
    }
  } catch (error) {
    console.error('Error initializing site settings:', error);
  }
};

// Reset settings to default values
const resetSettings = async () => {
  try {
    await pool.query(
      `INSERT INTO site_config (id, theme, notifications, advertisement, rate_limits)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         theme = EXCLUDED.theme,
         notifications = EXCLUDED.notifications,
         advertisement = EXCLUDED.advertisement,
         rate_limits = EXCLUDED.rate_limits,
         updated_at = NOW()`,
      ['settings', JSON.stringify(defaultSettings.theme), JSON.stringify(defaultSettings.notifications), JSON.stringify(defaultSettings.advertisement), JSON.stringify(defaultSettings.rateLimits)]
    );

    return defaultSettings;
  } catch (error) {
    console.error('Error resetting site settings:', error);
    throw error;
  }
};

// Get current settings
const getSettings = async () => {
  try {
    const { rows } = await pool.query(
      'SELECT theme, notifications, advertisement, rate_limits FROM site_config WHERE id = $1',
      ['settings']
    );

    if (rows.length === 0) {
      await initializeSettings();
      return defaultSettings;
    }

    return {
      theme: rows[0].theme,
      notifications: rows[0].notifications,
      advertisement: rows[0].advertisement,
      rateLimits: rows[0].rate_limits || defaultSettings.rateLimits
    };
  } catch (error) {
    console.error('Error getting site settings:', error);
    throw error;
  }
};

// Update settings
const updateSettings = async (newSettings) => {
  try {
    // Validate the settings object
    const validatedSettings = {
      theme: {
        primaryColor: newSettings.theme?.primaryColor || defaultSettings.theme.primaryColor,
        secondaryColor: newSettings.theme?.secondaryColor || defaultSettings.theme.secondaryColor,
        backgroundColor: newSettings.theme?.backgroundColor || defaultSettings.theme.backgroundColor,
        textColor: newSettings.theme?.textColor || defaultSettings.theme.textColor,
        accentColor: newSettings.theme?.accentColor || defaultSettings.theme.accentColor
      },
      notifications: {
        enableEmailNotifications: typeof newSettings.notifications?.enableEmailNotifications === 'boolean'
          ? newSettings.notifications.enableEmailNotifications
          : defaultSettings.notifications.enableEmailNotifications,
        enableMarketingEmails: typeof newSettings.notifications?.enableMarketingEmails === 'boolean'
          ? newSettings.notifications.enableMarketingEmails
          : defaultSettings.notifications.enableMarketingEmails,
        enableNewUserAlerts: typeof newSettings.notifications?.enableNewUserAlerts === 'boolean'
          ? newSettings.notifications.enableNewUserAlerts
          : defaultSettings.notifications.enableNewUserAlerts,
        enableNewContentAlerts: typeof newSettings.notifications?.enableNewContentAlerts === 'boolean'
          ? newSettings.notifications.enableNewContentAlerts
          : defaultSettings.notifications.enableNewContentAlerts
      },
      advertisement: {
        enableAds: typeof newSettings.advertisement?.enableAds === 'boolean'
          ? newSettings.advertisement.enableAds
          : defaultSettings.advertisement.enableAds,
        adFrequency: ['low', 'medium', 'high'].includes(newSettings.advertisement?.adFrequency)
          ? newSettings.advertisement.adFrequency
          : defaultSettings.advertisement.adFrequency,
        adPositions: Array.isArray(newSettings.advertisement?.adPositions)
          ? newSettings.advertisement.adPositions
          : defaultSettings.advertisement.adPositions
      },
      rateLimits: {
        globalApi: validateRateLimit(newSettings.rateLimits?.globalApi, defaultSettings.rateLimits.globalApi),
        authRoutes: validateRateLimit(newSettings.rateLimits?.authRoutes, defaultSettings.rateLimits.authRoutes),
        chatOpenAI: validateRateLimit(newSettings.rateLimits?.chatOpenAI, defaultSettings.rateLimits.chatOpenAI)
      }
    };

    // Upsert with validated settings
    await pool.query(
      `INSERT INTO site_config (id, theme, notifications, advertisement, rate_limits)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         theme = EXCLUDED.theme,
         notifications = EXCLUDED.notifications,
         advertisement = EXCLUDED.advertisement,
         rate_limits = EXCLUDED.rate_limits,
         updated_at = NOW()`,
      ['settings', JSON.stringify(validatedSettings.theme), JSON.stringify(validatedSettings.notifications), JSON.stringify(validatedSettings.advertisement), JSON.stringify(validatedSettings.rateLimits)]
    );

    // Clear cached rate limits so they're reloaded
    _cachedRateLimits = null;

    return validatedSettings;
  } catch (error) {
    console.error('Error updating site settings:', error);
    throw error;
  }
};

// Get rate limits from cache or DB (for use by rate limiter middleware)
const getRateLimits = async () => {
  const now = Date.now();
  if (_cachedRateLimits && _rateLimitsCacheTime && (now - _rateLimitsCacheTime < RATE_LIMITS_CACHE_TTL)) {
    return _cachedRateLimits;
  }
  try {
    const { rows } = await pool.query(
      'SELECT rate_limits FROM site_config WHERE id = $1',
      ['settings']
    );
    _cachedRateLimits = rows[0]?.rate_limits || defaultSettings.rateLimits;
    _rateLimitsCacheTime = now;
    return _cachedRateLimits;
  } catch (error) {
    console.error('Error reading rate limits:', error);
    return _cachedRateLimits || defaultSettings.rateLimits;
  }
};

module.exports = {
  defaultSettings,
  initializeSettings,
  getSettings,
  updateSettings,
  resetSettings,
  getRateLimits
};
