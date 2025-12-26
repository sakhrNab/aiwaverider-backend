# API Controller Methods and Dependencies

## Complete Dependency Analysis for All Controller Methods

### Core Dependencies (All Methods)

| **Dependency Type** | **Module/Class** | **Specific Functions/Properties** | **Purpose** |
|---------------------|------------------|-----------------------------------|-------------|
| **External Library** | `firebase-admin` | `admin.firestore()`, `admin.storage()` | Database and file storage |
| **External Library** | `ioredis` | Redis client | Caching layer |
| **External Library** | `winston` | Logger instance | Logging |
| **External Library** | `multer` | File upload middleware | File handling |
| **External Library** | `express` | Web framework | HTTP handling |
| **Internal Config** | `../../config/firebase` | `db`, `admin` | Firebase configuration |
| **Internal Utility** | `../../utils/logger` | `logger.info()`, `logger.error()`, `logger.warn()` | Logging operations |
| **Internal Utility** | `../../utils/cache` | `getCache()`, `setCache()`, `deleteCache()`, `deleteCacheByPattern()` | Cache operations |
| **Internal Utility** | `../../utils/responseHelper` | `sendSuccess()`, `sendError()` | Response formatting |
| **Internal Utility** | `../../utils/sanitize` | `sanitizeInput()` | Input sanitization |
| **Internal Utility** | `../../utils/validators` | Validation functions | Input validation |

---

## Controller Methods and Their Specific Dependencies

| **Controller Method** | **File Location** | **Primary Dependencies** | **Specific Functions Used** | **Route Path** |
|----------------------|-------------------|-------------------------|----------------------------|----------------|
| **`getAgents`** | `agentsController.js` | - Firebase Firestore<br>- Redis Cache<br>- Logger | - `db.collection('agents')`<br>- `getCache()`, `setCache()`<br>- `logger.info()` | `GET /api/agents/` |
| **`getAgentById`** | `agentsController.js` | - Firebase Firestore<br>- Redis Cache<br>- Logger | - `db.collection('agents').doc()`<br>- `getCache()`, `setCache()`<br>- `logger.info()` | `GET /api/agents/:id` |
| **`createAgent`** | `agentsController.js` | - Firebase Firestore<br>- Firebase Storage<br>- Multer Upload<br>- Logger | - `db.collection('agents').add()`<br>- `admin.storage().bucket()`<br>- `upload.single()` | `POST /api/agents/` |
| **`updateAgent`** | `agentsController.js` | - Firebase Firestore<br>- Firebase Storage<br>- Multer Upload<br>- Cache Invalidation | - `db.collection('agents').doc().update()`<br>- `deleteCacheByPattern()` | `PUT /api/agents/:id` |
| **`deleteAgent`** | `agentsController.js` | - Firebase Firestore<br>- Firebase Storage<br>- Cache Invalidation | - `db.collection('agents').doc().delete()`<br>- `admin.storage().bucket().file().delete()` | `DELETE /api/agents/:id` |
| **`toggleWishlist`** | `wishlistController.js` | - Firebase Firestore<br>- Logger | - `db.collection('wishlists')`<br>- `logger.info()` | `POST /api/agents/wishlist/toggle` |
| **`getWishlists`** | `wishlistController.js` | - Firebase Firestore<br>- Logger | - `db.collection('wishlists').where()`<br>- `logger.info()` | `GET /api/agents/wishlist` |
| **`getWishlistById`** | `wishlistController.js` | - Firebase Firestore<br>- Logger | - `db.collection('wishlists').doc()`<br>- `logger.info()` | `GET /api/agents/wishlist/:id` |
| **`addAgentReview_controller`** | `agentsController.js` | - Firebase Firestore<br>- Logger<br>- Cache Invalidation | - `db.collection('reviews').add()`<br>- `deleteCacheByPattern()` | `POST /api/agents/:id/reviews` |
| **`deleteAgentReview_controller`** | `agentsController.js` | - Firebase Firestore<br>- Logger<br>- Cache Invalidation | - `db.collection('reviews').doc().delete()`<br>- `deleteCacheByPattern()` | `DELETE /api/agents/:id/reviews/:reviewId` |
| **`getFeaturedAgents`** | `agentsController.js` | - Firebase Firestore<br>- Redis Cache<br>- Logger | - `db.collection('agents').where()`<br>- `getCache()`, `setCache()` | `GET /api/agents/featured` |
| **`seedAgents`** | `agentsController.js` | - Firebase Firestore<br>- Logger | - `db.collection('agents').add()`<br>- `logger.info()` | `POST /api/agents/seed` |
| **`generateMockAgents`** | `agentsController.js` | - Firebase Firestore<br>- Logger | - `db.collection('agents').add()`<br>- `logger.info()` | `POST /api/agents/generate-mock` |
| **`combinedUpdate`** | `agentsController.js` | - Firebase Firestore<br>- Logger<br>- Cache Invalidation | - `db.collection('agents').doc().update()`<br>- `deleteCacheByPattern()` | `PUT /api/agents/:id/combined` |
| **`createAgentWithPrice`** | `priceController.js` | - Firebase Firestore<br>- Price Model<br>- Logger | - `db.collection('agents').add()`<br>- `PriceModel.create()` | `POST /api/agents/with-price` |
| **`getDownloadCount`** | `agentsController.js` | - Firebase Firestore<br>- Logger | - `db.collection('agents').doc().get()`<br>- `logger.info()` | `GET /api/agents/:id/downloads` |
| **`incrementDownloadCount`** | `agentsController.js` | - Firebase Firestore<br>- Logger<br>- Cache Invalidation | - `db.collection('agents').doc().update()`<br>- `deleteCacheByPattern()` | `POST /api/agents/:id/downloads` |
| **`getAgentCount`** | `agentsController.js` | - Firebase Firestore<br>- Redis Cache<br>- Logger | - `db.collection('agents').get()`<br>- `getCache()`, `setCache()` | `GET /api/agents/count` |
| **`getSearchResultsCount`** | `agentsController.js` | - Firebase Firestore<br>- Logger | - `db.collection('agents').where()`<br>- `logger.info()` | `GET /api/agents/search/count` |
| **`getLatestAgents`** | `agentsController.js` | - Firebase Firestore<br>- Redis Cache<br>- Logger | - `db.collection('agents').orderBy()`<br>- `getCache()`, `setCache()` | `GET /api/agents/latest` |
| **`getLatestAgentsRoute`** | `agentsController.js` | - Firebase Firestore<br>- Redis Cache<br>- Logger | - `db.collection('agents').orderBy()`<br>- `getCache()`, `setCache()` | `GET /api/agents/latest-route` |

---

## Middleware Dependencies

| **Middleware** | **File Location** | **Dependencies** | **Used By Routes** |
|----------------|-------------------|------------------|-------------------|
| **`authenticationMiddleware`** | `middleware/authenticationMiddleware.js` | - Firebase Auth<br>- JWT | All protected routes |
| **`adminAuth`** | `middleware/adminAuth.js` | - Firebase Auth<br>- Admin role check | Admin-only routes |
| **`upload`** | `middleware/upload.js` | - Multer<br>- File validation | File upload routes |
| **`publicCacheMiddleware`** | `middleware/publicCacheMiddleware.js` | - Redis Cache<br>- Cache headers | Public routes |

---

## Cache Dependencies

| **Cache Operation** | **Function** | **Used By Methods** | **Cache Key Pattern** |
|---------------------|--------------|-------------------|----------------------|
| **Get Cache** | `getCache(key)` | `getAgents`, `getAgentById`, `getFeaturedAgents`, `getAgentCount`, `getLatestAgents` | `agents:*`, `agent:*`, `featured:*`, `count:*`, `latest:*` |
| **Set Cache** | `setCache(key, data, ttl)` | `getAgents`, `getAgentById`, `getFeaturedAgents`, `getAgentCount`, `getLatestAgents` | Same as above with 5-15 min TTL |
| **Delete Cache** | `deleteCache(key)` | Individual cache invalidation | Specific cache keys |
| **Delete Pattern** | `deleteCacheByPattern(pattern)` | `updateAgent`, `deleteAgent`, `addAgentReview_controller`, `deleteAgentReview_controller`, `incrementDownloadCount` | `agents:*`, `agent:*`, `featured:*` |

---

## Database Collections Used

| **Collection** | **Operations** | **Used By Methods** |
|----------------|----------------|-------------------|
| **`agents`** | CRUD operations | All agent-related methods |
| **`wishlists`** | CRUD operations | All wishlist methods |
| **`reviews`** | CRUD operations | Review methods |
| **`prices`** | CRUD operations | Price-related methods |
| **`users`** | Read operations | Authentication/authorization |

---

## Storage Dependencies

| **Storage Operation** | **Function** | **Used By Methods** |
|----------------------|--------------|-------------------|
| **Upload Files** | `admin.storage().bucket().upload()` | `createAgent`, `updateAgent` |
| **Delete Files** | `admin.storage().bucket().file().delete()` | `deleteAgent`, `updateAgent` |
| **Get File URLs** | `admin.storage().bucket().file().getSignedUrl()` | `getAgentById` | 