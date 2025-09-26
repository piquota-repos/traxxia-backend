const express = require('express');
const { ObjectId } = require('mongodb');
const { logAuditTrail } = require('../utils/helpers');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Get conversations
router.get('/', async (req, res) => {
  try {
    const { phase, business_id, user_id } = req.query;
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
        // Admin sees conversations from their company users
        const companyUsers = await db.collection('users')
          .find({ company_id: req.user.company_id })
          .project({ _id: 1 })
          .toArray();
        filter.user_id = { $in: companyUsers.map(u => u._id) };
      }
      // Super admin sees all conversations if no user_id specified
    } else {
      // Regular user sees only their conversations
      filter.user_id = req.user._id;
    }

    if (phase) {
      filter.phase = parseInt(phase);
    }

    if (business_id) {
      filter.business_id = new ObjectId(business_id);
    }

    const conversations = await db.collection('user_business_conversations')
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();

    res.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save conversation response
router.post('/', async (req, res) => {
  try {
    const {
      question_id,
      business_id,
      phase,
      response,
      followup_questions = [],
      analysis_result = null
    } = req.body;

    if (!question_id || !business_id || !phase || !response) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify business belongs to user (or user has admin access)
    const business = await db.collection('user_businesses').findOne({
      _id: new ObjectId(business_id)
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check access permissions
    if (req.user.role === 'user' && !business.user_id.equals(req.user._id)) {
      return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.role === 'admin') {
      const businessOwner = await db.collection('users').findOne({
        _id: business.user_id,
        company_id: req.user.company_id
      });
      if (!businessOwner) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const conversationData = {
      user_id: business.user_id,
      business_id: new ObjectId(business_id),
      question_id: new ObjectId(question_id),
      phase: parseInt(phase),
      response: response.trim(),
      followup_questions,
      analysis_result,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('user_business_conversations').insertOne(conversationData);

    // Log conversation
    await logAuditTrail(db, req.user._id, 'conversation_saved', {
      conversation_id: result.insertedId,
      business_id,
      question_id,
      phase
    });

    res.status(201).json({
      message: 'Conversation saved successfully',
      conversation_id: result.insertedId
    });
  } catch (error) {
    console.error('Error saving conversation:', error);
    res.status(500).json({ error: 'Failed to save conversation' });
  }
});

// Skip question
router.post('/skip', async (req, res) => {
  try {
    const {
      question_id,
      business_id,
      phase,
      skip_reason = 'User skipped'
    } = req.body;

    if (!question_id || !business_id || !phase) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify business access (same logic as above)
    const business = await db.collection('user_businesses').findOne({
      _id: new ObjectId(business_id)
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (req.user.role === 'user' && !business.user_id.equals(req.user._id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const skipData = {
      user_id: business.user_id,
      business_id: new ObjectId(business_id),
      question_id: new ObjectId(question_id),
      phase: parseInt(phase),
      response: '',
      skipped: true,
      skip_reason,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('user_business_conversations').insertOne(skipData);

    // Log skip action
    await logAuditTrail(db, req.user._id, 'question_skipped', {
      conversation_id: result.insertedId,
      business_id,
      question_id,
      phase,
      skip_reason
    });

    res.status(201).json({
      message: 'Question skipped successfully',
      conversation_id: result.insertedId
    });
  } catch (error) {
    console.error('Error skipping question:', error);
    res.status(500).json({ error: 'Failed to skip question' });
  }
});

// Save followup question
router.post('/followup-question', async (req, res) => {
  try {
    const {
      question_id,
      business_id,
      phase,
      followup_question,
      parent_conversation_id
    } = req.body;

    if (!question_id || !business_id || !phase || !followup_question) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const followupData = {
      user_id: req.user._id,
      business_id: new ObjectId(business_id),
      question_id: new ObjectId(question_id),
      phase: parseInt(phase),
      followup_question: followup_question.trim(),
      parent_conversation_id: parent_conversation_id ? new ObjectId(parent_conversation_id) : null,
      is_followup: true,
      created_at: new Date()
    };

    const result = await db.collection('user_business_conversations').insertOne(followupData);

    res.status(201).json({
      message: 'Followup question saved successfully',
      followup_id: result.insertedId
    });
  } catch (error) {
    console.error('Error saving followup question:', error);
    res.status(500).json({ error: 'Failed to save followup question' });
  }
});

// Save phase analysis
router.post('/phase-analysis', async (req, res) => {
  try {
    const {
      phase,
      business_id,
      analysis_type,
      analysis_result,
      user_id
    } = req.body;

    if (!phase || !business_id || !analysis_type || !analysis_result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Use provided user_id for admin operations, otherwise use current user
    const targetUserId = (req.user.role === 'admin' || req.user.role === 'super_admin') && user_id 
      ? new ObjectId(user_id) 
      : req.user._id;

    const analysisData = {
      user_id: targetUserId,
      business_id: new ObjectId(business_id),
      phase: parseInt(phase),
      analysis_type,
      analysis_result,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Check if analysis already exists and update, otherwise insert
    const existingAnalysis = await db.collection('phase_analysis').findOne({
      user_id: targetUserId,
      business_id: new ObjectId(business_id),
      phase: parseInt(phase),
      analysis_type
    });

    let result;
    if (existingAnalysis) {
      result = await db.collection('phase_analysis').updateOne(
        { _id: existingAnalysis._id },
        { $set: { analysis_result, updated_at: new Date() } }
      );
    } else {
      result = await db.collection('phase_analysis').insertOne(analysisData);
    }

    // Log phase analysis
    await logAuditTrail(db, req.user._id, 'phase_analysis_saved', {
      business_id,
      phase,
      analysis_type,
      action: existingAnalysis ? 'updated' : 'created'
    });

    res.status(201).json({
      message: 'Phase analysis saved successfully',
      analysis_id: existingAnalysis ? existingAnalysis._id : result.insertedId
    });
  } catch (error) {
    console.error('Error saving phase analysis:', error);
    res.status(500).json({ error: 'Failed to save phase analysis' });
  }
});

// Update conversation status
router.put('/:question_id/status', async (req, res) => {
  try {
    const { question_id } = req.params;
    const { completion_status, analysis_result } = req.body;

    const updateData = {
      updated_at: new Date()
    };

    if (completion_status !== undefined) {
      updateData.completion_status = completion_status;
    }

    if (analysis_result !== undefined) {
      updateData.analysis_result = analysis_result;
    }

    const result = await db.collection('user_business_conversations').updateMany(
      { 
        question_id: new ObjectId(question_id),
        user_id: req.user._id
      },
      { $set: updateData }
    );

    res.json({
      message: 'Conversation status updated successfully',
      modified_count: result.modifiedCount
    });
  } catch (error) {
    console.error('Error updating conversation status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete conversations
router.delete('/', async (req, res) => {
  try {
    const { business_id } = req.query;
    let filter = { user_id: new ObjectId(req.user._id) };

    if (business_id) {
      filter.business_id = new ObjectId(business_id);
    }

    const result = await db.collection('user_business_conversations').deleteMany(filter);

    res.json({
      message: 'Conversations deleted successfully',
      deleted_count: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting conversations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
