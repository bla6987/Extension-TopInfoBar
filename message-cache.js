/**
 * Incremental cache of rendered SillyTavern message text.
 */
export class MessageCache {
    /**
     * @param {HTMLElement} chat Chat container
     * @param {(updatedMessages: Set<HTMLElement>, removedMessages: Set<HTMLElement>) => void} onChanged Cache change callback
     */
    constructor(chat, onChanged) {
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
                this.messages.set(element, element.textContent?.toLowerCase() || '');
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
        const matching = [];
        for (const element of elements) {
            const textLower = this.messages.get(element);
            if (textLower !== undefined && queryTermsLower.some(term => textLower.includes(term))) {
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

        if (this.flushHandle === null) {
            this.flushHandle = requestAnimationFrame(() => this.flushMutations());
            // A background tab can stop animation frames. This fallback drains
            // bounded state when timers run; queue size stays capped either way.
            this.flushTimer = setTimeout(() => this.flushMutations(), 250);
        }
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
        for (const element of changedMessages) {
            if (!element.isConnected || !this.chat.contains(element)) {
                continue;
            }

            const textLower = element.textContent?.toLowerCase() || '';
            if (!this.messages.has(element) || this.messages.get(element) !== textLower) {
                this.messages.set(element, textLower);
                updatedMessages.add(element);
            }
        }

        this.onChanged(updatedMessages, removedMessages, { rebuilt });
        // Highlighting only wraps existing text, so discard those observer records.
        this.observer?.takeRecords();
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
        this.clear();
    }
}
