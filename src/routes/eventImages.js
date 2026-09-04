const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/db');
const requireManager = require('../lib/auth/requireManager');
const { getPublicImageUrl, deleteR2Object } = require('../lib/r2');

const router = Router();

const uuidSchema = z.string().uuid();
const createImageSchema = z.object({
  imageKey: z.string().min(1),
  caption: z.string().max(1000).optional().nullable(),
  altText: z.string().max(500).optional().nullable(),
  isCover: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
}).strict();
const updateImageSchema = z.object({
  caption: z.string().max(1000).optional().nullable(),
  altText: z.string().max(500).optional().nullable(),
  isCover: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

function serializeImage(image) {
  return {
    id: image.id,
    eventId: image.eventId,
    imageKey: image.imageKey,
    publicUrl: getPublicImageUrl(image.imageKey),
    caption: image.caption,
    altText: image.altText,
    isCover: image.isCover === true,
    sortOrder: image.sortOrder,
  };
}

router.post('/events/:eventId/images', requireManager, async (req, res, next) => {
  try {
    const eventId = uuidSchema.safeParse(req.params.eventId);
    const body = createImageSchema.safeParse(req.body);
    if (!eventId.success || !body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    if (!body.data.imageKey.startsWith(`events/${eventId.data}/`)) {
      return res.status(400).json({ error: 'imageKey does not belong to this event' });
    }

    const event = await prisma.event.findUnique({ where: { id: eventId.data }, select: { id: true } });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const data = {
      eventId: eventId.data,
      imageKey: body.data.imageKey,
      caption: body.data.caption ?? null,
      altText: body.data.altText ?? null,
      isCover: body.data.isCover,
      sortOrder: body.data.sortOrder,
      uploadedById: req.user.id,
    };
    const image = body.data.isCover
      ? await prisma.$transaction(async (tx) => {
        await tx.eventImage.updateMany({
          where: { eventId: eventId.data, isCover: true },
          data: { isCover: false },
        });
        return tx.eventImage.create({ data });
      })
      : await prisma.eventImage.create({ data });

    res.status(201).json(serializeImage(image));
  } catch (err) {
    next(err);
  }
});

router.get('/events/:eventId/images', requireManager, async (req, res, next) => {
  try {
    const eventId = uuidSchema.safeParse(req.params.eventId);
    if (!eventId.success) {
      return res.status(400).json({ error: 'Invalid event ID' });
    }
    const event = await prisma.event.findUnique({ where: { id: eventId.data }, select: { id: true } });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const images = await prisma.eventImage.findMany({
      where: { eventId: eventId.data },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ images: images.map(serializeImage) });
  } catch (err) {
    next(err);
  }
});

router.patch('/event-images/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updateImageSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const existing = await prisma.eventImage.findUnique({ where: { id: id.data } });
    if (!existing) {
      return res.status(404).json({ error: 'Event image not found' });
    }

    const data = { ...body.data };
    if (body.data.isCover !== undefined) {
      data.isCover = body.data.isCover;
    }
    const image = body.data.isCover === true
      ? await prisma.$transaction(async (tx) => {
        await tx.eventImage.updateMany({
          where: { eventId: existing.eventId, isCover: true, id: { not: existing.id } },
          data: { isCover: false },
        });
        return tx.eventImage.update({ where: { id: existing.id }, data });
      })
      : await prisma.eventImage.update({ where: { id: existing.id }, data });

    res.json(serializeImage(image));
  } catch (err) {
    next(err);
  }
});

router.delete('/event-images/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: 'Invalid image ID' });
    }
    const image = await prisma.eventImage.findUnique({ where: { id: id.data } });
    if (!image) {
      return res.status(404).json({ error: 'Event image not found' });
    }
    try {
      await deleteR2Object(image.imageKey);
    } catch {
      return res.status(502).json({ error: 'Failed to delete image from storage' });
    }
    await prisma.eventImage.delete({ where: { id: image.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
