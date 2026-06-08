// middleware/auth.js
// JWT authentication + Role-Based Access Control (RBAC)
// Roles: admin (can control actuators), viewer (read-only)

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'SKS_SecureKitchen_Secret_2026';
const JWT_EXPIRES = '8h';

// Hardcoded users for demo (in production: use a database)
const USERS = [
  { id: 1, username: 'admin',  password: 'admin123',  role: 'admin'  },
  { id: 2, username: 'viewer', password: 'viewer123', role: 'viewer' }
];

// Generate a JWT token on login
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// Middleware: verify JWT from Authorization header or cookie
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

// Middleware: only admin can proceed
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
}

// Login handler: check credentials, return JWT
function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  const user = USERS.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = generateToken(user);

  console.log(`[AUTH] Login success: ${username} (${user.role})`);

  return res.json({
    token,
    username: user.username,
    role: user.role,
    message: 'Login successful'
  });
}

module.exports = { verifyToken, requireAdmin, login, USERS };
