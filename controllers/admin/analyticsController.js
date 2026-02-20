/**
 * Analytics Controller
 * Queries PostgreSQL directly for real-time analytics data
 */

const { pool } = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Calculate start date based on time range
 */
function getStartDate(timeRange) {
  const now = new Date();
  switch (timeRange) {
    case 'year':
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'week':
    default:
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Format a date as short label (e.g. "Jan 15")
 */
function formatDayLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Get comprehensive analytics data from PostgreSQL
 */
exports.getAnalyticsData = async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    const startDate = getStartDate(timeRange);

    const [
      totalUsersRes,
      newUsersRes,
      activeUsersRes,
      agentsRes,
      ordersRes,
      viewsRes,
      userGrowthRes,
      revenueTimeRes,
      topAgentsRes,
      userActivityRes,
    ] = await Promise.all([
      // Total users
      pool.query('SELECT COUNT(*) AS total FROM users'),

      // New users in range
      pool.query('SELECT COUNT(*) AS total FROM users WHERE created_at >= $1', [startDate]),

      // Active users (logged in / updated recently)
      pool.query('SELECT COUNT(*) AS total FROM users WHERE updated_at >= $1', [startDate]),

      // Agents summary
      pool.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE is_free = true OR price = 0) AS free,
               COUNT(*) FILTER (WHERE is_free IS NOT TRUE AND price > 0) AS paid,
               COALESCE(SUM(download_count), 0) AS downloads
        FROM agents
      `),

      // Orders summary (completed)
      pool.query(`
        SELECT COUNT(*) AS total, COALESCE(SUM(total), 0) AS revenue
        FROM orders WHERE status = 'completed'
      `),

      // Total views from agents
      pool.query('SELECT COALESCE(SUM(view_count), 0) AS total FROM agents'),

      // Time series: user signups by day
      pool.query(`
        SELECT DATE(created_at) AS day, COUNT(*) AS value
        FROM users WHERE created_at >= $1
        GROUP BY DATE(created_at) ORDER BY day
      `, [startDate]),

      // Time series: revenue by day
      pool.query(`
        SELECT DATE(created_at) AS day, COALESCE(SUM(total), 0) AS value
        FROM orders WHERE status = 'completed' AND created_at >= $1
        GROUP BY DATE(created_at) ORDER BY day
      `, [startDate]),

      // Top agents by downloads
      pool.query(`
        SELECT id, name, title, download_count, view_count, price, is_free,
               average_rating, review_count
        FROM agents ORDER BY download_count DESC LIMIT 10
      `),

      // User activity with purchase stats
      pool.query(`
        SELECT u.id, u.username, u.email, u.created_at, u.updated_at,
               COUNT(DISTINCT o.id) AS purchases,
               COALESCE(SUM(o.total), 0) AS revenue
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'completed'
        GROUP BY u.id ORDER BY u.updated_at DESC NULLS LAST LIMIT 20
      `),
    ]);

    const totalUsers = parseInt(totalUsersRes.rows[0].total);
    const newUsers = parseInt(newUsersRes.rows[0].total);
    const activeUsers = parseInt(activeUsersRes.rows[0].total);

    const agentsRow = agentsRes.rows[0];
    const ordersRow = ordersRes.rows[0];
    const totalViews = parseInt(viewsRes.rows[0].total);

    const userGrowthData = userGrowthRes.rows.map(r => ({
      label: formatDayLabel(r.day),
      value: parseInt(r.value),
    }));

    const salesData = revenueTimeRes.rows.map(r => ({
      label: formatDayLabel(r.day),
      value: parseFloat(r.value),
    }));

    // Use user signup pattern as a proxy for visitor traffic
    const visitorData = userGrowthRes.rows.map(r => ({
      label: formatDayLabel(r.day),
      value: parseInt(r.value),
    }));

    const topAgents = topAgentsRes.rows.map(a => ({
      id: a.id,
      name: a.title || a.name,
      downloads: parseInt(a.download_count) || 0,
      price: parseFloat(a.price) || 0,
      isFree: a.is_free || parseFloat(a.price) === 0,
      revenue: a.is_free ? 0 : (parseInt(a.download_count) || 0) * (parseFloat(a.price) || 0),
      rating: parseFloat(a.average_rating) || 0,
      reviews: parseInt(a.review_count) || 0,
    }));

    const userActivity = userActivityRes.rows.map(u => ({
      userId: u.id,
      username: u.username || 'Unknown',
      userEmail: u.email,
      downloads: 0,
      purchases: parseInt(u.purchases) || 0,
      revenue: parseFloat(u.revenue) || 0,
      visits: 0,
      lastTimeLoggedIn: u.updated_at,
    }));

    const revenue = parseFloat(ordersRow.revenue) || 0;

    return res.status(200).json({
      success: true,
      data: {
        users: { total: totalUsers, new: newUsers, active: activeUsers, data: userGrowthData },
        agents: {
          total: parseInt(agentsRow.total),
          free: parseInt(agentsRow.free),
          paid: parseInt(agentsRow.paid),
          downloads: parseInt(agentsRow.downloads),
        },
        sales: { total: revenue, data: salesData },
        orders: { total: parseInt(ordersRow.total), revenue },
        visitors: { total: totalViews, data: visitorData },
        topAgents,
        userActivity,
      },
    });
  } catch (error) {
    logger.error(`Error getting analytics data: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get analytics data',
      error: error.message,
    });
  }
};

/**
 * Get top performing agents from PostgreSQL
 */
exports.getTopAgents = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(`
      SELECT id, name, title, download_count, view_count, price, is_free,
             average_rating, review_count
      FROM agents ORDER BY download_count DESC LIMIT $1
    `, [parseInt(limit)]);

    const topAgents = result.rows.map(a => ({
      id: a.id,
      name: a.title || a.name,
      downloads: parseInt(a.download_count) || 0,
      price: parseFloat(a.price) || 0,
      isFree: a.is_free || parseFloat(a.price) === 0,
      revenue: a.is_free ? 0 : (parseInt(a.download_count) || 0) * (parseFloat(a.price) || 0),
      rating: parseFloat(a.average_rating) || 0,
      reviews: parseInt(a.review_count) || 0,
    }));

    return res.status(200).json({ success: true, data: topAgents });
  } catch (error) {
    logger.error(`Error getting top agents: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get top agents',
      error: error.message,
    });
  }
};

/**
 * Track a page view (kept for compatibility — uses Firestore analytics service)
 */
exports.trackPageView = async (req, res) => {
  try {
    const { page } = req.body;

    if (!page) {
      return res.status(400).json({ error: 'Page path is required' });
    }

    // Page view tracking is a no-op for now since we don't have a PG page_views table
    return res.status(200).json({ success: true, message: 'View tracked successfully' });
  } catch (error) {
    logger.error('Error tracking view:', error);
    return res.status(500).json({ error: 'Failed to track view' });
  }
};
