const { Router } = require('express');
const { z } = require('zod');
const requireManager = require('../lib/auth/requireManager');
const {
  ALLOWED_CONTENT_TYPES,
  createPresignedPutUrl,
  generateObjectKey,
} = require('../lib/r2');

const router = Router();

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const presignSchema = z.object({
  type: z.enum(['event', 'gallery', 'story']),
  parentId: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});

router.post('/presign', requireManager, async (req, res, next) => {
  try {
    const parsed = presignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { type, parentId, fileName, contentType, size } = parsed.data;

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return res.status(400).json({ error: 'Unsupported content type' });
    }
    if (size > MAX_BYTES) {
      return res.status(400).json({ error: 'File too large. Max 10 MB.' });
    }

    // Never trust the original filename as the object key.
    const imageKey = generateObjectKey(type, parentId, contentType);
    const uploadUrl = await createPresignedPutUrl(imageKey, contentType);

    res.status(200).json({ uploadUrl, imageKey });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
