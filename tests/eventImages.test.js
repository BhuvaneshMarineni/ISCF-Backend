jest.mock('../src/lib/r2', () => ({
  getPublicImageUrl: jest.fn((key) => `https://media.example.com/${key}`),
  deleteR2Object: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/db');
const { deleteR2Object } = require('../src/lib/r2');

const TEST_EMAIL = 'gopal@iscfglobal.com';
const TEST_PASSWORD = 'Test@123';

let agent;
let event;
let firstImage;
let secondImage;

beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
  event = await prisma.event.create({
    data: { title: 'Image API Test Event', slug: `image-api-test-${Date.now()}` },
  });
});

afterAll(async () => {
  if (event) {
    await prisma.event.deleteMany({ where: { id: event.id } });
  }
  await prisma.$disconnect();
});

describe('POST /api/admin/events/:eventId/images', () => {
  test('requires admin authentication', async () => {
    const res = await request(app).post(`/api/admin/events/${event.id}/images`).send({
      imageKey: `events/${event.id}/one.jpg`,
    });
    expect(res.status).toBe(401);
  });

  test('rejects an image key for another event', async () => {
    const res = await agent.post(`/api/admin/events/${event.id}/images`).send({
      imageKey: 'events/123e4567-e89b-12d3-a456-426614174000/one.jpg',
    });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the event does not exist', async () => {
    const eventId = '123e4567-e89b-12d3-a456-426614174000';
    const res = await agent.post(`/api/admin/events/${eventId}/images`).send({
      imageKey: `events/${eventId}/one.jpg`,
    });
    expect(res.status).toBe(404);
  });

  test('creates image metadata and returns a public URL', async () => {
    const res = await agent.post(`/api/admin/events/${event.id}/images`).send({
      imageKey: `events/${event.id}/one.jpg`,
      caption: 'First image',
      altText: 'Students gathering',
      isCover: true,
      sortOrder: 2,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      eventId: event.id,
      imageKey: `events/${event.id}/one.jpg`,
      publicUrl: `https://media.example.com/events/${event.id}/one.jpg`,
      caption: 'First image',
      altText: 'Students gathering',
      isCover: true,
      sortOrder: 2,
    });
    firstImage = res.body;
    const stored = await prisma.eventImage.findUnique({ where: { id: firstImage.id } });
    expect(stored.uploadedById).toBeTruthy();
  });

  test('unsets the previous cover in the create transaction', async () => {
    const res = await agent.post(`/api/admin/events/${event.id}/images`).send({
      imageKey: `events/${event.id}/two.png`,
      isCover: true,
      sortOrder: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.isCover).toBe(true);
    secondImage = res.body;
    const previous = await prisma.eventImage.findUnique({ where: { id: firstImage.id } });
    expect(previous.isCover).toBe(false);
  });
});

describe('GET /api/admin/events/:eventId/images', () => {
  test('returns ordered images with public URLs', async () => {
    const res = await agent.get(`/api/admin/events/${event.id}/images`);

    expect(res.status).toBe(200);
    expect(res.body.images.map((image) => image.id)).toEqual([secondImage.id, firstImage.id]);
    expect(res.body.images.every((image) => image.publicUrl.startsWith('https://media.example.com/'))).toBe(true);
  });
});

describe('PATCH /api/admin/event-images/:id', () => {
  test('validates allowed fields', async () => {
    const res = await agent.patch(`/api/admin/event-images/${firstImage.id}`).send({ imageKey: 'changed.jpg' });
    expect(res.status).toBe(400);
  });

  test('updates metadata and makes the image the only cover', async () => {
    const res = await agent.patch(`/api/admin/event-images/${firstImage.id}`).send({
      caption: 'Updated caption',
      altText: null,
      isCover: true,
      sortOrder: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ caption: 'Updated caption', altText: null, isCover: true, sortOrder: 0 });
    const previousCover = await prisma.eventImage.findUnique({ where: { id: secondImage.id } });
    expect(previousCover.isCover).toBe(false);
  });
});

describe('DELETE /api/admin/event-images/:id', () => {
  test('keeps the database row when R2 deletion fails', async () => {
    deleteR2Object.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await agent.delete(`/api/admin/event-images/${secondImage.id}`);

    expect(res.status).toBe(502);
    expect(await prisma.eventImage.findUnique({ where: { id: secondImage.id } })).not.toBeNull();
  });

  test('deletes from R2 before deleting the database row', async () => {
    const res = await agent.delete(`/api/admin/event-images/${secondImage.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deleteR2Object).toHaveBeenCalledWith(secondImage.imageKey);
    expect(await prisma.eventImage.findUnique({ where: { id: secondImage.id } })).toBeNull();
  });
});
