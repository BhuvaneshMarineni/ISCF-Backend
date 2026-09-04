const { Router } = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const { prisma } = require('../lib/db');
const requireManager = require('../lib/auth/requireManager');
const { getPublicImageUrl, deleteR2Object } = require('../lib/r2');

const router = Router();
const uuidSchema = z.string().uuid();
const slugSchema = z.string().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const coverImageKeySchema = z.string().min(1).max(500).regex(/^stories\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+/i);
const statusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

const createStorySchema = z.object({
  title: z.string().min(1).max(255),
  slug: slugSchema,
  excerpt: z.string().max(500).optional().nullable(),
  content: z.string().min(1),
  authorName: z.string().max(255).optional().nullable(),
  coverImageKey: coverImageKeySchema.optional().nullable(),
  status: statusSchema.optional().default('DRAFT'),
  publishedAt: z.string().datetime({ offset: true }).optional().nullable(),
}).strict();
const updateStorySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  slug: slugSchema.optional(),
  excerpt: z.string().max(500).optional().nullable(),
  content: z.string().min(1).optional(),
  authorName: z.string().max(255).optional().nullable(),
  coverImageKey: coverImageKeySchema.optional().nullable(),
  status: statusSchema.optional(),
  publishedAt: z.string().datetime({ offset: true }).optional().nullable(),
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

function serializeStory(story, includeContent = true) {
  const response = {
    id: story.id,
    title: story.title,
    slug: story.slug,
    excerpt: story.excerpt,
    authorName: story.authorName,
    status: story.status,
    publishedAt: story.publishedAt,
    coverImageKey: story.coverImageKey,
    coverImageUrl: story.coverImageKey ? getPublicImageUrl(story.coverImageKey) : null,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
  if (includeContent) {
    response.content = story.content;
  }
  return response;
}

function storyIdFromCoverKey(imageKey) {
  return imageKey ? imageKey.split('/')[1] : null;
}

router.post('/stories', requireManager, async (req, res, next) => {
  try {
    const body = createStorySchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const existing = await prisma.story.findUnique({ where: { slug: body.data.slug }, select: { id: true } });
    if (existing) {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    const id = storyIdFromCoverKey(body.data.coverImageKey) || crypto.randomUUID();
    if (body.data.coverImageKey && !body.data.coverImageKey.startsWith(`stories/${id}/`)) {
      return res.status(400).json({ error: 'coverImageKey does not belong to this story' });
    }
    const story = await prisma.story.create({
      data: {
        id,
        title: body.data.title,
        slug: body.data.slug,
        excerpt: body.data.excerpt ?? null,
        content: body.data.content,
        authorName: body.data.authorName ?? null,
        coverImageKey: body.data.coverImageKey ?? null,
        status: body.data.status,
        publishedAt: body.data.publishedAt
          ? new Date(body.data.publishedAt)
          : body.data.status === 'PUBLISHED' ? new Date() : null,
        createdById: req.user.id,
      },
    });
    res.status(201).json({ story: serializeStory(story) });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    next(err);
  }
});

router.get('/stories', requireManager, async (req, res, next) => {
  try {
    const stories = await prisma.story.findMany({
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        authorName: true,
        status: true,
        publishedAt: true,
        coverImageKey: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json({ stories: stories.map((story) => serializeStory(story, false)) });
  } catch (err) {
    next(err);
  }
});

router.get('/stories/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: 'Invalid story ID' });
    }
    const story = await prisma.story.findUnique({ where: { id: id.data } });
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    res.json({ story: serializeStory(story) });
  } catch (err) {
    next(err);
  }
});

router.patch('/stories/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updateStorySchema.safeParse(req.body);
    if (!id.success || !body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const existing = await prisma.story.findUnique({ where: { id: id.data } });
    if (!existing) {
      return res.status(404).json({ error: 'Story not found' });
    }
    if (body.data.slug) {
      const duplicate = await prisma.story.findFirst({
        where: { slug: body.data.slug, id: { not: existing.id } },
        select: { id: true },
      });
      if (duplicate) {
        return res.status(409).json({ error: 'Slug already exists' });
      }
    }
    if (body.data.coverImageKey && !body.data.coverImageKey.startsWith(`stories/${existing.id}/`)) {
      return res.status(400).json({ error: 'coverImageKey does not belong to this story' });
    }

    const oldCoverImageKey = existing.coverImageKey;
    const removingCover = body.data.coverImageKey === null && oldCoverImageKey;
    if (removingCover) {
      try {
        await deleteR2Object(oldCoverImageKey);
      } catch {
        return res.status(502).json({ error: 'Failed to delete story cover from storage' });
      }
    }

    const data = { ...body.data };
    if (body.data.publishedAt !== undefined) {
      data.publishedAt = body.data.publishedAt ? new Date(body.data.publishedAt) : null;
    } else if (body.data.status === 'PUBLISHED' && !existing.publishedAt) {
      data.publishedAt = new Date();
    }
    const story = await prisma.story.update({ where: { id: existing.id }, data });

    const replacingCover = body.data.coverImageKey
      && oldCoverImageKey
      && body.data.coverImageKey !== oldCoverImageKey;
    if (replacingCover) {
      try {
        await deleteR2Object(oldCoverImageKey);
      } catch {
        return res.status(502).json({
          error: 'Story updated but old cover cleanup failed',
          story: serializeStory(story),
        });
      }
    }
    res.json({ story: serializeStory(story) });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    next(err);
  }
});

router.delete('/stories/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: 'Invalid story ID' });
    }
    const story = await prisma.story.findUnique({ where: { id: id.data } });
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    if (story.coverImageKey) {
      try {
        await deleteR2Object(story.coverImageKey);
      } catch {
        return res.status(502).json({ error: 'Failed to delete story cover from storage' });
      }
    }
    await prisma.story.delete({ where: { id: story.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
