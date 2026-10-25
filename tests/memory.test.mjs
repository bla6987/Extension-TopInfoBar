import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageCache } from '../message-cache.js';
import { selectHighlightMessages, MAX_HIGHLIGHT_MESSAGES } from '../search-highlights.js';

class Element {
    constructor(text = '') { this.textContent = text; this.isConnected = true; }
    matches(selector) { return selector === '.mes_text'; }
    closest() { return this; }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { top: 0, bottom: 10 }; }
}
globalThis.Element = globalThis.HTMLElement = Element;
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

function fixture(count = 1000) {
    const elements = Array.from({ length: count }, (_, i) => new Element(`matching message ${i}`));
    const chat = { querySelectorAll: () => elements.filter(e => e.isConnected), contains: e => elements.includes(e) && e.isConnected };
    const changes = [];
    const cache = new MessageCache(chat, (updated, removed, state) => changes.push({ updated, removed, state }));
    cache.init();
    return { cache, elements, changes };
}

test('ten thousand streamed replacements retain only one dirty message while frames are withheld', () => {
    const { cache, elements } = fixture();
    const message = elements[0];
    for (let i = 0; i < 10000; i++) cache.queueMutations([{ type: 'childList', target: message,
        addedNodes: [{ textContent: `new ${i}` }], removedNodes: [{ textContent: `old ${i}` }] }]);
    assert.equal(cache.pendingChangedMessages.size, 1);
    assert.equal(cache.pendingRemovedMessages.size, 0);
    assert.equal(cache.pendingAddedNodes, undefined);
    assert.equal(cache.pendingRemovedNodes, undefined);
    message.textContent = 'final streamed text';
    cache.flushMutations();
    assert.equal(cache.findMatches(['final streamed']).length, 1);
    cache.destroy();
});

test('overflow falls back to a complete rebuild and removes every detached message', () => {
    const { cache, elements, changes } = fixture();
    for (const message of elements) {
        message.isConnected = false;
        cache.queueMutations([{ type: 'childList', target: { parentElement: null }, addedNodes: [], removedNodes: [message] }]);
    }
    for (let i = 0; i < 2000; i++) {
        const message = new Element(`replacement matching ${i}`); elements.push(message);
        cache.queueMutations([{ type: 'childList', target: { parentElement: null }, addedNodes: [message], removedNodes: [] }]);
        assert.ok(cache.pendingChangedMessages.size + cache.pendingRemovedMessages.size <= cache.maxPendingMessages);
    }
    cache.flushMutations();
    assert.equal(cache.messages.size, 2000);
    assert.equal(cache.findMatches(['matching']).length, 2000);
    assert.equal(changes.at(-1).state.rebuilt, true, 'consumers must discard old result membership on overflow');
    cache.destroy();
    assert.equal(cache.flushTimer, null);
    assert.equal(cache.messages.size, 0);
});

test('highlight residency is bounded while the full matching-message set stays available', () => {
    const { cache, elements } = fixture();
    const matches = cache.findMatches(['matching']);
    const selected = selectHighlightMessages(matches, 999, { top: 0, bottom: 100 });
    assert.equal(selected.length, MAX_HIGHLIGHT_MESSAGES);
    assert.equal(selected[0], elements[999], 'navigation can reach the last result beyond the visible budget');
    assert.equal(matches.length, 1000);
    cache.destroy();
});
