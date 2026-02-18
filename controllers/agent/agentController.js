const { pool } = require('../../config/database');

/**
 * Increment download count for an agent
 */
exports.incrementDownloadCount = async (req, res) => {
  try {
    const { agentId } = req.params;

    // Validate agent ID
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Increment download count using atomic operation and return updated count
    const result = await pool.query(
      'UPDATE agents SET download_count = download_count + 1 WHERE id = $1 RETURNING download_count',
      [agentId]
    );

    // Check if agent exists
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Return success response with updated count
    return res.json({
      success: true,
      downloadCount: result.rows[0].download_count,
      message: 'Download count incremented successfully'
    });
  } catch (error) {
    console.error('Error incrementing download count:', error);
    return res.status(500).json({ error: 'Failed to increment download count' });
  }
};

/**
 * Get download count for an agent
 */
exports.getDownloadCount = async (req, res) => {
  try {
    const { agentId } = req.params;

    // Validate agent ID
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Get agent download count
    const result = await pool.query(
      'SELECT download_count FROM agents WHERE id = $1',
      [agentId]
    );

    // Check if agent exists
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Return download count
    const downloadCount = result.rows[0].download_count || 0;

    return res.json({ downloadCount });
  } catch (error) {
    console.error('Error getting download count:', error);
    return res.status(500).json({ error: 'Failed to get download count' });
  }
};