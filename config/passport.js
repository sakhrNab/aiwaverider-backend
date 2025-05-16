const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { admin, db } = require('./firebase');

const initializePassport = (passport) => {
  const usersCollection = db.collection('users');

  // Serialize user for the session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from the session
  passport.deserializeUser(async (id, done) => {
    try {
      const userDoc = await usersCollection.doc(id).get();
      if (!userDoc.exists) {
        return done(null, null);
      }
      done(null, { id: userDoc.id, ...userDoc.data() });
    } catch (error) {
      done(error, null);
    }
  });

  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL, // Use the environment variable
    passReqToCallback: true,
    prompt: 'select_account'  // Add this line
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value.toLowerCase();
      
      // First check if user exists in Firestore
      let userQuery = await usersCollection.where('email', '==', email).get();
      
      if (userQuery.empty) {
        // User doesn't exist in our database
        return done(null, false, { 
          errorType: 'NO_ACCOUNT',
          message: 'No account found. Please sign up first.' 
        });
      }

      // User exists, continue with Firebase auth
      let firebaseUser;
      try {
        firebaseUser = await admin.auth().getUserByEmail(email);
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          // This shouldn't happen since we found the user in Firestore
          return done(null, false, { 
            errorType: 'SYSTEM_ERROR',
            message: 'User system synchronization error' 
          });
        }
        throw error;
      }

      const userDoc = userQuery.docs[0];
      const userData = userDoc.data();

      return done(null, {
        uid: firebaseUser.uid,
        ...userData
      });
    } catch (error) {
      console.error('Error in Google Strategy:', error);
      return done(error);
    }
  }));
};

module.exports = { initializePassport };
