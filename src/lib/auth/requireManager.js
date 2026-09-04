const requireAuth = require('./requireAuth');

function requireManager(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!['ADMIN', 'USER'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });
}

module.exports = requireManager;
