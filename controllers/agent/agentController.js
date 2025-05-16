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
    
    // Get agent reference
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    
    // Check if agent exists
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Increment download count using atomic operation
    await agentRef.update({
      downloadCount: admin.firestore.FieldValue.increment(1),
      // Also update the statistics object if it exists
      'statistics.downloads': admin.firestore.FieldValue.increment(1)
    });
    
    // Get updated agent data
    const updatedAgentDoc = await agentRef.get();
    const updatedAgentData = updatedAgentDoc.data();
    
    // Return success response with updated count
    return res.json({ 
      success: true, 
      downloadCount: updatedAgentData.downloadCount || 0,
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
    
    // Get agent document
    const agentDoc = await db.collection('agents').doc(agentId).get();
    
    // Check if agent exists
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    
    // Return download count (check both possible locations)
    const downloadCount = agentData.downloadCount || agentData.statistics?.downloads || 0;
    
    return res.json({ downloadCount });
  } catch (error) {
    console.error('Error getting download count:', error);
    return res.status(500).json({ error: 'Failed to get download count' });
  }
}; 