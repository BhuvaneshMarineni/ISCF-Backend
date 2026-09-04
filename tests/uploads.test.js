const request = require('supertest');
const app = require('../src/app');

const TEST_EMAIL = 'gopal@iscfglobal.com';
const TEST_PASSWORD = 'Test@123';

const VALID_PARENT_ID = '123e4567-e89b-12d3-a456-426614174000';

// Mock R2 so tests don't require real credentials.
jest.mock('../src/lib/r2', () => {
  const original = jest.requireActual('../src/lib/r2');
  return {
    ...original,
    createPresignedPutUrl: jest.fn().mockResolvedValue('https://example.r2.cloudflarestorage.com/iscf-media/test-key?X-Amz-Signature=mock'),
    generateObjectKey: jest.fn((type, parentId, contentType) => {
      const prefix = type === 'event' ? 'events' : type === 'gallery' ? 'gallery' : 'stories';
      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      return `${prefix}/${parentId}/mock-uuid.${ext}`;
    }),
    deleteR2Object: jest.fn().mockResolvedValue(undefined),
  };
});

const r2 = require('../src/lib/r2');

let agent;

beforeAll(async () => {
  agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
    .expect(200);
});

afterAll(async () => {
  const { prisma } = require('../src/lib/db');
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/admin/uploads/presign', () => {
  test('should reject without auth', async () => {
    const res = await request(app).post('/api/admin/uploads/presign').send({
      type: 'event',
      parentId: VALID_PARENT_ID,
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(res.status).toBe(401);
  });

  test('should reject invalid type', async () => {
    const res = await agent.post('/api/admin/uploads/presign').send({
      type: 'invalid',
      parentId: VALID_PARENT_ID,
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(res.status).toBe(400);
  });

  test('should reject unsupported content type', async () => {
    const res = await agent.post('/api/admin/uploads/presign').send({
      type: 'event',
      parentId: VALID_PARENT_ID,
      fileName: 'photo.gif',
      contentType: 'image/gif',
      size: 1024,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content type/i);
  });

  test('should reject file over 10 MB', async () => {
    const res = await agent.post('/api/admin/uploads/presign').send({
      type: 'event',
      parentId: VALID_PARENT_ID,
      fileName: 'big.jpg',
      contentType: 'image/jpeg',
      size: 11 * 1024 * 1024,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  test('should reject missing parentId', async () => {
    const res = await agent.post('/api/admin/uploads/presign').send({
      type: 'event',
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(res.status).toBe(400);
  });

  test('should return uploadUrl and imageKey for valid request', async () => {
    const res = await agent.post('/api/admin/uploads/presign').send({
      type: 'event',
      parentId: VALID_PARENT_ID,
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    });

    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toBeDefined();
    expect(res.body.imageKey).toBeDefined();
    expect(res.body.imageKey).toMatch(/^events\//);
    // Should not leak credentials
    expect(res.body.accessKeyId).toBeUndefined();
    expect(res.body.secretAccessKey).toBeUndefined();
  });

  test('should not use original filename as object key', async () => {
    const res = await agent.post('/api/admin/uploads/presign').send({
      type: 'story',
      parentId: VALID_PARENT_ID,
      fileName: 'my-custom-filename-2024.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    });

    expect(res.status).toBe(200);
    expect(r2.generateObjectKey).toHaveBeenCalledWith('story', VALID_PARENT_ID, 'image/jpeg');
    expect(res.body.imageKey).not.toContain('my-custom-filename');
  });

  test('should support png and webp', async () => {
    const pngRes = await agent.post('/api/admin/uploads/presign').send({
      type: 'gallery',
      parentId: VALID_PARENT_ID,
      fileName: 'photo.png',
      contentType: 'image/png',
      size: 2048,
    });
    expect(pngRes.status).toBe(200);
    expect(pngRes.body.imageKey).toMatch(/^gallery\//);

    const webpRes = await agent.post('/api/admin/uploads/presign').send({
      type: 'gallery',
      parentId: VALID_PARENT_ID,
      fileName: 'photo.webp',
      contentType: 'image/webp',
      size: 2048,
    });
    expect(webpRes.status).toBe(200);
  });
});
