const { verifyAccessToken } = require('./jwt');

function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.access_token;
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = verifyAccessToken(token);
    if (decoded.type !== 'access') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = { id: decoded.sub, email: decoded.email, role: decoded.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = requireAuth;
