const express = require('express');
const { ObjectId } = require('mongodb');
const { logAuditTrail } = require('../utils/helpers');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Get phase analysis results
router.get('/', async (req, res) => {
  try {
    const { phase, business_id, analysis_type, user_id } = req.query;
    let filter = {};

    // Role-based access control
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      if (user_id) {
        filter.user_id = new ObjectId(user_id);
        
        // Admin can only see users from their company
        if (req.user.role === 'admin') {
          const targetUser = await db.collection('users').findOne({
            _id: new ObjectId(user_id),
            company_id: req.user.company_id
          });
          if (!targetUser) {
            return res.status(403).json({ error: 'Access denied' });
          }
        }
      } else if (req.user.role === 'admin') {
        // Admin sees analysis from their company users
        const companyUsers = await db.collection('users')
          .find({ company_id: req.user.company_id })
          .project({ _id: 1 })
          .toArray();
        filter.user_id = { $in: companyUsers.map(u => u._id) };
      }
      // Super admin sees all analysis if no user_id specified
    } else {
      // Regular user sees only their analysis
      filter.user_id = req.user._id;
    }

    if (phase) {
      filter.phase = parseInt(phase);
    }

    if (business_id) {
      filter.business_id = new ObjectId(business_id);
    }

    if (analysis_type) {
      filter.analysis_type = analysis_type;
    }

    const analysisResults = await db.collection('phase_analysis')
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();

    res.json({ 
      analysis_results: analysisResults,
      total: analysisResults.length
    });
  } catch (error) {
    console.error('Error fetching phase analysis:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get phase analysis by specific phase
router.get('/:phase', async (req, res) => {
  try {
    const { phase } = req.params;
    const { business_id, analysis_type, user_id } = req.query;

    if (!phase || isNaN(phase) || phase < 1 || phase > 3) {
      return res.status(400).json({ error: 'Invalid phase. Must be 1, 2, or 3' });
    }

    let filter = { phase: parseInt(phase) };

    // Role-based access control
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      if (user_id) {
        filter.user_id = new ObjectId(user_id);
        
        if (req.user.role === 'admin') {
          const targetUser = await db.collection('users').findOne({
            _id: new ObjectId(user_id),
            company_id: req.user.company_id
          });
          if (!targetUser) {
            return res.status(403).json({ error: 'Access denied' });
          }
        }
      } else if (req.user.role === 'admin') {
        const companyUsers = await db.collection('users')
          .find({ company_id: req.user.company_id })
          .project({ _id: 1 })
          .toArray();
        filter.user_id = { $in: companyUsers.map(u => u._id) };
      }
    } else {
      filter.user_id = req.user._id;
    }

    if (business_id) {
      filter.business_id = new ObjectId(business_id);
    }

    if (analysis_type) {
      filter.analysis_type = analysis_type;
    }

    const analysisResults = await db.collection('phase_analysis')
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();

    // Get available analysis types for this phase
    const availableTypes = await db.collection('phase_analysis')
      .distinct('analysis_type', { phase: parseInt(phase) });

    res.json({ 
      phase: parseInt(phase),
      analysis_results: analysisResults,
      available_types: availableTypes,
      total: analysisResults.length
    });
  } catch (error) {
    console.error('Error fetching phase analysis:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get missing questions for analysis
router.post('/missing-questions', async (req, res) => {
  try {
    const { analysis_type, business_id } = req.body;

    if (!analysis_type || !business_id) {
      return res.status(400).json({ error: 'Analysis type and business ID are required' });
    }

    // Verify business access
    const business = await db.collection('user_businesses').findOne({
      _id: new ObjectId(business_id)
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (req.user.role === 'user' && !business.user_id.equals(req.user._id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get questions required for this analysis type
    const requiredQuestions = await db.collection('global_questions')
      .find({ 
        used_for: { $in: [analysis_type, 'all'] },
        status: 'active'
      })
      .sort({ phase: 1, order: 1 })
      .toArray();

    // Get answered questions for this business
    const answeredQuestions = await db.collection('user_business_conversations')
      .find({ 
        business_id: new ObjectId(business_id),
        user_id: business.user_id,
        $or: [
          { response: { $ne: '' } },
          { skipped: true }
        ]
      })
      .project({ question_id: 1 })
      .toArray();

    const answeredQuestionIds = answeredQuestions.map(q => q.question_id.toString());

    // Find missing questions
    const missingQuestions = requiredQuestions.filter(q => 
      !answeredQuestionIds.includes(q._id.toString())
    );

    res.json({
      analysis_type,
      business_id,
      total_required: requiredQuestions.length,
      total_answered: answeredQuestions.length,
      total_missing: missingQuestions.length,
      missing_questions: missingQuestions,
      can_generate_analysis: missingQuestions.length === 0
    });
  } catch (error) {
    console.error('Error checking missing questions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
