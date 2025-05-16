const admin = require('firebase-admin');
const crypto = require('crypto');

/**
 * Upload an image to Firebase Storage
 * @param {Buffer} fileBuffer - The file content as a buffer
 * @param {string} originalFilename - The original filename
 * @param {string} folderPath - Path within bucket to store the file (e.g., 'posts', 'avatars')
 * @returns {Promise<Object>} - Object containing url and filename
 */
const uploadImageToStorage = async (fileBuffer, originalFilename, folderPath = 'posts') => {
  try {
    // Compute md5 hash of file buffer for unique filename
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    
    // Get Storage bucket
    const bucket = admin.storage().bucket();
    
    // Create a file reference using the hash as filename for deduplication
    const sanitizedFilename = originalFilename.replace(/\s+/g, '_');
    const fileName = `${folderPath}/${fileHash}-${sanitizedFilename}`;
    const fileRef = bucket.file(fileName);
    
    // Check if file exists already to avoid duplicates
    const [exists] = await fileRef.exists();
    
    if (!exists) {
      // Upload file if it doesn't exist
      await fileRef.save(fileBuffer, {
        metadata: {
          contentType: getContentType(originalFilename),
        },
      });
      
      // Make file public so it can be retrieved via public URL
      await fileRef.makePublic();
    }
    
    // Get public URL
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
    
    return { 
      url: publicUrl, 
      filename: fileName 
    };
  } catch (error) {
    console.error('Error uploading image to Firebase Storage:', error);
    throw new Error(`Failed to upload image to storage: ${error.message}`);
  }
};

/**
 * Delete an image from Firebase Storage
 * @param {string} filename - Full path to the file in the bucket
 * @returns {Promise<boolean>} - Returns true if deletion is successful
 */
const deleteImageFromStorage = async (filename) => {
  try {
    const bucket = admin.storage().bucket();
    const fileRef = bucket.file(filename);
    
    // Check if file exists
    const [exists] = await fileRef.exists();
    
    if (exists) {
      await fileRef.delete();
      return true;
    } else {
      console.warn(`File ${filename} does not exist in storage`);
      return false;
    }
  } catch (error) {
    console.error('Error deleting image from Firebase Storage:', error);
    throw new Error(`Failed to delete image from storage: ${error.message}`);
  }
};

/**
 * Get content type based on file extension
 * @param {string} filename - The filename
 * @returns {string} - The content type
 */
const getContentType = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  
  const contentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp'
  };
  
  return contentTypes[ext] || 'application/octet-stream';
};

module.exports = {
  uploadImageToStorage,
  deleteImageFromStorage
}; 