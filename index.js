const {
    eventSource,
    event_types,
    getCurrentChatId,
    renameChat,
    getRequestHeaders,
    openGroupChat,
    openCharacterChat,
    executeSlashCommandsWithOptions,
    Popup,
} = SillyTavern.getContext();
import { addJQueryHighlight } from './jquery-highlight.js';
import { getGroupPastChats } from '../../../group-chats.js';
import { getPastCharacterChats, animation_duration, animation_easing, getGeneratingApi } from '../../../../script.js';
import { debounce, timestampToMoment, sortMoments, uuidv4, waitUntilCondition } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import { t } from '../../../i18n.js';
import { MessageCache } from './message-cache.js';

const movingDivs = /** @type {HTMLDivElement} */ (document.getElementById('movingDivs'));
const sheld = /** @type {HTMLDivElement} */ (document.getElementById('sheld'));
const chat = /** @type {HTMLDivElement} */ (document.getElementById('chat'));
const draggableTemplate = /** @type {HTMLTemplateElement} */ (document.getElementById('generic_draggable_template'));
const apiBlock = /** @type {HTMLDivElement} */ (document.getElementById('rm_api_block'));

const messageCache = new MessageCache(chat, onMessageCacheChanged);

const topBar = document.createElement('div');
const chatName = document.createElement('select');
const searchInput = document.createElement('input');
/** @type {Set<HTMLElement>} */
const highlightedMessages = new Set();
const connectionProfiles = document.createElement('div');
const connectionProfilesStatus = document.createElement('div');
const connectionProfilesSelect = document.createElement('select');
const connectionProfilesIcon = document.createElement('img');

let chatSelectorContextKey = null;
let loadedChatSelectorContextKey = null;
let chatSelectorLoadGeneration = 0;
let chatSelectorLoadPromise = null;

const icons = [
    {
        id: 'extensionTopBarToggleSidebar',
        icon: 'fa-fw fa-solid fa-box-archive',
        position: 'left',
        title: t`Toggle sidebar`,
        onClick: onToggleSidebarClick,
    },
    {
        id: 'extensionTopBarToggleConnectionProfiles',
        icon: 'fa-fw fa-solid fa-plug',
        position: 'left',
        title: t`Show connection profiles`,
        isTemporaryAllowed: true,
        onClick: onToggleConnectionProfilesClick,
    },
    {
        id: 'extensionTopBarChatManager',
        icon: 'fa-fw fa-solid fa-address-book',
        position: 'right',
        title: t`View chat files`,
        isTemporaryAllowed: true,
        onClick: onChatManagerClick,
    },
    {
        id: 'extensionTopBarNewChat',
        icon: 'fa-fw fa-solid fa-comments',
        position: 'right',
        title: t`New chat`,
        isTemporaryAllowed: true,
        onClick: onNewChatClick,
    },
    {
        id: 'extensionTopBarRenameChat',
        icon: 'fa-fw fa-solid fa-edit',
        position: 'right',
        title: t`Rename chat`,
        onClick: onRenameChatClick,
    },
    {
        id: 'extensionTopBarDeleteChat',
        icon: 'fa-fw fa-solid fa-trash',
        position: 'right',
        title: t`Delete chat`,
        onClick: async () => {
            const confirm = await Popup.show.confirm(t`Are you sure?`);
            if (confirm) {
                await executeSlashCommandsWithOptions('/delchat');
            }
        },
    },
    {
        id: 'extensionTopBarCloseChat',
        icon: 'fa-fw fa-solid fa-times',
        position: 'right',
        title: t`Close chat`,
        isTemporaryAllowed: true,
        onClick: onCloseChatClick,
    },
];

function onChatManagerClick() {
    document.getElementById('option_select_chat')?.click();
}

function onCloseChatClick() {
    document.getElementById('option_close_chat')?.click();
}

function onNewChatClick() {
    document.getElementById('option_start_new_chat')?.click();
}

async function onRenameChatClick() {
    const currentChatName = getCurrentChatId();

    if (!currentChatName) {
        return;
    }

    const newChatName = await Popup.show.input(t`Enter new chat name`, null, currentChatName);

    if (!newChatName || newChatName === currentChatName) {
        return;
    }

    await renameChat(currentChatName, String(newChatName));
}

function patchSheldIfNeeded() {
    // Fun fact: sheld is a typo. It should be shell.
    // It was fixed in OG TAI long ago, but we still have it here.
    if (!sheld) {
        console.error('Sheld not found. Did you finally rename it?');
        return;
    }

    const computedStyle = getComputedStyle(sheld);
    // Alert: We're not in a version that switched sheld to flex yet.
    if (computedStyle.display === 'grid') {
        sheld.classList.add('flexPatch');
    }
}

function getChatSelectorContextKey(context = SillyTavern.getContext()) {
    if (context.groupId) {
        return `group:${context.groupId}`;
    }

    if (context.characterId !== undefined) {
        return `character:${context.characterId}`;
    }

    return 'none';
}

function invalidateChatSelector() {
    loadedChatSelectorContextKey = null;
    chatSelectorLoadGeneration++;
    chatSelectorLoadPromise = null;
}

function setChatName(name) {
    const isNotInChat = !name;
    const contextKey = getChatSelectorContextKey();

    if (chatSelectorContextKey !== contextKey || isNotInChat) {
        chatName.replaceChildren();
        chatSelectorContextKey = contextKey;
    }

    let selectedOption = Array.from(chatName.options).find(option => option.value === name);
    if (!selectedOption) {
        selectedOption = document.createElement('option');
        selectedOption.innerText = name || t`No chat selected`;
        selectedOption.value = name || '';
        chatName.appendChild(selectedOption);
    }

    selectedOption.selected = true;
    chatName.disabled = isNotInChat;

    icons.forEach(icon => {
        const iconElement = document.getElementById(icon.id);
        if (iconElement && !icon.isTemporaryAllowed) {
            iconElement.classList.toggle('not-in-chat', isNotInChat);
        }
    });
}

/**
 * Populate the chat selector only when the user interacts with it.
 * Chat changes and forks merely update the selected option.
 */
function ensureChatSelectorLoaded() {
    const name = getCurrentChatId();
    if (!name || typeof openGroupChat !== 'function' || typeof openCharacterChat !== 'function') {
        return;
    }

    const context = SillyTavern.getContext();
    const contextKey = getChatSelectorContextKey(context);
    if (loadedChatSelectorContextKey === contextKey) {
        return;
    }

    if (chatSelectorLoadPromise?.contextKey === contextKey) {
        return chatSelectorLoadPromise.promise;
    }

    const generation = ++chatSelectorLoadGeneration;
    const promise = (async () => {
        const list = [];
        if (context.groupId) {
            const group = context.groups.find(x => x.id == context.groupId);
            if (group) {
                list.push(...group.chats);
            }
        } else {
            const characterAvatar = context.characters[context.characterId]?.avatar;
            list.push(...await getListOfCharacterChats(characterAvatar));
        }

        if (generation !== chatSelectorLoadGeneration
            || getChatSelectorContextKey() !== contextKey
            || getCurrentChatId() !== name) {
            return;
        }

        const names = Array.from(new Set([...list, name].map(String))).sort((a, b) => a.localeCompare(b));
        const fragment = document.createDocumentFragment();
        for (const chatId of names) {
            const option = document.createElement('option');
            option.innerText = chatId;
            option.value = chatId;
            option.selected = chatId === name;
            fragment.appendChild(option);
        }

        chatName.replaceChildren(fragment);
        chatName.disabled = false;
        chatSelectorContextKey = contextKey;
        loadedChatSelectorContextKey = contextKey;
    })().finally(() => {
        if (chatSelectorLoadPromise?.generation === generation) {
            chatSelectorLoadPromise = null;
        }
    });

    chatSelectorLoadPromise = { contextKey, generation, promise };
    return promise;
}

/**
 * Get list of chat names for a character.
 * @param {string} avatar Avatar name of the character
 * @returns {Promise<string[]>} List of chat names
 */
async function getListOfCharacterChats(avatar) {
    try {
        const result = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar, simple: true }),
        });

        if (!result.ok) {
            return [];
        }

        const data = await result.json();
        return data.map(x => String(x.file_name).replace('.jsonl', ''));
    } catch (error) {
        console.error('Failed to get list of character chats', error);
        return [];
    }
}

async function getChatFiles() {
    const context = SillyTavern.getContext();
    const chatId = getCurrentChatId();

    if (!chatId) {
        return [];
    }

    if (context.groupId) {
        return await getGroupPastChats(context.groupId);
    }

    if (context.characterId !== undefined) {
        return await getPastCharacterChats(context.characterId);
    }

    return [];
}

/**
 * Clear all search highlights
 * @param {object} options Highlight options
 */
function clearHighlights(options) {
    if (highlightedMessages.size > 0) {
        jQuery(Array.from(highlightedMessages)).unhighlight(options);
        highlightedMessages.clear();
    }
}

/**
 * Parse a search query while preserving the existing space-separated OR behavior.
 * @param {string} query Search query
 * @returns {{terms: string[], termsLower: string[]}}
 */
function parseSearchQuery(query) {
    const terms = query.split(/\s+/).filter(term => term.length > 0);
    return {
        terms,
        termsLower: terms.map(term => term.toLowerCase()),
    };
}

/**
 * Highlight matching messages and remember exactly which elements were changed.
 * @param {HTMLElement[]} elements Matching message elements
 * @param {string[]} queryTerms Original-cased query terms
 * @param {object} options Highlight options
 */
function highlightMessages(elements, queryTerms, options) {
    if (elements.length === 0) {
        return;
    }

    jQuery(elements).highlight(queryTerms, options);
    elements.forEach(element => highlightedMessages.add(element));
}

/**
 * Refresh highlights only for messages whose rendered text changed.
 * @param {Set<HTMLElement>} updatedMessages Added or changed message elements
 * @param {Set<HTMLElement>} removedMessages Removed message elements
 */
function onMessageCacheChanged(updatedMessages, removedMessages) {
    removedMessages.forEach(element => highlightedMessages.delete(element));

    const query = searchInput.value.trim();
    if (!query || updatedMessages.size === 0) {
        return;
    }

    const options = { element: 'mark', className: 'highlight' };
    const { terms, termsLower } = parseSearchQuery(query);
    const previouslyHighlighted = Array.from(updatedMessages).filter(element => highlightedMessages.has(element));
    if (previouslyHighlighted.length > 0) {
        jQuery(previouslyHighlighted).unhighlight(options);
        previouslyHighlighted.forEach(element => highlightedMessages.delete(element));
    }

    const matching = messageCache.findMatches(termsLower, updatedMessages);
    highlightMessages(matching, terms, options);
}

/**
 * Highlight search query in chat messages
 * @param {string} query Search query
 * @returns {void}
 */
function searchInChat(query) {
    const options = { element: 'mark', className: 'highlight' };

    // Clear existing highlights
    clearHighlights(options);

    if (!query) {
        messageCache.destroy();
        return;
    }

    messageCache.init();

    const { terms, termsLower } = parseSearchQuery(query);
    if (terms.length === 0) {
        return;
    }

    // Pre-filter: only highlight messages containing search terms
    const matching = messageCache.findMatches(termsLower);
    highlightMessages(matching, terms, options);
}

const searchDebounced = debounce((x) => {
    if (x === searchInput.value.trim()) {
        searchInChat(x);
    }
}, 250);

/**
 * Clear search input and highlights
 */
function clearSearch() {
    searchInput.value = '';
    searchInChat('');
}

function onSearchInput() {
    const query = searchInput.value.trim();
    if (!query) {
        searchInChat('');
        return;
    }

    searchDebounced(query);
}
const updateStatusDebounced = debounce(onOnlineStatusChange, 1000);

function addTopBar() {
    chatName.id = 'extensionTopBarChatName';
    topBar.id = 'extensionTopBar';
    searchInput.id = 'extensionTopBarSearchInput';
    searchInput.placeholder = 'Search...';
    searchInput.classList.add('text_pole');
    searchInput.type = 'search';
    searchInput.addEventListener('input', onSearchInput);
    topBar.append(chatName, searchInput);
    sheld.insertBefore(topBar, chat);
}

function addIcons() {
    icons.forEach(icon => {
        const iconElement = document.createElement('i');
        iconElement.id = icon.id;
        iconElement.className = icon.icon;
        iconElement.title = icon.title;
        iconElement.tabIndex = 0;
        iconElement.classList.add('right_menu_button');
        iconElement.addEventListener('click', () => {
            if (iconElement.classList.contains('not-in-chat')) {
                return;
            }
            icon.onClick();
        });
        if (icon.position === 'left') {
            topBar.insertBefore(iconElement, chatName);
            return;
        }
        if (icon.position === 'right') {
            topBar.appendChild(iconElement);
            return;
        }
        if (icon.position === 'middle') {
            topBar.insertBefore(iconElement, searchInput);
            return;
        }
        if (icon.id === 'extensionTopBarRenameChat' && typeof renameChat !== 'function') {
            iconElement.classList.add('displayNone');
        }
    });
}

function addSideBar() {
    if (!draggableTemplate) {
        console.warn(t`Draggable template not found. Side bar will not be added.`);
        return;
    }

    const fragment = /** @type {DocumentFragment} */ (draggableTemplate.content.cloneNode(true));
    const draggable = fragment.querySelector('.draggable');
    const closeButton = fragment.querySelector('.dragClose');

    if (!draggable || !closeButton) {
        console.warn(t`Failed to find draggable or close button. Side bar will not be added.`);
        return;
    }

    draggable.id = 'extensionSideBar';
    closeButton.addEventListener('click', onToggleSidebarClick);

    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'extensionSideBarContainer';
    draggable.appendChild(scrollContainer);

    const loaderContainer = document.createElement('div');
    loaderContainer.id = 'extensionSideBarLoader';
    draggable.appendChild(loaderContainer);

    const loaderIcon = document.createElement('i');
    loaderIcon.className = 'fa-2x fa-solid fa-gear fa-spin';
    loaderContainer.appendChild(loaderIcon);

    movingDivs.appendChild(draggable);
}

function addConnectionProfiles() {
    connectionProfiles.id = 'extensionConnectionProfiles';
    connectionProfilesStatus.id = 'extensionConnectionProfilesStatus';
    connectionProfilesSelect.id = 'extensionConnectionProfilesSelect';
    connectionProfilesSelect.title = t`Switch connection profile`;

    const connectionProfilesServerIcon = document.createElement('i');
    connectionProfilesServerIcon.id = 'extensionConnectionProfilesIcon';
    connectionProfilesServerIcon.className = 'fa-fw fa-solid fa-network-wired';

    connectionProfiles.append(connectionProfilesServerIcon, connectionProfilesSelect, connectionProfilesStatus, connectionProfilesIcon);
    sheld.insertBefore(connectionProfiles, chat);

    apiBlock.querySelectorAll('select').forEach(select => {
        select.addEventListener('input', () => updateStatusDebounced());
    });
}

function bindConnectionProfilesSelect() {
    waitUntilCondition(() => document.getElementById('connection_profiles') !== null).then(() => {
        const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
        if (!connectionProfilesMainSelect) {
            return;
        }
        connectionProfilesSelect.addEventListener('change', async () => {
            connectionProfilesMainSelect.value = connectionProfilesSelect.value;
            connectionProfilesMainSelect.dispatchEvent(new Event('change'));
        });
        connectionProfilesMainSelect.addEventListener('change', async () => {
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        const observer = new MutationObserver(() => {
            connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        observer.observe(connectionProfilesMainSelect, { childList: true });
    });
}

async function onToggleSidebarClick() {
    const sidebar = document.getElementById('extensionSideBar');
    const toggle = document.getElementById('extensionTopBarToggleSidebar');

    if (!sidebar || !toggle) {
        console.warn(t`Sidebar or toggle button not found`);
        return;
    }

    toggle.classList.toggle('active');
    const alreadyVisible = sidebar.classList.contains('visible');

    const keyframes = [
        { opacity: alreadyVisible ? 1 : 0 },
        { opacity: alreadyVisible ? 0 : 1 },
    ];
    const options = {
        duration: animation_duration,
        easing: animation_easing,
    };

    const animation = sidebar.animate(keyframes, options);

    if (alreadyVisible) {
        await animation.finished;
        sidebar.classList.toggle('visible');
        await populateSideBar();
    } else {
        sidebar.classList.toggle('visible');
        await populateSideBar();
        await animation.finished;
    }

    savePanelsState();
}

async function populateSideBar() {
    const sidebar = document.getElementById('extensionSideBar');
    const loader = document.getElementById('extensionSideBarLoader');
    const container = document.getElementById('extensionSideBarContainer');

    if (!loader || !container || !sidebar) {
        return;
    }

    if (!sidebar.classList.contains('visible')) {
        container.innerHTML = '';
        return;
    }

    loader.classList.add('displayNone');
    const processId = uuidv4();
    const scrollTop = container.scrollTop;
    const prettify = x => {
        x.last_mes = timestampToMoment(x.last_mes);
        x.file_name = String(x.file_name).replace('.jsonl', '');
        return x;
    };
    container.dataset.processId = processId;
    const chatId = getCurrentChatId();
    const chats = (await getChatFiles()).map(prettify).sort((a, b) => sortMoments(a.last_mes, b.last_mes));

    if (container.dataset.processId !== processId) {
        console.log(t`Aborting populateSideBar due to process id mismatch`);
        return;
    }

    container.innerHTML = '';

    for (const chat of chats) {
        const sideBarItem = document.createElement('div');
        sideBarItem.classList.add('sideBarItem');

        sideBarItem.addEventListener('click', async () => {
            if (chat.file_name === chatId || sideBarItem.classList.contains('selected')) {
                return;
            }

            container.childNodes.forEach(x => x instanceof HTMLElement && x.classList.remove('selected'));
            sideBarItem.classList.add('selected');
            await openChatById(chat.file_name);
        });

        const isSelected = chat.file_name === chatId;
        sideBarItem.classList.toggle('selected', isSelected);

        const chatName = document.createElement('div');
        chatName.classList.add('chatName');
        chatName.textContent = chat.file_name;
        chatName.title = chat.file_name;

        const chatDate = document.createElement('small');
        chatDate.classList.add('chatDate');
        chatDate.textContent = chat.last_mes.format('l');
        chatDate.title = chat.last_mes.format('LL LT');

        const chatNameContainer = document.createElement('div');
        chatNameContainer.classList.add('chatNameContainer');
        chatNameContainer.append(chatName, chatDate);

        const chatMessage = document.createElement('div');
        chatMessage.classList.add('chatMessage');
        chatMessage.textContent = chat.mes;
        chatMessage.title = chat.mes;

        const chatStats = document.createElement('div');
        chatStats.classList.add('chatStats');

        const counterBlock = document.createElement('div');
        counterBlock.classList.add('counterBlock');

        const counterIcon = document.createElement('i');
        counterIcon.classList.add('fa-solid', 'fa-comment', 'fa-xs');

        const counterText = document.createElement('small');
        counterText.textContent = chat.chat_items;

        counterBlock.append(counterIcon, counterText);

        const fileSizeText = document.createElement('small');
        fileSizeText.classList.add('fileSize');
        fileSizeText.textContent = chat.file_size;

        chatStats.append(counterBlock, fileSizeText);

        const chatMessageContainer = document.createElement('div');
        chatMessageContainer.classList.add('chatMessageContainer');
        chatMessageContainer.append(chatMessage, chatStats);

        sideBarItem.append(chatNameContainer, chatMessageContainer);
        container.appendChild(sideBarItem);
    }

    container.scrollTop = scrollTop;

    /** @type {HTMLElement} */
    const selectedElement = container.querySelector('.selected');
    const isSelectedElementVisible = selectedElement && selectedElement.offsetTop >= container.scrollTop && selectedElement.offsetTop <= container.scrollTop + container.clientHeight;
    if (!isSelectedElementVisible) {
        container.scrollTop = selectedElement.offsetTop - container.clientHeight / 2;
    }

    loader.classList.add('displayNone');
}

async function openChatById(chatId) {
    const context = SillyTavern.getContext();

    if (!chatId) {
        return;
    }

    if (typeof openGroupChat === 'function' && context.groupId) {
        await openGroupChat(context.groupId, chatId);
        return;
    }

    if (typeof openCharacterChat === 'function' && context.characterId !== undefined) {
        await openCharacterChat(chatId);
        return;
    }
}

async function onChatNameChange() {
    const chatId = chatName.value;
    await openChatById(chatId);
}

async function onToggleConnectionProfilesClick() {
    const button = document.getElementById('extensionTopBarToggleConnectionProfiles');

    if (!button) {
        console.warn('Connection profiles button not found');
        return;
    }

    button.classList.toggle('active');
    connectionProfiles.classList.toggle('visible');
    savePanelsState();
    await onOnlineStatusChange();
}

async function onOnlineStatusChange() {
    if (!connectionProfiles.classList.contains('visible')) {
        return;
    }

    const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
    if (connectionProfilesMainSelect) {
        connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
        connectionProfilesSelect.value = connectionProfilesMainSelect.value;
    } else {
        connectionProfilesSelect.classList.add('displayNone');
    }

    if (connectionProfilesStatus.nextElementSibling?.classList?.contains('icon-svg')) {
        connectionProfilesStatus.nextElementSibling.remove();
    }

    const { SlashCommandParser, onlineStatus, mainApi } = SillyTavern.getContext();

    if (onlineStatus === 'no_connection') {
        connectionProfilesStatus.classList.add('offline');
        connectionProfilesStatus.textContent = t`No connection...`;

        const nullIcon = new Image();
        nullIcon.classList.add('icon-svg', 'null-icon');
        connectionProfilesStatus.insertAdjacentElement('afterend', nullIcon);
        return;
    }

    async function getCurrentAPI() {
        let currentAPI = mainApi;
        try {
            const commandResult = await SlashCommandParser.commands['api'].callback({ quiet: 'true' }, '');
            if (commandResult) {
                currentAPI = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current API`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`select:not(#main_api) option[value="${currentAPI}"]`) ?? apiBlock.querySelector(`select#main_api option[value="${currentAPI}"]`);
        if (fancyNameOption) {
            // Remove text in parentheses or brackets
            return fancyNameOption.textContent.replace(/[[(].*[\])]/, '').trim();
        }
        return currentAPI;
    }

    async function getCurrentModel() {
        let currentModel = onlineStatus;
        try {
            const commandResult = await SlashCommandParser.commands['model'].callback({ quiet: 'true' }, '');
            if (commandResult && typeof commandResult === 'string') {
                currentModel = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current model`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`option[value="${currentModel}"]`);
        if (fancyNameOption) {
            return fancyNameOption.textContent.trim();
        }
        return currentModel;
    }

    const [currentAPI, currentModel] = await Promise.all([getCurrentAPI(), getCurrentModel()]);
    await addConnectionProfileIcon();
    connectionProfilesStatus.classList.remove('offline');
    connectionProfilesStatus.textContent = `${currentAPI} – ${currentModel}`;
}

async function addConnectionProfileIcon() {
    return new Promise((resolve) => {
        const modelName = getGeneratingApi();
        const image = new Image();
        image.classList.add('icon-svg');
        image.src = `/img/${modelName}.svg`;

        image.onload = async function () {
            connectionProfilesStatus.insertAdjacentElement('afterend', image);
            await SVGInject(image);
            resolve();
        };

        image.onerror = function () {
            resolve();
        };

        // Prevent infinite waiting
        setTimeout(() => resolve(), 500);
    });
}

function savePanelsState() {
    localStorage.setItem('topBarPanelsState', JSON.stringify({
        sidebarVisible: document.getElementById('extensionSideBar')?.classList.contains('visible'),
        connectionProfilesVisible: document.getElementById('extensionConnectionProfiles')?.classList.contains('visible'),
    }));
}

function restorePanelsState() {
    const state = JSON.parse(localStorage.getItem('topBarPanelsState'));

    if (!state) {
        return;
    }

    if (state.sidebarVisible) {
        document.getElementById('extensionTopBarToggleSidebar')?.click();
    }

    if (state.connectionProfilesVisible) {
        document.getElementById('extensionTopBarToggleConnectionProfiles')?.click();
    }
}

// Init extension on load
(async function () {
    addJQueryHighlight();
    patchSheldIfNeeded();
    addTopBar();
    addIcons();
    addSideBar();
    addConnectionProfiles();
    setChatName(getCurrentChatId());
    chatName.addEventListener('change', onChatNameChange);
    chatName.addEventListener('focus', ensureChatSelectorLoaded);
    chatName.addEventListener('pointerdown', ensureChatSelectorLoaded);
    const setChatNameDebounced = debounce(() => {
        invalidateChatSelector();
        setChatName(getCurrentChatId());
        const sidebar = document.getElementById('extensionSideBar');
        if (sidebar?.classList.contains('visible')) {
            populateSideBar();
        }
    }, debounce_timeout.short);
    for (const eventName of [event_types.CHAT_CHANGED, event_types.CHAT_DELETED, event_types.GROUP_CHAT_DELETED]) {
        eventSource.on(eventName, setChatNameDebounced);
    }
    // Clear search and release its cache on chat change.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearSearch();
    });
    eventSource.once(event_types.APP_READY, () => {
        bindConnectionProfilesSelect();
        restorePanelsState();
    });
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, updateStatusDebounced);
})();
