require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');

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
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
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
      serviceAccount = JSON.parse(serviceAccountJson);
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

// Initialize Firestore with error handling
let db = null;
if (firebaseAdmin) {
  try {
    console.log('Initializing Firestore...');
    db = firebaseAdmin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    console.log('Firestore initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firestore:', error);
  }
} else {
  console.warn('Skipping Firestore initialization as Firebase Admin is not available');
}

module.exports = {
  admin: firebaseAdmin,
  initializeFirebase,
  db
};
