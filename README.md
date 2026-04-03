# @fulldecent/firefox-devtools-mcp

[![npm version](https://img.shields.io/npm/v/@fulldecent/firefox-devtools-mcp)](https://www.npmjs.com/package/@fulldecent/firefox-devtools-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Model Context Protocol server for automating Firefox via WebDriver BiDi (through Selenium WebDriver). Works with Claude Code, Claude Desktop, Cursor, Cline and other MCP clients.

> **Note**: this MCP server requires a local Firefox browser installation and cannot run on cloud hosting services. Use `npx @fulldecent/firefox-devtools-mcp@latest` to run locally, or use Docker with the provided Dockerfile.

## How this differs from upstream

This package is a fork of [`firefox-devtools-mcp`](https://www.npmjs.com/package/firefox-devtools-mcp) (by freema) via [`@padenot/firefox-devtools-mcp`](https://www.npmjs.com/package/@padenot/firefox-devtools-mcp). The following features are added on top of immediate upstream:

* **Tabs are identified with robust UUIDs in all functions (instead of ephemeral tab index number).** This means you can have multiple agents all accessing their own tabs in the same browser profile simultaneously.

The goal is to upstream features that prove useful.

## Requirements

* Node.js ≥ 20.19.0
* Firefox 100+ installed (auto‑detected, or pass `--firefox-path`)

## Install and use with Claude Code

Recommended: use npx so you always run the latest published version from npm.

### Option A — Claude Code CLI

```bash
claude mcp add firefox-devtools npx @fulldecent/firefox-devtools-mcp@latest
```

Pass options either as args or env vars:

```bash
# Headless + viewport via args
claude mcp add firefox-devtools npx @fulldecent/firefox-devtools-mcp@latest -- --headless --viewport 1280x720

# Or via environment variables
claude mcp add firefox-devtools npx @fulldecent/firefox-devtools-mcp@latest \
  --env START_URL=https://example.com \
  --env FIREFOX_HEADLESS=true
```

### Option B — edit Claude Code settings JSON

Add to your Claude Code config file:
* macOS: `~/Library/Application Support/Claude/Code/mcp_settings.json`
* Linux: `~/.config/claude/code/mcp_settings.json`
* Windows: `%APPDATA%\Claude\Code\mcp_settings.json`

```json
{
  "mcpServers": {
    "firefox-devtools": {
      "command": "npx",
      "args": ["-y", "@fulldecent/firefox-devtools-mcp@latest", "--headless", "--viewport", "1280x720"],
      "env": {
        "START_URL": "about:home"
      }
    }
  }
}
```

### Option C — helper script (local dev build)

```bash
npm run setup
# Choose Claude Code; the script saves JSON to the right path
```

## Try it with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx @fulldecent/firefox-devtools-mcp@latest --start-url https://example.com --headless
```

Then call tools like:
* `list_pages`, `navigate_page` (pass `pageId` from `list_pages`)
* `take_snapshot` then `click_by_uid` / `fill_by_uid`
* `list_network_requests` (always‑on capture), `get_network_request`
* `screenshot_page`, `list_console_messages`

## CLI options

You can pass flags or environment variables (names on the right):

| Flag | Environment variable | Description |
|---|---|---|
| `--firefox-path` | | Absolute path to Firefox binary |
| `--headless` | `FIREFOX_HEADLESS=true` | Run without UI |
| `--viewport 1280x720` | | Initial window size |
| `--profile-path` | | Use a specific Firefox profile |
| `--firefox-arg` | | Extra Firefox arguments (repeatable) |
| `--start-url` | `START_URL` | Open this URL on start |
| `--accept-insecure-certs` | `ACCEPT_INSECURE_CERTS=true` | Ignore TLS errors |
| `--pref name=value` | | Set Firefox preference at startup (repeatable, requires `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`) |
| `--env KEY=VALUE` | | Pass environment variables to Firefox (repeatable) |
| `--output-file` | | Path for Firefox output redirection |

> **Note on `--pref`:** when Firefox runs in WebDriver BiDi mode, it applies [RecommendedPreferences](https://searchfox.org/firefox-main/source/remote/shared/RecommendedPreferences.sys.mjs) that modify browser behavior for testing. The `--pref` option allows overriding these defaults when needed (e.g., for Firefox development, debugging, or testing scenarios that require production-like behavior).
>
> **Example:** `--pref "browser.ml.enable=true"` enables Firefox's ML/AI features. This is essential when using this MCP server to develop or test AI-powered features like Smart Window, since RecommendedPreferences disables it by default.

## Tool reference

All page-aware tools require an explicit `pageId` parameter — the stable window handle returned by `list_pages`. This handle is assigned by Firefox at tab-creation time and does not change if other tabs are opened or closed, making it safe to hold across multi-step workflows.

### Page management

| Tool | Description |
|---|---|
| `list_pages` | List open tabs. Returns stable `pageId` for each tab. |
| `new_page` | Open new tab at URL. Returns `pageId` of the new tab. |
| `navigate_page` | Navigate a tab to a URL. |
| `close_page` | Close a tab. |

**`list_pages`** — no parameters

**`new_page`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Target URL |

**`navigate_page`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `url` | string | yes | Target URL |

**`close_page`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |

### DOM snapshot

UIDs are stable identifiers for DOM elements within a single snapshot. They become invalid after page navigation or DOM changes — call `take_snapshot` again to get fresh UIDs.

| Tool | Description |
|---|---|
| `take_snapshot` | Capture DOM snapshot with stable UIDs for element interaction. |
| `resolve_uid_to_selector` | Resolve a UID to its CSS selector. |
| `clear_snapshot` | Clear snapshot cache. |

**`take_snapshot`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `maxLines` | number | no | Maximum lines to display (default: 100) |
| `includeAttributes` | boolean | no | Include ARIA attributes (default: false) |
| `includeText` | boolean | no | Include text content (default: true) |
| `maxDepth` | number | no | Maximum tree depth for traversal |
| `includeAll` | boolean | no | Include all visible elements without relevance filtering, useful for Vue/Livewire/Alpine.js apps (default: false) |
| `selector` | string | no | CSS selector to scope snapshot to a specific subtree (e.g., `#app`) |

**`resolve_uid_to_selector`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `uid` | string | yes | UID from snapshot |

**`clear_snapshot`** — no parameters

### Input interaction

All input tools require valid UIDs from the current snapshot.

| Tool | Description |
|---|---|
| `click_by_uid` | Click an element. |
| `hover_by_uid` | Hover over an element. |
| `fill_by_uid` | Fill a text input or textarea (clears existing value first). |
| `drag_by_uid_to_uid` | Drag one element to another via HTML5 drag events. |
| `fill_form_by_uid` | Fill multiple form fields at once. |
| `upload_file_by_uid` | Upload a file to a file input. |

**`click_by_uid`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `uid` | string | yes | Element UID from current snapshot |
| `dblClick` | boolean | no | Double-click instead of single click (default: false) |

**`hover_by_uid`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `uid` | string | yes | Element UID from current snapshot |

**`fill_by_uid`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `uid` | string | yes | Input element UID from current snapshot |
| `value` | string | yes | Text to fill |

**`drag_by_uid_to_uid`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `fromUid` | string | yes | Source element UID |
| `toUid` | string | yes | Target element UID |

**`fill_form_by_uid`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `elements` | array | yes | Array of `{ uid: string, value: string }` objects |

**`upload_file_by_uid`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `uid` | string | yes | File input element UID from current snapshot |
| `filePath` | string | yes | Local file path (absolute or relative) |

### Network monitoring

Network requests are captured automatically. Use `list_network_requests` to browse and `get_network_request` to inspect individual requests in detail.

**`list_network_requests`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | no | Maximum number of requests (default: 50) |
| `sinceMs` | number | no | Only show requests from last N milliseconds |
| `urlContains` | string | no | Filter by URL substring (case-insensitive) |
| `method` | string | no | HTTP method filter (e.g., `GET`, `POST`) |
| `status` | number | no | Exact HTTP status code filter |
| `statusMin` | number | no | Minimum status code |
| `statusMax` | number | no | Maximum status code |
| `isXHR` | boolean | no | Filter to XHR/fetch requests only |
| `resourceType` | string | no | Filter by resource type (case-insensitive) |
| `sortBy` | string | no | Sort field: `timestamp` (default), `duration`, or `status` |
| `detail` | string | no | Detail level: `summary` (default), `min`, or `full` |
| `format` | string | no | Output format: `text` (default) or `json` |

**`get_network_request`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | no | Request ID from `list_network_requests` (primary lookup) |
| `url` | string | no | URL as fallback lookup (exact match) |
| `format` | string | no | Output format: `text` (default) or `json` |

Either `id` or `url` must be provided. If multiple requests match a URL, an error is returned listing the matching IDs.

### Console

**`list_console_messages`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `level` | string | no | Filter by level: `debug`, `info`, `warn`, or `error` |
| `limit` | number | no | Max messages to return (default: 50) |
| `sinceMs` | number | no | Only show messages from the last N milliseconds |
| `textContains` | string | no | Filter by text content (case-insensitive) |
| `source` | string | no | Filter by source (case-insensitive) |
| `format` | string | no | Output format: `text` (default) or `json` |

All filters are combined with AND logic.

**`clear_console_messages`** — no parameters. Returns count of cleared messages.

### Screenshots

Returns a native MCP image content item (PNG) for GUI clients, or saves to disk when `saveTo` is provided.

**`screenshot_page`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `saveTo` | string | no | File path to save screenshot instead of returning image data |

**`screenshot_by_uid`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `uid` | string | yes | Element UID from current snapshot |
| `saveTo` | string | no | File path to save screenshot instead of returning image data |

**Screenshot tip for Claude Code:** base64 image data consumes significant context. Use the `saveTo` parameter to save screenshots to disk, then view the file with Claude Code's read tool.

### Script evaluation

**`evaluate_script`** — execute JavaScript in page context.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `function` | string | yes | JS function string (e.g., `() => document.title`). Max 16 KB. |
| `args` | array | no | Array of objects with `uid` field to pass as function arguments |
| `timeout` | number | no | Execution timeout in milliseconds (default: 5000) |

**`evaluate_chrome_script`** — evaluate JavaScript in the current chrome (privileged) context. Requires `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `expression` | string | yes | JavaScript expression to evaluate in chrome context |

### Chrome context (privileged)

These tools require `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` environment variable.

**`list_chrome_contexts`** — no parameters. Lists privileged browsing contexts with their IDs.

**`select_chrome_context`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `contextId` | string | yes | Chrome browsing context ID from `list_chrome_contexts` |

### Firefox management

**`get_firefox_info`** — no parameters. Returns Firefox configuration: binary path, headless status, viewport, profile path, start URL, arguments, environment variables, preferences, output file path and size.

**`get_firefox_output`** — retrieve Firefox stdout/stderr output (including MOZ_LOG).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `lines` | number | no | Number of recent log lines (default: 100, max: 10000) |
| `grep` | string | no | Filter log lines containing this string (case-insensitive) |
| `since` | number | no | Only show logs from last N seconds |

**`restart_firefox`** — restart Firefox with different configuration. All current tabs will be closed.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `firefoxPath` | string | no | New Firefox binary path |
| `profilePath` | string | no | Firefox profile path |
| `env` | array | no | Environment variables in `KEY=VALUE` format (e.g., `["MOZ_LOG=HTMLMediaElement:5"]`) |
| `headless` | boolean | no | Run in headless mode |
| `startUrl` | string | no | URL to navigate to after restart |
| `prefs` | object | no | Firefox preferences object (values are auto-typed) |

### Firefox preferences (runtime)

These tools require `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`.

**`set_firefox_prefs`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prefs` | object | yes | Map of preference names to values. `true`/`false` strings become booleans, integer strings become numbers, everything else stays as strings. |

**`get_firefox_prefs`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `names` | array | yes | Array of preference names to read (e.g., `["browser.tabs.drawInTitlebar"]`) |

### WebExtension management

**`install_extension`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | Extension data type: `archivePath` (.xpi/.zip), `base64` (encoded data), or `path` (unpacked directory) |
| `path` | string | conditional | File path to extension archive or directory (required for `archivePath`/`path` types) |
| `value` | string | conditional | Base64-encoded extension data (required for `base64` type) |
| `permanent` | boolean | no | Install permanently (requires signed extension). Default: false (temporary install). |

**`uninstall_extension`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Extension ID (e.g., `addon@example.com`) |

**`list_extensions`** — requires `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ids` | array | no | Filter by exact extension IDs |
| `name` | string | no | Filter by partial name match (case-insensitive) |
| `isActive` | boolean | no | Filter by enabled/disabled status |
| `isSystem` | boolean | no | Filter by system/built-in vs. user-installed |

### Utilities

**`accept_dialog`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `promptText` | string | no | Text to enter for prompt dialogs |

**`dismiss_dialog`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |

**`navigate_history`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `direction` | string | yes | `back` or `forward` |

**`set_viewport_size`**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageId` | string | yes | Stable tab ID from `list_pages` |
| `width` | number | yes | Width in pixels |
| `height` | number | yes | Height in pixels |

## Local development

```bash
npm install
npm run build

# Run with Inspector against local build
npx @modelcontextprotocol/inspector node dist/index.js --headless --viewport 1280x720

# Or run in dev with hot reload
npm run inspector:dev
```

## Troubleshooting

* **Firefox not found:** pass `--firefox-path "/Applications/Firefox.app/Contents/MacOS/firefox"` (macOS) or the correct path on your OS.
* **First run is slow:** Selenium sets up the BiDi session; subsequent runs are faster.
* **Stale UIDs after navigation:** take a fresh snapshot (`take_snapshot`) before using UID tools.
* **Windows 10 — MCP error -32000: connection closed:**
  * **Solution 1:** call using `cmd` (see <https://github.com/modelcontextprotocol/servers/issues/1082#issuecomment-2791786310>)

    ```json
    {
      "mcpServers": {
        "firefox-devtools": {
          "command": "cmd",
          "args": ["/c", "npx", "-y", "@fulldecent/firefox-devtools-mcp@latest"]
        }
      }
    }
    ```

  * **Solution 2:** use the absolute path to `npx`:

    ```json
    {
      "mcpServers": {
        "firefox-devtools": {
          "command": "C:\\nvm4w\\nodejs\\npx.ps1",
          "args": ["-y", "@fulldecent/firefox-devtools-mcp@latest"]
        }
      }
    }
    ```

    Adjust the path to match your installation. The extension might be `.cmd`, `.bat`, or `.exe` rather than `.ps1`. Use double backslashes (`\\`) as required by JSON.

## Versioning

Use `@latest` with npx for the newest release.

## License

MIT
