# 🏗️ Modularization Guide - How to Update and Add Methods

## 📁 **Project Structure**

```
traxxia-backend/
├── server.js                 # Original monolithic server
├── server-modular.js         # New modular server
├── config/
│   └── database.js           # Database connection management
├── middleware/
│   └── auth.js               # Authentication middleware
├── routes/
│   ├── auth.js               # Authentication routes
│   └── companies.js          # Companies routes
└── utils/
    └── helpers.js            # Utility functions
```

## 🔄 **How to Update Existing Methods**

### **Example 1: Updating the Login Method**

**Current location**: `routes/auth.js`

**To modify the login method:**

```javascript
// In routes/auth.js
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // ✅ ADD: Enhanced validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    // ✅ ADD: Email format validation
    if (!isValidEmail(email)) {
      return res.status(400).json({ 
        error: 'Invalid email format',
        code: 'INVALID_EMAIL'
      });
    }

    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ✅ MODIFY: Enhanced company details
    let company = null;
    if (user.company_id) {
      company = await db.collection('companies').findOne(
        { _id: user.company_id },
        { 
          projection: { 
            company_name: 1, 
            logo: 1, 
            industry: 1,
            // ✅ ADD: Additional company fields
            size: 1,
            status: 1
          } 
        }
      );
    }

    // ✅ MODIFY: Enhanced token with more claims
    const token = jwt.sign(
      { 
        userId: user._id,
        role: user.role,
        companyId: user.company_id
      },
      process.env.SECRET_KEY || 'default_secret_key',
      { expiresIn: '24h' }
    );

    // ✅ ADD: Enhanced audit logging
    await logAuditTrail(db, user._id, 'login', {
      email: user.email,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      timestamp: new Date()
    });

    // ✅ MODIFY: Enhanced response
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: company,
        // ✅ ADD: Additional user info
        last_login: new Date(),
        permissions: await getUserPermissions(user.role)
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ ADD: Helper function for permissions
const getUserPermissions = async (role) => {
  const permissions = {
    user: ['read_profile', 'update_profile'],
    admin: ['read_profile', 'update_profile', 'manage_users', 'view_reports'],
    super_admin: ['*'] // All permissions
  };
  return permissions[role] || permissions.user;
};
```

### **Example 2: Updating the Companies List Method**

**Current location**: `routes/companies.js`

```javascript
// In routes/companies.js
router.get('/', async (req, res) => {
  try {
    // ✅ ADD: Query parameters for filtering
    const { search, industry, limit = 50, page = 1 } = req.query;
    const skip = (page - 1) * limit;

    // ✅ ADD: Build dynamic filter
    let filter = { status: 'active' };
    
    if (search) {
      filter.company_name = { $regex: search, $options: 'i' };
    }
    
    if (industry) {
      filter.industry = industry;
    }

    // ✅ MODIFY: Enhanced query with aggregation
    const companies = await db.collection('companies').aggregate([
      { $match: filter },
      {
        // ✅ ADD: Include user count for each company
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'company_id',
          as: 'users'
        }
      },
      {
        $addFields: {
          user_count: { $size: '$users' }
        }
      },
      {
        $project: { 
          company_name: 1, 
          industry: 1, 
          logo: 1,
          // ✅ ADD: Additional fields
          size: 1,
          user_count: 1,
          created_at: 1
        }
      },
      { $sort: { company_name: 1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ]).toArray();

    // ✅ ADD: Total count for pagination
    const total = await db.collection('companies').countDocuments(filter);

    // ✅ MODIFY: Enhanced response with metadata
    res.json({ 
      success: true,
      companies,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_companies: total,
        per_page: parseInt(limit)
      },
      filters_applied: {
        search: search || null,
        industry: industry || null
      }
    });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      code: 'FETCH_COMPANIES_ERROR'
    });
  }
});
```

## ➕ **How to Add New Methods**

### **Example 1: Adding a New Route Module**

**Step 1**: Create new route file `routes/users.js`

```javascript
const express = require('express');
const { ObjectId } = require('mongodb');
const { logAuditTrail, createPagination } = require('../utils/helpers');
const router = express.Router();

let db;
const setDatabase = (database) => {
  db = database;
};

// ✅ NEW: Get user profile
router.get('/profile', async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: req.user._id },
      { projection: { password: 0 } }
    );
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    res.json({ 
      success: true,
      user 
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// ✅ NEW: Update user profile
router.put('/profile', async (req, res) => {
  try {
    const { name, email } = req.body;
    const updates = {};
    
    if (name) updates.name = name;
    if (email) updates.email = email;
    updates.updated_at = new Date();

    const result = await db.collection('users').updateOne(
      { _id: req.user._id },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Log the update
    await logAuditTrail(db, req.user._id, 'profile_updated', updates);

    res.json({ 
      success: true,
      message: 'Profile updated successfully' 
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// ✅ NEW: Get all users (Admin only)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    
    // Role-based filtering
    if (req.user.role === 'admin') {
      filter.company_id = req.user.company_id;
    }
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) {
      filter.role = role;
    }

    const users = await db.collection('users').aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'companies',
          localField: 'company_id',
          foreignField: '_id',
          as: 'company'
        }
      },
      {
        $unwind: {
          path: '$company',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          password: 0,
          'company.created_at': 0,
          'company.updated_at': 0
        }
      },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ]).toArray();

    const total = await db.collection('users').countDocuments(filter);

    res.json({
      success: true,
      users,
      pagination: createPagination(parseInt(page), parseInt(limit), total)
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

module.exports = {
  router,
  setDatabase
};
```

**Step 2**: Register the new route in `server-modular.js`

```javascript
// In server-modular.js
const usersRoutes = require('./routes/users');

const initializeApp = async () => {
  try {
    db = await databaseConnection.connect();
    
    // Set database for all modules
    authMiddleware.setDatabase(db);
    authRoutes.setDatabase(db);
    companiesRoutes.setDatabase(db);
    usersRoutes.setDatabase(db); // ✅ ADD: New module
    
    setupRoutes();
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

const setupRoutes = () => {
  // Existing routes...
  
  // ✅ ADD: New users routes
  app.use('/api/users', 
    authMiddleware.authenticateToken, 
    usersRoutes.router
  );
  
  // Admin-only users routes
  app.use('/api/admin/users', 
    authMiddleware.authenticateToken, 
    authMiddleware.requireAdmin, 
    usersRoutes.router
  );
};
```

### **Example 2: Adding New Middleware**

**Step 1**: Create `middleware/validation.js`

```javascript
const { isValidEmail } = require('../utils/helpers');

// ✅ NEW: Request validation middleware
const validateRegistration = (req, res, next) => {
  const { name, email, password, company_id } = req.body;
  const errors = [];

  if (!name || name.trim().length < 2) {
    errors.push('Name must be at least 2 characters long');
  }

  if (!email || !isValidEmail(email)) {
    errors.push('Valid email is required');
  }

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!company_id) {
    errors.push('Company ID is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors
    });
  }

  next();
};

// ✅ NEW: Rate limiting middleware (simple implementation)
const rateLimiter = (windowMs = 15 * 60 * 1000, maxRequests = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const clientId = req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    const clientRequests = requests.get(clientId) || [];
    const validRequests = clientRequests.filter(time => time > windowStart);

    if (validRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        retry_after: Math.ceil(windowMs / 1000)
      });
    }

    validRequests.push(now);
    requests.set(clientId, validRequests);
    next();
  };
};

module.exports = {
  validateRegistration,
  rateLimiter
};
```

**Step 2**: Use the new middleware

```javascript
// In routes/auth.js
const { validateRegistration } = require('../middleware/validation');

// ✅ ADD: Use validation middleware
router.post('/register', validateRegistration, async (req, res) => {
  // Registration logic here...
});
```

### **Example 3: Adding New Utility Functions**

**In `utils/helpers.js`**:

```javascript
// ✅ NEW: Password strength validator
const validatePasswordStrength = (password) => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const score = [
    password.length >= minLength,
    hasUpperCase,
    hasLowerCase,
    hasNumbers,
    hasSpecialChar
  ].filter(Boolean).length;

  return {
    isValid: score >= 3,
    score,
    requirements: {
      minLength: password.length >= minLength,
      hasUpperCase,
      hasLowerCase,
      hasNumbers,
      hasSpecialChar
    }
  };
};

// ✅ NEW: Data export utility
const exportToCSV = (data, filename) => {
  if (!data || data.length === 0) return null;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => 
        JSON.stringify(row[header] || '')
      ).join(',')
    )
  ].join('\n');

  return {
    content: csvContent,
    filename: `${filename}_${new Date().toISOString().split('T')[0]}.csv`,
    contentType: 'text/csv'
  };
};

// ✅ NEW: File size formatter
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

module.exports = {
  // Existing functions...
  validatePasswordStrength,
  exportToCSV,
  formatFileSize
};
```

## 🚀 **Testing the Modular Server**

**Start the modular server**:
```bash
node server-modular.js
```

**Test endpoints**:
```bash
# Health check
curl http://localhost:5001/health

# Login
curl -X POST http://localhost:5001/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@traxxia.com","password":"admin123"}'

# Get companies
curl http://localhost:5001/api/companies

# Get user profile (with token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5001/api/users/profile
```

## 📋 **Migration Checklist**

When moving from monolithic to modular:

- [ ] **Backup original server.js**
- [ ] **Create route modules** for each major feature
- [ ] **Extract middleware** into separate files
- [ ] **Create utility functions** for common operations
- [ ] **Set up database connections** in each module
- [ ] **Test all endpoints** after modularization
- [ ] **Update documentation** for new structure
- [ ] **Add error handling** in each module
- [ ] **Implement logging** consistently
- [ ] **Add input validation** where needed

## 🎯 **Benefits of Modularization**

1. **Better Organization**: Each feature has its own file
2. **Easier Maintenance**: Changes are isolated to specific modules
3. **Team Collaboration**: Multiple developers can work on different modules
4. **Reusability**: Modules can be reused across projects
5. **Testing**: Easier to write unit tests for individual modules
6. **Scalability**: Easy to add new features without affecting existing code

## 🔄 **Next Steps**

1. **Move remaining routes** from original server.js to separate modules
2. **Add comprehensive error handling** to all modules
3. **Implement input validation** for all endpoints
4. **Add logging and monitoring** throughout the application
5. **Write unit tests** for each module
6. **Add API documentation** for all endpoints

This modular structure provides a solid foundation for scaling your application! 🚀
