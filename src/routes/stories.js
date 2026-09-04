const { Router } = require('express');
const { prisma } = require('../lib/db');
const { getPublicImageUrl } = require('../lib/r2');

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/', async (req, res, next) => {
  try {
    const stories = await prisma.story.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        authorName: true,
        coverImageKey: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json({
      stories: stories.map((story) => ({
        ...story,
        coverImageUrl: story.coverImageKey ? getPublicImageUrl(story.coverImageKey) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug', async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const where = UUID_RE.test(idOrSlug)
      ? { id: idOrSlug, status: 'PUBLISHED' }
      : { slug: idOrSlug, status: 'PUBLISHED' };
    const story = await prisma.story.findFirst({ where });
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    res.json({
      story: {
        ...story,
        coverImageUrl: story.coverImageKey ? getPublicImageUrl(story.coverImageKey) : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
