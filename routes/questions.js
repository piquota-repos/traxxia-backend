const express = require('express');
const { ObjectId } = require('mongodb');
const { logAuditTrail, createPagination } = require('../utils/helpers');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Get all active questions
router.get('/', async (req, res) => {
  try {
    const { phase, category } = req.query;
    
    let filter = { status: 'active' };
    
    if (phase) {
      filter.phase = parseInt(phase);
    }
    
    if (category) {
      filter.category = category;
    }

    const questions = await db.collection('global_questions')
      .find(filter)
      .sort({ phase: 1, order: 1 })
      .toArray();

    res.json({ questions });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get questions by phase
router.get('/phase/:phase', async (req, res) => {
  try {
    const phase = parseInt(req.params.phase);
    
    if (isNaN(phase) || phase < 1 || phase > 3) {
      return res.status(400).json({ error: 'Invalid phase. Must be 1, 2, or 3' });
    }

    const questions = await db.collection('global_questions')
      .find({ 
        phase: phase,
        status: 'active'
      })
      .sort({ order: 1 })
      .toArray();

    res.json({ 
      phase,
      questions,
      total: questions.length
    });
  } catch (error) {
    console.error('Error fetching questions by phase:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all questions for admin management
router.get('/admin', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, phase, category, status } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    
    if (search) {
      filter.$or = [
        { question_text: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (phase) {
      filter.phase = parseInt(phase);
    }
    
    if (category) {
      filter.category = category;
    }
    
    if (status) {
      filter.status = status;
    }

    const questions = await db.collection('global_questions')
      .find(filter)
      .sort({ phase: 1, order: 1, created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const total = await db.collection('global_questions').countDocuments(filter);

    // Get categories for filtering
    const categories = await db.collection('global_questions')
      .distinct('category', { status: 'active' });

    res.json({
      questions,
      pagination: createPagination(parseInt(page), parseInt(limit), total),
      filters: {
        categories: categories.sort()
      }
    });
  } catch (error) {
    console.error('Error fetching questions for admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new question (Super admin only)
router.post('/', async (req, res) => {
  try {
    const { 
      question_text, 
      question_type, 
      phase, 
      category, 
      order, 
      options,
      is_required = true
    } = req.body;

    if (!question_text || !question_type || !phase) {
      return res.status(400).json({ 
        error: 'Question text, type, and phase are required' 
      });
    }

    const validTypes = ['text', 'textarea', 'select', 'radio', 'checkbox', 'number', 'date'];
    if (!validTypes.includes(question_type)) {
      return res.status(400).json({ 
        error: 'Invalid question type' 
      });
    }

    if (phase < 1 || phase > 3) {
      return res.status(400).json({ 
        error: 'Phase must be 1, 2, or 3' 
      });
    }

    // If order not provided, get next order number for the phase
    let questionOrder = order;
    if (!questionOrder) {
      const lastQuestion = await db.collection('global_questions')
        .findOne(
          { phase: parseInt(phase) },
          { sort: { order: -1 } }
        );
      questionOrder = lastQuestion ? lastQuestion.order + 1 : 1;
    }

    const questionData = {
      question_text: question_text.trim(),
      question_type,
      phase: parseInt(phase),
      category: category || 'General',
      order: parseInt(questionOrder),
      is_required,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
      created_by: req.user._id
    };

    // Add options for select/radio/checkbox types
    if (['select', 'radio', 'checkbox'].includes(question_type)) {
      if (!options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ 
          error: 'Options are required for select, radio, and checkbox questions' 
        });
      }
      questionData.options = options.map(opt => opt.trim()).filter(opt => opt);
    }

    const result = await db.collection('global_questions').insertOne(questionData);

    // Log question creation
    await logAuditTrail(db, req.user._id, 'question_created', {
      question_id: result.insertedId,
      question_text,
      phase,
      category
    });

    res.status(201).json({
      message: 'Question created successfully',
      question_id: result.insertedId
    });
  } catch (error) {
    console.error('Error creating question:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update question (Super admin only)
router.put('/:id', async (req, res) => {
  try {
    const questionId = req.params.id;
    
    if (!ObjectId.isValid(questionId)) {
      return res.status(400).json({ error: 'Invalid question ID' });
    }

    const { 
      question_text, 
      question_type, 
      phase, 
      category, 
      order, 
      options,
      is_required,
      status
    } = req.body;

    const updates = {};
    
    if (question_text) updates.question_text = question_text.trim();
    if (question_type) {
      const validTypes = ['text', 'textarea', 'select', 'radio', 'checkbox', 'number', 'date'];
      if (!validTypes.includes(question_type)) {
        return res.status(400).json({ error: 'Invalid question type' });
      }
      updates.question_type = question_type;
    }
    if (phase) {
      if (phase < 1 || phase > 3) {
        return res.status(400).json({ error: 'Phase must be 1, 2, or 3' });
      }
      updates.phase = parseInt(phase);
    }
    if (category) updates.category = category;
    if (order) updates.order = parseInt(order);
    if (typeof is_required === 'boolean') updates.is_required = is_required;
    if (status) updates.status = status;
    if (options && Array.isArray(options)) {
      updates.options = options.map(opt => opt.trim()).filter(opt => opt);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.updated_at = new Date();

    const result = await db.collection('global_questions').updateOne(
      { _id: new ObjectId(questionId) },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Log question update
    await logAuditTrail(db, req.user._id, 'question_updated', {
      question_id: questionId,
      changes: updates
    });

    res.json({ message: 'Question updated successfully' });
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete question (Super admin only)
router.delete('/:id', async (req, res) => {
  try {
    const questionId = req.params.id;
    
    if (!ObjectId.isValid(questionId)) {
      return res.status(400).json({ error: 'Invalid question ID' });
    }

    // Soft delete by setting status to 'deleted'
    const result = await db.collection('global_questions').updateOne(
      { _id: new ObjectId(questionId) },
      { 
        $set: { 
          status: 'deleted',
          deleted_at: new Date(),
          deleted_by: req.user._id
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Log question deletion
    await logAuditTrail(db, req.user._id, 'question_deleted', {
      question_id: questionId
    });

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reorder questions within a phase (Super admin only)
router.put('/reorder/:phase', async (req, res) => {
  try {
    const phase = parseInt(req.params.phase);
    const { question_orders } = req.body; // Array of {id, order} objects

    if (isNaN(phase) || phase < 1 || phase > 3) {
      return res.status(400).json({ error: 'Invalid phase. Must be 1, 2, or 3' });
    }

    if (!Array.isArray(question_orders) || question_orders.length === 0) {
      return res.status(400).json({ error: 'Question orders array is required' });
    }

    // Update each question's order
    const bulkOps = question_orders.map(item => ({
      updateOne: {
        filter: { 
          _id: new ObjectId(item.id),
          phase: phase
        },
        update: { 
          $set: { 
            order: parseInt(item.order),
            updated_at: new Date()
          }
        }
      }
    }));

    const result = await db.collection('global_questions').bulkWrite(bulkOps);

    // Log reordering
    await logAuditTrail(db, req.user._id, 'questions_reordered', {
      phase,
      questions_updated: result.modifiedCount
    });

    res.json({ 
      message: 'Questions reordered successfully',
      updated_count: result.modifiedCount
    });
  } catch (error) {
    console.error('Error reordering questions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update/insert questions (Super admin only)
router.post('/bulk', async (req, res) => {
  try {
    const { questions } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Questions array is required' });
    }

    const results = {
      inserted: 0,
      updated: 0,
      errors: []
    };

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      
      try {
        // Validate required fields
        if (!question.question_text || !question.phase) {
          results.errors.push({
            index: i,
            error: 'Missing required fields: question_text and phase'
          });
          continue;
        }

        const questionData = {
          question_text: question.question_text.trim(),
          question_type: question.question_type || 'text',
          phase: parseInt(question.phase),
          category: question.category || 'General',
          order: question.order || 1,
          is_required: question.is_required !== false,
          status: question.status || 'active',
          severity: question.severity || 'medium',
          used_for: question.used_for || 'all',
          objective: question.objective || '',
          required_info: question.required_info || '',
          updated_at: new Date()
        };

        if (question._id) {
          // Update existing question
          const result = await db.collection('global_questions').updateOne(
            { _id: new ObjectId(question._id) },
            { $set: questionData }
          );
          
          if (result.matchedCount > 0) {
            results.updated++;
          } else {
            results.errors.push({
              index: i,
              error: 'Question not found for update'
            });
          }
        } else {
          // Insert new question
          questionData.created_at = new Date();
          questionData.created_by = req.user._id;
          
          await db.collection('global_questions').insertOne(questionData);
          results.inserted++;
        }
      } catch (error) {
        results.errors.push({
          index: i,
          error: error.message
        });
      }
    }

    // Log bulk operation
    await logAuditTrail(db, req.user._id, 'questions_bulk_operation', {
      total_questions: questions.length,
      inserted: results.inserted,
      updated: results.updated,
      errors: results.errors.length
    });

    res.json({
      message: 'Bulk questions operation completed',
      results
    });
  } catch (error) {
    console.error('Error in bulk questions operation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
