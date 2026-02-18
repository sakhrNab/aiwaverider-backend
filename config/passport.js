const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { admin } = require('./firebase');
const { pool } = require('./database');

const initializePassport = (passport) => {

  // Serialize user for the session
  passport.serializeUser((user, done) => {
    done(null, user.id || user.uid);
  });

  // Deserialize user from the session
  passport.deserializeUser(async (id, done) => {
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (rows.length === 0) {
        return done(null, null);
      }
      done(null, { id: rows[0].id, ...rows[0] });
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

      // First check if user exists in PostgreSQL
      const { rows: userRows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

      if (userRows.length === 0) {
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
          // This shouldn't happen since we found the user in PostgreSQL
          return done(null, false, {
            errorType: 'SYSTEM_ERROR',
            message: 'User system synchronization error'
          });
        }
        throw error;
      }

      const userData = userRows[0];

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
