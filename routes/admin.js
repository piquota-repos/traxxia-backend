const express = require('express');
const { ObjectId } = require('mongodb');
const { logAuditTrail, createPagination } = require('../utils/helpers');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Get user data (conversations + businesses + phase analysis)
router.get('/user-data/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const { business_id } = req.query;

    if (!ObjectId.isValid(user_id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Verify access permissions
    const targetUser = await db.collection('users').findOne({
      _id: new ObjectId(user_id)
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Admin can only see users from their company
    if (req.user.role === 'admin' && !targetUser.company_id.equals(req.user.company_id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let businessFilter = { user_id: new ObjectId(user_id) };
    if (business_id) {
      businessFilter._id = new ObjectId(business_id);
    }

    // Get user's businesses
    const businesses = await db.collection('user_businesses')
      .find(businessFilter)
      .sort({ created_at: -1 })
      .toArray();

    // Get conversations for the businesses
    const businessIds = businesses.map(b => b._id);
    const conversations = await db.collection('user_business_conversations')
      .find({ 
        user_id: new ObjectId(user_id),
        business_id: { $in: businessIds }
      })
      .sort({ created_at: -1 })
      .toArray();

    // Get phase analysis for the businesses
    const phaseAnalysis = await db.collection('phase_analysis')
      .find({ 
        user_id: new ObjectId(user_id),
        business_id: { $in: businessIds }
      })
      .sort({ phase: 1, created_at: -1 })
      .toArray();

    // Get user profile
    const userProfile = await db.collection('users').findOne(
      { _id: new ObjectId(user_id) },
      { projection: { password: 0 } }
    );

    res.json({
      user: userProfile,
      businesses,
      conversations,
      phase_analysis: phaseAnalysis,
      summary: {
        total_businesses: businesses.length,
        total_conversations: conversations.length,
        total_analysis: phaseAnalysis.length,
        phases_completed: [...new Set(phaseAnalysis.map(p => p.phase))].sort()
      }
    });
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get audit trail
router.get('/audit-trail', async (req, res) => {
  try {
    const { 
      user_id, 
      event_type, 
      start_date, 
      end_date, 
      limit = 100, 
      page = 1,
      include_analysis_data = false 
    } = req.query;

    let filter = {};

    // Role-based filtering
    if (req.user.role === 'admin') {
      // Admin sees audit trail from their company users
      const companyUsers = await db.collection('users')
        .find({ company_id: req.user.company_id })
        .project({ _id: 1 })
        .toArray();
      filter.user_id = { $in: companyUsers.map(u => u._id) };
    }
    // Super admin sees all audit trail

    if (user_id) {
      filter.user_id = new ObjectId(user_id);
    }

    if (event_type) {
      filter.event_type = event_type;
    }

    if (start_date || end_date) {
      filter.timestamp = {};
      if (start_date) {
        filter.timestamp.$gte = new Date(start_date);
      }
      if (end_date) {
        filter.timestamp.$lte = new Date(end_date);
      }
    }

    const skip = (page - 1) * limit;

    // Get audit trail entries with user details
    const auditEntries = await db.collection('audit_trail').aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          event_type: 1,
          timestamp: 1,
          details: 1,
          'user.name': 1,
          'user.email': 1,
          'user.role': 1
        }
      },
      { $sort: { timestamp: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ]).toArray();

    // Get total count for pagination
    const total = await db.collection('audit_trail').countDocuments(filter);

    // If including analysis data, get phase analysis for relevant entries
    if (include_analysis_data === 'true') {
      for (let entry of auditEntries) {
        if (entry.event_type === 'phase_analysis_saved' && entry.details.business_id) {
          const analysis = await db.collection('phase_analysis').findOne({
            business_id: new ObjectId(entry.details.business_id),
            phase: entry.details.phase,
            analysis_type: entry.details.analysis_type
          });
          entry.analysis_data = analysis;
        }
      }
    }

    res.json({
      audit_entries: auditEntries,
      pagination: createPagination(parseInt(page), parseInt(limit), total),
      filters: {
        user_id: user_id || null,
        event_type: event_type || null,
        start_date: start_date || null,
        end_date: end_date || null
      }
    });
  } catch (error) {
    console.error('Error fetching audit trail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific audit trail analysis data
router.get('/audit-trail/:audit_id/analysis-data', async (req, res) => {
  try {
    const { audit_id } = req.params;

    if (!ObjectId.isValid(audit_id)) {
      return res.status(400).json({ error: 'Invalid audit ID' });
    }

    const auditEntry = await db.collection('audit_trail').findOne({
      _id: new ObjectId(audit_id)
    });

    if (!auditEntry) {
      return res.status(404).json({ error: 'Audit entry not found' });
    }

    // Check if this audit entry has analysis data
    if (auditEntry.event_type !== 'phase_analysis_saved' || !auditEntry.details.business_id) {
      return res.status(400).json({ error: 'This audit entry does not contain analysis data' });
    }

    const analysisData = await db.collection('phase_analysis').findOne({
      business_id: new ObjectId(auditEntry.details.business_id),
      phase: auditEntry.details.phase,
      analysis_type: auditEntry.details.analysis_type
    });

    if (!analysisData) {
      return res.status(404).json({ error: 'Analysis data not found' });
    }

    res.json({
      audit_entry: auditEntry,
      analysis_data: analysisData
    });
  } catch (error) {
    console.error('Error fetching audit analysis data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get audit event types
router.get('/audit-trail/event-types', async (req, res) => {
  try {
    let filter = {};

    // Role-based filtering
    if (req.user.role === 'admin') {
      const companyUsers = await db.collection('users')
        .find({ company_id: req.user.company_id })
        .project({ _id: 1 })
        .toArray();
      filter.user_id = { $in: companyUsers.map(u => u._id) };
    }

    const eventTypes = await db.collection('audit_trail').distinct('event_type', filter);

    res.json({ event_types: eventTypes.sort() });
  } catch (error) {
    console.error('Error fetching event types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
