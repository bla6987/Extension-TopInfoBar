// Counts how often a streamed message is reread and refreshed, using fake time.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { MessageCache } from '../message-cache.js';

class Element {
    constructor(text = '') { this.text = text; this.reads = 0; this.isConnected = true; }
    get textContent() { this.reads++; return this.text; }
    matches(selector) { return selector === '.mes_text'; }
    closest() { return this; }
    querySelectorAll() { return []; }
}
globalThis.Element = globalThis.HTMLElement = Element;
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };

function fixture(options) {
    const message = new Element('start');
    const chat = { querySelectorAll: () => [message], contains: () => true };
    const flushes = [];
    const cache = new MessageCache(chat, (updated, removed, state) => flushes.push({ updated, removed, state }), options);
    cache.init();
    const change = text => {
        message.text = text;
        cache.queueMutations([{ type: 'characterData', target: message, addedNodes: [], removedNodes: [] }]);
    };
    return { cache, message, flushes, change };
}

function withFakeTime(run) {
    return async () => {
        mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-05T12:00:00Z') });
        globalThis.requestAnimationFrame = fn => setTimeout(fn, 16);
        globalThis.cancelAnimationFrame = handle => clearTimeout(handle);
        try { await run(); } finally { mock.timers.reset(); }
    };
}

test('five seconds of 30 fps streaming refreshes about five times a second and keeps the last chunk', withFakeTime(() => {
    const { cache, message, flushes, change } = fixture();
    const chunks = 150;
    const readsAtStart = message.reads;
    let text = '';
    for (let i = 0; i < chunks; i++) {
        text += ` chunk${i}`;
        change(text);
        mock.timers.tick(33);
    }
    const duringStream = flushes.length;
    assert.ok(duringStream <= 5000 / 200 + 2, `${duringStream} refreshes for ${chunks} chunks`);
    assert.ok(message.reads - readsAtStart <= duringStream, `${message.reads - readsAtStart} full text reads`);

    // Nothing else arrives: the trailing refresh still applies the final text.
    mock.timers.tick(250);
    assert.equal(cache.findMatches([`chunk${chunks - 1}`]).length, 1);
    assert.ok(flushes.at(-1).updated.has(message));
    cache.destroy();
}));

test('a lone change after a quiet period still refreshes on the next frame', withFakeTime(() => {
    const { cache, flushes, change } = fixture();
    change('first');
    mock.timers.tick(16);
    assert.equal(flushes.length, 1);
    mock.timers.tick(1000);
    change('second');
    mock.timers.tick(16);
    assert.equal(flushes.length, 2);
    cache.destroy();
}));

test('completion applies queued text immediately, and does nothing when none is queued', withFakeTime(() => {
    const { cache, flushes, change } = fixture();
    change('first');
    mock.timers.tick(16);
    change('final text');
    assert.equal(flushes.length, 1);
    cache.flushPending();
    assert.equal(flushes.length, 2);
    assert.equal(cache.findMatches(['final text']).length, 1);
    cache.flushPending();
    mock.timers.tick(1000);
    assert.equal(flushes.length, 2, 'the replaced timer must not refresh again');
    cache.destroy();
}));

test('destroy cancels a waiting refresh and the next search starts without waiting', withFakeTime(() => {
    const { cache, flushes, change } = fixture();
    change('first');
    mock.timers.tick(16);
    change('second');
    cache.destroy();
    mock.timers.tick(1000);
    assert.equal(flushes.length, 1);
    assert.equal(cache.flushTimer, null);
    cache.init();
    change('third');
    mock.timers.tick(16);
    assert.equal(flushes.length, 2);
    cache.destroy();
}));

test('a streaming message that shows highlights refreshes every frame, so its marks do not flicker', withFakeTime(() => {
    const { cache, flushes, change } = fixture({ needsNextFrame: () => true });
    const chunks = 150;
    let text = '';
    for (let i = 0; i < chunks; i++) {
        text += ` chunk${i}`;
        change(text);
        mock.timers.tick(33);
    }
    assert.equal(flushes.length, chunks);
    cache.destroy();
}));

test('a message gaining highlights stops waiting for a refresh already scheduled', withFakeTime(() => {
    let highlighted = false;
    const { cache, flushes, change } = fixture({ needsNextFrame: () => highlighted });
    change('first');
    mock.timers.tick(16);
    assert.equal(flushes.length, 1);

    // Inside the interval, so this refresh is left waiting on the timer.
    change('second');
    mock.timers.tick(16);
    assert.equal(flushes.length, 1);

    highlighted = true;
    change('third');
    mock.timers.tick(16);
    assert.equal(flushes.length, 2);

    // Nothing is left scheduled to fire a second time for the same change.
    mock.timers.tick(1000);
    assert.equal(flushes.length, 2);
    cache.destroy();
}));
