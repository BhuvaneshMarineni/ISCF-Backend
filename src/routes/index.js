const { Router } = require('express');
const auth = require('./auth');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', auth);

module.exports = router;
