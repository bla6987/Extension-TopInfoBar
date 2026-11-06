import test from 'node:test';
import assert from 'node:assert/strict';
import { SideBarRefresher } from '../sidebar-refresh.js';

function fixture() {
    const state = { owner: 'character:1', chat: 'chat-1', visible: true };
    const loads = [];
    const renders = [];
    const refresher = new SideBarRefresher({
        getOwnerKey: () => state.owner,
        getChatId: () => state.chat,
        isVisible: () => state.visible,
        loadChats: () => new Promise((resolve, reject) => {
            loads.push({ owner: state.owner, chat: state.chat, resolve, reject });
        }),
        render: (chats, chatId) => renders.push({ chats, chatId, owner: state.owner }),
    });
    return { state, loads, renders, refresher };
}

test('refreshes for an unchanged chat share one list request and one render', async () => {
    const { loads, renders, refresher } = fixture();
    const calls = Array.from({ length: 5 }, () => refresher.refresh());
    assert.equal(loads.length, 1);
    loads[0].resolve(['a']);
    await Promise.all(calls);
    assert.deepEqual(renders.map(r => r.chats), [['a']]);
});

test('a finished request is not reused: the next refresh loads again', async () => {
    const { loads, renders, refresher } = fixture();
    const first = refresher.refresh();
    loads[0].resolve(['a']);
    await first;
    const second = refresher.refresh();
    assert.equal(loads.length, 2);
    loads[1].resolve(['a', 'b']);
    await second;
    assert.equal(renders.at(-1).chats.length, 2);
});

test('closing the sidebar discards the pending list without building rows', async () => {
    const { state, loads, renders, refresher } = fixture();
    const pending = refresher.refresh();
    state.visible = false;
    loads[0].resolve(['a']);
    await pending;
    assert.equal(renders.length, 0);
    assert.equal(refresher.pending, null);
});

test('reopening before the list arrives reuses the request and renders once', async () => {
    const { state, loads, renders, refresher } = fixture();
    const first = refresher.refresh();
    state.visible = false;
    state.visible = true;
    const second = refresher.refresh();
    assert.equal(loads.length, 1);
    loads[0].resolve(['a']);
    await Promise.all([first, second]);
    assert.equal(renders.length, 1);
});

test('a list for the previous owner never renders, and the new owner does not wait for it', async () => {
    const { state, loads, renders, refresher } = fixture();
    const a = refresher.refresh();
    state.owner = 'character:2';
    state.chat = 'b-chat';
    const b = refresher.refresh();
    assert.equal(loads.length, 2);
    assert.equal(loads[1].owner, 'character:2');
    loads[1].resolve(['b']);
    await b;
    loads[0].resolve(['a']);
    await a;
    assert.deepEqual(renders.map(r => [r.chats[0], r.chatId, r.owner]), [['b', 'b-chat', 'character:2']]);
});

test('a list arriving after the owner changed but before any refresh is discarded', async () => {
    const { state, loads, renders, refresher } = fixture();
    const pending = refresher.refresh();
    state.owner = 'group:7';
    loads[0].resolve(['a']);
    await pending;
    assert.equal(renders.length, 0);
});

test('switching chats under one owner loads at most once more, for the latest chat', async () => {
    const { state, loads, renders, refresher } = fixture();
    const calls = [refresher.refresh()];
    for (const chat of ['chat-2', 'chat-3', 'chat-4']) {
        state.chat = chat;
        calls.push(refresher.refresh());
    }
    assert.equal(loads.length, 1);
    loads[0].resolve(['stale']);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders.length, 0, 'the stale list renders nothing');
    assert.equal(loads.length, 2);
    assert.equal(loads[1].chat, 'chat-4');
    loads[1].resolve(['fresh']);
    await Promise.all(calls);
    assert.deepEqual(renders.map(r => [r.chats[0], r.chatId]), [['fresh', 'chat-4']]);
});

test('a change to the chat list invalidates a request for the same chat', async () => {
    const { loads, renders, refresher } = fixture();
    const first = refresher.refresh();
    refresher.invalidate();
    const calls = [refresher.refresh(), refresher.refresh(), refresher.refresh()];
    assert.equal(loads.length, 1);
    loads[0].resolve(['deleted', 'kept']);
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders.length, 0);
    assert.equal(loads.length, 2);
    loads[1].resolve(['kept']);
    await Promise.all(calls);
    assert.deepEqual(renders.map(r => r.chats), [['kept']]);
});

test('an invalidation with no later refresh still discards the running request', async () => {
    const { loads, renders, refresher } = fixture();
    const pending = refresher.refresh();
    refresher.invalidate();
    loads[0].resolve(['a']);
    await pending;
    assert.equal(renders.length, 0);
    assert.equal(loads.length, 1);
});

test('no rerun is fetched if the sidebar closed meanwhile', async () => {
    const { state, loads, refresher } = fixture();
    refresher.refresh();
    refresher.invalidate();
    const rerun = refresher.refresh();
    state.visible = false;
    loads[0].resolve([]);
    await rerun;
    assert.equal(loads.length, 1);
});

test('a failed request rejects, clears the pending entry and leaves the next refresh free to retry', async () => {
    const { loads, renders, refresher } = fixture();
    const failed = refresher.refresh();
    loads[0].reject(new Error('offline'));
    await assert.rejects(failed, /offline/);
    assert.equal(refresher.pending, null);
    const retry = refresher.refresh();
    assert.equal(loads.length, 2);
    loads[1].resolve(['a']);
    await retry;
    assert.equal(renders.length, 1);
});

test('a failed request still runs the rerun that was waiting for it', async () => {
    const { loads, renders, refresher } = fixture();
    const failed = refresher.refresh();
    refresher.invalidate();
    const rerun = refresher.refresh();
    loads[0].reject(new Error('offline'));
    await assert.rejects(failed, /offline/);
    await new Promise(resolve => setImmediate(resolve));
    loads[1].resolve(['a']);
    await rerun;
    assert.equal(renders.length, 1);
});
