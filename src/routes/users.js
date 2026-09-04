const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/db');
const { hashPassword } = require('../lib/auth/password');
const requireAdmin = require('../lib/auth/requireAdmin');

const router = Router();
const uuidSchema = z.string().uuid();
const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(255),
  role: z.enum(['USER', 'ADMIN']).optional().default('USER'),
  isActive: z.boolean().optional().default(true),
}).strict();
const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(255).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: safeUserSelect });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid request' });
    const existing = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() }, select: { id: true } });
    if (existing) return res.status(409).json({ error: 'Email already exists' });
    const user = await prisma.user.create({
      data: {
        name: body.data.name,
        email: body.data.email.toLowerCase(),
        passwordHash: await hashPassword(body.data.password),
        role: body.data.role,
        isActive: body.data.isActive,
      },
      select: safeUserSelect,
    });
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already exists' });
    next(err);
  }
});

router.get('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await prisma.user.findUnique({ where: { id: id.data }, select: safeUserSelect });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    const body = updateUserSchema.safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ error: 'Invalid request' });
    const existing = await prisma.user.findUnique({ where: { id: id.data }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const data = { ...body.data };
    if (data.email) data.email = data.email.toLowerCase();
    if (data.password) {
      data.passwordHash = await hashPassword(data.password);
      delete data.password;
    }
    const user = await prisma.user.update({ where: { id: id.data }, data, select: safeUserSelect });
    res.json({ user });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already exists' });
    next(err);
  }
});

router.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid user ID' });
    const existing = await prisma.user.findUnique({ where: { id: id.data }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'User not found' });
    await prisma.user.delete({ where: { id: id.data } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
