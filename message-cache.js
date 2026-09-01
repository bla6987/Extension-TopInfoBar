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
        /** @type {Set<Node>} */
        this.pendingAddedNodes = new Set();
        /** @type {Set<Node>} */
        this.pendingRemovedNodes = new Set();
        /** @type {Set<HTMLElement>} */
        this.pendingChangedMessages = new Set();
        this.flushHandle = null;
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
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => this.pendingAddedNodes.add(node));
                mutation.removedNodes.forEach(node => this.pendingRemovedNodes.add(node));
            }

            const target = mutation.target instanceof Element
                ? mutation.target
                : mutation.target.parentElement;
            const containingMessage = target?.closest?.('.mes_text');
            if (containingMessage instanceof HTMLElement) {
                this.pendingChangedMessages.add(containingMessage);
            }
        }

        if (this.flushHandle === null) {
            this.flushHandle = requestAnimationFrame(() => this.flushMutations());
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
        this.flushHandle = null;

        const addedMessages = new Set();
        const removedMessages = new Set();
        this.pendingAddedNodes.forEach(node => this.collectMessageElements(node, addedMessages));
        this.pendingRemovedNodes.forEach(node => this.collectMessageElements(node, removedMessages));

        const changedMessages = new Set([...addedMessages, ...this.pendingChangedMessages]);
        this.pendingAddedNodes.clear();
        this.pendingRemovedNodes.clear();
        this.pendingChangedMessages.clear();

        for (const element of removedMessages) {
            this.messages.delete(element);
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

        this.onChanged(updatedMessages, removedMessages);
        // Highlighting only wraps existing text, so discard those observer records.
        this.observer?.takeRecords();
    }

    /**
     * Clear cached messages and pending mutations.
     */
    clear() {
        this.messages.clear();
        this.pendingAddedNodes.clear();
        this.pendingRemovedNodes.clear();
        this.pendingChangedMessages.clear();
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
        this.clear();
    }
}
