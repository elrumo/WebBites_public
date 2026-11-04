# MCP server (AI assistants)

Connect Claude, ChatGPT, Cursor and other AI assistants to your library: setup, sign-in, the tools and the limits.

## What it is

The Model Context Protocol (MCP) is the open standard AI assistants use to reach tools outside the chat. The WebBites MCP server hands an assistant your library as a set of those tools — search, read, save, edit and organise — so you can ask for things in plain words and it does the calls.

- “Find the article about sourdough starters I saved last spring.”
- “Save this link to my Reading board and tag it *design*.”
- “What have I saved about Rust this month? Summarise the three best.”

There is nothing to install and no code to write. It works on every plan, signs in with your WebBites account, and every tool call counts against the same allowance as the [REST API](https://www.webbites.io/developers/docs).

> The hosted server — the only address you need to give an assistant: `https://api.webbites.io/mcp`

## Connecting an assistant

Most apps take the URL above and do the rest: the first time they connect, your browser opens WebBites, you sign in and approve the connection, and you are sent back. The same steps are in the app under Settings → AI assistants.

### Claude

Claude.ai, Claude Desktop and the mobile apps

1. In Claude, open Settings → Connectors and choose Add custom connector.
2. Name it WebBites, paste the server URL and select Add.
3. Select Connect, then approve access on the WebBites page that opens. The connector works in Claude Desktop and the mobile apps too.

### ChatGPT

ChatGPT on the web

1. In ChatGPT, open Settings → Connectors and turn on developer mode (under Advanced).
2. Create a connector: name it WebBites, paste the server URL and choose OAuth.
3. Approve access on the WebBites page that opens, then turn WebBites on from the tools menu in a chat.

### Claude Code

Claude Code, in the terminal or your editor

1. Add the server from your terminal:

   **Terminal**
   ```bash
   claude mcp add --transport http webbites https://api.webbites.io/mcp
   ```
2. Start Claude Code, run /mcp, choose webbites and sign in. Your browser opens WebBites so you can approve access.

### Cursor

The Cursor code editor

1. Add WebBites to ~/.cursor/mcp.json, or to .cursor/mcp.json in a project:

   **~/.cursor/mcp.json**
   ```json
   {
     "mcpServers": {
       "webbites": {
         "url": "https://api.webbites.io/mcp"
       }
     }
   }
   ```
2. In Cursor’s settings, find webbites in the MCP list and select Connect, then approve access on WebBites.

### VS Code

VS Code with Copilot Chat

1. Add WebBites to .vscode/mcp.json in your workspace:

   **.vscode/mcp.json**
   ```json
   {
     "servers": {
       "webbites": {
         "type": "http",
         "url": "https://api.webbites.io/mcp"
       }
     }
   }
   ```
2. Select Start above the server in that file, then approve access on WebBites when your browser opens. Its tools appear in Copilot Chat’s agent mode.

### Other apps

Any app that speaks MCP

1. Apps that support remote MCP servers take the server URL as it is. Look for “custom connector”, “remote server” or “MCP” in their settings.
2. Apps that can only start local (stdio) servers can reach it through the mcp-remote bridge, which needs Node.js:

   **Terminal**
   ```bash
   npx -y mcp-remote https://api.webbites.io/mcp
   ```

   **JSON config**
   ```json
   {
     "mcpServers": {
       "webbites": {
         "command": "npx",
         "args": [
           "-y",
           "mcp-remote",
           "https://api.webbites.io/mcp"
         ]
       }
     }
   }
   ```
3. The first time it runs, your browser opens WebBites so you can approve access.

### With an API key

Scripts and apps that let you set headers

1. Apps that let you set request headers can skip the sign-in and send an API key instead. A key can read and change your whole library, like it can over the REST API.
2. Create a key in Settings → Developer, then send it as a bearer token:

   **Header**
   ```bash
   Authorization: Bearer wb_live_…
   ```

   **Claude Code**
   ```bash
   claude mcp add --transport http webbites https://api.webbites.io/mcp \
     --header "Authorization: Bearer wb_live_…"
   ```

   **Cursor**
   ```json
   {
     "mcpServers": {
       "webbites": {
         "url": "https://api.webbites.io/mcp",
         "headers": {
           "Authorization": "Bearer wb_live_…"
         }
       }
     }
   }
   ```

## Signing in and what an assistant can do

### Approving a connection

An assistant never sees your password. It signs in with OAuth: WebBites shows you a consent page saying which app is asking, where you will be sent afterwards and what it will be able to do, and the app only gets in if you approve.

- **Read access** comes with every approval: searching and reading your bookmarks, notes, boards and tags.
- **Allow changes** is a switch on the same page, on by default when the app asks for it. Turned off, the connection is read only and the write tools disappear from what the assistant sees.
- **Verified apps** publish their details at an https address WebBites can check, and the page shows that address. An **Unverified** badge means the app registered itself and WebBites cannot confirm who made it.
- **A program on this computer** — the page says so when an app asks to be sent back to `localhost`. Only approve that if you have just started the connection yourself.

| Scope | What it allows |
| --- | --- |
| `bookmarks:read` | Search and read bookmarks, boards and tags. |
| `bookmarks:write` | Save links and notes, edit bookmarks, create and fill boards, and move bookmarks to the trash. |

What you approve is fixed for that connection. To give a read-only assistant write access, or take it away, disconnect it and connect it again.

### Seeing and disconnecting assistants

Settings → AI assistants in the app lists every assistant you have connected, whether it can make changes and when it was last used. **Disconnect** takes effect immediately — its next request is refused — and the assistant has to be approved again to come back.

### Using an API key instead

Apps that let you set request headers can skip the sign-in and send one of your [API keys](https://www.webbites.io/developers/docs/api-keys) as a bearer token. A key always has full read and write access, and its calls count against that key in your [usage](https://www.webbites.io/developers/docs/usage). Revoke the key to cut the app off.

**Header**
```bash
Authorization: Bearer wb_live_…
```

### For client developers

- Streamable HTTP, `POST` only. The server is stateless: it serves protocol revision 2026-07-28 and answers `initialize` for 2025-11-25, 2025-06-18 and 2025-03-26.
- OAuth 2.1 with PKCE (`S256`). Clients identify themselves with a Client ID Metadata Document, or register through Dynamic Client Registration.
- An unauthenticated request gets a `401` whose `WWW-Authenticate` header points at the protected resource metadata: `https://api.webbites.io/.well-known/oauth-protected-resource/mcp`.
- A read-only connection that calls a write tool anyway gets a `403` with `error="insufficient_scope"`, so the client can ask for `bookmarks:write` again.

## Tool reference

Eleven tools, in this order. Results come back as structured content with a JSON copy alongside, and every bookmark carries a `web_url` that opens it in WebBites. Write tools are left out of the list for a read-only connection.

| Tool | What it does | Arguments | Access |
| --- | --- | --- | --- |
| `search_bookmarks` | Search the user's WebBites library (links, notes, images, PDFs, audio). With no query it lists the most recent bookmarks. Results are summaries; call get_bookmark for the full record. | `query`, `tags`, `type`, `saved_after`, `saved_before`, `sort`, `limit`, `cursor` | Read |
| `get_bookmark` | Fetch one bookmark by id: its notes, tags, AI summary, the boards it is in and, with include_content, the saved page text. | `id`\*, `include_content`, `max_chars` | Read |
| `list_boards` | List the user's boards (collections), including nested ones, with how many bookmarks each holds. | none | Read |
| `list_board_bookmarks` | List the bookmarks in one board, newest first. | `board_id`\*, `limit`, `cursor` | Read |
| `list_tags` | List the tags in use, most used first, with counts. With a query, only tags containing it. | `query`, `limit` | Read |
| `save_bookmark` | Save a web page to the library. WebBites fetches the page and fills in its title, image and summary in the background. Saving a URL that is already saved returns the existing bookmark. | `url`\*, `tags`, `note`, `board_id` | Write |
| `save_note` | Save a plain-text note to the library as a note bite. | `text`\*, `title`, `tags` | Write |
| `update_bookmark` | Change a bookmark's title, note, tags or pin. Only the fields given change. tags replaces every tag; add_tags and remove_tags edit the existing list. An empty note clears it. | `id`\*, `title`, `note`, `tags`, `add_tags`, `remove_tags`, `pinned` | Write |
| `create_board` | Create a board (collection), optionally inside another board. | `name`\*, `description`, `parent_id` | Write |
| `add_to_board` | Add bookmarks to a board. Bookmarks already in it are left as they are. | `bookmark_ids`\*, `board_id`\* | Write |
| `delete_bookmark` | Move one bookmark to the trash. The user can restore it from the trash in WebBites for 30 days. Confirm with the user before calling this. | `id`\* | Write |

\* required.

### Arguments

#### search_bookmarks — Search bookmarks

| Argument | Type | What it does |
| --- | --- | --- |
| `query` | string | Words to look for in titles, descriptions, notes, page text and tags. The cloud library also matches by meaning. |
| `tags` | string[] | Only bookmarks carrying every one of these tags. |
| `type` | string | Only bookmarks of this kind: website, textNote, drawing, image, movie, game, music, pdf or audio. |
| `saved_after` | date-time | Only bookmarks saved at or after this time (ISO 8601). |
| `saved_before` | date-time | Only bookmarks saved before this time (ISO 8601). |
| `sort` | string | relevance, newest or oldest. Defaults to relevance with a query, newest without. |
| `limit` | integer | 1–50, default 20. |
| `cursor` | string | next_cursor from the previous page. |

#### get_bookmark — Get a bookmark

| Argument | Type | What it does |
| --- | --- | --- |
| `id` (required) | string | The bookmark's id. |
| `include_content` | boolean | Also return the page's saved reader text, when there is one. Default false. |
| `max_chars` | integer | Cap on the returned page text: 500–20,000, default 8,000. |

#### list_board_bookmarks — List a board's bookmarks

| Argument | Type | What it does |
| --- | --- | --- |
| `board_id` (required) | string | The board's id. |
| `limit` | integer | 1–50, default 20. |
| `cursor` | string | next_cursor from the previous page. |

#### list_tags — List tags

| Argument | Type | What it does |
| --- | --- | --- |
| `query` | string | Only tags containing this. |
| `limit` | integer | 1–200, default 50. |

#### save_bookmark — Save a link

| Argument | Type | What it does |
| --- | --- | --- |
| `url` (required) | string | An http(s) URL. |
| `tags` | string[] | Tags to add, up to 20. |
| `note` | string | A note to keep with the bookmark. |
| `board_id` | string | Also add it to this board. |

#### save_note — Save a note

| Argument | Type | What it does |
| --- | --- | --- |
| `text` (required) | string | The note, up to 50,000 characters. |
| `title` | string | A title for it. |
| `tags` | string[] | Tags to add, up to 20. |

#### update_bookmark — Edit a bookmark

| Argument | Type | What it does |
| --- | --- | --- |
| `id` (required) | string | The bookmark's id. |
| `title` | string | A new title. |
| `note` | string | A new note. An empty one clears it. |
| `tags` | string[] | Replaces every tag. |
| `add_tags` | string[] | Tags to add to the existing ones. |
| `remove_tags` | string[] | Tags to take off. |
| `pinned` | boolean | Pin or unpin it. |

#### create_board — Create a board

| Argument | Type | What it does |
| --- | --- | --- |
| `name` (required) | string | The board's name. |
| `description` | string | What it is for. |
| `parent_id` | string | Nest it inside this board. |

#### add_to_board — Add to a board

| Argument | Type | What it does |
| --- | --- | --- |
| `bookmark_ids` (required) | string[] | 1–50 bookmark ids. |
| `board_id` (required) | string | The board to add them to. |

#### delete_bookmark — Move a bookmark to the trash

| Argument | Type | What it does |
| --- | --- | --- |
| `id` (required) | string | The bookmark's id. One per call. |

## Limits and metering

Every tool call is one request against your plan's developer API allowance — the same one your API keys share. Listing the tools and the protocol's own housekeeping are free.

| Plan | Tool calls per minute | Tool calls per month |
| --- | --- | --- |
| Free | 60 | 1,000 |
| Plus | 1,000 | 100,000 |

- An assistant that runs out gets an error result explaining why, and usually tells you. The per-minute limit clears within a minute; the monthly one on the first of the month, or when you upgrade.
- The [usage page](https://www.webbites.io/developers/docs/usage) breaks the month down per key and per connected assistant.
- One question can take several calls — a search, then a `get_bookmark` or two — so a chatty assistant spends more than one request per message.

## The Mac app's local server

If you use the Mac app without an account, your library never reaches our servers, so the hosted server cannot see it. The Mac app has its own MCP server for that case: the app itself, started with `--mcp` by the assistant, on your Mac.

1. In the Mac app, open Settings → AI assistants and turn on the local server. It is off until you do. A second switch decides whether assistants may make changes.
2. Keep WebBites in `/Applications`, and open it at least once in local mode so there is a library to read.
3. Point the assistant at the app. In Claude Desktop, add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (Cursor takes the same JSON in `~/.cursor/mcp.json`); in Claude Code, run the command:

**Claude Desktop**
```json
{
  "mcpServers": {
    "webbites": {
      "command": "/Applications/WebBites.app/Contents/MacOS/WebBites",
      "args": [
        "--mcp"
      ]
    }
  }
}
```

**Claude Code**
```bash
claude mcp add webbites -- /Applications/WebBites.app/Contents/MacOS/WebBites --mcp
```

It has the same eleven tools, with these differences:

- **No semantic search.** `search_bookmarks` matches the words you give it, not their meaning.
- **No page text.** `get_bookmark` returns the bookmark without its saved reader text, and says so.
- **Writes go through the app.** Saves and edits are handed to WebBites, which may open in the background to apply them. If it has not done so within about 15 seconds, the tool reports the change as queued, and it lands the next time the app runs.
- **The free plan's 100-bite limit applies** to saves, as it does in the app.
- **It does not answer while App Lock is on**, and it needs the Mac app: there is no local server on iPhone or iPad.

## Security notes

- **What an assistant reads goes to its provider.** Search results, notes and page text pass through the assistant's own AI service and are kept under that service's terms, not ours.
- **Saved pages are untrusted text.** A page you bookmarked can contain instructions aimed at an AI. The server tells assistants to treat titles, notes and page text as data, never as orders — but if an assistant also browses the web or runs other tools, consider leaving Allow changes off.
- **Deleting is cautious by design.** `delete_bookmark` moves one bookmark to the trash per call, assistants are told to ask you first, and the trash keeps it for 30 days.
- **Disconnect what you no longer use.** Settings → AI assistants shows when each one was last used.
- **Treat an API key like a password.** Anything that holds one has your whole library; see [Authentication](https://www.webbites.io/developers/docs/authentication).

## Troubleshooting

| What you see | What to do |
| --- | --- |
| 401, “needs authentication” or “unauthorized” | The connection was disconnected or its sign-in lapsed after a long spell unused. Reconnect it from the assistant and approve it again. With an API key, check the header reads Bearer wb_live_… and the key has not been revoked. |
| An “Unverified” badge on the consent page | The app registered itself, so WebBites cannot confirm who made it. That is normal for many desktop and command-line tools; approve only if you started the connection and trust the app. |
| The assistant cannot save or edit | The connection is read only. Disconnect it in Settings → AI assistants, connect again and leave Allow changes on. |
| 429 or “allowance spent” | You hit the per-minute or monthly limit. Wait a minute, or check the usage page; upgrading raises the monthly allowance straight away. |
| Local server: “turn it on in Settings” | Open the Mac app, go to Settings → AI assistants and turn on the local server. |
| Local server: “open WebBites once in local mode” | The app has not written a library for the server to read yet. Open WebBites, make sure it is in local mode, and try again. |
| Local server: changes reported as queued | The app did not apply them within 15 seconds. Open WebBites and they are applied. |

Still stuck? [Get in touch](https://www.webbites.io/support) and say which assistant you are using.
