/**
 * Site Settings Model
 *
 * This file defines the default site settings and utility functions
 * to handle site-wide configuration.
 */

const { pool } = require('../config/database');

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
  }
};

// Initialize settings in the database if they don't exist
const initializeSettings = async () => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM site_config WHERE id = $1',
      ['settings']
    );

    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO site_config (id, theme, notifications, advertisement)
         VALUES ($1, $2, $3, $4)`,
        ['settings', JSON.stringify(defaultSettings.theme), JSON.stringify(defaultSettings.notifications), JSON.stringify(defaultSettings.advertisement)]
      );
      console.log('Site settings initialized with default values');
    }
  } catch (error) {
    console.error('Error initializing site settings:', error);
  }
};

// Reset settings to default values
const resetSettings = async () => {
  try {
    await pool.query(
      `INSERT INTO site_config (id, theme, notifications, advertisement)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         theme = EXCLUDED.theme,
         notifications = EXCLUDED.notifications,
         advertisement = EXCLUDED.advertisement,
         updated_at = NOW()`,
      ['settings', JSON.stringify(defaultSettings.theme), JSON.stringify(defaultSettings.notifications), JSON.stringify(defaultSettings.advertisement)]
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
      'SELECT theme, notifications, advertisement FROM site_config WHERE id = $1',
      ['settings']
    );

    if (rows.length === 0) {
      await initializeSettings();
      return defaultSettings;
    }

    return {
      theme: rows[0].theme,
      notifications: rows[0].notifications,
      advertisement: rows[0].advertisement
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
      }
    };

    // Upsert with validated settings
    await pool.query(
      `INSERT INTO site_config (id, theme, notifications, advertisement)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         theme = EXCLUDED.theme,
         notifications = EXCLUDED.notifications,
         advertisement = EXCLUDED.advertisement,
         updated_at = NOW()`,
      ['settings', JSON.stringify(validatedSettings.theme), JSON.stringify(validatedSettings.notifications), JSON.stringify(validatedSettings.advertisement)]
    );

    return validatedSettings;
  } catch (error) {
    console.error('Error updating site settings:', error);
    throw error;
  }
};

module.exports = {
  defaultSettings,
  initializeSettings,
  getSettings,
  updateSettings,
  resetSettings
};
