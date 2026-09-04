jest.mock('../src/lib/r2', () => ({
  getPublicImageUrl: jest.fn((key) => `https://public-r2.example.com/${key}`),
  deleteR2Object: jest.fn().mockResolvedValue(undefined),
  deleteMultipleR2Objects: jest.fn().mockResolvedValue(undefined),
  ALLOWED_CONTENT_TYPES: new Set(['image/jpeg', 'image/png', 'image/webp']),
  createPresignedPutUrl: jest.fn().mockResolvedValue('https://signed.example.com/upload'),
  generateObjectKey: jest.fn((type, parentId) => `${type}s/${parentId}/image.jpg`),
}));

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/db');
const { hashPassword } = require('../src/lib/auth/password');
const { getPublicImageUrl } = require('../src/lib/r2');

const ADMIN_EMAIL = 'gopal@iscfglobal.com';
const ADMIN_PASSWORD = 'Test@123';
const USER_PASSWORD = 'UserTest@123';
let adminAgent;
let userAgent;
let managerUser;
let event;
let album;
let story;
const cleanupUserIds = [];

beforeAll(async () => {
  managerUser = await prisma.user.create({
    data: {
      name: 'Access Test User',
      email: `access-user-${Date.now()}@iscfglobal.com`,
      passwordHash: await hashPassword(USER_PASSWORD),
      role: 'USER',
    },
  });
  cleanupUserIds.push(managerUser.id);
  adminAgent = request.agent(app);
  userAgent = request.agent(app);
  await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(200);
  await userAgent.post('/api/auth/login').send({ email: managerUser.email, password: USER_PASSWORD }).expect(200);
  event = await prisma.event.create({
    data: { title: 'Public Event', slug: `public-event-${Date.now()}`, eventDate: new Date(), publicationStatus: 'PUBLISHED' },
  });
  album = await prisma.galleryAlbum.create({
    data: { title: 'Public Gallery', slug: `public-gallery-access-${Date.now()}`, isPublished: true },
  });
  story = await prisma.story.create({
    data: { title: 'Public Story', slug: `public-story-${Date.now()}`, content: 'Content', status: 'PUBLISHED' },
  });
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { id: event.id } });
  await prisma.galleryAlbum.deleteMany({ where: { id: album.id } });
  await prisma.story.deleteMany({ where: { id: story.id } });
  await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  await prisma.$disconnect();
});

describe.each(['/api/events', '/api/gallery', '/api/stories'])('public read access for %s', (endpoint) => {
  test('allows unauthenticated visitors', async () => {
    expect((await request(app).get(endpoint)).status).toBe(200);
  });

  test('allows USER', async () => {
    expect((await userAgent.get(endpoint)).status).toBe(200);
  });

  test('allows ADMIN', async () => {
    expect((await adminAgent.get(endpoint)).status).toBe(200);
  });
});

describe('content management', () => {
  test('returns 401 for unauthenticated writes', async () => {
    expect((await request(app).post('/api/admin/events').send({ title: 'Denied', slug: `denied-${Date.now()}` })).status).toBe(401);
    expect((await request(app).post('/api/admin/uploads/presign').send({})).status).toBe(401);
  });

  test('allows USER to create, edit, and delete content and images', async () => {
    const created = await userAgent.post('/api/admin/events').send({
      title: 'User Managed Event',
      slug: `user-managed-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const id = created.body.event.id;
    expect((await userAgent.patch(`/api/admin/events/${id}`).send({ title: 'Updated by User' })).status).toBe(200);

    const presign = await userAgent.post('/api/admin/uploads/presign').send({
      type: 'event',
      parentId: id,
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(presign.status).toBe(200);

    const image = await userAgent.post(`/api/admin/events/${id}/images`).send({ imageKey: `events/${id}/photo.jpg` });
    expect(image.status).toBe(201);
    expect((await userAgent.delete(`/api/admin/event-images/${image.body.id}`)).status).toBe(200);
    expect((await userAgent.delete(`/api/admin/events/${id}`)).status).toBe(200);
  });

  test('allows ADMIN to create, edit, and delete content and request uploads', async () => {
    const created = await adminAgent.post('/api/admin/events').send({
      title: 'Admin Managed Event',
      slug: `admin-managed-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const id = created.body.event.id;
    expect((await adminAgent.patch(`/api/admin/events/${id}`).send({ title: 'Updated by Admin' })).status).toBe(200);
    expect((await adminAgent.post('/api/admin/uploads/presign').send({
      type: 'event', parentId: id, fileName: 'photo.png', contentType: 'image/png', size: 1024,
    })).status).toBe(200);
    expect((await adminAgent.delete(`/api/admin/events/${id}`)).status).toBe(200);
  });
});

describe('user management', () => {
  test('returns 401 when unauthenticated', async () => {
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
  });

  test('returns 403 to USER', async () => {
    expect((await userAgent.get('/api/admin/users')).status).toBe(403);
    expect((await userAgent.post('/api/admin/users').send({})).status).toBe(403);
  });

  test('allows ADMIN to create, read, update, and delete users', async () => {
    const created = await adminAgent.post('/api/admin/users').send({
      name: 'Managed User',
      email: `managed-${Date.now()}@iscfglobal.com`,
      password: 'ManagedTest@123',
      role: 'USER',
    });
    expect(created.status).toBe(201);
    const id = created.body.user.id;
    cleanupUserIds.push(id);
    expect(created.body.user.passwordHash).toBeUndefined();
    expect((await adminAgent.get(`/api/admin/users/${id}`)).status).toBe(200);
    const updated = await adminAgent.patch(`/api/admin/users/${id}`).send({ role: 'ADMIN', isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body.user).toMatchObject({ role: 'ADMIN', isActive: false });
    expect((await adminAgent.delete(`/api/admin/users/${id}`)).status).toBe(200);
    cleanupUserIds.splice(cleanupUserIds.indexOf(id), 1);
  });
});

test('R2 public image URL generation is independent of API authentication', () => {
  expect(getPublicImageUrl('gallery/album/photo.jpg')).toBe('https://public-r2.example.com/gallery/album/photo.jpg');
});
