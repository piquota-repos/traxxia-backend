const express = require('express');
const { ObjectId } = require('mongodb');
const { logAuditTrail, createPagination } = require('../utils/helpers');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Get businesses for a user
router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    let targetUserId;

    // Role-based access control
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      // Admin can query specific user or see all in their company
      if (user_id) {
        targetUserId = new ObjectId(user_id);
        
        // Admin can only see users from their company (unless super admin)
        if (req.user.role === 'admin') {
          const targetUser = await db.collection('users').findOne({
            _id: targetUserId,
            company_id: req.user.company_id
          });
          if (!targetUser) {
            return res.status(403).json({ error: 'Access denied' });
          }
        }
      } else {
        // No user_id specified, show businesses based on role
        if (req.user.role === 'admin') {
          // Admin sees all businesses from their company
          const companyUsers = await db.collection('users')
            .find({ company_id: req.user.company_id })
            .project({ _id: 1 })
            .toArray();
          
          const userIds = companyUsers.map(user => user._id);
          const businesses = await db.collection('user_businesses')
            .find({ user_id: { $in: userIds } })
            .sort({ created_at: -1 })
            .toArray();
          
          return res.json({ businesses });
        } else {
          // Super admin sees all businesses
          const businesses = await db.collection('user_businesses')
            .find({})
            .sort({ created_at: -1 })
            .toArray();
          
          return res.json({ businesses });
        }
      }
    } else {
      // Regular user can only see their own businesses
      targetUserId = req.user._id;
    }

    const businesses = await db.collection('user_businesses')
      .find({ user_id: targetUserId })
      .sort({ created_at: -1 })
      .toArray();

    res.json({ businesses });
  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new business
router.post('/', async (req, res) => {
  try {
    const { business_name, business_purpose, description, city, country } = req.body;

    if (!business_name || !business_purpose) {
      return res.status(400).json({ error: 'Business name and purpose are required' });
    }

    const businessData = {
      user_id: req.user._id,
      business_name: business_name.trim(),
      business_purpose: business_purpose.trim(),
      description: description ? description.trim() : '',
      city: city ? city.trim() : '',
      country: country ? country.trim() : '',
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('user_businesses').insertOne(businessData);

    // Log business creation
    await logAuditTrail(db, req.user._id, 'business_created', {
      business_id: result.insertedId,
      business_name,
      business_purpose
    });

    res.status(201).json({
      message: 'Business created successfully',
      business_id: result.insertedId
    });
  } catch (error) {
    console.error('Error creating business:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete business
router.delete('/:id', async (req, res) => {
  try {
    const businessId = new ObjectId(req.params.id);
    const userId = new ObjectId(req.user._id);

    // Check if business exists and belongs to user (or user is admin)
    let filter = { _id: businessId };
    
    if (req.user.role === 'user') {
      filter.user_id = userId;
    } else if (req.user.role === 'admin') {
      // Admin can delete businesses from users in their company
      const business = await db.collection('user_businesses').findOne({ _id: businessId });
      if (business) {
        const businessOwner = await db.collection('users').findOne({
          _id: business.user_id,
          company_id: req.user.company_id
        });
        if (!businessOwner) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    }
    // Super admin can delete any business (no additional filter needed)

    const business = await db.collection('user_businesses').findOne(filter);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Delete the business
    await db.collection('user_businesses').deleteOne(filter);

    // Also delete related conversations and analysis
    await db.collection('user_business_conversations').deleteMany({ business_id: businessId });
    await db.collection('phase_analysis').deleteMany({ business_id: businessId });

    // Log business deletion
    await logAuditTrail(db, req.user._id, 'business_deleted', {
      business_id: businessId,
      business_name: business.business_name
    });

    res.json({ message: 'Business and related data deleted successfully' });
  } catch (error) {
    console.error('Error deleting business:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload decision for business
router.post('/:id/upload-decision', async (req, res) => {
  try {
    const businessId = req.params.id;
    const { decision } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approved or rejected' });
    }

    const result = await db.collection('user_businesses').updateOne(
      { _id: new ObjectId(businessId) },
      { 
        $set: { 
          upload_decision: decision,
          decision_date: new Date(),
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Log upload decision
    await logAuditTrail(db, req.user._id, 'upload_decision_made', {
      business_id: businessId,
      decision
    });

    res.json({ message: 'Upload decision saved successfully' });
  } catch (error) {
    console.error('Error saving upload decision:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
