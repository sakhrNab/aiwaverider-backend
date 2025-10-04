# Cache Testing Scenarios - Intelligent Caching System

## 🧪 **Complete Testing Guide for Your Dual-Cache Architecture**

## **🔐 Quick Authentication Reference**

### **Working Commands (Copy & Paste):**
```bash
# Clear cache
curl -X POST http://localhost:4000/api/test-auth/clear-cache \
  -H "Authorization: Bearer test-admin-token"

# Create agent
curl -X POST http://localhost:4000/api/test-auth/agents \
  -H "Authorization: Bearer test-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Agent", "category": "Technology"}'

# Get agents (authenticated)
curl -X GET http://localhost:4000/api/test-auth/agents \
  -H "Authorization: Bearer test-user-token"

# Get agents (public)
curl -X GET http://localhost:4000/api/agents
```

### **Test Tokens:**
- `test-admin-token` - Admin access
- `test-user-token` - User access

### **Test Environment Setup**
```bash
# Clear all caches before testing (works immediately)
curl -X POST http://localhost:4000/api/test-auth/clear-cache \
  -H "Authorization: Bearer test-admin-token"

# Monitor Redis cache
redis-cli monitor

# Monitor HTTP cache headers
curl -I http://localhost:4000/api/agents

# 🔐 AUTHENTICATION (Simple):
# Test tokens (works immediately):
# - Admin: test-admin-token
# - User: test-user-token
# - Use with: /api/test-auth/ endpoints

# Working commands:
# Clear cache: curl -X POST http://localhost:4000/api/test-auth/clear-cache -H "Authorization: Bearer test-admin-token"
# Create agent: curl -X POST http://localhost:4000/api/test-auth/agents -H "Authorization: Bearer test-admin-token" -H "Content-Type: application/json" -d '{"name":"Test","category":"Technology"}'
# Get agents: curl -X GET http://localhost:4000/api/test-auth/agents -H "Authorization: Bearer test-user-token"
```

---

## **📋 Test Scenario 1: Mode 1 - Category Browsing (Client-Side Filtering)**

### **1.1 Basic Category Request**
```
# Test: Technology category (should use client-side filtering)
GET http://localhost:3000/api/agents?category=Technology
Headers: 
  Accept: application/json

# Expected Response:
{
  "agents": [...], // All Technology agents
  "fromCache": true/false,
  "mode": "category",
  "total": 200+,
  "pagination": { "hasMore": false }
}
```

### **1.2 Category with Filters**
```
# Test: Technology + Price filter (client-side filtering)
GET http://localhost:3000/api/agents?category=Technology&priceMin=10&priceMax=50
Headers: 
  Accept: application/json

# Expected: Same response as 1.1 (filters applied client-side)
```

### **1.3 Category Cache Performance**
```
# First request (cache miss)
GET http://localhost:3000/api/agents?category=Business
Headers: 
  Accept: application/json

# Second request (cache hit)
GET http://localhost:3000/api/agents?category=Business
Headers: 
  Accept: application/json

# Expected: Second request should be faster and show fromCache: true
```

---

## **📋 Test Scenario 2: Mode 2 - Server-Side Search**

### **2.1 Global Search**
```
# Test: Search for "gmail automation"
GET http://localhost:3000/api/agents?searchQuery=gmail%20automation&limit=50
Headers: 
  Accept: application/json

# Expected Response:
{
  "agents": [...], // Filtered results
  "fromCache": false, // First time
  "mode": "search",
  "total": 15,
  "pagination": { "hasMore": true, "lastVisibleId": "..." }
}
```

### **2.2 Search Cache Performance**
```
# First search (cache miss)
GET http://localhost:3000/api/agents?searchQuery=telegram%20bot&limit=50
Headers: None required

# Second search (cache hit)
GET http://localhost:3000/api/agents?searchQuery=telegram%20bot&limit=50
Headers: None required

# Expected: Second request should be faster and show fromCache: true
```

### **2.3 Different Search Queries**
```
# Test: Each search should have different cache keys
GET http://localhost:3000/api/agents?searchQuery=gmail&limit=50
GET http://localhost:3000/api/agents?searchQuery=telegram&limit=50
GET http://localhost:3000/api/agents?searchQuery=automation&limit=50

# Expected: Each should return different results, no cache conflicts
```

---

## **📋 Test Scenario 3: Browse All (Server-Side Pagination)**

### **3.1 Browse All Categories**
```
# Test: Browse all agents
GET http://localhost:3000/api/agents?category=All&limit=50
Headers: 
  Accept: application/json

# Expected Response:
{
  "agents": [...], // First 50 agents
  "fromCache": false, // First time
  "mode": "search",
  "pagination": { "hasMore": true, "lastVisibleId": "..." }
}
```

### **3.2 Pagination**
```
# First page
GET http://localhost:3000/api/agents?category=All&limit=50
Headers: None required

# Second page (use lastVisibleId from first response)
GET http://localhost:3000/api/agents?category=All&limit=50&lastVisibleId=agent123
Headers: None required

# Expected: Different results, proper pagination
```

---

## **📋 Test Scenario 4: HTTP Cache Headers**

### **4.1 Check Cache Headers**
```
# Test HTTP cache headers
GET http://localhost:3000/api/agents?category=Technology
Headers: None required

# Expected Headers:
# Cache-Control: public, max-age=300, stale-while-revalidate=60
# ETag: "abc123"
# Vary: Origin, Accept-Encoding, User-Agent
```

### **4.2 Browser Cache Test**
```
# First request
GET http://localhost:3000/api/agents?category=Technology
Headers: None required

# Second request (should be served from browser cache)

GET http://localhost:3000/api/agents?category=Technology
Headers: None required

# Expected: Second request should be instant (browser cache)
```

---

## **📋 Test Scenario 5: Cache Invalidation**

### **5.1 Agent Update (Admin Required)**
```
# Update an agent
PUT http://localhost:4000/api/test-auth/agents/agent123
Headers: 
  Content-Type: application/json
  Authorization: Bearer test-admin-token
Body:
{
  "name": "Updated Agent",
  "price": 25
}

# Test: Category cache should be invalidated
GET http://localhost:4000/api/agents?category=Technology
Headers: None required

# Expected: fromCache: false (cache was invalidated)
```

### **5.2 Agent Creation (Admin Required)**
```
# Create new agent
POST http://localhost:4000/api/test-auth/agents
Headers: 
  Content-Type: application/json
  Authorization: Bearer test-admin-token
Body:
{
  "name": "New Test Agent",
  "category": "Technology"
}

# Test: Caches should be invalidated
GET http://localhost:4000/api/agents?category=Technology
Headers: None required

# Expected: fromCache: false (cache was invalidated)
```

---

## **📋 Test Scenario 6: Performance Testing**

### **6.1 Response Time Comparison**
```
# Test Redis cache performance
GET http://localhost:3000/api/agents?category=Technology
Headers: None required

# Send the same request again
GET http://localhost:3000/api/agents?category=Technology
Headers: None required

# Expected: Second request should be significantly faster
# Check response time in Postman's response tab
```

### **6.2 Firebase Cost Monitoring**
```
# Monitor Firebase reads in console
# Run multiple requests and check Firebase usage
GET http://localhost:3000/api/agents?category=Technology
GET http://localhost:3000/api/agents?category=Business
GET http://localhost:3000/api/agents?category=Marketing

# Expected: Only first request per category hits Firebase
# Check your backend console for Firebase read logs
```

---

## **📋 Test Scenario 7: Edge Cases**

### **7.1 Empty Search Results**
```
# Search for non-existent term
GET http://localhost:3000/api/agents?searchQuery=nonexistentterm123&limit=50
Headers: None required

# Expected: Empty results, but still cached
```

### **7.2 Large Result Sets**
```
# Test with large limit
GET http://localhost:3000/api/agents?category=All&limit=200
Headers: None required

# Expected: Proper pagination, reasonable response time
```

### **7.3 Special Characters**
```
# Test with special characters
GET http://localhost:3000/api/agents?searchQuery=gmail%20%26%20automation&limit=50
Headers: None required

# Expected: Proper URL encoding, correct results
```

---

## **📋 Test Scenario 8: Frontend Integration**

### **8.1 Client-Side Filtering**
```javascript
// Test in browser console
// 1. Load Technology category
fetch('/api/agents?category=Technology')
  .then(r => r.json())
  .then(data => {
    console.log('Total agents:', data.agents.length);
    
    // Test client-side filtering
    const filtered = data.agents.filter(a => a.price < 50);
    console.log('Filtered agents:', filtered.length);
  });
```

### **8.2 Search Performance**
```javascript
// Test search performance
const start = performance.now();
fetch('/api/agents?searchQuery=gmail&limit=50')
  .then(r => r.json())
  .then(data => {
    const end = performance.now();
    console.log('Search time:', end - start, 'ms');
    console.log('Results:', data.agents.length);
  });
```

### **8.3 Authenticated Requests**
```javascript
// Test authenticated endpoints
// First, get your token from localStorage
const token = localStorage.getItem('authToken');

// Test download increment
fetch('/api/agents/agent123/downloads', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
.then(r => r.json())
.then(data => console.log('Download response:', data));

// Test review creation
fetch('/api/agents/agent123/reviews', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    content: 'Great agent!',
    rating: 5
  })
})
.then(r => r.json())
.then(data => console.log('Review response:', data));
```

---

## **📋 Test Scenario 9: Authentication Testing**

### **9.1 Token Validation**
```
# Test if your token is valid
GET http://localhost:3000/api/auth/verify
Headers: 
  Authorization: Bearer YOUR_TOKEN

# Expected: 200 OK with user info
```

### **9.2 User-Level Authentication**
```
# Test user-level authenticated endpoints
POST http://localhost:3000/api/agents/agent123/downloads
Headers: 
  Authorization: Bearer YOUR_TOKEN
  Content-Type: application/json

# Expected: 200 OK with success message
```

### **9.3 Admin-Level Authentication**
```
# Test admin-level endpoints (works immediately)
POST http://localhost:4000/api/test-auth/agents
Headers: 
  Authorization: Bearer test-admin-token
  Content-Type: application/json
Body:
{
  "name": "Test Agent",
  "description": "Test description",
  "category": "Technology",
  "price": 25
}

# Expected: 201 Created with agent data

# 🔐 Working command:
# curl -X POST http://localhost:4000/api/test-auth/agents -H "Authorization: Bearer test-admin-token" -H "Content-Type: application/json" -d '{"name":"Test Agent","category":"Technology"}'
```

### **9.4 Authentication Errors**
```
# Test without token (should fail)
POST http://localhost:3000/api/agents/agent123/downloads
Headers: None

# Expected: 401 Unauthorized

# Test with invalid token
POST http://localhost:3000/api/agents/agent123/downloads
Headers: 
  Authorization: Bearer invalid_token

# Expected: 401 Unauthorized
```

---

## **🔍 Monitoring & Debugging**

### **Redis Cache Monitoring**
```bash
# Check Redis cache keys
redis-cli keys "agents:*"

# Check specific cache key
redis-cli get "agents:category:Technology"

# Monitor Redis operations
redis-cli monitor
```

### **HTTP Cache Monitoring**
```bash
# Check browser cache (Chrome DevTools)
# Network tab → Look for "from cache" responses

# Check cache headers
curl -I "http://localhost:3000/api/agents?category=Technology"
```

### **Performance Monitoring**
```bash
# Monitor response times
curl -w "@curl-format.txt" "http://localhost:3000/api/agents?category=Technology"

# Create curl-format.txt:
#      time_namelookup:  %{time_namelookup}\n
#         time_connect:  %{time_connect}\n
#      time_appconnect:  %{time_appconnect}\n
#     time_pretransfer:  %{time_pretransfer}\n
#        time_redirect:  %{time_redirect}\n
#   time_starttransfer:  %{time_starttransfer}\n
#                      ----------\n
#           time_total:  %{time_total}\n
```

---

## **✅ Expected Results Summary**

### **Performance Targets:**
- **Mode 1 (Category)**: <50ms response time
- **Mode 2 (Search)**: <100ms response time
- **Cache Hit Rate**: >95% after warm-up
- **Firebase Cost**: 95%+ reduction

### **Cache Behavior:**
- **First Request**: fromCache: false, slower response
- **Subsequent Requests**: fromCache: true, fast response
- **After Updates**: Cache invalidation, fromCache: false

### **HTTP Cache Behavior:**
- **First Request**: Cache-Control headers set
- **Second Request**: Served from browser cache (instant)
- **After 5 minutes**: Cache expires, new request made

This comprehensive testing will validate your intelligent caching system and ensure optimal performance! 