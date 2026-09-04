const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/db');

const TEST_EMAIL = 'gopal@iscfglobal.com';
const TEST_PASSWORD = 'Test@123';
const BAD_EMAIL = 'wrong@iscfglobal.com';
const BAD_PASSWORD = 'wrongpassword';

let agent;

beforeAll(async () => {
  agent = request.agent(app);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  test('should login with valid admin credentials and set cookies', async () => {
    const res = await agent
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.passwordHash).toBeUndefined();

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('access_token='))).toBe(true);
    expect(cookies.some(c => c.startsWith('refresh_token='))).toBe(true);
  });

  test('should reject invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: BAD_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('should reject invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: BAD_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('should reject missing email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  test('should reject missing password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  test('should not return tokens in JSON body', async () => {
    const res = await agent
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.body.token).toBeUndefined();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });
});

describe('GET /api/auth/me', () => {
  test('should return current user when authenticated', async () => {
    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('should return 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

describe('POST /api/auth/refresh', () => {
  test('should issue new tokens with valid refresh cookie', async () => {
    const res = await agent.post('/api/auth/refresh');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('access_token='))).toBe(true);
    expect(cookies.some(c => c.startsWith('refresh_token='))).toBe(true);
  });

  test('should return 401 without refresh cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

describe('POST /api/auth/logout', () => {
  test('should clear cookies and revoke session', async () => {
    const res = await agent.post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const cookies = res.headers['set-cookie'];
    if (cookies) {
      expect(cookies.some(c => c.includes('access_token=;'))).toBe(true);
      expect(cookies.some(c => c.includes('refresh_token=;'))).toBe(true);
    }
  });

  test('should return 200 even without cookies', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/auth/me after logout', () => {
  test('should return 401 after logout', async () => {
    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(401);
  });
});

describe('Protected route /api/admin/* without auth', () => {
  test('should return 401', async () => {
    const res = await request(app).get('/api/admin/health');

    expect(res.status).toBe(401);
  });
});

describe('Health check', () => {
  test('GET /api/health should return 200', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
