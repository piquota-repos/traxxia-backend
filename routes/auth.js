const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const router = express.Router();

// Database instance will be set from main server
let db;
const setDatabase = (database) => {
  db = database;
};

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get company details including logo
    let company = null;
    if (user.company_id) {
      company = await db.collection('companies').findOne(
        { _id: user.company_id },
        { projection: { company_name: 1, logo: 1, industry: 1 } }
      );
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.SECRET_KEY || 'default_secret_key',
      { expiresIn: '24h' }
    );

    // Log successful login
    await db.collection('audit_trail').insertOne({
      user_id: user._id,
      event_type: 'login',
      timestamp: new Date(),
      details: { email: user.email }
    });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: company
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, company_id, terms_accepted } = req.body;

    if (!name || !email || !password || !company_id) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!terms_accepted) {
      return res.status(400).json({ error: 'Terms and conditions must be accepted' });
    }

    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const company = await db.collection('companies').findOne({
      _id: new ObjectId(company_id),
      status: 'active'
    });
    if (!company) {
      return res.status(400).json({ error: 'Invalid company' });
    }

    const userRole = await db.collection('roles').findOne({ role_name: 'user' });
    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.collection('users').insertOne({
      name,
      email,
      password: hashedPassword,
      role: 'user',
      role_id: userRole ? userRole._id : null,
      company_id: new ObjectId(company_id),
      terms_accepted,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Log user registration
    await db.collection('audit_trail').insertOne({
      user_id: result.insertedId,
      event_type: 'user_registered',
      timestamp: new Date(),
      details: { email, company_id }
    });

    res.status(201).json({
      message: 'User registered successfully',
      userId: result.insertedId
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  setDatabase
};
