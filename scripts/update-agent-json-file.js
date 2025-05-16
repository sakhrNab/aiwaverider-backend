// Script to update agents with JSON file URLs
require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

// Initialize Firebase Admin
let serviceAccount;
try {
  serviceAccount = require('../serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  // Use environment variables or default credentials if file not found
  admin.initializeApp();
  console.log('Using default credentials or environment variables for Firebase Admin');
}

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

/**
 * Updates an agent document with a JSON file URL and data
 * @param {string} agentId - The ID of the agent to update
 * @param {string} jsonFileUrl - URL to the JSON file (optional)
 * @param {object} jsonData - The JSON data to store (optional)
 * @param {string} fileName - Name to save the file as (optional)
 * @returns {Promise<object>} - Updated agent data
 */
async function updateAgentWithJsonFile(agentId, jsonFileUrl, jsonData, fileName) {
  console.log(`Updating agent ${agentId} with JSON file...`);
  
  // Check if agent exists
  const agentRef = db.collection('agents').doc(agentId);
  const agentDoc = await agentRef.get();
  
  if (!agentDoc.exists) {
    throw new Error(`Agent with ID ${agentId} does not exist.`);
  }
  
  // Prepare update data
  const updateData = {};
  
  // If we have JSON data directly
  if (jsonData) {
    updateData.jsonData = jsonData;
    updateData.jsonFileUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    if (fileName) {
      updateData.jsonFileName = fileName;
    } else {
      updateData.jsonFileName = `agent_${agentId}_template.json`;
    }
  }
  
  // If we have a URL
  if (jsonFileUrl) {
    updateData.jsonFileUrl = jsonFileUrl;
    updateData.jsonFileUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    // If we also don't have direct JSON data, try to fetch it from the URL
    if (!jsonData) {
      try {
        const downloadedData = await downloadJsonFile(jsonFileUrl);
        updateData.jsonData = downloadedData;
        
        if (!fileName) {
          // Extract filename from URL or generate default
          const urlParts = jsonFileUrl.split('/');
          const urlFileName = urlParts[urlParts.length - 1];
          updateData.jsonFileName = urlFileName.includes('.json') 
            ? urlFileName 
            : `agent_${agentId}_template.json`;
        } else {
          updateData.jsonFileName = fileName;
        }
      } catch (error) {
        console.warn(`Warning: Could not download JSON data from URL: ${error.message}`);
        // Still update the URL even if we couldn't download the content
      }
    }
  }
  
  // Update the agent document
  await agentRef.update(updateData);
  
  // Get the updated document and return it
  const updatedAgentDoc = await agentRef.get();
  return updatedAgentDoc.data();
}

/**
 * Reads a JSON file from a local path
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<object>} - Parsed JSON data
 */
async function readJsonFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return reject(err);
      try {
        const jsonData = JSON.parse(data);
        resolve(jsonData);
      } catch (parseError) {
        reject(new Error(`Invalid JSON file: ${parseError.message}`));
      }
    });
  });
}

/**
 * Downloads a JSON file from a URL
 * @param {string} url - URL to the JSON file
 * @returns {Promise<object>} - Parsed JSON data
 */
async function downloadJsonFile(url) {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    throw new Error(`Failed to download file from ${url}: ${error.message}`);
  }
}

/**
 * Main function to handle the script execution
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let agentId, jsonFileUrl, localFilePath, fileName;
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--agent-id' || arg === '-a') {
      agentId = args[++i];
    } else if (arg === '--json-url' || arg === '-u') {
      jsonFileUrl = args[++i];
    } else if (arg === '--file' || arg === '-f') {
      localFilePath = args[++i];
    } else if (arg === '--name' || arg === '-n') {
      fileName = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }
  
  // Check for required arguments
  if (!agentId) {
    console.error('Error: Agent ID is required');
    showHelp();
    process.exit(1);
  }
  
  if (!jsonFileUrl && !localFilePath) {
    console.error('Error: Either a JSON URL or a local file path is required');
    showHelp();
    process.exit(1);
  }
  
  try {
    let jsonData;
    
    // Read local file if provided
    if (localFilePath) {
      console.log(`Reading JSON file from: ${localFilePath}`);
      jsonData = await readJsonFile(localFilePath);
      
      // Extract filename from path if not provided
      if (!fileName) {
        fileName = path.basename(localFilePath);
      }
    }
    
    // Update the agent
    const updatedAgent = await updateAgentWithJsonFile(
      agentId,
      jsonFileUrl,
      jsonData,
      fileName
    );
    
    console.log('Agent updated successfully!');
    console.log('Updated fields:');
    
    if (jsonFileUrl) {
      console.log(`- JSON File URL: ${updatedAgent.jsonFileUrl}`);
    }
    
    if (updatedAgent.jsonFileName) {
      console.log(`- JSON File Name: ${updatedAgent.jsonFileName}`);
    }
    
    if (updatedAgent.jsonFileUpdatedAt) {
      console.log(`- JSON File Updated At: ${updatedAgent.jsonFileUpdatedAt.toDate()}`);
    }
    
    if (updatedAgent.jsonData) {
      console.log(`- JSON Data: ${JSON.stringify(updatedAgent.jsonData).substring(0, 100)}...`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Displays help information
 */
function showHelp() {
  console.log(`
Usage: node update-agent-json-file.js [options]

Options:
  --agent-id, -a    ID of the agent to update (required)
  --json-url, -u    URL to the JSON file
  --file, -f        Path to a local JSON file
  --name, -n        Name to save the file as (optional)
  --help, -h        Show this help message

Examples:
  # Update agent with a JSON file from URL
  node update-agent-json-file.js --agent-id agent123 --json-url https://example.com/template.json

  # Update agent with a local JSON file
  node update-agent-json-file.js --agent-id agent123 --file ./templates/agent-template.json

  # Update agent with both URL and local file (local file data takes precedence)
  node update-agent-json-file.js --agent-id agent123 --json-url https://example.com/template.json --file ./templates/agent-template.json --name custom-template.json
`);
}

// Run the script
main(); 