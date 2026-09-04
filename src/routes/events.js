const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/db');
const { getPublicImageUrl } = require('../lib/r2');
const { expandEventOccurrences } = require('../lib/eventOccurrences');

const router = Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const querySchema = z.object({
  timeStatus: z.enum(['UPCOMING', 'ONGOING', 'PAST', 'ALL']).optional().default('ALL'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
}).strict().refine((query) => Boolean(query.from) === Boolean(query.to), { message: 'from and to must be provided together' })
  .refine((query) => !query.from || query.from <= query.to, { message: 'from must not be after to' });

function coverImage(event) {
  const cover = event.images?.[0];
  return cover ? { imageKey: cover.imageKey, publicUrl: getPublicImageUrl(cover.imageKey) } : null;
}

function serializeOccurrence(event, occurrence) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    description: event.description,
    location: event.location,
    eventDate: occurrence.occurrenceDate,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    recurrenceType: event.recurrenceType,
    timeStatus: occurrence.timeStatus,
    coverImage: coverImage(event),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const events = await prisma.event.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      orderBy: [{ eventDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        images: { where: { isCover: true }, select: { imageKey: true }, take: 1 },
      },
    });
    const from = query.data.from ? new Date(`${query.data.from}T00:00:00.000Z`) : null;
    const to = query.data.to ? new Date(`${query.data.to}T23:59:59.999Z`) : null;
    const results = events.flatMap((event) =>
      expandEventOccurrences(event, from, to).map((occurrence) => serializeOccurrence(event, occurrence))
    );
    const filtered = query.data.timeStatus === 'ALL'
      ? results
      : results.filter((event) => event.timeStatus === query.data.timeStatus);
    res.json({ events: filtered });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const event = await prisma.event.findFirst({
      where: { slug: req.params.slug, publicationStatus: 'PUBLISHED' },
      include: { images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const occurrence = expandEventOccurrences(event)[0];
    res.json({
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        description: event.description,
        location: event.location,
        eventDate: event.eventDate,
        startTime: event.startTime,
        endTime: event.endTime,
        publicationStatus: event.publicationStatus,
        recurrenceType: event.recurrenceType,
        recurrenceDays: event.recurrenceDays,
        recurrenceEndDate: event.recurrenceEndDate,
        timeStatus: occurrence?.timeStatus ?? null,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        images: event.images.map((image) => ({
          id: image.id,
          eventId: image.eventId,
          imageKey: image.imageKey,
          publicUrl: getPublicImageUrl(image.imageKey),
          caption: image.caption,
          altText: image.altText,
          isCover: image.isCover === true,
          sortOrder: image.sortOrder,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
