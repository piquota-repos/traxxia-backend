const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config(); 

const app = express();
const port = process.env.PORT || 5000;
const secretKey = process.env.SECRET_KEY || 'default_secret_key';

app.use(bodyParser.json());
app.use(cors());

// MySQL Connection (Using Render Environment Variables)
const db = mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT,
});

db.connect(err => {
  if (err) {
    console.error('Database connection error:', err);
    return;
  }
  console.log('✅ Connected to Render MySQL');
});

// Routes
app.post('/register', async (req, res) => {
  console.log(req.body);
  const { name, description, gender, terms, email, password } = req.body;

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  db.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
    if (err) return res.status(500).send(err);

    if (result.length > 0) {
      return res.status(400).send({ message: 'User already exists' });
    }

    const query = 'INSERT INTO users (name, description, gender, terms, email, password) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(query, [name, description, gender, terms, email, hashedPassword], (err, result) => {
      if (err) return res.status(500).send(err);
      res.status(200).send({ message: 'Registration successful' });
    });
  });
});

app.post('/login', (req, res) => {
  console.log('Request Body:', req.body);

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send({ message: 'Email and password are required' });
  }

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, result) => {
    if (err) return res.status(500).send(err);

    if (result.length === 0) {
      return res.status(400).send({ message: 'Invalid credentials' });
    }

    const user = result[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).send({ message: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign({ id: user.id, email: user.email }, secretKey, { expiresIn: '1h' });

    res.status(200).send({ message: 'Login successful', token });
  });
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'];
  console.log('Received Token:', token);

  if (!token) {
    return res.status(401).send({ message: 'No token provided' });
  }

  jwt.verify(token, secretKey, (err, user) => {
    if (err) {
      console.error('JWT Verification Error:', err);
      return res.status(403).send({ message: 'Invalid token' });
    }

    req.user = user;
    next();
  });
};

// Protected Route (Example)
app.get('/dashboard', authenticateToken, (req, res) => {
  res.send({ message: `Welcome to the dashboard, ${req.user.email}` });
});

// Insert Responses into Database
app.post('/api/analyse', (req, res) => {
  const { answers } = req.body;

  answers.forEach((answer, index) => {
    const query = 'INSERT INTO responses (question_id, rating, reason) VALUES (?, ?, ?)';
    db.query(query, [index + 1, answer.rating, answer.reason], (err, result) => {
      if (err) throw err;
    });
  });

  res.status(200).send({ message: 'Answers submitted for analysis.' });
});

app.listen(port, () => console.log(`🚀 Backend running on port ${port}`));