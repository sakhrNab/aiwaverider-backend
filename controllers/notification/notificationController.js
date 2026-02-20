const { pool } = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Get paginated notifications for the authenticated user
 */
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.uid;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) as total FROM notifications WHERE user_id = $1',
      [userId]
    );
    const total = parseInt(countRows[0].total);

    res.json({
      notifications: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

/**
 * Get unread notification count
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { rows } = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
      [userId]
    );
    res.json({ count: parseInt(rows[0].count) });
  } catch (error) {
    logger.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
};

/**
 * Mark a single notification as read
 */
const markAsRead = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;

    const { rowCount } = await pool.query(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

/**
 * Mark all notifications as read
 */
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.uid;
    await pool.query(
      'UPDATE notifications SET read = true WHERE user_id = $1',
      [userId]
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
};

/**
 * Delete a single notification
 */
const deleteNotification = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;

    const { rowCount } = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

/**
 * Delete all notifications for the user
 */
const deleteAllNotifications = async (req, res) => {
  try {
    const userId = req.user.uid;
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting all notifications:', error);
    res.status(500).json({ error: 'Failed to delete all notifications' });
  }
};

/**
 * Get notification preferences (proxy to users.notifications JSONB column)
 */
const getPreferences = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { rows } = await pool.query(
      'SELECT notifications FROM users WHERE id = $1',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0].notifications || { email: true, inApp: true });
  } catch (error) {
    logger.error('Error fetching notification preferences:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
};

/**
 * Update notification preferences
 */
const updatePreferences = async (req, res) => {
  try {
    const userId = req.user.uid;
    const preferences = req.body;

    await pool.query(
      'UPDATE users SET notifications = $1 WHERE id = $2',
      [JSON.stringify(preferences), userId]
    );

    res.json({ success: true, preferences });
  } catch (error) {
    logger.error('Error updating notification preferences:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  getPreferences,
  updatePreferences
};
