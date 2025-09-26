const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Get all active companies
router.get('/', async (req, res) => {
  try {
    const companies = await db.collection('companies')
      .find({ status: 'active' })
      .project({ company_name: 1, industry: 1, logo: 1 })
      .sort({ company_name: 1 })
      .toArray();

    res.json({ companies });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get companies for admin (with pagination and filtering)
router.get('/admin', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const industry = req.query.industry || '';

    let matchFilter = {};

    // Apply search filter
    if (search) {
      matchFilter.company_name = { $regex: search, $options: 'i' };
    }

    // Apply industry filter
    if (industry) {
      matchFilter.industry = industry;
    }

    // Role-based filtering
    if (req.user.role === 'admin') {
      // Admin sees only their company
      matchFilter._id = req.user.company_id;
    }
    // Super admin sees all companies (no filter needed)

    // Get companies with their admin details
    const companies = await db.collection('companies').aggregate([
      {
        $match: matchFilter
      },
      {
        $lookup: {
          from: 'users',
          let: { companyId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$company_id', '$$companyId'] },
                role: 'admin'
              }
            },
            {
              $project: {
                name: 1,
                email: 1,
                created_at: 1
              }
            }
          ],
          as: 'admins'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { companyId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$company_id', '$$companyId'] }
              }
            },
            {
              $count: 'total'
            }
          ],
          as: 'userCount'
        }
      },
      {
        $addFields: {
          total_users: { $ifNull: [{ $arrayElemAt: ['$userCount.total', 0] }, 0] }
        }
      },
      {
        $project: {
          company_name: 1,
          industry: 1,
          size: 1,
          logo: 1,
          status: 1,
          created_at: 1,
          admins: 1,
          total_users: 1
        }
      },
      {
        $sort: { created_at: -1 }
      },
      {
        $skip: skip
      },
      {
        $limit: limit
      }
    ]).toArray();

    // Get total count for pagination
    const totalCount = await db.collection('companies').countDocuments(matchFilter);

    res.json({
      companies,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_companies: totalCount,
        per_page: limit
      }
    });
  } catch (error) {
    console.error('Error fetching companies for admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new company (Super admin only)
router.post('/', async (req, res) => {
  try {
    const { company_name, industry, size, logo } = req.body;

    if (!company_name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    // Check if company already exists
    const existingCompany = await db.collection('companies').findOne({
      company_name: { $regex: new RegExp(`^${company_name}$`, 'i') }
    });

    if (existingCompany) {
      return res.status(400).json({ error: 'Company with this name already exists' });
    }

    // Create company with logo
    const companyResult = await db.collection('companies').insertOne({
      company_name,
      industry: industry || '',
      size: size || '',
      logo: logo || null,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Log company creation
    await db.collection('audit_trail').insertOne({
      user_id: req.user._id,
      event_type: 'company_created',
      timestamp: new Date(),
      details: { company_id: companyResult.insertedId, company_name }
    });

    res.status(201).json({
      message: 'Company created successfully',
      company_id: companyResult.insertedId
    });
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update company
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.params.id;
    const { company_name, industry, size, logo, status } = req.body;

    if (!ObjectId.isValid(companyId)) {
      return res.status(400).json({ error: 'Invalid company ID' });
    }

    // Role-based access control
    let filter = { _id: new ObjectId(companyId) };
    if (req.user.role === 'admin') {
      // Admin can only update their own company
      if (!req.user.company_id.equals(new ObjectId(companyId))) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await db.collection('companies').updateOne(
      filter,
      {
        $set: {
          ...(company_name && { company_name }),
          ...(industry !== undefined && { industry }),
          ...(size !== undefined && { size }),
          ...(logo !== undefined && { logo }),
          ...(status && req.user.role === 'super_admin' && { status }),
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Log company update
    await db.collection('audit_trail').insertOne({
      user_id: req.user._id,
      event_type: 'company_updated',
      timestamp: new Date(),
      details: { company_id: companyId, changes: req.body }
    });

    res.json({ message: 'Company updated successfully' });
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to get companies with detailed management info
router.get('/admin-management', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, industry, status } = req.query;
    const skip = (page - 1) * limit;

    let matchFilter = {};

    // Apply search filter
    if (search) {
      matchFilter.company_name = { $regex: search, $options: 'i' };
    }

    // Apply industry filter
    if (industry) {
      matchFilter.industry = industry;
    }

    // Apply status filter
    if (status) {
      matchFilter.status = status;
    }

    // Role-based filtering
    if (req.user.role === 'admin') {
      // Admin sees only their company
      matchFilter._id = req.user.company_id;
    }
    // Super admin sees all companies (no additional filter needed)

    // Get companies with their admin details and statistics
    const companies = await db.collection('companies').aggregate([
      {
        $match: matchFilter
      },
      {
        $lookup: {
          from: 'users',
          let: { companyId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$company_id', '$$companyId'] },
                role: 'admin'
              }
            },
            {
              $project: {
                name: 1,
                email: 1,
                created_at: 1,
                role: 1
              }
            }
          ],
          as: 'admins'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { companyId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$company_id', '$$companyId'] }
              }
            },
            {
              $group: {
                _id: '$role',
                count: { $sum: 1 }
              }
            }
          ],
          as: 'userStats'
        }
      },
      {
        $lookup: {
          from: 'user_businesses',
          let: { companyId: '$_id' },
          pipeline: [
            {
              $lookup: {
                from: 'users',
                localField: 'user_id',
                foreignField: '_id',
                as: 'user'
              }
            },
            {
              $unwind: '$user'
            },
            {
              $match: {
                $expr: { $eq: ['$user.company_id', '$$companyId'] }
              }
            },
            {
              $count: 'total'
            }
          ],
          as: 'businessCount'
        }
      },
      {
        $addFields: {
          total_users: { 
            $reduce: {
              input: '$userStats',
              initialValue: 0,
              in: { $add: ['$$value', '$$this.count'] }
            }
          },
          total_businesses: { 
            $ifNull: [{ $arrayElemAt: ['$businessCount.total', 0] }, 0] 
          },
          user_breakdown: {
            $arrayToObject: {
              $map: {
                input: '$userStats',
                as: 'stat',
                in: {
                  k: '$$stat._id',
                  v: '$$stat.count'
                }
              }
            }
          }
        }
      },
      {
        $project: {
          company_name: 1,
          industry: 1,
          size: 1,
          logo: 1,
          status: 1,
          created_at: 1,
          updated_at: 1,
          admins: 1,
          total_users: 1,
          total_businesses: 1,
          user_breakdown: 1
        }
      },
      {
        $sort: { created_at: -1 }
      },
      {
        $skip: skip
      },
      {
        $limit: parseInt(limit)
      }
    ]).toArray();

    // Get total count for pagination
    const totalCount = await db.collection('companies').countDocuments(matchFilter);

    res.json({
      companies,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(totalCount / limit),
        total_companies: totalCount,
        per_page: parseInt(limit)
      },
      filters: {
        search: search || null,
        industry: industry || null,
        status: status || null
      }
    });
  } catch (error) {
    console.error('Error fetching companies for admin management:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
