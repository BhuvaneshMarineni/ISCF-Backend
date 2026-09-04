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
let story;
let duplicateStory;
let cleanupIds = [];

beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
});

afterAll(async () => {
  await prisma.story.deleteMany({ where: { id: { in: cleanupIds } } });
  await prisma.$disconnect();
});

describe('Admin Story APIs', () => {
  test('requires admin authentication', async () => {
    const res = await request(app).get('/api/admin/stories');
    expect(res.status).toBe(401);
  });

  test('creates a story', async () => {
    const res = await agent.post('/api/admin/stories').send({
      title: 'Finding Community Far From Home',
      slug: `finding-community-${Date.now()}`,
      excerpt: 'Optional short summary',
      content: 'Full story content',
      authorName: 'Student Name',
      status: 'PUBLISHED',
      publishedAt: '2026-09-04T12:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(res.body.story).toMatchObject({
      title: 'Finding Community Far From Home',
      content: 'Full story content',
      authorName: 'Student Name',
      status: 'PUBLISHED',
      coverImageKey: null,
      coverImageUrl: null,
    });
    story = res.body.story;
    cleanupIds.push(story.id);
    const stored = await prisma.story.findUnique({ where: { id: story.id } });
    expect(stored.createdById).toBeTruthy();
  });

  test('rejects a duplicate slug', async () => {
    const res = await agent.post('/api/admin/stories').send({
      title: 'Duplicate',
      slug: story.slug,
      content: 'Duplicate content',
    });
    expect(res.status).toBe(409);
  });

  test('updates story fields', async () => {
    const res = await agent.patch(`/api/admin/stories/${story.id}`).send({
      title: 'Updated Story',
      excerpt: null,
      content: 'Updated full content',
      authorName: 'Updated Student',
      status: 'ARCHIVED',
      publishedAt: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.story).toMatchObject({
      title: 'Updated Story',
      excerpt: null,
      content: 'Updated full content',
      authorName: 'Updated Student',
      status: 'ARCHIVED',
      publishedAt: null,
    });
  });

  test('assigns a cover image and returns its public URL', async () => {
    const coverImageKey = `stories/${story.id}/first.jpg`;
    const res = await agent.patch(`/api/admin/stories/${story.id}`).send({ coverImageKey });
    expect(res.status).toBe(200);
    expect(res.body.story.coverImageKey).toBe(coverImageKey);
    expect(res.body.story.coverImageUrl).toBe(`https://media.example.com/${coverImageKey}`);
  });

  test('rejects a cover image belonging to another story', async () => {
    const res = await agent.patch(`/api/admin/stories/${story.id}`).send({
      coverImageKey: 'stories/123e4567-e89b-12d3-a456-426614174000/wrong.jpg',
    });
    expect(res.status).toBe(400);
  });

  test('replaces a cover after the database update and deletes the old object', async () => {
    const oldKey = `stories/${story.id}/first.jpg`;
    const newKey = `stories/${story.id}/second.webp`;
    const res = await agent.patch(`/api/admin/stories/${story.id}`).send({ coverImageKey: newKey });
    expect(res.status).toBe(200);
    expect(res.body.story.coverImageKey).toBe(newKey);
    expect(deleteR2Object).toHaveBeenCalledWith(oldKey);
  });

  test('reports old-cover cleanup failure while preserving the new assignment', async () => {
    const currentKey = `stories/${story.id}/second.webp`;
    const newKey = `stories/${story.id}/third.png`;
    deleteR2Object.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await agent.patch(`/api/admin/stories/${story.id}`).send({ coverImageKey: newKey });
    expect(res.status).toBe(502);
    expect(res.body.story.coverImageKey).toBe(newKey);
    expect((await prisma.story.findUnique({ where: { id: story.id } })).coverImageKey).toBe(newKey);
    expect(deleteR2Object).toHaveBeenCalledWith(currentKey);
  });

  test('preserves the cover assignment if removal from R2 fails', async () => {
    const currentKey = `stories/${story.id}/third.png`;
    deleteR2Object.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await agent.patch(`/api/admin/stories/${story.id}`).send({ coverImageKey: null });
    expect(res.status).toBe(502);
    expect((await prisma.story.findUnique({ where: { id: story.id } })).coverImageKey).toBe(currentKey);
  });

  test('removes a cover image after R2 deletion succeeds', async () => {
    const oldKey = `stories/${story.id}/third.png`;
    const res = await agent.patch(`/api/admin/stories/${story.id}`).send({ coverImageKey: null });
    expect(res.status).toBe(200);
    expect(res.body.story.coverImageKey).toBeNull();
    expect(res.body.story.coverImageUrl).toBeNull();
    expect(deleteR2Object).toHaveBeenCalledWith(oldKey);
  });

  test('returns a lightweight list without full content', async () => {
    const res = await agent.get('/api/admin/stories');
    expect(res.status).toBe(200);
    const result = res.body.stories.find((item) => item.id === story.id);
    expect(result).toBeDefined();
    expect(result.content).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual([
      'authorName', 'coverImageKey', 'coverImageUrl', 'createdAt', 'excerpt',
      'id', 'publishedAt', 'slug', 'status', 'title', 'updatedAt',
    ].sort());
  });

  test('returns full content in the detail response', async () => {
    const res = await agent.get(`/api/admin/stories/${story.id}`);
    expect(res.status).toBe(200);
    expect(res.body.story.content).toBe('Updated full content');
    expect(res.body.story).toHaveProperty('coverImageUrl');
  });

  test('deletes a story without a cover', async () => {
    const res = await agent.delete(`/api/admin/stories/${story.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await prisma.story.findUnique({ where: { id: story.id } })).toBeNull();
    cleanupIds = cleanupIds.filter((id) => id !== story.id);
  });

  test('deletes a story with a cover only after R2 succeeds', async () => {
    const id = require('crypto').randomUUID();
    const create = await agent.post('/api/admin/stories').send({
      title: 'Covered Story',
      slug: `covered-story-${Date.now()}`,
      content: 'Covered content',
      coverImageKey: `stories/${id}/cover.jpg`,
    });
    expect(create.status).toBe(201);
    duplicateStory = create.body.story;
    cleanupIds.push(duplicateStory.id);

    const res = await agent.delete(`/api/admin/stories/${duplicateStory.id}`);
    expect(res.status).toBe(200);
    expect(deleteR2Object).toHaveBeenCalledWith(duplicateStory.coverImageKey);
    expect(await prisma.story.findUnique({ where: { id: duplicateStory.id } })).toBeNull();
    cleanupIds = cleanupIds.filter((storyId) => storyId !== duplicateStory.id);
  });

  test('preserves a covered story when R2 deletion fails', async () => {
    const id = require('crypto').randomUUID();
    const create = await agent.post('/api/admin/stories').send({
      title: 'Preserved Story',
      slug: `preserved-story-${Date.now()}`,
      content: 'Preserved content',
      coverImageKey: `stories/${id}/cover.jpg`,
    });
    expect(create.status).toBe(201);
    const preserved = create.body.story;
    cleanupIds.push(preserved.id);

    deleteR2Object.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await agent.delete(`/api/admin/stories/${preserved.id}`);
    expect(res.status).toBe(502);
    expect(await prisma.story.findUnique({ where: { id: preserved.id } })).not.toBeNull();
  });
});
