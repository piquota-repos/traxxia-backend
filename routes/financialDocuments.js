const express = require('express');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { logAuditTrail } = require('../utils/helpers');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Configure multer for financial document uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/documents');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'financial_doc_' + uniqueSuffix + path.extname(file.originalname));
  }
});

const financialDocUpload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow various document formats
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type for financial document'), false);
    }
  }
});

// Upload financial document for a business
router.put('/:id/financial-document', financialDocUpload.single('document'), async (req, res) => {
  try {
    const businessId = req.params.id;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify business exists and user has access
    const business = await db.collection('user_businesses').findOne({
      _id: new ObjectId(businessId)
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

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/documents/${req.file.filename}`;
    
    const documentData = {
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_path: req.file.path,
      file_url: fileUrl,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_at: new Date(),
      uploaded_by: req.user._id
    };

    // Update business with financial document info
    await db.collection('user_businesses').updateOne(
      { _id: new ObjectId(businessId) },
      { 
        $set: { 
          financial_document: documentData,
          updated_at: new Date()
        }
      }
    );

    // Log document upload
    await logAuditTrail(db, req.user._id, 'financial_document_uploaded', {
      business_id: businessId,
      filename: req.file.originalname,
      file_size: req.file.size
    });

    res.json({
      message: 'Financial document uploaded successfully',
      document: {
        filename: req.file.filename,
        original_name: req.file.originalname,
        file_url: fileUrl,
        file_size: req.file.size,
        uploaded_at: documentData.uploaded_at
      }
    });
  } catch (error) {
    console.error('Error uploading financial document:', error);
    res.status(500).json({ error: 'Failed to upload financial document' });
  }
});

// Get financial document info for a business
router.get('/:id/financial-document', async (req, res) => {
  try {
    const businessId = req.params.id;

    const business = await db.collection('user_businesses').findOne({
      _id: new ObjectId(businessId)
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

    if (!business.financial_document) {
      return res.status(404).json({ error: 'No financial document found for this business' });
    }

    res.json({
      business_id: businessId,
      business_name: business.business_name,
      financial_document: business.financial_document
    });
  } catch (error) {
    console.error('Error fetching financial document:', error);
    res.status(500).json({ error: 'Failed to fetch financial document info' });
  }
});

// Delete financial document for a business
router.delete('/:id/financial-document', async (req, res) => {
  try {
    const businessId = req.params.id;

    const business = await db.collection('user_businesses').findOne({
      _id: new ObjectId(businessId)
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

    if (!business.financial_document) {
      return res.status(404).json({ error: 'No financial document found for this business' });
    }

    // Delete the physical file
    try {
      if (fs.existsSync(business.financial_document.file_path)) {
        fs.unlinkSync(business.financial_document.file_path);
      }
    } catch (fileError) {
      console.warn('Could not delete physical file:', fileError);
    }

    // Remove financial document from business
    await db.collection('user_businesses').updateOne(
      { _id: new ObjectId(businessId) },
      { 
        $unset: { financial_document: "" },
        $set: { updated_at: new Date() }
      }
    );

    // Log document deletion
    await logAuditTrail(db, req.user._id, 'financial_document_deleted', {
      business_id: businessId,
      filename: business.financial_document.original_name
    });

    res.json({ message: 'Financial document deleted successfully' });
  } catch (error) {
    console.error('Error deleting financial document:', error);
    res.status(500).json({ error: 'Failed to delete financial document' });
  }
});

// Download financial document
router.get('/:id/financial-document/download', async (req, res) => {
  try {
    const businessId = req.params.id;

    const business = await db.collection('user_businesses').findOne({
      _id: new ObjectId(businessId)
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

    if (!business.financial_document) {
      return res.status(404).json({ error: 'No financial document found for this business' });
    }

    const filePath = path.resolve(business.financial_document.file_path);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Financial document file not found on server' });
    }

    // Log document download
    await logAuditTrail(db, req.user._id, 'financial_document_downloaded', {
      business_id: businessId,
      filename: business.financial_document.original_name
    });

    // Set appropriate headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${business.financial_document.original_name}"`);
    res.setHeader('Content-Type', business.financial_document.mime_type);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading financial document:', error);
    res.status(500).json({ error: 'Failed to download financial document' });
  }
});

module.exports = {
  router,
  setDatabase
};
