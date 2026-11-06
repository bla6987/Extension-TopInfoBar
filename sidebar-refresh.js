/**
 * Single-flight loading of the sidebar's chat list.
 * One list request runs per owner (character or group). A refresh joins it while nothing has
 * changed since it started; otherwise it reruns once after it settles, so the rows shown always
 * come from a list requested after the last change, however many refreshes arrive meanwhile.
 * A result is discarded if the sidebar closed, the chat moved on, or newer work replaced it.
 */
export class SideBarRefresher {
    /**
     * @param {object} options
     * @param {() => string} options.getOwnerKey Current character or group
     * @param {() => string|undefined} options.getChatId Current chat
     * @param {() => boolean} options.isVisible Whether the sidebar is open
     * @param {() => Promise<object[]>} options.loadChats Fetch the current owner's chat list
     * @param {(chats: object[], chatId: string|undefined) => void} options.render Publish the rows
     */
    constructor({ getOwnerKey, getChatId, isVisible, loadChats, render }) {
        this.getOwnerKey = getOwnerKey;
        this.getChatId = getChatId;
        this.isVisible = isVisible;
        this.loadChats = loadChats;
        this.render = render;
        this.generation = 0;
        /** @type {{ownerKey: string, chatId: string|undefined, generation: number, promise: Promise<void>, rerun: Promise<void>|null}|null} */
        this.pending = null;
    }

    /**
     * The chat list may have changed: results of requests made so far must not be used.
     */
    invalidate() {
        this.generation++;
    }

    /**
     * Load and render the current owner's list, sharing any request still valid for it.
     * @returns {Promise<void>} Settles once the list this refresh depends on was handled
     */
    refresh() {
        const ownerKey = this.getOwnerKey();
        const chatId = this.getChatId();
        const running = this.pending;

        if (running?.ownerKey === ownerKey) {
            if (running.generation === this.generation && running.chatId === chatId) {
                return running.promise;
            }
            const rerun = () => (this.isVisible() ? this.refresh() : undefined);
            running.rerun ??= running.promise.then(rerun, rerun);
            return running.rerun;
        }

        // Another owner's request cannot be cancelled, only ignored; never make this owner wait for it.
        const generation = ++this.generation;
        const request = { ownerKey, chatId, generation, promise: null, rerun: null };
        request.promise = (async () => {
            const chats = await this.loadChats();
            if (generation === this.generation && this.isVisible()
                && this.getOwnerKey() === ownerKey && this.getChatId() === chatId) {
                this.render(chats, chatId);
            }
        })().finally(() => {
            if (this.pending === request) {
                this.pending = null;
            }
        });
        this.pending = request;
        return request.promise;
    }
}
