jest.mock('../src/lib/r2', () => ({
  getPublicImageUrl: jest.fn((key) => `https://media.example.com/${key}`),
}));

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/db');

const TEST_EMAIL = 'gopal@iscfglobal.com';
const TEST_PASSWORD = 'Test@123';
const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const eventIds = [];
let agent;
let futureEvent;
let ongoingEvent;
let pastEvent;
let dateOnlyEvent;
let recurringEvent;
let noCoverEvent;
let coveredEvent;

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

async function createEvent(data) {
  const event = await prisma.event.create({ data });
  eventIds.push(event.id);
  return event;
}

beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
  const now = new Date();
  futureEvent = await createEvent({
    title: 'Future Event',
    slug: `future-event-${Date.now()}`,
    eventDate: addDays(now, 2),
    startTime: addDays(now, 2),
    endTime: addDays(now, 2.1),
    publicationStatus: 'PUBLISHED',
  });
  ongoingEvent = await createEvent({
    title: 'Ongoing Event',
    slug: `ongoing-event-${Date.now()}`,
    eventDate: now,
    startTime: new Date(now.getTime() - 60 * 60 * 1000),
    endTime: new Date(now.getTime() + 60 * 60 * 1000),
    publicationStatus: 'PUBLISHED',
  });
  pastEvent = await createEvent({
    title: 'Past Event',
    slug: `past-event-${Date.now()}`,
    eventDate: addDays(now, -2),
    startTime: addDays(now, -2),
    endTime: addDays(now, -1.9),
    publicationStatus: 'PUBLISHED',
  });
  dateOnlyEvent = await createEvent({
    title: 'Date Only Event',
    slug: `date-only-event-${Date.now()}`,
    eventDate: new Date(`${dateOnly(now)}T00:00:00.000Z`),
    publicationStatus: 'PUBLISHED',
  });
  recurringEvent = await createEvent({
    title: 'Weekly Event',
    slug: `weekly-event-${Date.now()}`,
    eventDate: now,
    startTime: new Date(now.getTime() - 60 * 60 * 1000),
    endTime: new Date(now.getTime() + 60 * 60 * 1000),
    publicationStatus: 'PUBLISHED',
    recurrenceType: 'WEEKLY',
    recurrenceDays: [DAY_NAMES[now.getUTCDay()]],
    recurrenceEndDate: addDays(now, 30),
  });
  noCoverEvent = await createEvent({
    title: 'No Cover Event',
    slug: `no-cover-event-${Date.now()}`,
    eventDate: addDays(now, 4),
    publicationStatus: 'PUBLISHED',
  });
  coveredEvent = await createEvent({
    title: 'Covered Event',
    slug: `covered-event-${Date.now()}`,
    eventDate: addDays(now, 5),
    publicationStatus: 'PUBLISHED',
    images: {
      create: [
        { imageKey: 'events/covered/secondary.jpg', sortOrder: 0 },
        { imageKey: 'events/covered/cover.jpg', isCover: true, sortOrder: 1 },
      ],
    },
  });
  await createEvent({
    title: 'Draft Event',
    slug: `draft-event-${Date.now()}`,
    eventDate: now,
    publicationStatus: 'DRAFT',
  });
  await createEvent({
    title: 'Archived Event',
    slug: `archived-event-${Date.now()}`,
    eventDate: now,
    publicationStatus: 'ARCHIVED',
  });
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.$disconnect();
});

describe('GET /api/events', () => {
  test('calculates upcoming, ongoing, and past statuses', async () => {
    const res = await agent.get('/api/events');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.events.map((event) => [event.id, event]));
    expect(byId[futureEvent.id].timeStatus).toBe('UPCOMING');
    expect(byId[ongoingEvent.id].timeStatus).toBe('ONGOING');
    expect(byId[pastEvent.id].timeStatus).toBe('PAST');
  });

  test('treats a date-only event on the current UTC date as ongoing', async () => {
    const res = await agent.get('/api/events');
    const event = res.body.events.find((item) => item.id === dateOnlyEvent.id);
    expect(event.timeStatus).toBe('ONGOING');
    expect(event.startTime).toBeNull();
    expect(event.endTime).toBeNull();
  });

  test('filters by computed time status', async () => {
    const res = await agent.get('/api/events?timeStatus=UPCOMING');
    expect(res.status).toBe(200);
    expect(res.body.events.every((event) => event.timeStatus === 'UPCOMING')).toBe(true);
    expect(res.body.events.some((event) => event.id === futureEvent.id)).toBe(true);
  });

  test('expands and calculates each weekly occurrence within the requested range', async () => {
    const now = new Date();
    const from = dateOnly(addDays(now, -7));
    const to = dateOnly(addDays(now, 7));
    const res = await agent.get(`/api/events?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    const occurrences = res.body.events.filter((event) => event.id === recurringEvent.id);
    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((event) => event.timeStatus)).toEqual(['PAST', 'ONGOING', 'UPCOMING']);
    expect(new Set(occurrences.map((event) => event.eventDate))).toHaveProperty('size', 3);
  });

  test('requires from and to together and validates their order', async () => {
    expect((await agent.get('/api/events?from=2026-09-01')).status).toBe(400);
    expect((await agent.get('/api/events?from=2026-09-10&to=2026-09-01')).status).toBe(400);
  });

  test('returns null when there is no cover and only the cover when present', async () => {
    const res = await agent.get('/api/events');
    const withoutCover = res.body.events.find((event) => event.id === noCoverEvent.id);
    const withCover = res.body.events.find((event) => event.id === coveredEvent.id);
    expect(withoutCover.coverImage).toBeNull();
    expect(withCover.coverImage).toEqual({
      imageKey: 'events/covered/cover.jpg',
      publicUrl: 'https://media.example.com/events/covered/cover.jpg',
    });
  });

  test('does not return draft or archived events', async () => {
    const res = await agent.get('/api/events');
    const titles = res.body.events.map((event) => event.title);
    expect(titles).not.toContain('Draft Event');
    expect(titles).not.toContain('Archived Event');
  });
});

describe('GET /api/events/:slug', () => {
  test('returns the complete published event with ordered images', async () => {
    const res = await agent.get(`/api/events/${coveredEvent.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.event.publicationStatus).toBe('PUBLISHED');
    expect(res.body.event.recurrenceType).toBe('NONE');
    expect(res.body.event.images.map((image) => image.imageKey)).toEqual([
      'events/covered/secondary.jpg',
      'events/covered/cover.jpg',
    ]);
    expect(res.body.event.images.every((image) => image.publicUrl.startsWith('https://media.example.com/'))).toBe(true);
  });

  test('returns 404 for unpublished events', async () => {
    const draft = await prisma.event.findFirst({ where: { title: 'Draft Event' } });
    const res = await agent.get(`/api/events/${draft.slug}`);
    expect(res.status).toBe(404);
  });
});
