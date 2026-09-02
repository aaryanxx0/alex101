import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, friendlyReason, isPermanent } from '../src/errorClassifier.js';
import { redact } from '../src/LogManager.js';

test('classifyError recognizes whitelist rejection', () => {
  assert.equal(classifyError('You are not on the whitelist of this server!'), 'WHITELIST_REJECTION');
});

test('classifyError recognizes ban', () => {
  assert.equal(classifyError('You are banned from this server.'), 'BANNED');
});

test('classifyError recognizes kick', () => {
  assert.equal(classifyError('You were kicked by an admin'), 'KICKED');
});

test('classifyError recognizes connection reset by code', () => {
  assert.equal(classifyError('read ECONNRESET', 'ECONNRESET'), 'CONNECTION_RESET');
});

test('classifyError recognizes DNS failure', () => {
  assert.equal(classifyError('lookup minecraft.server.com', 'ENOTFOUND'), 'DNS_RESOLUTION_ERROR');
});

test('classifyError recognizes unsupported protocol', () => {
  assert.equal(classifyError('Incompatible protocol version!'), 'UNSUPPORTED_PROTOCOL');
});

test('friendlyReason returns friendly text for known reasons', () => {
  assert.match(friendlyReason('WHITELIST_REJECTION'), /whitelist/);
  assert.match(friendlyReason('DNS_RESOLUTION_ERROR'), /resolve/);
});

test('isPermanent flags permanent reasons', () => {
  assert.equal(isPermanent('WHITELIST_REJECTION'), true);
  assert.equal(isPermanent('BANNED'), true);
  assert.equal(isPermanent('CONNECTION_TIMEOUT'), false);
  assert.equal(isPermanent('LOST_CONNECTION'), false);
});

test('redact removes token-like secrets', () => {
  const redacted = redact('access_token=abc.def.ghi Bearer eyABCD.efgh.ijkl');
  assert.match(redacted, /\[redacted\]/);
  assert.doesNotMatch(redacted, /abc\.def\.ghi/);
});