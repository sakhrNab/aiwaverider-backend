const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');

/**
 * Upload an image to Firebase Storage (from buffer — for small files)
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
 * Upload a file to Firebase Storage by streaming from disk (for large files).
 * Streams the file instead of loading it entirely into memory.
 * @param {string} filePath - Absolute path to the file on disk
 * @param {string} originalFilename - The original filename
 * @param {string} folderPath - Path within bucket (e.g., 'apps/downloads')
 * @returns {Promise<Object>} - Object containing url and filename
 */
const uploadFileFromPath = async (filePath, originalFilename, folderPath = 'apps/downloads') => {
  try {
    // Compute md5 hash by streaming the file (memory-efficient)
    const fileHash = await new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });

    const bucket = admin.storage().bucket();
    const sanitizedFilename = originalFilename.replace(/\s+/g, '_');
    const fileName = `${folderPath}/${fileHash}-${sanitizedFilename}`;
    const fileRef = bucket.file(fileName);

    const [exists] = await fileRef.exists();

    if (!exists) {
      // Stream the file to Firebase Storage
      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(filePath);
        const writeStream = fileRef.createWriteStream({
          metadata: {
            contentType: getContentType(originalFilename),
          },
          resumable: true, // Enables resumable uploads for large files
        });

        readStream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        readStream.on('error', reject);
      });

      await fileRef.makePublic();
    }

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;

    return { url: publicUrl, filename: fileName };
  } catch (error) {
    console.error('Error uploading file from path to Firebase Storage:', error);
    throw new Error(`Failed to upload file to storage: ${error.message}`);
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
    'bmp': 'image/bmp',
    'zip': 'application/zip',
    'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'exe': 'application/x-msdownload',
    'msi': 'application/x-msi',
    'dmg': 'application/x-apple-diskimage',
    'deb': 'application/x-debian-package',
    'apk': 'application/vnd.android.package-archive',
    'pdf': 'application/pdf',
    'json': 'application/json',
  };

  return contentTypes[ext] || 'application/octet-stream';
};

module.exports = {
  uploadImageToStorage,
  uploadFileFromPath,
  deleteImageFromStorage
}; 