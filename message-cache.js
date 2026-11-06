/**
 * Incremental cache of rendered SillyTavern message text.
 */
export class MessageCache {
    /**
     * @param {HTMLElement} chat Chat container
     * @param {(updatedMessages: Set<HTMLElement>, removedMessages: Set<HTMLElement>, state: {rebuilt: boolean, rerenderedMessages: Set<HTMLElement>}) => void} onChanged Cache change callback
     * @param {object} [options]
     * @param {number} [options.minFlushInterval] Minimum milliseconds between refreshes while mutations keep coming
     * @param {(element: HTMLElement) => boolean} [options.needsNextFrame] Messages whose refresh must not wait for the interval
     */
    constructor(chat, onChanged, { minFlushInterval = 200, needsNextFrame = () => false } = {}) {
        this.chat = chat;
        this.onChanged = onChanged;
        /** @type {Map<HTMLElement, string>} */
        this.messages = new Map();
        this.observer = null;
        // Never retain replaced streaming child nodes while animation frames
        // are suspended. A bounded dirty-message set is enough to rebuild text.
        this.pendingRemovedMessages = new Set();
        /** @type {Set<HTMLElement>} */
        this.pendingChangedMessages = new Set();
        this.flushHandle = null;
        this.flushTimer = null;
        this.needsRebuild = false;
        this.maxPendingMessages = 512;
        // Streaming rewrites a message many times per second. A lone change still refreshes on
        // the next frame; a burst refreshes once per interval and a trailing timer takes the rest.
        this.minFlushInterval = minFlushInterval;
        this.needsNextFrame = needsNextFrame;
        this.lastFlushAt = -Infinity;
    }

    /**
     * Initialize the cache and set up its mutation observer.
     */
    init() {
        if (this.observer) {
            return;
        }

        this.rebuild();
        this.observer = new MutationObserver(mutations => this.queueMutations(mutations));
        this.observer.observe(this.chat, { childList: true, characterData: true, subtree: true });
    }

    /**
     * Rebuild the cache from the current DOM.
     */
    rebuild() {
        this.messages.clear();
        for (const element of this.chat.querySelectorAll('.mes_text')) {
            if (element instanceof HTMLElement) {
                this.messages.set(element, element.textContent || '');
            }
        }
    }

    /**
     * Find cached messages containing at least one query term.
     * @param {string[]} queryTermsLower Lowercase query terms
     * @param {Iterable<HTMLElement>} [elements] Optional subset of cached elements to inspect
     * @returns {HTMLElement[]}
     */
    findMatches(queryTermsLower, elements = this.messages.keys()) {
        const patterns = queryTermsLower.map(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        const matching = [];
        for (const element of elements) {
            const textLower = this.messages.get(element);
            if (textLower !== undefined && patterns.some(pattern => pattern.test(textLower))) {
                matching.push(element);
            }
        }
        return matching;
    }

    /**
     * Queue DOM mutations for one incremental update on the next animation frame.
     * @param {MutationRecord[]} mutations Mutation records from the chat observer
     */
    queueMutations(mutations) {
        const queue = (set, element) => {
            if (this.needsRebuild) return;
            set.add(element);
            if (this.pendingChangedMessages.size + this.pendingRemovedMessages.size > this.maxPendingMessages) {
                this.pendingChangedMessages.clear();
                this.pendingRemovedMessages.clear();
                this.needsRebuild = true;
            }
        };
        const visitMessages = (node, callback) => {
            if (node instanceof HTMLElement && node.matches('.mes_text')) callback(node);
            if (node.querySelectorAll) for (const element of node.querySelectorAll('.mes_text')) callback(element);
        };
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.removedNodes.forEach(node => visitMessages(node, element => {
                    this.messages.delete(element);
                    queue(this.pendingRemovedMessages, element);
                }));
                if (!this.needsRebuild) mutation.addedNodes.forEach(node => visitMessages(node,
                    element => queue(this.pendingChangedMessages, element)));
            }

            const target = mutation.target instanceof Element
                ? mutation.target
                : mutation.target.parentElement;
            const containingMessage = target?.closest?.('.mes_text');
            if (containingMessage instanceof HTMLElement) {
                queue(this.pendingChangedMessages, containingMessage);
            }
        }

        const urgent = this.flushHandle === null && [...this.pendingChangedMessages].some(this.needsNextFrame);
        if (urgent && this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (this.flushHandle === null && this.flushTimer === null) {
            const wait = urgent ? 0 : this.lastFlushAt + this.minFlushInterval - Date.now();
            if (wait > 0) {
                this.flushTimer = setTimeout(() => this.flushMutations(), Math.min(wait, this.minFlushInterval));
                return;
            }
            this.flushHandle = requestAnimationFrame(() => this.flushMutations());
            // A background tab can stop animation frames. This fallback drains
            // bounded state when timers run; queue size stays capped either way.
            this.flushTimer = setTimeout(() => this.flushMutations(), 250);
        }
    }

    /**
     * Apply anything still queued now, without waiting for the next refresh.
     */
    flushPending() {
        const records = this.observer?.takeRecords();
        if (records?.length) this.queueMutations(records);
        if (this.flushHandle !== null || this.flushTimer !== null) this.flushMutations();
    }

    /**
     * Add every message element represented by a node to a set.
     * @param {Node} node Root node
     * @param {Set<HTMLElement>} elements Destination set
     */
    collectMessageElements(node, elements) {
        if (node instanceof HTMLElement && node.matches('.mes_text')) {
            elements.add(node);
        }

        if ('querySelectorAll' in node && typeof node.querySelectorAll === 'function') {
            for (const element of node.querySelectorAll('.mes_text')) {
                if (element instanceof HTMLElement) {
                    elements.add(element);
                }
            }
        }
    }

    /**
     * Apply queued mutations without rescanning unaffected messages.
     */
    flushMutations() {
        if (this.flushHandle !== null) cancelAnimationFrame(this.flushHandle);
        this.flushHandle = null;
        if (this.flushTimer !== null) clearTimeout(this.flushTimer);
        this.flushTimer = null;

        const rebuilt = this.needsRebuild;
        const removedMessages = new Set(this.pendingRemovedMessages);
        const changedMessages = new Set(this.pendingChangedMessages);
        this.pendingRemovedMessages.clear();
        this.pendingChangedMessages.clear();
        for (const element of this.messages.keys()) {
            if (!element.isConnected || !this.chat.contains(element)) {
                this.messages.delete(element);
                removedMessages.add(element);
            }
        }
        if (this.needsRebuild) {
            for (const element of this.chat.querySelectorAll('.mes_text')) changedMessages.add(element);
            this.needsRebuild = false;
        }

        const updatedMessages = new Set();
        // Touched but with the same text, possibly after changing and changing back: marks may be gone.
        const rerenderedMessages = new Set();
        for (const element of changedMessages) {
            if (!element.isConnected || !this.chat.contains(element)) {
                continue;
            }

            const textLower = element.textContent || '';
            if (!this.messages.has(element) || this.messages.get(element) !== textLower) {
                this.messages.set(element, textLower);
                updatedMessages.add(element);
            } else {
                rerenderedMessages.add(element);
            }
        }

        this.onChanged(updatedMessages, removedMessages, { rebuilt, rerenderedMessages });
        // Highlighting only wraps existing text, so discard those observer records.
        this.observer?.takeRecords();
        this.lastFlushAt = Date.now();
    }

    /**
     * Clear cached messages and pending mutations.
     */
    clear() {
        this.messages.clear();
        this.pendingRemovedMessages.clear();
        this.pendingChangedMessages.clear();
        this.needsRebuild = false;
    }

    /**
     * Stop observing the chat and release cached message text.
     */
    destroy() {
        this.observer?.disconnect();
        this.observer = null;
        if (this.flushHandle !== null) {
            cancelAnimationFrame(this.flushHandle);
            this.flushHandle = null;
        }
        if (this.flushTimer !== null) clearTimeout(this.flushTimer);
        this.flushTimer = null;
        this.lastFlushAt = -Infinity;
        this.clear();
    }
}
