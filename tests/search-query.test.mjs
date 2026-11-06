import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { compileSearchQuery, highlightMessage } from '../search-highlights.js';

test('a compiled query parses once, keeps OR terms and escapes regex characters', () => {
    const { query, terms, termsLower, pattern } = compileSearchQuery('Foo  a+b');
    assert.equal(query, 'Foo  a+b');
    assert.deepEqual(terms, ['Foo', 'a+b']);
    assert.deepEqual(termsLower, ['foo', 'a+b']);
    assert.ok(pattern.test('FOO') && pattern.test('xa+b'));
    assert.ok(!pattern.test('aab'));
    assert.equal(compileSearchQuery('').pattern, null);
});

test('highlighting many messages compiles one pattern for one query', () => {
    const element = { ownerDocument: { createTreeWalker: () => ({ nextNode: () => null }) } };
    const OriginalRegExp = globalThis.RegExp;
    let compiled = 0;
    globalThis.RegExp = class extends OriginalRegExp {
        constructor(...args) { super(...args); compiled++; }
    };
    try {
        const { pattern } = compileSearchQuery('needle');
        for (let i = 0; i < 100; i++) highlightMessage(element, pattern);
        assert.equal(compiled, 1);
    } finally {
        globalThis.RegExp = OriginalRegExp;
    }
});

test('one compiled pattern marks every message it is reused on', () => {
    const { window } = new JSDOM('<div id="chat"></div>');
    const chat = window.document.getElementById('chat');
    const { pattern } = compileSearchQuery('needle');
    for (let i = 0; i < 100; i++) {
        const message = window.document.createElement('div');
        message.textContent = `needle ${i}`;
        chat.appendChild(message);
        assert.equal(highlightMessage(message, pattern), 1);
    }
    assert.equal(chat.querySelectorAll('mark.extensionTopBarHighlight').length, 100);
    assert.equal(highlightMessage(chat, null), 0);
    window.close();
});
