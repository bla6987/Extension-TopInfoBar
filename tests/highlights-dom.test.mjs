import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { highlightMessage, clearMessageHighlights, MAX_HIGHLIGHTS_PER_MESSAGE } from '../search-highlights.js';

test('common search terms create bounded marks and clearing restores exact text', () => {
    const { window } = new JSDOM('<div id="message"></div>');
    const message = window.document.getElementById('message');
    message.textContent = 'match '.repeat(10000);
    const before = message.textContent;
    assert.equal(highlightMessage(message, ['match']), MAX_HIGHLIGHTS_PER_MESSAGE);
    assert.equal(message.querySelectorAll('mark.extensionTopBarHighlight').length, MAX_HIGHLIGHTS_PER_MESSAGE);
    assert.equal(message.textContent, before);
    clearMessageHighlights(message);
    assert.equal(message.textContent, before);
    assert.equal(message.querySelectorAll('mark').length, 0);
    window.close();
});

test('regex characters remain literal and unrelated extension highlights survive cleanup', () => {
    const { window } = new JSDOM('<div id="message"><span>a+b [x] aab x</span><mark class="other">keep</mark><script>a+b</script></div>');
    const message = window.document.getElementById('message');
    const before = message.textContent;
    assert.equal(highlightMessage(message, ['a+b', '[x]']), 2);
    clearMessageHighlights(message);
    assert.equal(message.textContent, before);
    assert.equal(message.querySelector('mark.other').textContent, 'keep');
    window.close();
});
