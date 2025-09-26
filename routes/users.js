const express = require('express');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { logAuditTrail, createPagination, isValidEmail } = require('../utils/helpers');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: req.user._id },
      { projection: { password: 0 } }
    );
    
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found' 
      });
    }

    res.json({ user });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const { name, email } = req.body;
    const updates = {};
    
    if (name) {
      if (name.trim().length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters long' });
      }
      updates.name = name.trim();
    }
    
    if (email) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      
      // Check if email already exists for another user
      const existingUser = await db.collection('users').findOne({
        email,
        _id: { $ne: req.user._id }
      });
      
      if (existingUser) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      
      updates.email = email;
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    updates.updated_at = new Date();

    const result = await db.collection('users').updateOne(
      { _id: req.user._id },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log the update
    await logAuditTrail(db, req.user._id, 'profile_updated', updates);

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.put('/password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    // Get current user with password
    const user = await db.collection('users').findOne({ _id: req.user._id });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(current_password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    await db.collection('users').updateOne(
      { _id: req.user._id },
      { 
        $set: { 
          password: hashedPassword,
          updated_at: new Date()
        }
      }
    );

    // Log password change
    await logAuditTrail(db, req.user._id, 'password_changed', {
      timestamp: new Date()
    });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users (Admin only)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    
    // Role-based filtering
    if (req.user.role === 'admin') {
      // Admin can only see users from their company
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
      users,
      pagination: createPagination(parseInt(page), parseInt(limit), total)
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID (Admin only)
router.get('/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    let filter = { _id: new ObjectId(userId) };
    
    // Role-based access control
    if (req.user.role === 'admin') {
      filter.company_id = req.user.company_id;
    }

    const user = await db.collection('users').aggregate([
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
          password: 0
        }
      }
    ]).toArray();

    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: user[0] });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user role (Super admin only)
router.put('/:id/role', async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const validRoles = ['user', 'admin', 'super_admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Cannot change own role
    if (req.user._id.toString() === userId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    const result = await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          role,
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log role change
    await logAuditTrail(db, req.user._id, 'user_role_changed', {
      target_user_id: userId,
      new_role: role
    });

    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to create new user
router.post('/admin-create', async (req, res) => {
  try {
    const { name, email, password, role = 'user', company_id } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Check if email already exists
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Determine target company
    let targetCompanyId;
    if (req.user.role === 'super_admin' && company_id) {
      // Super admin can create users for any company
      const targetCompany = await db.collection('companies').findOne({
        _id: new ObjectId(company_id),
        status: 'active'
      });
      if (!targetCompany) {
        return res.status(400).json({ error: 'Invalid company' });
      }
      targetCompanyId = new ObjectId(company_id);
    } else {
      // Admin can only create users for their own company
      targetCompanyId = req.user.company_id;
    }

    // Validate role assignment
    const validRoles = ['user', 'admin'];
    if (req.user.role === 'super_admin') {
      validRoles.push('super_admin');
    }
    
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role assignment' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role,
      company_id: targetCompanyId,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: req.user._id
    };

    const result = await db.collection('users').insertOne(userData);

    // Log user creation
    await logAuditTrail(db, req.user._id, 'user_created_by_admin', {
      created_user_id: result.insertedId,
      email,
      role,
      company_id: targetCompanyId
    });

    res.status(201).json({
      message: 'User created successfully',
      user_id: result.insertedId,
      user: {
        id: result.insertedId,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        created_at: userData.created_at
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to get users with detailed management info
router.get('/admin-management', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role, company_id } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    
    // Role-based filtering
    if (req.user.role === 'admin') {
      // Admin can only see users from their company
      filter.company_id = req.user.company_id;
    } else if (req.user.role === 'super_admin' && company_id) {
      // Super admin can filter by specific company
      filter.company_id = new ObjectId(company_id);
    }
    // Super admin without company_id sees all users
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) {
      filter.role = role;
    }

    // Get users with company details and activity stats
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
        $lookup: {
          from: 'user_businesses',
          localField: '_id',
          foreignField: 'user_id',
          as: 'businesses'
        }
      },
      {
        $lookup: {
          from: 'user_business_conversations',
          localField: '_id',
          foreignField: 'user_id',
          as: 'conversations'
        }
      },
      {
        $lookup: {
          from: 'audit_trail',
          localField: '_id',
          foreignField: 'user_id',
          as: 'recent_activity'
        }
      },
      {
        $addFields: {
          total_businesses: { $size: '$businesses' },
          total_conversations: { $size: '$conversations' },
          last_activity: { 
            $max: '$recent_activity.timestamp'
          }
        }
      },
      {
        $project: {
          password: 0,
          businesses: 0,
          conversations: 0,
          recent_activity: 0,
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
      users,
      pagination: createPagination(parseInt(page), parseInt(limit), total),
      filters: {
        search: search || null,
        role: role || null,
        company_id: company_id || null
      }
    });
  } catch (error) {
    console.error('Error fetching users for admin management:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
