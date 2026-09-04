jest.mock('../src/lib/r2', () => ({
  getPublicImageUrl: jest.fn((key) => `https://media.example.com/${key}`),
  deleteR2Object: jest.fn().mockResolvedValue(undefined),
  deleteMultipleR2Objects: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/db');
const { deleteR2Object, deleteMultipleR2Objects } = require('../src/lib/r2');

const TEST_EMAIL = 'gopal@iscfglobal.com';
const TEST_PASSWORD = 'Test@123';

let agent;
let album;
let secondAlbum;
let firstPhoto;
let secondPhoto;

beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
});

afterAll(async () => {
  const ids = [album?.id, secondAlbum?.id].filter(Boolean);
  await prisma.galleryAlbum.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('Gallery album APIs', () => {
  test('requires admin authentication', async () => {
    const res = await request(app).get('/api/admin/gallery');
    expect(res.status).toBe(401);
  });

  test('validates album creation', async () => {
    const res = await agent.post('/api/admin/gallery').send({ title: '', slug: 'Invalid Slug' });
    expect(res.status).toBe(400);
  });

  test('creates an album and assigns the admin', async () => {
    const res = await agent.post('/api/admin/gallery').send({
      title: 'Campus Life',
      slug: `campus-life-${Date.now()}`,
      description: 'Campus photos',
      category: 'CAMPUS_LIFE',
      eventDate: '2026-04-18',
      location: 'Old Dominion University',
      isPublished: true,
      sortOrder: 2,
    });

    expect(res.status).toBe(201);
    expect(res.body.album).toMatchObject({
      title: 'Campus Life',
      category: 'CAMPUS_LIFE',
      eventDate: '2026-04-18T00:00:00.000Z',
      location: 'Old Dominion University',
      isPublished: true,
      sortOrder: 2,
    });
    expect(res.body.album.createdById).toBeTruthy();
    album = res.body.album;
  });

  test('rejects a duplicate slug', async () => {
    const res = await agent.post('/api/admin/gallery').send({ title: 'Duplicate', slug: album.slug });
    expect(res.status).toBe(409);
  });

  test('creates a second album for ordering and deletion tests', async () => {
    const res = await agent.post('/api/admin/gallery').send({
      title: 'Second Album',
      slug: `second-album-${Date.now()}`,
      sortOrder: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.album.eventDate).toBeNull();
    expect(res.body.album.location).toBeNull();
    secondAlbum = res.body.album;
  });

  test('rejects an invalid event date', async () => {
    const res = await agent.post('/api/admin/gallery').send({
      title: 'Invalid Date',
      slug: `invalid-date-${Date.now()}`,
      eventDate: '2026-02-30',
    });
    expect(res.status).toBe(400);
  });

  test('patches allowed fields and rejects createdById', async () => {
    const rejected = await agent.patch(`/api/admin/gallery/${album.id}`).send({ createdById: null });
    expect(rejected.status).toBe(400);

    const res = await agent.patch(`/api/admin/gallery/${album.id}`).send({
      title: 'Updated Campus Life',
      description: null,
      eventDate: '2026-05-20',
      location: 'Updated Location',
      sortOrder: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.album).toMatchObject({
      title: 'Updated Campus Life',
      description: null,
      eventDate: '2026-05-20T00:00:00.000Z',
      location: 'Updated Location',
      sortOrder: 0,
    });
  });

  test('clears nullable event details', async () => {
    const res = await agent.patch(`/api/admin/gallery/${album.id}`).send({ eventDate: null, location: null });
    expect(res.status).toBe(200);
    expect(res.body.album.eventDate).toBeNull();
    expect(res.body.album.location).toBeNull();
  });
});

describe('Gallery photo APIs', () => {
  test('rejects a key belonging to another album', async () => {
    const res = await agent.post(`/api/admin/gallery/${album.id}/photos`).send({
      imageKey: `gallery/${secondAlbum.id}/wrong.jpg`,
    });
    expect(res.status).toBe(400);
  });

  test('creates a cover photo with metadata', async () => {
    const res = await agent.post(`/api/admin/gallery/${album.id}/photos`).send({
      imageKey: `gallery/${album.id}/first.jpg`,
      caption: 'First',
      altText: 'First photo',
      isCover: true,
      isFeatured: true,
      sortOrder: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      albumId: album.id,
      publicUrl: `https://media.example.com/gallery/${album.id}/first.jpg`,
      isCover: true,
      isFeatured: true,
      sortOrder: 2,
    });
    firstPhoto = res.body;
    const stored = await prisma.galleryPhoto.findUnique({ where: { id: firstPhoto.id } });
    expect(stored.uploadedById).toBeTruthy();
  });

  test('creates a new cover and unsets the previous cover transactionally', async () => {
    const res = await agent.post(`/api/admin/gallery/${album.id}/photos`).send({
      imageKey: `gallery/${album.id}/second.webp`,
      isCover: true,
      sortOrder: 1,
    });
    expect(res.status).toBe(201);
    secondPhoto = res.body;
    const previous = await prisma.galleryPhoto.findUnique({ where: { id: firstPhoto.id } });
    expect(previous.isCover).toBe(false);
    expect(await prisma.galleryPhoto.count({ where: { albumId: album.id, isCover: true } })).toBe(1);
  });

  test('returns ordered photos with dynamic public URLs', async () => {
    const res = await agent.get(`/api/admin/gallery/${album.id}/photos`);
    expect(res.status).toBe(200);
    expect(res.body.photos.map((photo) => photo.id)).toEqual([secondPhoto.id, firstPhoto.id]);
    expect(res.body.photos.every((photo) => photo.publicUrl.startsWith('https://media.example.com/'))).toBe(true);
  });

  test('returns one album with ordered photos', async () => {
    const res = await agent.get(`/api/admin/gallery/${album.id}`);
    expect(res.status).toBe(200);
    expect(res.body.album).toHaveProperty('eventDate');
    expect(res.body.album).toHaveProperty('location');
    expect(res.body.album.photos.map((photo) => photo.id)).toEqual([secondPhoto.id, firstPhoto.id]);
  });

  test('lists albums with cover photo and photo count', async () => {
    const res = await agent.get('/api/admin/gallery');
    expect(res.status).toBe(200);
    const result = res.body.albums.find((item) => item.id === album.id);
    expect(result).toHaveProperty('eventDate');
    expect(result).toHaveProperty('location');
    expect(result.photoCount).toBe(2);
    expect(result.coverPhoto).toEqual({
      imageKey: secondPhoto.imageKey,
      publicUrl: `https://media.example.com/${secondPhoto.imageKey}`,
    });
  });

  test('rejects immutable photo fields', async () => {
    const res = await agent.patch(`/api/admin/gallery-photos/${firstPhoto.id}`).send({ imageKey: 'changed.jpg' });
    expect(res.status).toBe(400);
  });

  test('updates photo metadata and cover transactionally', async () => {
    const res = await agent.patch(`/api/admin/gallery-photos/${firstPhoto.id}`).send({
      caption: 'Updated',
      altText: null,
      isCover: true,
      isFeatured: false,
      sortOrder: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ caption: 'Updated', altText: null, isCover: true, isFeatured: false, sortOrder: 0 });
    expect(await prisma.galleryPhoto.count({ where: { albumId: album.id, isCover: true } })).toBe(1);
    expect((await prisma.galleryPhoto.findUnique({ where: { id: secondPhoto.id } })).isCover).toBe(false);
  });

  test('preserves the photo row if R2 deletion fails', async () => {
    deleteR2Object.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await agent.delete(`/api/admin/gallery-photos/${secondPhoto.id}`);
    expect(res.status).toBe(502);
    expect(await prisma.galleryPhoto.findUnique({ where: { id: secondPhoto.id } })).not.toBeNull();
  });

  test('deletes an R2 object before its photo row', async () => {
    const res = await agent.delete(`/api/admin/gallery-photos/${secondPhoto.id}`);
    expect(res.status).toBe(200);
    expect(deleteR2Object).toHaveBeenCalledWith(secondPhoto.imageKey);
    expect(await prisma.galleryPhoto.findUnique({ where: { id: secondPhoto.id } })).toBeNull();
  });
});

describe('Gallery album deletion', () => {
  test('preserves album rows if any R2 cleanup fails', async () => {
    deleteMultipleR2Objects.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await agent.delete(`/api/admin/gallery/${album.id}`);
    expect(res.status).toBe(502);
    expect(await prisma.galleryAlbum.findUnique({ where: { id: album.id } })).not.toBeNull();
  });

  test('deletes storage objects before cascading database rows', async () => {
    const remainingKeys = (await prisma.galleryPhoto.findMany({
      where: { albumId: album.id },
      select: { imageKey: true },
    })).map((photo) => photo.imageKey);
    const res = await agent.delete(`/api/admin/gallery/${album.id}`);
    expect(res.status).toBe(200);
    expect(deleteMultipleR2Objects).toHaveBeenCalledWith(remainingKeys);
    expect(await prisma.galleryAlbum.findUnique({ where: { id: album.id } })).toBeNull();
    album = null;
  });
});
