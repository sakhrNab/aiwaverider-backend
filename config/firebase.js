require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');

// Force IPv4 connections to avoid IPv6 timeout issues
process.env.GRPC_DNS_RESOLVER = 'native';
process.env.GRPC_LOOKUP_SERVICE_CONFIG = '{"serviceConfig":{"loadBalancingConfig":{"pick_first":{"shuffleAddressList":false}}}}';
// Force Node.js to prefer IPv4
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';

const initializeFirebase = () => {
  if (admin.apps.length) {
    console.log('Firebase already initialized, returning existing instance');
    return admin;
  }

  console.log('Starting Firebase initialization...');
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`Service Account JSON exists: ${!!process.env.FIREBASE_SERVICE_ACCOUNT_JSON}`);
  console.log(`Storage Bucket: ${process.env.FIREBASE_STORAGE_BUCKET}`);

  let serviceAccount;

  if (process.env.NODE_ENV === 'production') {
    let serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    // Coolify may wrap values in quotes and/or escape internal quotes
    if (serviceAccountJson) {
      serviceAccountJson = serviceAccountJson.trim();
      // Remove surrounding single or double quotes
      serviceAccountJson = serviceAccountJson.replace(/^['"]|['"]$/g, '');
      // Unescape backslash-escaped quotes (Coolify escaping)
      serviceAccountJson = serviceAccountJson.replace(/\\'/g, "'").replace(/\\"/g, '"');
      // If still wrapped in quotes after unescaping, strip again
      serviceAccountJson = serviceAccountJson.replace(/^['"]|['"]$/g, '');
      console.log('Firebase JSON first 50 chars:', serviceAccountJson.substring(0, 50));
    }
    if (!serviceAccountJson) {
      console.error('FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set.');
      console.warn('Attempting to initialize Firebase without credentials...');
      try {
        admin.initializeApp({
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });
        console.log('Firebase initialized in limited mode without credentials');
        return admin;
      } catch (error) {
        console.error('Failed to initialize Firebase without credentials:', error);
        // Continue execution in degraded mode
        return null;
      }
    }

    try {
      console.log('Parsing service account JSON...');
      // First try direct parse; if Coolify UI corrupted the JSON with extra
      // whitespace, fix known corruption patterns and retry
      try {
        serviceAccount = JSON.parse(serviceAccountJson);
      } catch (firstError) {
        console.warn('Direct JSON parse failed, attempting to fix Coolify whitespace corruption...');
        const fixed = serviceAccountJson
          .replace(/-----BEGIN PRIVATE\s+KEY-----/g, '-----BEGIN PRIVATE KEY-----')
          .replace(/-----END PRIVATE\s+KEY-----/g, '-----END PRIVATE KEY-----')
          .replace(/\\n\s+/g, '\\n')
          .replace(/\s+\\n/g, '\\n')
          .replace(/":\s*"\s+https/g, '":"https')
          .replace(/client_x509_cer\s+t_url/g, 'client_x509_cert_url')
          .replace(/([A-Za-z0-9+/=])\s+([A-Za-z0-9+/=])/g, '$1$2'); // remove spaces in base64
        serviceAccount = JSON.parse(fixed);
        console.log('Successfully parsed after whitespace cleanup');
      }
      // Clean any remaining spaces inside the private key value
      if (serviceAccount && serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key
          .replace(/-----BEGIN PRIVATE\s+KEY-----/, '-----BEGIN PRIVATE KEY-----')
          .replace(/-----END PRIVATE\s+KEY-----/, '-----END PRIVATE KEY-----');
      }
      console.log('Successfully parsed service account JSON');
    } catch (error) {
      console.error('Failed to parse service account JSON:', error);
      console.warn('Attempting to initialize Firebase without credentials...');
      try {
        admin.initializeApp({
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });
        console.log('Firebase initialized in limited mode without credentials');
        return admin;
      } catch (initError) {
        console.error('Failed to initialize Firebase without credentials:', initError);
        return null;
      }
    }
  } else {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '../server/aiwaverider8-privatekey.json';
    try {
      console.log(`Loading service account from path: ${serviceAccountPath}`);
      serviceAccount = require(path.resolve(serviceAccountPath));
      console.log('Successfully loaded service account from file');
    } catch (error) {
      console.error('Failed to load service account key:', error);
      return null;
    }
  }

  if (serviceAccount) {
    try {
      console.log('Initializing Firebase with credentials...');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
      console.log('Firebase Admin SDK initialized successfully with credentials');
    } catch (error) {
      console.error('Failed to initialize Firebase with credentials:', error);
      console.warn('Attempting to initialize without credentials...');
      try {
        admin.initializeApp({
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });
        console.log('Firebase initialized in limited mode without credentials');
      } catch (initError) {
        console.error('Failed to initialize Firebase without credentials:', initError);
        return null;
      }
    }
  }

  return admin;
};

// Initialize Firebase
console.log('Starting Firebase initialization process...');
const firebaseAdmin = initializeFirebase();

// NOTE: Firestore has been replaced by PostgreSQL (see config/database.js)
// Firebase Admin is kept for Auth and Storage only

// Initialize Storage with error handling
let storage = null;
if (firebaseAdmin) {
  try {
    console.log('Initializing Firebase Storage...');
    storage = firebaseAdmin.storage();
    console.log('Firebase Storage initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase Storage:', error);
  }
} else {
  console.warn('Skipping Storage initialization as Firebase Admin is not available');
}

module.exports = {
  admin: firebaseAdmin,
  initializeFirebase,
  storage
};
