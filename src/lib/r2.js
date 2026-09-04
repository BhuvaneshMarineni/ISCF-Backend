const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

const R2_ENDPOINT = R2_ACCOUNT_ID
  ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : undefined;

const PRESIGN_TTL_SECONDS = 300; // 5 minutes

const client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const TYPE_PREFIX = {
  event: 'events',
  gallery: 'gallery',
  story: 'stories',
};

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function assertConfigured() {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.');
  }
}

function resolvePrefix(type, parentId) {
  const prefix = TYPE_PREFIX[type];
  if (!prefix) {
    throw new Error(`Unsupported upload type: ${type}`);
  }
  if (!parentId) {
    throw new Error('parentId is required');
  }
  return `${prefix}/${parentId}`;
}

function generateObjectKey(type, parentId, contentType) {
  const prefix = resolvePrefix(type, parentId);
  const ext = EXT_BY_CONTENT_TYPE[contentType];
  if (!ext) {
    throw new Error(`Unsupported contentType: ${contentType}`);
  }
  const id = crypto.randomUUID();
  return `${prefix}/${id}.${ext}`;
}

async function createPresignedPutUrl(imageKey, contentType) {
  assertConfigured();
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: imageKey,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: PRESIGN_TTL_SECONDS });
}

function getPublicImageUrl(imageKey) {
  if (!imageKey) return null;
  if (!R2_PUBLIC_BASE_URL) {
    throw new Error('R2_PUBLIC_BASE_URL is not configured');
  }
  const base = R2_PUBLIC_BASE_URL.replace(/\/+$/, '');
  const key = imageKey.replace(/^\/+/, '');
  return `${base}/${key}`;
}

async function deleteR2Object(imageKey) {
  assertConfigured();
  if (!imageKey) return;
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: imageKey,
  });
  await client.send(command);
}

async function deleteMultipleR2Objects(imageKeys) {
  const results = await Promise.allSettled(imageKeys.map(deleteR2Object));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    throw new Error(`Failed to delete ${failures.length} object(s) from R2`);
  }
}

module.exports = {
  client,
  ALLOWED_CONTENT_TYPES,
  createPresignedPutUrl,
  generateObjectKey,
  getPublicImageUrl,
  deleteR2Object,
  deleteMultipleR2Objects,
};
