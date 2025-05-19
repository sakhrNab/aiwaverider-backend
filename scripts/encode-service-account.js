const fs = require('fs');
const path = require('path');

// Path to your service account JSON file
const serviceAccountPath = path.resolve(__dirname, '../server/aiwaverider8-privatekey.json');

try {
  // Read the service account file
  const serviceAccountJson = fs.readFileSync(serviceAccountPath, 'utf8');
  
  // Convert to base64
  const base64Encoded = Buffer.from(serviceAccountJson).toString('base64');
  
  console.log('Base64 encoded service account:');
  console.log(base64Encoded);
  console.log('\nAdd this to your .env.production file as:');
  console.log('FIREBASE_SERVICE_ACCOUNT_JSON=' + base64Encoded);
} catch (error) {
  console.error('Error encoding service account file:', error);
} 