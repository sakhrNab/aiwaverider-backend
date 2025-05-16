/**
 * Firebase security rules for the application
 * These rules need to be deployed to Firebase using the Firebase CLI
 * 
 * Usage:
 * 1. Install Firebase CLI: npm install -g firebase-tools
 * 2. Login: firebase login
 * 3. Deploy rules: firebase deploy --only firestore:rules
 */

const firestoreRules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // AI Tools collection - public read access
    match /ai_tools/{document=**} {
      // Anyone can read AI tools
      allow read: true;
      
      // Only authenticated admins can write
      allow create, update, delete: if request.auth != null && 
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }
    
    // All other collections require authentication
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
`;

const storageRules = `
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // AI tools images - public read access
    match /ai_tools_images/{imageId} {
      // Anyone can read AI tool images
      allow read: true;
      
      // Only authenticated admins can write
      allow write: if request.auth != null && 
        firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)) &&
        firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }
    
    // All other files require authentication
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
`;

module.exports = {
  firestoreRules,
  storageRules
}; 