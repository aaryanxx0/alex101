import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, clampPitch, clampYaw, DEFAULT_SETTINGS, EMPTY_MOVEMENT, emptySnapshot, isValidChatMessage, isValidCoord, isValidMovementState, makeId, normalizeHotbarSlot, } from '../src/index.js';
test('clamp respects NaN', () => {
    assert.equal(clamp(Number.NaN, 0, 10), 0);
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-3, 0, 10), 0);
    assert.equal(clamp(99, 0, 10), 10);
});
test('clampPitch bounded [-90, 90]', () => {
    assert.equal(clampPitch(0), 0);
    assert.equal(clampPitch(180), 90);
    assert.equal(clampPitch(-180), -90);
    assert.equal(clampPitch(Number.NaN), -90);
});
test('clampYaw normalizes to (-180, 180]', () => {
    assert.equal(clampYaw(0), 0);
    assert.equal(clampYaw(181), -179);
    assert.equal(clampYaw(-181), 179);
    assert.equal(clampYaw(720), 0);
    assert.equal(clampYaw(Number.NaN), 0);
});
test('isValidMovementState accepts/partial keys', () => {
    assert.equal(isValidMovementState({ forward: true }), true);
    assert.equal(isValidMovementState({ forward: true, left: false }), true);
    assert.equal(isValidMovementState({ forward: 'yes' }), false);
    assert.equal(isValidMovementState({ bad: true }), false);
    assert.equal(isValidMovementState(null), false);
    assert.equal(isValidMovementState(42), false);
});
test('normalizeHotbarSlot floors and clamps', () => {
    assert.equal(normalizeHotbarSlot(0), 0);
    assert.equal(normalizeHotbarSlot(8), 8);
    assert.equal(normalizeHotbarSlot(9), 8);
    assert.equal(normalizeHotbarSlot(-1), 0);
    assert.equal(normalizeHotbarSlot(2.9), 2);
});
test('isValidCoord rejects non-finite', () => {
    assert.equal(isValidCoord(1), true);
    assert.equal(isValidCoord(-1.5), true);
    assert.equal(isValidCoord(Number.NaN), false);
    assert.equal(isValidCoord('1'), false);
});
test('isValidChatMessage limits length', () => {
    assert.equal(isValidChatMessage('hi'), true);
    assert.equal(isValidChatMessage(''), false);
    assert.equal(isValidChatMessage('a'.repeat(257)), false);
    assert.equal(isValidChatMessage(42), false);
});
test('DEFAULT_SETTINGS has Alex101 + mc.238458.xyz', () => {
    assert.equal(DEFAULT_SETTINGS.host, 'mc.238458.xyz');
    assert.equal(DEFAULT_SETTINGS.username, 'Alex101');
    assert.equal(DEFAULT_SETTINGS.version, '1.21.11');
    assert.equal(DEFAULT_SETTINGS.authMode, 'offline');
    assert.equal(DEFAULT_SETTINGS.autoReconnect, true);
});
test('emptySnapshot starts in OFFLINE with default target', () => {
    const s = emptySnapshot();
    assert.equal(s.connection.state, 'OFFLINE');
    assert.equal(s.connection.host, 'mc.238458.xyz');
    assert.equal(s.connection.username, undefined);
    assert.equal(s.connection.configuredUsername, 'Alex101');
    assert.equal(s.player.health, 20);
    assert.equal(s.player.food, 20);
    assert.equal(s.inventory.hotbar.length, 9);
    assert.equal(EMPTY_MOVEMENT.forward, false);
});
test('makeId produces unique strings', () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeId('log')));
    assert.equal(ids.size, 100);
});
//# sourceMappingURL=shared.test.js.map