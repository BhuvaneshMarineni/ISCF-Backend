const { Router } = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const ms = require('ms');
const { prisma } = require('../lib/db');
const { verifyPassword } = require('../lib/auth/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../lib/auth/jwt');
const { setAuthCookies, clearAuthCookies } = require('../lib/auth/cookies');
const requireAuth = require('../lib/auth/requireAuth');

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        isActive: true,
        role: { in: ['ADMIN', 'EDITOR'] },
      },
    });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const now = new Date();
    const refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
    const expiresAt = new Date(now.getTime() + ms(refreshExpiresIn));

    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: '', // placeholder; updated after signing the JWT
        expiresAt,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    });

    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, sessionId: session.id });
    const refreshTokenHash = hashRefreshToken(refreshToken);

    await prisma.authSession.update({
      where: { id: session.id },
      data: { refreshTokenHash },
    });

    setAuthCookies(res, accessToken, refreshToken);

    const { passwordHash, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const rawRefreshToken = req.cookies?.refresh_token;
    if (!rawRefreshToken) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(rawRefreshToken);
    } catch {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (decoded.type !== 'refresh' || !decoded.sessionId) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const session = await prisma.authSession.findUnique({
      where: { id: decoded.sessionId },
    });

    if (!session || session.revokedAt || new Date() > session.expiresAt) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (hashRefreshToken(rawRefreshToken) !== session.refreshTokenHash) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
    const newExpiresAt = new Date(Date.now() + ms(refreshExpiresIn));

    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, sessionId: session.id });
    const refreshTokenHash = hashRefreshToken(refreshToken);

    await prisma.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash,
        expiresAt: newExpiresAt,
        lastUsedAt: new Date(),
      },
    });

    setAuthCookies(res, accessToken, refreshToken);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const rawRefreshToken = req.cookies?.refresh_token;
    if (rawRefreshToken) {
      try {
        const decoded = verifyRefreshToken(rawRefreshToken);
        if (decoded?.sessionId) {
          await prisma.authSession.updateMany({
            where: { id: decoded.sessionId },
            data: { revokedAt: new Date() },
          });
        }
      } catch {
        // ignore invalid tokens during logout
      }
    }
    clearAuthCookies(res);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true },
  });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ user });
});

module.exports = router;
