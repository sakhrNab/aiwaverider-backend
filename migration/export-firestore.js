/**
 * Export Firestore collections → JSON files
 *
 * Usage:
 *   node export-firestore.js
 *
 * Outputs one file per collection into ./data/<collection>.json
 * Uses the existing service account key at ../server/aiwaverider8-privatekey.json
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../server/aiwaverider8-privatekey.json');
const DATA_DIR = path.resolve(__dirname, 'data');

const CORE_COLLECTIONS = [
  'users',
  'agents',
  'orders',
  'invoices',
  'videos',
  'posts',
  'comments',
  'prompts',
  'wishlists',
  'prices',
  'templateAccess',
  'siteConfig',
  'ai_tools',
];

// Subcollections to export (parent -> subcollection name)
const SUBCOLLECTIONS = {
  agents: ['reviews'],
};

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively convert Firestore Timestamps (and nested objects) to plain
 * JSON-safe values.
 */
function serialise(value) {
  if (value === null || value === undefined) return value;

  // Firestore Timestamp → ISO string
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }

  // Firestore GeoPoint
  if (value && typeof value.latitude === 'number' && typeof value.longitude === 'number' && value.constructor?.name === 'GeoPoint') {
    return { latitude: value.latitude, longitude: value.longitude };
  }

  // Firestore DocumentReference → path string
  if (value && typeof value.path === 'string' && typeof value.firestore === 'object') {
    return value.path;
  }

  // Buffer / Bytes
  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }

  // Arrays
  if (Array.isArray(value)) {
    return value.map(serialise);
  }

  // Plain objects
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serialise(v);
    }
    return out;
  }

  return value;
}

/**
 * Export a single top-level collection.
 * Returns array of docs (each with an `_id` field).
 */
async function exportCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const docs = [];

  for (const doc of snapshot.docs) {
    const data = serialise(doc.data());
    data._id = doc.id;
    docs.push(data);
  }

  return docs;
}

/**
 * Export subcollections for every document in a parent collection.
 * Returns a map: { parentDocId: [ ...subcollectionDocs ] }
 */
async function exportSubcollection(parentCollection, subName) {
  const parentSnap = await db.collection(parentCollection).get();
  const allDocs = [];

  for (const parentDoc of parentSnap.docs) {
    const subSnap = await parentDoc.ref.collection(subName).get();
    for (const subDoc of subSnap.docs) {
      const data = serialise(subDoc.data());
      data._id = subDoc.id;
      data._parentId = parentDoc.id;
      allDocs.push(data);
    }
  }

  return allDocs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Ensure output dir exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log('=== Firestore Export ===\n');

  // 1. Top-level collections
  for (const name of CORE_COLLECTIONS) {
    try {
      const docs = await exportCollection(name);
      const outPath = path.join(DATA_DIR, `${name}.json`);
      fs.writeFileSync(outPath, JSON.stringify(docs, null, 2));
      console.log(`  ${name}: ${docs.length} docs → ${outPath}`);
    } catch (err) {
      console.error(`  ${name}: ERROR — ${err.message}`);
    }
  }

  // 2. Subcollections
  for (const [parent, subs] of Object.entries(SUBCOLLECTIONS)) {
    for (const sub of subs) {
      const tag = `${parent}/${sub}`;
      try {
        const docs = await exportSubcollection(parent, sub);
        const outPath = path.join(DATA_DIR, `${parent}_${sub}.json`);
        fs.writeFileSync(outPath, JSON.stringify(docs, null, 2));
        console.log(`  ${tag}: ${docs.length} docs → ${outPath}`);
      } catch (err) {
        console.error(`  ${tag}: ERROR — ${err.message}`);
      }
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
