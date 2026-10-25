# Chat Top Info Bar

Adds a top bar to the chat window with shortcuts to quick actions (left to right):

- Open a sidebar with a chats list
- Open chat file manager
- View chat file name and switch chats
- Search in the chat
- Create new chat
- Rename current chat file
- Delete current chat
- Close current chat

## How to install

Use this URL with the extension installer: `https://github.com/bla6987/Extension-TopInfoBar`

## License

AGPLv3

## Search memory and navigation

The search cache coalesces streaming changes by message. Its pending queue holds at most 512
message references; a larger burst switches to one complete rebuild instead of retaining all
replaced DOM nodes. A 250 ms fallback flush also clears the queue if animation frames are delayed.

Search still finds every matching rendered message. The counter and Previous/Next buttons
navigate the complete result list (Enter / Shift+Enter work from the search field). Highlighting
adds marks only to the selected result and nearby visible results, up to 20 messages and 50
occurrences per message. Scrolling or selecting another result updates those marks. These limits
bound the extra highlight DOM; they do not truncate search results or alter the chat text.
