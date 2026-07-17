'use strict';

const crypto = require('crypto');

function configuredKey() {
  const key = String(process.env.PODWAFFLE_ACCESS_KEY || '').trim();
  return key === 'null' ? '' : key;
}

function isRequired() {
  return configuredKey().length > 0;
}

function extractHttpKey(req) {
  const explicit = req.get('x-podwaffle-key');
  if (explicit) return String(explicit).trim();
  const authorization = String(req.get('authorization') || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function matches(candidate) {
  const expected = configuredKey();
  if (!expected) return true;
  const actual = String(candidate || '');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function requireHttpAccess(req, res, next) {
  if (matches(extractHttpKey(req))) return next();
  res.setHeader('WWW-Authenticate', 'Bearer realm="Podwaffle"');
  return res.status(401).json({ error: 'Access key required' });
}

module.exports = {
  isRequired,
  matches,
  extractHttpKey,
  requireHttpAccess,
};
