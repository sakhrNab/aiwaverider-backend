/**
 * Site Settings Model
 * 
 * This file defines the default site settings and utility functions
 * to handle site-wide configuration.
 */

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

// Get the settings document reference
const getSettingsDocRef = (db) => {
  return db.collection('siteConfig').doc('settings');
};

// Initialize settings in the database if they don't exist
const initializeSettings = async (db) => {
  try {
    const settingsRef = getSettingsDocRef(db);
    const settingsDoc = await settingsRef.get();
    
    if (!settingsDoc.exists) {
      await settingsRef.set({
        ...defaultSettings,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('Site settings initialized with default values');
    }
  } catch (error) {
    console.error('Error initializing site settings:', error);
  }
};

// Reset settings to default values
const resetSettings = async (db) => {
  try {
    const settingsRef = getSettingsDocRef(db);
    await settingsRef.set({
      ...defaultSettings,
      updatedAt: new Date()
    });
    
    return defaultSettings;
  } catch (error) {
    console.error('Error resetting site settings:', error);
    throw error;
  }
};

// Get current settings
const getSettings = async (db) => {
  try {
    const settingsRef = getSettingsDocRef(db);
    const settingsDoc = await settingsRef.get();
    
    if (!settingsDoc.exists) {
      await initializeSettings(db);
      return defaultSettings;
    }
    
    return settingsDoc.data();
  } catch (error) {
    console.error('Error getting site settings:', error);
    throw error;
  }
};

// Update settings
const updateSettings = async (db, newSettings) => {
  try {
    const settingsRef = getSettingsDocRef(db);
    
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
    
    // Update with validated settings
    await settingsRef.update({
      ...validatedSettings,
      updatedAt: new Date()
    });
    
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