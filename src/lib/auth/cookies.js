const ms = require('ms');

const isProduction = process.env.NODE_ENV === 'production';

function parseMs(value, fallback) {
  if (!value) return fallback;
  try {
    return ms(value);
  } catch {
    return fallback;
  }
}

const accessMaxAge = parseMs(process.env.ACCESS_TOKEN_EXPIRES_IN, 15 * 60 * 1000);
const refreshMaxAge = parseMs(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000);

const cookieDefaults = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('access_token', accessToken, {
    ...cookieDefaults,
    maxAge: accessMaxAge,
  });
  res.cookie('refresh_token', refreshToken, {
    ...cookieDefaults,
    maxAge: refreshMaxAge,
  });
}

function clearAuthCookies(res) {
  res.clearCookie('access_token', { ...cookieDefaults });
  res.clearCookie('refresh_token', { ...cookieDefaults });
}

module.exports = { setAuthCookies, clearAuthCookies };
