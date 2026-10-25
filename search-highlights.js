/** Scoped, bounded highlights; other extensions' jQuery plugins remain untouched. */
export const MAX_HIGHLIGHT_MESSAGES = 20;
export const MAX_HIGHLIGHTS_PER_MESSAGE = 50;
const MARK_CLASS = 'extensionTopBarHighlight';

export function clearMessageHighlights(element) {
    for (const mark of element.querySelectorAll(`mark.${MARK_CLASS}`)) {
        const parent = mark.parentNode;
        mark.replaceWith(...mark.childNodes);
        parent?.normalize();
    }
}

export function highlightMessage(element, terms, limit = MAX_HIGHLIGHTS_PER_MESSAGE) {
    const words = terms.filter(Boolean).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length || limit < 1) return 0;
    const pattern = new RegExp(words.join('|'), 'i');
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, 4, {
        acceptNode: node => node.parentElement?.closest(`script,style,textarea,mark.${MARK_CLASS}`) ? 2 : 1,
    });
    let count = 0;
    while (count < limit) {
        const node = walker.nextNode();
        if (!node) break;
        const match = pattern.exec(node.data);
        if (!match?.[0]) continue;
        const word = node.splitText(match.index);
        word.splitText(match[0].length);
        const mark = doc.createElement('mark');
        mark.className = `highlight ${MARK_CLASS}`;
        word.parentNode.replaceChild(mark, word);
        mark.appendChild(word);
        count++;
    }
    return count;
}

/** Full matches stay with the caller; only visible messages and the current hit get DOM marks. */
export function selectHighlightMessages(matches, selected, bounds) {
    const chosen = [];
    const active = matches[selected];
    if (active?.isConnected) chosen.push(active);
    for (const element of matches) {
        if (chosen.length >= MAX_HIGHLIGHT_MESSAGES) break;
        if (!element.isConnected || element === active) continue;
        const rect = element.getBoundingClientRect();
        if (rect.bottom >= bounds.top && rect.top <= bounds.bottom) chosen.push(element);
    }
    return chosen;
}
