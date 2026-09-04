const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/db');
const requireManager = require('../lib/auth/requireManager');
const { getPublicImageUrl, deleteR2Object, deleteMultipleR2Objects } = require('../lib/r2');

const router = Router();
const uuidSchema = z.string().uuid();
const slugSchema = z.string().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const eventDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

const createAlbumSchema = z.object({
  title: z.string().min(1).max(255),
  slug: slugSchema,
  description: z.string().max(5000).optional().nullable(),
  category: z.string().min(1).max(100).optional().nullable(),
  eventDate: eventDateSchema.optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  isPublished: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
}).strict();
const updateAlbumSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  slug: slugSchema.optional(),
  description: z.string().max(5000).optional().nullable(),
  category: z.string().min(1).max(100).optional().nullable(),
  eventDate: eventDateSchema.optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });
const createPhotoSchema = z.object({
  imageKey: z.string().min(1),
  caption: z.string().max(1000).optional().nullable(),
  altText: z.string().max(500).optional().nullable(),
  isCover: z.boolean().optional().default(false),
  isFeatured: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
}).strict();
const updatePhotoSchema = z.object({
  caption: z.string().max(1000).optional().nullable(),
  altText: z.string().max(500).optional().nullable(),
  isCover: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

function serializePhoto(photo) {
  return {
    id: photo.id,
    albumId: photo.albumId,
    imageKey: photo.imageKey,
    publicUrl: getPublicImageUrl(photo.imageKey),
    caption: photo.caption,
    altText: photo.altText,
    isCover: photo.isCover === true,
    isFeatured: photo.isFeatured,
    sortOrder: photo.sortOrder,
  };
}

function serializeAlbum(album) {
  const cover = album.photos?.[0];
  return {
    id: album.id,
    title: album.title,
    slug: album.slug,
    description: album.description,
    category: album.category,
    eventDate: album.eventDate,
    location: album.location,
    isPublished: album.isPublished,
    sortOrder: album.sortOrder,
    coverPhoto: cover ? { imageKey: cover.imageKey, publicUrl: getPublicImageUrl(cover.imageKey) } : null,
    photoCount: album._count?.photos ?? 0,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

router.post('/gallery', requireManager, async (req, res, next) => {
  try {
    const body = createAlbumSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const existing = await prisma.galleryAlbum.findUnique({ where: { slug: body.data.slug }, select: { id: true } });
    if (existing) {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    const album = await prisma.galleryAlbum.create({
      data: {
        ...body.data,
        description: body.data.description ?? null,
        category: body.data.category ?? null,
        eventDate: body.data.eventDate ? new Date(`${body.data.eventDate}T00:00:00.000Z`) : null,
        location: body.data.location ?? null,
        createdById: req.user.id,
      },
    });
    res.status(201).json({ album });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    next(err);
  }
});

router.get('/gallery', requireManager, async (req, res, next) => {
  try {
    const albums = await prisma.galleryAlbum.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        photos: { where: { isCover: true }, select: { imageKey: true }, take: 1 },
        _count: { select: { photos: true } },
      },
    });
    res.json({ albums: albums.map(serializeAlbum) });
  } catch (err) {
    next(err);
  }
});

router.get('/gallery/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: 'Invalid album ID' });
    }
    const album = await prisma.galleryAlbum.findUnique({
      where: { id: id.data },
      include: { photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!album) {
      return res.status(404).json({ error: 'Gallery album not found' });
    }
    res.json({
      album: {
        id: album.id,
        title: album.title,
        slug: album.slug,
        description: album.description,
        category: album.category,
        eventDate: album.eventDate,
        location: album.location,
        isPublished: album.isPublished,
        sortOrder: album.sortOrder,
        createdAt: album.createdAt,
        updatedAt: album.updatedAt,
        photos: album.photos.map(serializePhoto),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/gallery/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updateAlbumSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const existing = await prisma.galleryAlbum.findUnique({ where: { id: id.data }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: 'Gallery album not found' });
    }
    if (body.data.slug) {
      const duplicate = await prisma.galleryAlbum.findFirst({
        where: { slug: body.data.slug, id: { not: id.data } },
        select: { id: true },
      });
      if (duplicate) {
        return res.status(409).json({ error: 'Slug already exists' });
      }
    }
    const data = { ...body.data };
    if (body.data.eventDate !== undefined) {
      data.eventDate = body.data.eventDate ? new Date(`${body.data.eventDate}T00:00:00.000Z`) : null;
    }
    const album = await prisma.galleryAlbum.update({ where: { id: id.data }, data });
    res.json({ album });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    next(err);
  }
});

router.delete('/gallery/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: 'Invalid album ID' });
    }
    const album = await prisma.galleryAlbum.findUnique({
      where: { id: id.data },
      include: { photos: { select: { imageKey: true } } },
    });
    if (!album) {
      return res.status(404).json({ error: 'Gallery album not found' });
    }
    try {
      await deleteMultipleR2Objects(album.photos.map((photo) => photo.imageKey));
    } catch {
      return res.status(502).json({ error: 'Failed to delete gallery images from storage' });
    }
    await prisma.galleryAlbum.delete({ where: { id: album.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/gallery/:albumId/photos', requireManager, async (req, res, next) => {
  try {
    const albumId = uuidSchema.safeParse(req.params.albumId);
    const body = createPhotoSchema.safeParse(req.body);
    if (!albumId.success || !body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    if (!body.data.imageKey.startsWith(`gallery/${albumId.data}/`)) {
      return res.status(400).json({ error: 'imageKey does not belong to this album' });
    }
    const album = await prisma.galleryAlbum.findUnique({ where: { id: albumId.data }, select: { id: true } });
    if (!album) {
      return res.status(404).json({ error: 'Gallery album not found' });
    }
    const data = { ...body.data, albumId: album.id, uploadedById: req.user.id };
    const photo = body.data.isCover
      ? await prisma.$transaction(async (tx) => {
        await tx.galleryPhoto.updateMany({ where: { albumId: album.id, isCover: true }, data: { isCover: false } });
        return tx.galleryPhoto.create({ data });
      })
      : await prisma.galleryPhoto.create({ data });
    res.status(201).json(serializePhoto(photo));
  } catch (err) {
    next(err);
  }
});

router.get('/gallery/:albumId/photos', requireManager, async (req, res, next) => {
  try {
    const albumId = uuidSchema.safeParse(req.params.albumId);
    if (!albumId.success) {
      return res.status(400).json({ error: 'Invalid album ID' });
    }
    const album = await prisma.galleryAlbum.findUnique({ where: { id: albumId.data }, select: { id: true } });
    if (!album) {
      return res.status(404).json({ error: 'Gallery album not found' });
    }
    const photos = await prisma.galleryPhoto.findMany({
      where: { albumId: album.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ photos: photos.map(serializePhoto) });
  } catch (err) {
    next(err);
  }
});

router.patch('/gallery-photos/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updatePhotoSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const existing = await prisma.galleryPhoto.findUnique({ where: { id: id.data } });
    if (!existing) {
      return res.status(404).json({ error: 'Gallery photo not found' });
    }
    const photo = body.data.isCover === true
      ? await prisma.$transaction(async (tx) => {
        await tx.galleryPhoto.updateMany({
          where: { albumId: existing.albumId, isCover: true, id: { not: existing.id } },
          data: { isCover: false },
        });
        return tx.galleryPhoto.update({ where: { id: existing.id }, data: body.data });
      })
      : await prisma.galleryPhoto.update({ where: { id: existing.id }, data: body.data });
    res.json(serializePhoto(photo));
  } catch (err) {
    next(err);
  }
});

router.delete('/gallery-photos/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: 'Invalid photo ID' });
    }
    const photo = await prisma.galleryPhoto.findUnique({ where: { id: id.data } });
    if (!photo) {
      return res.status(404).json({ error: 'Gallery photo not found' });
    }
    try {
      await deleteR2Object(photo.imageKey);
    } catch {
      return res.status(502).json({ error: 'Failed to delete gallery image from storage' });
    }
    await prisma.galleryPhoto.delete({ where: { id: photo.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
