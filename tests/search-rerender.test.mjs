// Real MessageCache and highlighter in one DOM, wired the way the search controller wires them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { MessageCache } from '../message-cache.js';
import { compileSearchQuery, highlightMessage, clearMessageHighlights, forgetWipedHighlights } from '../search-highlights.js';

function fixture() {
    const { window } = new JSDOM('<div id="chat"><div class="mes_text"><p>a needle here</p></div></div>', { pretendToBeVisual: true });
    Object.assign(globalThis, { HTMLElement: window.HTMLElement, Element: window.Element, MutationObserver: window.MutationObserver,
        requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window) });
    const chat = window.document.getElementById('chat');
    const message = chat.querySelector('.mes_text');
    const { pattern } = compileSearchQuery('needle');
    const highlighted = new Set();
    let renders = 0;
    const render = () => {
        renders++;
        if (highlighted.has(message)) return;
        highlightMessage(message, pattern);
        highlighted.add(message);
    };
    const cache = new MessageCache(chat, (updated, removed, { rerenderedMessages }) => {
        forgetWipedHighlights(highlighted, rerenderedMessages);
        for (const element of updated) {
            clearMessageHighlights(element);
            highlighted.delete(element);
        }
        render();
    });
    cache.init();
    render();
    cache.observer.takeRecords();
    const marks = () => [...message.querySelectorAll('mark.extensionTopBarHighlight')];
    assert.equal(marks().length, 1);
    return { window, cache, message, marks, renders: () => renders };
}

test('a rerender with identical text restores the wiped marks', () => {
    const { window, cache, message, marks } = fixture();
    message.innerHTML = '<p>a <em>needle</em> here</p>';
    assert.equal(marks().length, 0);
    cache.flushPending();
    assert.equal(marks().length, 1);
    assert.equal(message.textContent, 'a needle here');
    cache.destroy();
    window.close();
});

test('text that changes and changes back between refreshes also gets its marks back', () => {
    const { window, cache, message, marks } = fixture();
    message.innerHTML = '<p>something else entirely</p>';
    cache.queueMutations(cache.observer.takeRecords());
    message.innerHTML = '<p>a needle here</p>';
    cache.flushPending();
    assert.equal(marks().length, 1);
    cache.destroy();
    window.close();
});

test('restoring marks does not trigger another refresh', async () => {
    const { window, cache, message, renders } = fixture();
    message.innerHTML = '<p>a needle here</p>';
    cache.flushPending();
    const after = renders();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(cache.flushTimer, null);
    assert.equal(cache.flushHandle, null);
    assert.equal(renders(), after);
    cache.destroy();
    window.close();
});

test('an unrelated change inside a message leaves intact marks alone', () => {
    const { window, cache, message, marks } = fixture();
    const mark = marks()[0];
    message.appendChild(window.document.createElement('span'));
    cache.flushPending();
    assert.equal(marks()[0], mark, 'the same mark node stays in place');
    cache.destroy();
    window.close();
});
