// backend/upload.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');

// ===========================
// Default upload (memory storage, 5MB) — for images, JSON, etc.
// ===========================
const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check for image file types (for image and icon)
    if (file.fieldname === 'image' || file.fieldname === 'icon') {
      const allowedTypes = /jpeg|jpg|png|gif/;
      const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);

      if (ext && mimetype) {
        return cb(null, true);
      } else {
        return cb(new Error('Only image files are allowed (jpg, jpeg, png, gif)'));
      }
    }

    // Check for JSON file types
    if (file.fieldname === 'jsonFile') {
      const isJson =
        file.originalname.toLowerCase().endsWith('.json') ||
        file.mimetype === 'application/json';

      if (isJson) {
        return cb(null, true);
      } else {
        return cb(new Error('Only JSON files are allowed for jsonFile field'));
      }
    }

    // Restrict unknown fields to safe file types only
    const safeTypes = /jpeg|jpg|png|gif|json|pdf|zip|txt|csv|md|svg|webp/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const safeMimes = /image\/|application\/json|application\/pdf|application\/zip|text\//;

    if (safeTypes.test(ext) && safeMimes.test(file.mimetype)) {
      return cb(null, true);
    }

    return cb(new Error(`File type not allowed: ${file.originalname} (${file.mimetype})`));
  }
});

// ===========================
// App upload (disk storage, 1GB) — for app download files + images
// Uses disk to avoid OOM on large files.
// ===========================
const appTmpDir = path.join(os.tmpdir(), 'app-uploads');
if (!fs.existsSync(appTmpDir)) {
  fs.mkdirSync(appTmpDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, appTmpDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  },
});

const appUpload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 1 * 1024 * 1024 * 1024, // 1GB limit
  },
  fileFilter: (req, file, cb) => {
    // Images (for image and icon fields)
    if (file.fieldname === 'image' || file.fieldname === 'icon') {
      const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
      const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = /image\//.test(file.mimetype);
      if (ext && mimetype) return cb(null, true);
      return cb(new Error('Only image files are allowed (jpg, jpeg, png, gif, webp, svg)'));
    }

    // Download file — allow common app/archive types
    if (file.fieldname === 'downloadFile') {
      const allowedExts = /zip|rar|7z|tar|gz|exe|msi|dmg|deb|appimage|apk|pdf/;
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      if (allowedExts.test(ext)) return cb(null, true);
      return cb(new Error(`File type not allowed for download: .${ext}`));
    }

    return cb(new Error(`Unexpected field: ${file.fieldname}`));
  },
});

// Pre-configured fields middleware for the apps route
const appFields = appUpload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'downloadFile', maxCount: 1 },
]);

// Export both single-file and multiple-file upload middlewares
module.exports = {
  // For single file upload
  single: (fieldName) => upload.single(fieldName),

  // For multiple fields with multiple files
  fields: (fields) => upload.fields(fields),

  // For parsing form data without files
  none: () => upload.none(),

  // For multiple files in one field
  array: (fieldName, maxCount) => upload.array(fieldName, maxCount),

  // For apps route (disk storage, 1GB limit)
  appFields,
};

// // backend/middleware/upload.js -- using bitbucket for firebase

// const multer = require('multer');
// const path = require('path');
// const { bucket } = require('../index'); // Adjust the path as necessary

// // Set up multer storage to store files in memory
// const storage = multer.memoryStorage();

// const fileFilter = (req, file, cb) => {
//   // Accept images only
//   if (!file.mimetype.startsWith('image/')) {
//     cb(new Error('Only image files are allowed!'), false);
//   } else {
//     cb(null, true);
//   }
// };

// const upload = multer({ storage, fileFilter });
