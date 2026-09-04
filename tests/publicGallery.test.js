jest.mock('../src/lib/r2', () => ({
  getPublicImageUrl: jest.fn((key) => `https://media.example.com/${key}`),
  deleteR2Object: jest.fn().mockResolvedValue(undefined),
  deleteMultipleR2Objects: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/db');

const TEST_EMAIL = 'gopal@iscfglobal.com';
const TEST_PASSWORD = 'Test@123';
const albumIds = [];
let agent;
let publishedAlbum;
let hiddenAlbum;
let noCoverAlbum;

beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);

  const created = await agent.post('/api/admin/gallery').send({
    title: 'Public Gallery',
    slug: `public-gallery-${Date.now()}`,
    description: 'Published album',
    category: 'PUBLIC',
    eventDate: '2026-09-04',
    location: 'Campus',
    sortOrder: 0,
  });
  publishedAlbum = created.body.album;
  albumIds.push(publishedAlbum.id);

  await prisma.galleryPhoto.createMany({
    data: [
      { albumId: publishedAlbum.id, imageKey: `gallery/${publishedAlbum.id}/second.jpg`, sortOrder: 2 },
      { albumId: publishedAlbum.id, imageKey: `gallery/${publishedAlbum.id}/cover.jpg`, isCover: true, sortOrder: 1 },
    ],
  });

  hiddenAlbum = await prisma.galleryAlbum.create({
    data: { title: 'Hidden Gallery', slug: `hidden-gallery-${Date.now()}`, isPublished: false },
  });
  albumIds.push(hiddenAlbum.id);

  noCoverAlbum = await prisma.galleryAlbum.create({
    data: { title: 'No Cover Gallery', slug: `no-cover-gallery-${Date.now()}`, sortOrder: 1 },
  });
  albumIds.push(noCoverAlbum.id);
});

afterAll(async () => {
  await prisma.galleryAlbum.deleteMany({ where: { id: { in: albumIds } } });
  await prisma.$disconnect();
});

describe('Public Gallery APIs', () => {
  test('new admin gallery defaults to published', () => {
    expect(publishedAlbum.isPublished).toBe(true);
    expect(noCoverAlbum.isPublished).toBe(true);
  });

  test('GET /api/gallery works without authentication', async () => {
    const res = await request(app).get('/api/gallery');
    expect(res.status).toBe(200);
  });

  test('GET /api/gallery returns published albums when authenticated', async () => {
    const res = await agent.get('/api/gallery');
    expect(res.status).toBe(200);
    expect(res.body.albums.some((album) => album.id === publishedAlbum.id)).toBe(true);
    expect(res.body.albums.some((album) => album.id === noCoverAlbum.id)).toBe(true);
  });

  test('does not return hidden albums', async () => {
    const res = await agent.get('/api/gallery');
    expect(res.body.albums.some((album) => album.id === hiddenAlbum.id)).toBe(false);
  });

  test('returns a cover photo without fetching all photos', async () => {
    const res = await agent.get('/api/gallery');
    const album = res.body.albums.find((item) => item.id === publishedAlbum.id);
    expect(album.photoCount).toBe(2);
    expect(album.coverPhoto).toEqual({
      imageKey: `gallery/${publishedAlbum.id}/cover.jpg`,
      publicUrl: `https://media.example.com/gallery/${publishedAlbum.id}/cover.jpg`,
    });
    expect(album.photos).toBeUndefined();
  });

  test('returns null when an album has no cover', async () => {
    const res = await agent.get('/api/gallery');
    const album = res.body.albums.find((item) => item.id === noCoverAlbum.id);
    expect(album.coverPhoto).toBeNull();
    expect(album.photoCount).toBe(0);
  });

  test('returns published album photos in order with public URLs', async () => {
    const res = await agent.get(`/api/gallery/${publishedAlbum.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.album.photos.map((photo) => photo.imageKey)).toEqual([
      `gallery/${publishedAlbum.id}/cover.jpg`,
      `gallery/${publishedAlbum.id}/second.jpg`,
    ]);
    expect(res.body.album.photos.every((photo) => photo.publicUrl.startsWith('https://media.example.com/'))).toBe(true);
  });

  test('returns 404 for a hidden album', async () => {
    const res = await agent.get(`/api/gallery/${hiddenAlbum.slug}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 for an unknown slug', async () => {
    const res = await agent.get('/api/gallery/not-a-real-gallery');
    expect(res.status).toBe(404);
  });
});
