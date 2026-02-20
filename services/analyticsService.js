const { db, admin } = require('../config/firebase');
const logger = require('../utils/logger');

/**
 * Analytics Service
 * Manages real-time analytics collection with atomic updates
 */
class AnalyticsService {
  constructor() {
    this.analyticsCollection = 'analytics_summary';
    this.initializeAnalytics();
  }

  /**
   * Initialize analytics collection with default values
   */
  async initializeAnalytics() {
    try {
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const doc = await analyticsRef.get();
      
      if (!doc.exists) {
        await analyticsRef.set({
          // Agent metrics
          totalAgents: 0,
          freeAgents: 0,
          paidAgents: 0,
          totalDownloads: 0,
          
          // User metrics
          totalUsers: 0,
          newUsersToday: 0,
          activeUsersToday: 0,
          
          // Revenue metrics
          totalRevenue: 0,
          revenueToday: 0,
          totalOrders: 0,
          
          // Visitor metrics
          totalVisits: 0,
          visitsToday: 0,
          uniqueVisitorsToday: 0,
          
          // Top agents (top 10)
          topAgents: [],
          
          // Time series data
          dailyMetrics: {},
          
          // Last updated
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        logger.info('[ANALYTICS] Initialized analytics collection');
      }
    } catch (error) {
      logger.error('[ANALYTICS] Error initializing analytics:', error);
    }
  }

  /**
   * Get current analytics data
   */
  async getAnalytics(timeRange = 'week') {
    try {
      logger.info(`[ANALYTICS] getAnalytics called with timeRange: ${timeRange}`);
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const doc = await analyticsRef.get();
      
      if (!doc.exists) {
        logger.warn(`[ANALYTICS] No analytics document found`);
        return null;
      }
      
      const data = doc.data();
      logger.info(`[ANALYTICS] Retrieved analytics data, dailyMetrics keys:`, Object.keys(data.dailyMetrics || {}));
      
      // Generate time series data based on timeRange
      const timeSeriesData = this.generateTimeSeriesData(data.dailyMetrics, timeRange);
      
      // Use stored detailed user information or fetch fresh if not available
      let detailedUserInfo = {
        users: data.detailedUsers || [],
        agents: data.detailedDownloads || [],
        orders: data.detailedPurchases || [],
        visitors: data.detailedVisits || []
      };
      
      // If no detailed data is stored, fetch fresh data
      if (detailedUserInfo.users.length === 0) {
        detailedUserInfo = await this.getDetailedUserInfo(timeRange);
      }
      
      // Get comprehensive user activity data
      const userActivity = await this.getComprehensiveUserActivity(timeRange);
      
      return {
        sales: {
          total: data.totalRevenue,
          data: timeSeriesData.sales,
          detailed: detailedUserInfo.orders
        },
        users: {
          total: data.totalUsers,
          new: data.newUsersToday,
          active: data.activeUsersToday,
          data: timeSeriesData.users,
          detailed: detailedUserInfo.users
        },
        agents: {
          total: data.totalAgents,
          free: data.freeAgents,
          paid: data.paidAgents,
          downloads: data.totalDownloads,
          detailed: detailedUserInfo.agents
        },
        orders: {
          total: data.totalOrders,
          revenue: data.totalRevenue,
          detailed: detailedUserInfo.orders
        },
        visitors: {
          total: data.totalVisits,
          data: timeSeriesData.visitors,
          detailed: detailedUserInfo.visitors
        },
        topAgents: data.topAgents || [],
        userActivity: userActivity
      };
    } catch (error) {
      logger.error('[ANALYTICS] Error getting analytics:', error);
      return null;
    }
  }

  /**
   * Generate time series data from daily metrics
   */
  generateTimeSeriesData(dailyMetrics, timeRange) {
    const now = new Date();
    const data = { sales: [], users: [], visitors: [] };
    
    let days = 7;
    if (timeRange === 'month') days = 30;
    if (timeRange === 'year') days = 60; // Only look at last 2 months for now since we only have sample data
    
    logger.info(`[ANALYTICS] Generating time series for ${timeRange}, ${days} days`);
    logger.info(`[ANALYTICS] Available dailyMetrics keys:`, Object.keys(dailyMetrics || {}));
    
    // For year view, we need to aggregate by month
    if (timeRange === 'year') {
      const monthlyData = {};
      
      // Aggregate daily data by month
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = date.toISOString().split('T')[0];
        const monthKey = date.toISOString().substring(0, 7); // YYYY-MM
        
        const dayData = dailyMetrics[dateKey] || { sales: 0, users: 0, visitors: 0 };
        
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { sales: 0, users: 0, visitors: 0 };
        }
        
        monthlyData[monthKey].sales += dayData.sales || 0;
        monthlyData[monthKey].users += dayData.users || 0;
        monthlyData[monthKey].visitors += dayData.visitors || 0;
      }
      
      // Convert monthly data to array, only include months with data
      Object.keys(monthlyData).sort().forEach(monthKey => {
        const monthData = monthlyData[monthKey];
        const monthDate = new Date(monthKey + '-01');
        const year = monthDate.getFullYear();
        const month = monthDate.toLocaleDateString('en-US', { month: 'short' });
        const label = `${month} ${year}`;
        
        // Only add months that have data
        if (monthData.sales > 0 || monthData.users > 0 || monthData.visitors > 0) {
          data.sales.push({ label, value: monthData.sales, date: monthKey });
          data.users.push({ label, value: monthData.users, date: monthKey });
          data.visitors.push({ label, value: monthData.visitors, date: monthKey });
        }
      });
    } else {
      // For week and month views, use daily data
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = date.toISOString().split('T')[0];
        const dayData = dailyMetrics[dateKey] || { sales: 0, users: 0, visitors: 0 };
        
        let label;
        if (timeRange === 'week') {
          label = date.toLocaleDateString('en-US', { weekday: 'short' });
        } else if (timeRange === 'month') {
          // For month view, show day of month with month abbreviation
          const month = date.toLocaleDateString('en-US', { month: 'short' });
          const day = date.getDate();
          label = `${month} ${day}`;
        } else {
          label = date.getDate().toString();
        }
        
        data.sales.push({ label, value: dayData.sales || 0, date: dateKey });
        data.users.push({ label, value: dayData.users || 0, date: dateKey });
        data.visitors.push({ label, value: dayData.visitors || 0, date: dateKey });
      }
    }
    
    logger.info(`[ANALYTICS] Generated ${data.sales.length} data points for ${timeRange}`);
    logger.info(`[ANALYTICS] Sample sales data:`, data.sales.slice(0, 3));
    logger.info(`[ANALYTICS] Sample labels:`, data.sales.slice(0, 5).map(item => item.label));
    
    return data;
  }

  /**
   * Get detailed user information for analytics
   * This method now only populates the analytics collection, not used for real-time queries
   */
  async getDetailedUserInfo(timeRange = 'week', includeAllData = false) {
    try {
      const now = new Date();
      let startDate = new Date();
      
      // For initial population, get all data regardless of date
      if (includeAllData) {
        startDate = new Date('2020-01-01'); // Very old date to get all data
      } else {
        // Calculate start date based on timeRange
        if (timeRange === 'week') {
          startDate.setDate(now.getDate() - 7);
        } else if (timeRange === 'month') {
          startDate.setMonth(now.getMonth() - 1);
        } else if (timeRange === 'year') {
          startDate.setFullYear(now.getFullYear() - 1);
        }
      }
      
      // Get recent users with their details
      const usersSnapshot = await db.collection('users')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      
      const users = [];
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        users.push({
          id: doc.id,
          userId: doc.id,
          email: user.email,
          username: user.username || user.displayName || 'Unknown',
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          role: user.role || 'user',
          status: user.status || 'active'
        });
      });
      
      // Get recent downloads with user info
      let downloadsQuery = db.collection('agent_downloads');
      if (!includeAllData) {
        downloadsQuery = downloadsQuery.where('downloadDate', '>=', startDate);
      }
      const downloadsSnapshot = await downloadsQuery
        .orderBy('downloadDate', 'desc')
        .limit(100)
        .get();
      
      const downloads = [];
      downloadsSnapshot.forEach(doc => {
        const download = doc.data();
        downloads.push({
          id: doc.id,
          userId: download.userId,
          agentId: download.agentId,
          agentName: download.agentName,
          downloadDate: download.downloadDate,
          agentType: download.agentType,
          agentPrice: download.agentPrice,
          userEmail: download.userEmail || 'Unknown',
          username: download.username || 'Unknown'
        });
      });
      
      // Get recent purchases with user info
      let purchasesQuery = db.collection('orders');
      if (!includeAllData) {
        purchasesQuery = purchasesQuery.where('createdAt', '>=', startDate);
      }
      const purchasesSnapshot = await purchasesQuery
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      
      const purchases = [];
      purchasesSnapshot.forEach(doc => {
        const purchase = doc.data();
        purchases.push({
          id: doc.id,
          userId: purchase.userId,
          agentId: purchase.items?.[0]?.id || 'N/A',
          agentName: purchase.items?.[0]?.name || 'N/A',
          amount: purchase.total || 0,
          purchaseDate: purchase.createdAt,
          userEmail: purchase.userEmail || 'Unknown',
          username: purchase.username || 'Unknown'
        });
      });
      
      // Get recent visits with user info
      let visitsQuery = db.collection('productViews');
      if (!includeAllData) {
        visitsQuery = visitsQuery.where('timestamp', '>=', startDate);
      }
      const visitsSnapshot = await visitsQuery
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();
      
      const visits = [];
      visitsSnapshot.forEach(doc => {
        const visit = doc.data();
        visits.push({
          id: doc.id,
          userId: visit.userId,
          pagePath: visit.pagePath || 'N/A',
          productId: visit.productId,
          visitDate: visit.timestamp,
          userEmail: visit.userEmail || 'Unknown',
          username: visit.username || 'Unknown'
        });
      });
      
      return {
        users,
        agents: downloads,
        orders: purchases,
        visitors: visits
      };
    } catch (error) {
      logger.error('[ANALYTICS] Error getting detailed user info:', error);
      return {
        users: [],
        agents: [],
        orders: [],
        visitors: []
      };
    }
  }

  /**
   * Update analytics when agent is downloaded
   */
  async onAgentDownload(agentId, agentData, userId) {
    try {
      const batch = db.batch();
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const today = new Date().toISOString().split('T')[0];
      
      // Update total downloads
      batch.update(analyticsRef, {
        totalDownloads: admin.firestore.FieldValue.increment(1),
        [`dailyMetrics.${today}.downloads`]: admin.firestore.FieldValue.increment(1)
      });
      
      // Update agent-specific metrics
      const agentRef = db.collection('agents').doc(agentId);
      batch.update(agentRef, {
        downloadCount: admin.firestore.FieldValue.increment(1)
      });
      
      // Update user download history
      const userDownloadRef = db.collection('user_downloads').doc(`${userId}_${agentId}`);
      batch.set(userDownloadRef, {
        userId,
        agentId,
        agentName: agentData.name,
        downloadDate: admin.firestore.FieldValue.serverTimestamp(),
        agentType: agentData.isFree ? 'free' : 'paid',
        agentPrice: agentData.price || 0
      }, { merge: true });
      
      await batch.commit();
      
      // Update top agents if needed
      await this.updateTopAgents();
      
      // Update detailed data in analytics collection
      await this.updateDetailedDataInAnalytics();
      
      logger.info(`[ANALYTICS] Updated analytics for agent download: ${agentId}`);
    } catch (error) {
      logger.error('[ANALYTICS] Error updating agent download:', error);
    }
  }

  /**
   * Update analytics when user registers
   */
  async onUserRegister(userId, userData) {
    try {
      const batch = db.batch();
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const today = new Date().toISOString().split('T')[0];
      
      // Update user counts
      batch.update(analyticsRef, {
        totalUsers: admin.firestore.FieldValue.increment(1),
        newUsersToday: admin.firestore.FieldValue.increment(1),
        [`dailyMetrics.${today}.users`]: admin.firestore.FieldValue.increment(1)
      });
      
      // Store user registration
      const userRef = db.collection('users').doc(userId);
      batch.set(userRef, {
        ...userData,
        registrationDate: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      await batch.commit();
      
      logger.info(`[ANALYTICS] Updated analytics for user registration: ${userId}`);
    } catch (error) {
      logger.error('[ANALYTICS] Error updating user registration:', error);
    }
  }

  /**
   * Update analytics when user logs in
   */
  async onUserLogin(userId) {
    try {
      const batch = db.batch();
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const today = new Date().toISOString().split('T')[0];
      
      // Update active users
      batch.update(analyticsRef, {
        activeUsersToday: admin.firestore.FieldValue.increment(1)
      });
      
      // Update user last login
      const userRef = db.collection('users').doc(userId);
      batch.update(userRef, {
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await batch.commit();
      
      logger.info(`[ANALYTICS] Updated analytics for user login: ${userId}`);
    } catch (error) {
      logger.error('[ANALYTICS] Error updating user login:', error);
    }
  }

  /**
   * Update analytics when user visits page
   */
  async onPageVisit(userId, pagePath, productId = null) {
    try {
      const batch = db.batch();
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const today = new Date().toISOString().split('T')[0];
      
      // Update visit counts
      batch.update(analyticsRef, {
        totalVisits: admin.firestore.FieldValue.increment(1),
        visitsToday: admin.firestore.FieldValue.increment(1),
        [`dailyMetrics.${today}.visitors`]: admin.firestore.FieldValue.increment(1)
      });
      
      // Store visit record
      const visitRef = db.collection('visits').doc();
      batch.set(visitRef, {
        userId: userId || 'anonymous',
        pagePath,
        productId,
        visitDate: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await batch.commit();
      
      logger.info(`[ANALYTICS] Updated analytics for page visit: ${pagePath}`);
    } catch (error) {
      logger.error('[ANALYTICS] Error updating page visit:', error);
    }
  }

  /**
   * Update analytics when user purchases agent
   */
  async onAgentPurchase(userId, agentId, agentData, amount) {
    try {
      const batch = db.batch();
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const today = new Date().toISOString().split('T')[0];
      
      // Update revenue metrics
      batch.update(analyticsRef, {
        totalRevenue: admin.firestore.FieldValue.increment(amount),
        revenueToday: admin.firestore.FieldValue.increment(amount),
        totalOrders: admin.firestore.FieldValue.increment(1),
        [`dailyMetrics.${today}.sales`]: admin.firestore.FieldValue.increment(amount)
      });
      
      // Store purchase record
      const purchaseRef = db.collection('purchases').doc();
      batch.set(purchaseRef, {
        userId,
        agentId,
        agentName: agentData.name,
        amount,
        purchaseDate: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await batch.commit();
      
      logger.info(`[ANALYTICS] Updated analytics for agent purchase: ${agentId}, amount: ${amount}`);
    } catch (error) {
      logger.error('[ANALYTICS] Error updating agent purchase:', error);
    }
  }

  /**
   * Update top agents list
   */
  async updateTopAgents() {
    try {
      // Get top 10 agents by downloads
      const agentsSnapshot = await db.collection('agents')
        .where('downloadCount', '>', 0)
        .orderBy('downloadCount', 'desc')
        .limit(10)
        .get();
      
      const topAgents = [];
      agentsSnapshot.forEach(doc => {
        const agent = doc.data();
        topAgents.push({
          id: doc.id,
          name: agent.name || agent.title || 'Unnamed Agent',
          downloads: agent.downloadCount || 0,
          revenue: agent.price ? (agent.downloadCount || 0) * (agent.price || 0) : 0,
          isFree: agent.isFree || agent.price === 0,
          price: agent.price || 0
        });
      });
      
      // Update analytics collection
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      await analyticsRef.update({
        topAgents,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      logger.info(`[ANALYTICS] Updated top agents list: ${topAgents.length} agents`);
    } catch (error) {
      logger.error('[ANALYTICS] Error updating top agents:', error);
    }
  }

  /**
   * Get comprehensive user activity data for the new table
   */
  async getComprehensiveUserActivity(timeRange = 'week') {
    try {
      // Get data from analytics collection only
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      const analyticsDoc = await analyticsRef.get();
      
      if (!analyticsDoc.exists) {
        logger.warn('[ANALYTICS] No analytics document found for user activity');
        return [];
      }
      
      const analyticsData = analyticsDoc.data();
      const detailedUsers = analyticsData.detailedUsers || [];
      const detailedDownloads = analyticsData.detailedDownloads || [];
      const detailedPurchases = analyticsData.detailedPurchases || [];
      const detailedVisits = analyticsData.detailedVisits || [];
      
      // Process data from analytics collection
      const userActivity = this.processDetailedUserActivity(detailedUsers, detailedDownloads, detailedPurchases, detailedVisits);
      
      logger.info(`[ANALYTICS] Generated user activity for ${userActivity.length} users from analytics collection`);
      return userActivity;
    } catch (error) {
      logger.error('[ANALYTICS] Error getting comprehensive user activity:', error);
      return [];
    }
  }

  /**
   * Process detailed user activity data from analytics collection
   */
  processDetailedUserActivity(detailedUsers, detailedDownloads, detailedPurchases, detailedVisits) {
    const userActivityMap = new Map();
    
    // First, add all users from detailedUsers to ensure we have complete user info
    detailedUsers.forEach(userData => {
      const userId = userData.userId || userData.id;
      if (userId && userId !== 'null' && userId !== 'undefined') {
        userActivityMap.set(userId, {
          userId,
          userEmail: userData.email || 'Unknown',
          username: userData.username || 'Unknown',
          downloads: 0,
          purchases: 0,
          revenue: 0,
          visits: 0,
          lastTimeVisited: null,
          lastTimeLoggedIn: userData.lastLoginAt || null,
          agentName: 'N/A'
        });
      }
    });
    
    // Process downloads
    detailedDownloads.forEach(download => {
      const userId = download.userId;
      if (userId && userId !== 'null' && userId !== 'undefined') {
        if (!userActivityMap.has(userId)) {
          userActivityMap.set(userId, {
            userId,
            userEmail: download.userEmail || 'Unknown',
            username: download.username || 'Unknown',
            downloads: 0,
            purchases: 0,
            revenue: 0,
            visits: 0,
            lastTimeVisited: null,
            lastTimeLoggedIn: null,
            agentName: download.agentName || 'N/A'
          });
        }
        const user = userActivityMap.get(userId);
        user.downloads += 1;
        if (download.agentName && download.agentName !== 'N/A') {
          user.agentName = download.agentName;
        }
      }
    });
    
    // Process purchases
    detailedPurchases.forEach(purchase => {
      const userId = purchase.userId;
      if (userId && userId !== 'null' && userId !== 'undefined') {
        if (!userActivityMap.has(userId)) {
          userActivityMap.set(userId, {
            userId,
            userEmail: purchase.userEmail || 'Unknown',
            username: purchase.username || 'Unknown',
            downloads: 0,
            purchases: 0,
            revenue: 0,
            visits: 0,
            lastTimeVisited: null,
            lastTimeLoggedIn: null,
            agentName: purchase.agentName || 'N/A'
          });
        }
        const user = userActivityMap.get(userId);
        user.purchases += 1;
        user.revenue += purchase.amount || 0;
        if (purchase.agentName && purchase.agentName !== 'N/A') {
          user.agentName = purchase.agentName;
        }
      }
    });
    
    // Process visits
    detailedVisits.forEach(visit => {
      const userId = visit.userId;
      if (userId && userId !== 'null' && userId !== 'undefined' && userId !== 'anonymous') {
        if (!userActivityMap.has(userId)) {
          userActivityMap.set(userId, {
            userId,
            userEmail: visit.userEmail || 'Unknown',
            username: visit.username || 'Unknown',
            downloads: 0,
            purchases: 0,
            revenue: 0,
            visits: 0,
            lastTimeVisited: null,
            lastTimeLoggedIn: null,
            agentName: 'N/A'
          });
        }
        const user = userActivityMap.get(userId);
        user.visits += 1;
        if (visit.visitDate && (!user.lastTimeVisited || visit.visitDate.seconds > user.lastTimeVisited.seconds)) {
          user.lastTimeVisited = visit.visitDate;
        }
      }
    });
    
    return this.formatUserActivity(Array.from(userActivityMap.values()));
  }


  /**
   * Format user activity data
   */
  formatUserActivity(userActivity) {
    // Sort by total activity (downloads + purchases + visits) and set rank
    userActivity.sort((a, b) => {
      const aActivity = a.downloads + a.purchases + a.visits;
      const bActivity = b.downloads + b.purchases + b.visits;
      return bActivity - aActivity;
    });
    
    // Set ranks and format data
    userActivity.forEach((user, index) => {
      user.rank = index + 1;
      user.downloadPurchase = `${user.downloads} downloads, ${user.purchases} purchases`;
      user.numberOfVisits = user.visits;
    });
    
    return userActivity;
  }

  /**
   * Update detailed data in analytics collection
   */
  async updateDetailedDataInAnalytics() {
    try {
      const detailedUserInfo = await this.getDetailedUserInfo('week');
      
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      await analyticsRef.update({
        detailedUsers: detailedUserInfo.users,
        detailedDownloads: detailedUserInfo.agents,
        detailedPurchases: detailedUserInfo.orders,
        detailedVisits: detailedUserInfo.visitors,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      logger.info('[ANALYTICS] Updated detailed data in analytics collection');
    } catch (error) {
      logger.error('[ANALYTICS] Error updating detailed data in analytics:', error);
    }
  }

  /**
   * One-time script to populate analytics from existing data
   */
  async populateFromExistingData() {
    try {
      logger.info('[ANALYTICS] Starting one-time population from existing data...');
      
      // Get all agents
      const agentsSnapshot = await db.collection('agents').get();
      let totalAgents = 0;
      let freeAgents = 0;
      let paidAgents = 0;
      let totalDownloads = 0;
      
      agentsSnapshot.forEach(doc => {
        const agent = doc.data();
        totalAgents++;
        if (agent.isFree || agent.price === 0) {
          freeAgents++;
        } else {
          paidAgents++;
        }
        totalDownloads += agent.downloadCount || 0;
      });
      
      // Get all users
      const usersSnapshot = await db.collection('users').get();
      const totalUsers = usersSnapshot.size;
      
      // Get all orders
      const ordersSnapshot = await db.collection('orders').get();
      let totalRevenue = 0;
      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        totalRevenue += parseFloat(order.total || order.amount || 0);
      });
      
      // Get all visits
      const visitsSnapshot = await db.collection('productViews').get();
      const totalVisits = visitsSnapshot.size;
      
      // Get detailed user information for the population
      const detailedUserInfo = await this.getDetailedUserInfo('month', true);
      
      // Generate sample daily metrics for the last 30 days
      const dailyMetrics = {};
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = date.toISOString().split('T')[0];
        
        // Generate sample data with some randomness
        const baseSales = Math.floor(totalRevenue / 30) + Math.floor(Math.random() * 100);
        const baseUsers = Math.floor(totalUsers / 30) + Math.floor(Math.random() * 2);
        const baseVisits = Math.floor(totalVisits / 30) + Math.floor(Math.random() * 20);
        const baseDownloads = Math.floor(totalDownloads / 30) + Math.floor(Math.random() * 5);
        
        dailyMetrics[dateKey] = {
          sales: baseSales,
          users: baseUsers,
          visitors: baseVisits,
          downloads: baseDownloads
        };
      }
      
      // Update analytics collection
      const analyticsRef = db.collection(this.analyticsCollection).doc('main');
      await analyticsRef.set({
        totalAgents,
        freeAgents,
        paidAgents,
        totalDownloads,
        totalUsers,
        newUsersToday: 0,
        activeUsersToday: 0,
        totalRevenue,
        revenueToday: 0,
        totalOrders: ordersSnapshot.size,
        totalVisits,
        visitsToday: 0,
        uniqueVisitorsToday: 0,
        topAgents: [],
        dailyMetrics: dailyMetrics,
        // Include detailed user information in the collection
        detailedUsers: detailedUserInfo.users,
        detailedDownloads: detailedUserInfo.agents,
        detailedPurchases: detailedUserInfo.orders,
        detailedVisits: detailedUserInfo.visitors,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      logger.info(`[ANALYTICS] Populated analytics with ${detailedUserInfo.users.length} users, ${detailedUserInfo.agents.length} downloads, ${detailedUserInfo.orders.length} purchases, ${detailedUserInfo.visitors.length} visits`);
      
      // Update top agents
      await this.updateTopAgents();
      
      logger.info('[ANALYTICS] One-time population completed successfully');
    } catch (error) {
      logger.error('[ANALYTICS] Error in one-time population:', error);
    }
  }
}

// Export singleton instance
module.exports = new AnalyticsService();
