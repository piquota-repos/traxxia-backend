const NodeCache = require('node-cache');
const config = require('../config');

class CacheService {
  constructor() {
    // Cache configuration from config file
    this.config = config.cache;
    this.enabled = this.config.enabled;
    
    // Initialize cache instances only if caching is enabled
    if (this.enabled) {
      this.initializeCaches();
    } else {
      console.log('🚫 Caching is disabled via configuration');
    }
  }

  initializeCaches() {
    const { layers, checkPeriod } = this.config;

    // Users cache
    this.userCache = layers.users.enabled ? new NodeCache({ 
      stdTTL: layers.users.ttl,
      checkperiod: checkPeriod,
      maxKeys: layers.users.maxKeys
    }) : null;
    
    // Questions cache
    this.questionCache = layers.questions.enabled ? new NodeCache({ 
      stdTTL: layers.questions.ttl,
      checkperiod: checkPeriod,
      maxKeys: layers.questions.maxKeys
    }) : null;
    
    // Companies cache
    this.companyCache = layers.companies.enabled ? new NodeCache({ 
      stdTTL: layers.companies.ttl,
      checkperiod: checkPeriod,
      maxKeys: layers.companies.maxKeys
    }) : null;
    
    // Businesses cache
    this.businessCache = layers.businesses.enabled ? new NodeCache({ 
      stdTTL: layers.businesses.ttl,
      checkperiod: checkPeriod,
      maxKeys: layers.businesses.maxKeys
    }) : null;

    // Conversations cache
    this.conversationCache = layers.conversations.enabled ? new NodeCache({
      stdTTL: layers.conversations.ttl,
      checkperiod: checkPeriod,
      maxKeys: layers.conversations.maxKeys
    }) : null;

    console.log('✅ Cache service initialized with multiple cache layers');
  }

  // User cache methods
  setUser(userId, userData) {
    if (!this.enabled || !this.userCache) return false;
    const key = `user_${userId}`;
    return this.userCache.set(key, userData);
  }

  getUser(userId) {
    if (!this.enabled || !this.userCache) return undefined;
    const key = `user_${userId}`;
    return this.userCache.get(key);
  }

  deleteUser(userId) {
    if (!this.enabled || !this.userCache) return false;
    const key = `user_${userId}`;
    return this.userCache.del(key);
  }

  // Question cache methods
  setQuestions(phase, questions) {
    if (!this.enabled || !this.questionCache) return false;
    const key = `questions_phase_${phase}`;
    return this.questionCache.set(key, questions);
  }

  getQuestions(phase) {
    if (!this.enabled || !this.questionCache) return undefined;
    const key = `questions_phase_${phase}`;
    return this.questionCache.get(key);
  }

  setAllQuestions(questions) {
    if (!this.enabled || !this.questionCache) return false;
    return this.questionCache.set('all_questions', questions);
  }

  getAllQuestions() {
    if (!this.enabled || !this.questionCache) return undefined;
    return this.questionCache.get('all_questions');
  }

  invalidateQuestions() {
    if (!this.enabled || !this.questionCache) return false;
    console.log('🗑️  Invalidating question cache');
    return this.questionCache.flushAll();
  }

  // Company cache methods
  setCompanies(companies) {
    if (!this.enabled || !this.companyCache) return false;
    return this.companyCache.set('active_companies', companies);
  }

  getCompanies() {
    if (!this.enabled || !this.companyCache) return undefined;
    return this.companyCache.get('active_companies');
  }

  invalidateCompanies() {
    if (!this.enabled || !this.companyCache) return false;
    console.log('🗑️  Invalidating company cache');
    return this.companyCache.del('active_companies');
  }

  // Business cache methods
  setUserBusinesses(userId, businesses) {
    if (!this.enabled || !this.businessCache) return false;
    const key = `businesses_${userId}`;
    return this.businessCache.set(key, businesses);
  }

  getUserBusinesses(userId) {
    if (!this.enabled || !this.businessCache) return undefined;
    const key = `businesses_${userId}`;
    return this.businessCache.get(key);
  }

  invalidateUserBusinesses(userId) {
    if (!this.enabled || !this.businessCache) return false;
    const key = `businesses_${userId}`;
    console.log(`🗑️  Invalidating business cache for user: ${userId}`);
    return this.businessCache.del(key);
  }

  invalidateAllBusinesses() {
    if (!this.enabled || !this.businessCache) return false;
    console.log('🗑️  Invalidating all business cache');
    return this.businessCache.flushAll();
  }

  // Conversation cache methods
  setConversations(userId, businessId, phase, conversations) {
    if (!this.enabled || !this.conversationCache) return false;
    const key = `conversations_${userId}_${businessId}_${phase}`;
    return this.conversationCache.set(key, conversations);
  }

  getConversations(userId, businessId, phase) {
    if (!this.enabled || !this.conversationCache) return undefined;
    const key = `conversations_${userId}_${businessId}_${phase}`;
    return this.conversationCache.get(key);
  }

  invalidateConversations(userId, businessId = null) {
    if (!this.enabled || !this.conversationCache) return false;
    if (businessId) {
      // Invalidate specific business conversations
      const keys = this.conversationCache.keys().filter(key => 
        key.startsWith(`conversations_${userId}_${businessId}`)
      );
      keys.forEach(key => this.conversationCache.del(key));
      console.log(`🗑️  Invalidated conversation cache for user ${userId}, business ${businessId}`);
    } else {
      // Invalidate all conversations for user
      const keys = this.conversationCache.keys().filter(key => 
        key.startsWith(`conversations_${userId}`)
      );
      keys.forEach(key => this.conversationCache.del(key));
      console.log(`🗑️  Invalidated all conversation cache for user ${userId}`);
    }
  }

  // General cache statistics
  getStats() {
    if (!this.enabled) {
      return {
        enabled: false,
        users: { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0 },
        questions: { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0 },
        companies: { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0 },
        businesses: { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0 },
        conversations: { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0 }
      };
    }

    return {
      enabled: true,
      users: this.userCache ? {
        ...this.userCache.getStats(),
        keys: this.userCache.keys().length
      } : { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0, disabled: true },
      questions: this.questionCache ? {
        ...this.questionCache.getStats(),
        keys: this.questionCache.keys().length
      } : { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0, disabled: true },
      companies: this.companyCache ? {
        ...this.companyCache.getStats(),
        keys: this.companyCache.keys().length
      } : { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0, disabled: true },
      businesses: this.businessCache ? {
        ...this.businessCache.getStats(),
        keys: this.businessCache.keys().length
      } : { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0, disabled: true },
      conversations: this.conversationCache ? {
        ...this.conversationCache.getStats(),
        keys: this.conversationCache.keys().length
      } : { hits: 0, misses: 0, keys: 0, ksize: 0, vsize: 0, disabled: true }
    };
  }

  // Get cache hit/miss rates
  getHitRates() {
    const stats = this.getStats();
    const calculateHitRate = (cacheStats) => {
      const total = cacheStats.hits + cacheStats.misses;
      return total > 0 ? ((cacheStats.hits / total) * 100).toFixed(2) : 0;
    };

    return {
      users: `${calculateHitRate(stats.users)}%`,
      questions: `${calculateHitRate(stats.questions)}%`,
      companies: `${calculateHitRate(stats.companies)}%`,
      businesses: `${calculateHitRate(stats.businesses)}%`,
      conversations: `${calculateHitRate(stats.conversations)}%`
    };
  }

  // Clear all caches
  flushAll() {
    if (!this.enabled) {
      console.log('🚫 Cache is disabled - nothing to flush');
      return false;
    }
    
    console.log('🗑️  Flushing all caches');
    if (this.userCache) this.userCache.flushAll();
    if (this.questionCache) this.questionCache.flushAll();
    if (this.companyCache) this.companyCache.flushAll();
    if (this.businessCache) this.businessCache.flushAll();
    if (this.conversationCache) this.conversationCache.flushAll();
    return true;
  }

  // Cache middleware for automatic caching
  middleware(cacheType, keyGenerator, ttl = null) {
    return async (req, res, next) => {
      try {
        // Skip caching if disabled or cache layer not available
        if (!this.enabled) {
          return next();
        }
        
        const cacheKey = typeof keyGenerator === 'function' ? keyGenerator(req) : keyGenerator;
        const cache = this[`${cacheType}Cache`];
        
        if (!cache) {
          return next();
        }

        const cachedData = cache.get(cacheKey);
        if (cachedData) {
          console.log(`🎯 Cache HIT for ${cacheType}: ${cacheKey}`);
          return res.json(cachedData);
        }

        console.log(`❌ Cache MISS for ${cacheType}: ${cacheKey}`);
        
        // Store original json method
        const originalJson = res.json;
        
        // Override json method to cache the response
        res.json = function(data) {
          if (res.statusCode === 200) {
            if (ttl) {
              cache.set(cacheKey, data, ttl);
            } else {
              cache.set(cacheKey, data);
            }
            console.log(`💾 Cached ${cacheType}: ${cacheKey}`);
          }
          return originalJson.call(this, data);
        };

        next();
      } catch (error) {
        console.error('Cache middleware error:', error);
        next();
      }
    };
  }
}

module.exports = new CacheService();
