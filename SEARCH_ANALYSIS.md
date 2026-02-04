# Search Functionality Analysis

## Overview

This document describes the search functionality in the Extension-TopInfoBar for SillyTavern.

## Search Features

### 1. Top Bar Search (In-Chat Highlighting)

**Location**: Main top bar, next to the chat name selector

**What it searches**: Message content within the **currently open chat only**

**Behavior**:
- Highlights matching text using `<mark class="highlight">` elements
- Case-insensitive matching
- Supports multiple search terms (space-separated, OR logic)
- Debounced with 250ms delay for performance
- Auto-updates highlights when new messages arrive

**Implementation Details**:
- `searchInChat()` function (index.js:325-353)
- `MessageCache` class caches message elements with pre-lowercased text (index.js:28-96)
- Uses custom jQuery highlight plugin (jquery-highlight.js)
- MutationObserver automatically rebuilds cache on DOM changes

**Does NOT**:
- Search across multiple chat threads
- Return results from other conversations
- Integrate with the sidebar chat list

---

### 2. Sidebar Chat List

**Location**: Toggled via the list icon button in the top bar

**Purpose**: Navigation only - displays past chats for quick switching

**Features**:
- Shows chat name, last message date, message count, file size
- Click to switch chats
- Sorted by last message date

**No search functionality** - this is purely for navigation between existing chats.

---

### 3. Chat Manager Button (Address Book Icon)

**Location**: Top bar, `fa-address-book` icon

**Behavior**: Opens **SillyTavern's native chat manager dialog**

**Implementation** (index.js:169-171):
```javascript
function onChatManagerClick() {
    document.getElementById('option_select_chat')?.click();
}
```

**Important**: Any search box visible after clicking this button is **SillyTavern's built-in feature**, not part of this extension. The extension simply provides a shortcut to open the native UI.

---

## Summary

| Feature | Searches | Scope |
|---------|----------|-------|
| Top bar search | Message content | Current chat only |
| Sidebar | None | N/A (navigation only) |
| Chat Manager button | N/A | Opens SillyTavern's native UI |

The extension implements custom in-chat search for highlighting but does **not** implement cross-thread/cross-conversation search. Cross-thread search would require SillyTavern's native chat manager or a new feature implementation.
