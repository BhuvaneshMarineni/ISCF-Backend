const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/lib/db');

const TEST_EMAIL = 'gopal@iscfglobal.com';
const TEST_PASSWORD = 'Test@123';
let agent;
let story;

beforeAll(async () => {
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
  story = await prisma.story.create({
    data: {
      title: 'Authenticated Story',
      slug: `authenticated-story-${Date.now()}`,
      content: 'Full story content',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await prisma.story.deleteMany({ where: { id: story.id } });
  await prisma.$disconnect();
});

describe('Authenticated Story reads', () => {
  test('allows reads without authentication', async () => {
    expect((await request(app).get('/api/stories')).status).toBe(200);
    expect((await request(app).get(`/api/stories/${story.slug}`)).status).toBe(200);
  });

  test('lists published stories for an authenticated account', async () => {
    const res = await agent.get('/api/stories');
    expect(res.status).toBe(200);
    expect(res.body.stories.some((item) => item.id === story.id)).toBe(true);
  });

  test('returns story detail for an authenticated account', async () => {
    const res = await agent.get(`/api/stories/${story.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.story.id).toBe(story.id);
    expect(res.body.story.content).toBe('Full story content');
  });

  test('disables non-admin Story mutation routes', async () => {
    expect((await agent.post('/api/stories').send({ title: 'No', content: 'No' })).status).toBe(404);
    expect((await agent.put(`/api/stories/${story.id}`).send({ title: 'No' })).status).toBe(404);
    expect((await agent.delete(`/api/stories/${story.id}`)).status).toBe(404);
  });
});
