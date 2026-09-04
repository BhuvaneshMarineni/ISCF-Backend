const { Router } = require('express');
const auth = require('./auth');
const stories = require('./stories');
const events = require('./events');
const uploads = require('./uploads');
const eventImages = require('./eventImages');
const gallery = require('./gallery');
const publicGallery = require('./publicGallery');
const adminStories = require('./adminStories');
const adminEvents = require('./adminEvents');
const users = require('./users');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/admin/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.use('/admin/uploads', uploads);
router.use('/admin', eventImages);
router.use('/admin', gallery);
router.use('/admin', adminStories);
router.use('/admin', adminEvents);
router.use('/admin', users);
router.use('/auth', auth);
router.use('/stories', stories);
router.use('/events', events);
router.use('/gallery', publicGallery);

module.exports = router;
