import { MessageCache } from '../message-cache.js';

const chat = document.getElementById('chat');
const result = document.getElementById('result');
const changes = [];

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createMessage(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mes';
    const message = document.createElement('div');
    message.className = 'mes_text';
    message.textContent = text;
    wrapper.appendChild(message);
    return wrapper;
}

function settleMutations() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

try {
    const initialMessages = document.createDocumentFragment();
    for (let index = 0; index < 1000; index++) {
        initialMessages.appendChild(createMessage(`Message ${index}`));
    }
    chat.appendChild(initialMessages);

    const cache = new MessageCache(chat, (updated, removed) => {
        if (updated.size > 0 || removed.size > 0) {
            changes.push({ updated: updated.size, removed: removed.size });
        }
    });
    cache.init();

    assert(cache.messages.size === 1000, 'Initial cache should contain all rendered messages');
    assert(cache.findMatches(['message 999']).length === 1, 'Initial substring search should match');

    chat.appendChild(createMessage('New incremental message'));
    await settleMutations();
    assert(cache.messages.size === 1001, 'Appending should add one cache entry');
    assert(changes.at(-1)?.updated === 1, 'Appending should update only the new message');

    const firstMessage = chat.querySelector('.mes_text');
    firstMessage.firstChild.data = 'Edited message zero';
    await settleMutations();
    assert(changes.at(-1)?.updated === 1, 'Editing should update only the edited message');
    assert(cache.findMatches(['edited message zero']).length === 1, 'Edited text should be searchable');

    const changeCountBeforeHighlight = changes.length;
    const mark = document.createElement('mark');
    mark.className = 'highlight';
    mark.textContent = 'Edited';
    firstMessage.replaceChildren(mark, document.createTextNode(' message zero'));
    await settleMutations();
    assert(changes.length === changeCountBeforeHighlight, 'Highlight wrappers should not invalidate cached text');

    firstMessage.closest('.mes').remove();
    await settleMutations();
    assert(cache.messages.size === 1000, 'Removing a message should remove its cache entry');
    assert(changes.at(-1)?.removed === 1, 'Removing should report only the removed message');

    const bulkMessages = document.createDocumentFragment();
    for (let index = 0; index < 50; index++) {
        bulkMessages.appendChild(createMessage(`Bulk-${index}`));
    }
    chat.appendChild(bulkMessages);
    await settleMutations();
    assert(cache.messages.size === 1050, 'Bulk insertion should add every new message');
    assert(changes.at(-1)?.updated === 50, 'Bulk insertion should be coalesced into one cache update');
    assert(cache.findMatches(['bulk-']).length === 50, 'Bulk-added messages should be searchable');

    cache.destroy();
    assert(cache.messages.size === 0, 'Destroy should release cached text');
    assert(cache.observer === null, 'Destroy should disconnect the observer');

    const summary = {
        status: 'passed',
        assertions: 14,
        nonEmptyMutationBatches: changes.length,
    };
    result.dataset.status = 'passed';
    result.textContent = JSON.stringify(summary, null, 2);
} catch (error) {
    result.dataset.status = 'failed';
    result.textContent = error.stack || error.message;
    throw error;
}
