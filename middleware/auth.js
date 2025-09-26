const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

// Get database instance
let db;
const setDatabase = (database) => {
  db = database;
};

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.SECRET_KEY || 'default_secret_key');
    
    // Get user details from database
    const user = await db.collection('users').findOne({ 
      _id: new ObjectId(decoded.userId) 
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token - user not found' });
    }

    // Get company details including logo
    let company = null;
    if (user.company_id) {
      company = await db.collection('companies').findOne(
        { _id: user.company_id },
        { projection: { company_name: 1, logo: 1, industry: 1 } }
      );
    }

    req.user = {
      ...user,
      company: company
    };
    
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Admin role middleware
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  next();
};

// Super admin role middleware
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  
  next();
};

module.exports = {
  setDatabase,
  authenticateToken,
  requireAdmin,
  requireSuperAdmin
};
