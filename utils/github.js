// backend/github.js

const { Octokit } = require('@octokit/rest');
const path = require('path'); // Import the path module
require('dotenv').config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const [owner, repo] = process.env.GITHUB_REPO.split('/');
const branch = process.env.GITHUB_BRANCH || 'main';
const imagesDir = process.env.GITHUB_DIR || 'images';

/**
 * Uploads an image to GitHub.
 * @param {string} filename - The name of the file.
 * @param {Buffer} content - The file content as a buffer.
 * @returns {Object} - An object containing the URL and SHA of the uploaded image.
 */
const uploadImageToGitHub = async (filename, content) => {
  try {
    // 1) Check if the file already exists to determine if it's an update
    let sha;
    try {
      const { data: existingFile } = await octokit.repos.getContent({
        owner,
        repo,
        path: `${imagesDir}/${filename}`,
        ref: branch,
      });
      sha = existingFile.sha; // Existing file's SHA for update
    } catch (error) {
      if (error.status === 404) {
        // File does not exist; proceed to create
        sha = undefined;
      } else {
        console.error('Error checking existing file:', error);
        throw new Error(`Error checking existing file: ${error.message}`);
      }
    }

    // 2) Create or Update the file in GitHub
    const response = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: `${imagesDir}/${filename}`,
      message: `Upload image ${filename}`,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha, // Required for updates; omit for new files
    });

    // 3) Extract necessary information from the response
    const downloadUrl = response.data.content.download_url;
    const fileSha = response.data.content.sha;

    if (!downloadUrl || !fileSha) {
      throw new Error('GitHub API did not return download_url or sha.');
    }

    return { url: downloadUrl, sha: fileSha };
  } catch (error) {
    console.error('Error uploading image to GitHub:', error);
    // Enhance error message based on error type
    if (error.status === 401) {
      throw new Error('Unauthorized: Invalid GitHub token.');
    } else if (error.status === 403) {
      throw new Error('Forbidden: Insufficient permissions to upload to the repository.');
    } else {
      throw new Error(error.message || 'Failed to upload image to GitHub.');
    }
  }
};

/**
 * Deletes an image from GitHub.
 * @param {string} filename - The name of the file to delete.
 * @param {string} sha - The SHA of the file to delete.
 * @returns {boolean} - Returns true if deletion is successful.
 */
const deleteImageFromGitHub = async (filename, sha) => {
  try {
    const filePath = path.join(imagesDir, filename);

    await octokit.repos.deleteFile({
      owner,
      repo,
      path: filePath,
      message: `Delete image ${filename}`,
      sha,
      branch,
    });

    return true;
  } catch (error) {
    console.error('Error deleting image from GitHub:', error);
    throw new Error('Failed to delete image from GitHub.');
  }
};

module.exports = {
  octokit,
  owner,
  repo,
  branch,
  imagesDir,
  uploadImageToGitHub,
  deleteImageFromGitHub, // Export the delete function
};
