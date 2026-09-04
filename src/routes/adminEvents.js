const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/db');
const requireManager = require('../lib/auth/requireManager');
const { getPublicImageUrl, deleteMultipleR2Objects } = require('../lib/r2');

const router = Router();
const uuidSchema = z.string().uuid();
const slugSchema = z.string().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const dateSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
]);
const recurrenceDaySchema = z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']);
const createEventSchema = z.object({
  title: z.string().min(1).max(255),
  slug: slugSchema,
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  eventDate: dateSchema.optional().nullable(),
  startTime: z.string().datetime({ offset: true }).optional().nullable(),
  endTime: z.string().datetime({ offset: true }).optional().nullable(),
  publicationStatus: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional().default('DRAFT'),
  recurrenceType: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).optional().default('NONE'),
  recurrenceDays: z.array(recurrenceDaySchema).optional().default([]),
  recurrenceEndDate: dateSchema.optional().nullable(),
}).strict().superRefine((data, ctx) => {
  if (data.recurrenceType === 'WEEKLY' && data.recurrenceDays.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recurrenceDays'], message: 'Weekly events require recurrenceDays' });
  }
  if (data.startTime && data.endTime && new Date(data.endTime) < new Date(data.startTime)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'endTime must not be before startTime' });
  }
});
const updateEventSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  slug: slugSchema.optional(),
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  eventDate: dateSchema.optional().nullable(),
  startTime: z.string().datetime({ offset: true }).optional().nullable(),
  endTime: z.string().datetime({ offset: true }).optional().nullable(),
  publicationStatus: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  recurrenceType: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).optional(),
  recurrenceDays: z.array(recurrenceDaySchema).optional(),
  recurrenceEndDate: dateSchema.optional().nullable(),
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

function toDate(value) {
  if (!value) return null;
  return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

function eventData(data) {
  const result = { ...data };
  for (const field of ['eventDate', 'startTime', 'endTime', 'recurrenceEndDate']) {
    if (data[field] !== undefined) result[field] = toDate(data[field]);
  }
  return result;
}

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

router.post('/events', requireManager, async (req, res, next) => {
  try {
    const body = createEventSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid request' });
    const duplicate = await prisma.event.findUnique({ where: { slug: body.data.slug }, select: { id: true } });
    if (duplicate) return res.status(409).json({ error: 'Slug already exists' });
    const event = await prisma.event.create({ data: { ...eventData(body.data), createdById: req.user.id } });
    res.status(201).json({ event });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Slug already exists' });
    next(err);
  }
});

router.get('/events', requireManager, async (req, res, next) => {
  try {
    const events = await prisma.event.findMany({
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      include: { images: { where: { isCover: true }, take: 1 } },
    });
    res.json({
      events: events.map((event) => {
        const { images, ...data } = event;
        return { ...data, coverImage: images[0] ? serializeImage(images[0]) : null };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/events/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid event ID' });
    const event = await prisma.event.findUnique({
      where: { id: id.data },
      include: { images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: { ...event, images: event.images.map(serializeImage) } });
  } catch (err) {
    next(err);
  }
});

router.patch('/events/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updateEventSchema.safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ error: 'Invalid request' });
    const existing = await prisma.event.findUnique({ where: { id: id.data } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    if (body.data.slug) {
      const duplicate = await prisma.event.findFirst({ where: { slug: body.data.slug, id: { not: existing.id } }, select: { id: true } });
      if (duplicate) return res.status(409).json({ error: 'Slug already exists' });
    }
    const mergedRecurrenceType = body.data.recurrenceType || existing.recurrenceType;
    const mergedDays = body.data.recurrenceDays || existing.recurrenceDays;
    if (mergedRecurrenceType === 'WEEKLY' && mergedDays.length === 0) return res.status(400).json({ error: 'Invalid request' });
    const start = body.data.startTime === undefined ? existing.startTime : toDate(body.data.startTime);
    const end = body.data.endTime === undefined ? existing.endTime : toDate(body.data.endTime);
    if (start && end && end < start) return res.status(400).json({ error: 'Invalid request' });
    const event = await prisma.event.update({ where: { id: existing.id }, data: eventData(body.data) });
    res.json({ event });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Slug already exists' });
    next(err);
  }
});

router.delete('/events/:id', requireManager, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid event ID' });
    const event = await prisma.event.findUnique({ where: { id: id.data }, include: { images: { select: { imageKey: true } } } });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    try {
      await deleteMultipleR2Objects(event.images.map((image) => image.imageKey));
    } catch {
      return res.status(502).json({ error: 'Failed to delete event images from storage' });
    }
    await prisma.event.delete({ where: { id: event.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
