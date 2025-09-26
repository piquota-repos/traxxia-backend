// Utility functions for the application

/**
 * Format date for display
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
const formatDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

/**
 * Generate random string for IDs
 * @param {number} length - Length of the string
 * @returns {string} Random string
 */
const generateRandomString = (length = 10) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Sanitize string input
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized string
 */
const sanitizeString = (input) => {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[<>]/g, '');
};

/**
 * Create pagination object
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items
 * @returns {object} Pagination object
 */
const createPagination = (page, limit, total) => {
  return {
    current_page: page,
    total_pages: Math.ceil(total / limit),
    total_items: total,
    per_page: limit,
    has_next: page < Math.ceil(total / limit),
    has_prev: page > 1
  };
};

/**
 * Log audit trail entry
 * @param {object} db - Database instance
 * @param {string} userId - User ID
 * @param {string} eventType - Type of event
 * @param {object} details - Event details
 */
const logAuditTrail = async (db, userId, eventType, details = {}) => {
  try {
    await db.collection('audit_trail').insertOne({
      user_id: userId,
      event_type: eventType,
      timestamp: new Date(),
      details
    });
  } catch (error) {
    console.error('Error logging audit trail:', error);
  }
};

module.exports = {
  formatDate,
  generateRandomString,
  isValidEmail,
  sanitizeString,
  createPagination,
  logAuditTrail
};
