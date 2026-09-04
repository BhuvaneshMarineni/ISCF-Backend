const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const ISSUER = process.env.JWT_ISSUER || 'iscfglobal';
const AUDIENCE = process.env.JWT_AUDIENCE || 'iscf-admin';

function ensureSecrets() {
  if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
    throw new Error('ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be set');
  }
}

function signAccessToken(payload) {
  ensureSecrets();
  return jwt.sign(
    { type: 'access', ...payload },
    ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
    }
  );
}

function verifyAccessToken(token) {
  ensureSecrets();
  return jwt.verify(token, ACCESS_TOKEN_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
}

function signRefreshToken(payload) {
  ensureSecrets();
  return jwt.sign(
    { type: 'refresh', ...payload },
    REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
    }
  );
}

function verifyRefreshToken(token) {
  ensureSecrets();
  return jwt.verify(token, REFRESH_TOKEN_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
};
