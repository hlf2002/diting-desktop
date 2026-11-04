# 谛听 CLI（Diting CLI）Skill

## Trigger Conditions

Use this skill when a user asks to:

- Manage RSS subscriptions
- Browse timeline entries
- Read entry details or readability content
- Mark entries as read/unread
- Search feeds/lists or trending sources
- Import/export OPML
- Check unread counts

## Preconditions

1. CLI 从本仓库构建（不能用 npm 上官方 `folocli`——它连的是 Folo 官方 API，接口与谛听自建后端完全不同）：
   ```bash
   cd diting-desktop/apps/cli && pnpm build   # 产物 dist/index.js，bin 名 folo
   ```
2. Authentication is configured:
   - `folo login` (recommended, opens browser and auto-logins)
   - or `folo login --token <session-token>`
   - or set `FOLO_TOKEN=<token>`
3. 默认 API 指向谛听生产 `https://diting.7373.com.cn`；可用 `--api-url` 覆盖。

## Execution Policy

- Prefer the locally built `folo ...` binary for all agent runs.
- Do not require `npm install -g folocli`, and never run `npx folocli@latest` — the npm package is the upstream Folo CLI and talks to the official Folo API, not 谛听.
- No separate update preflight is needed; rebuild from source after pulling.

## Output Contract

Default output is JSON with a stable envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

Errors return:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Token is invalid or expired."
  }
}
```

Usage errors, such as an unknown option, a missing argument or an invalid value, use the same envelope with the code `INVALID_ARGUMENT`.

With `--verbose`, an error the API answered with also has `request`: the `method`, `path`, `originalPath`, `query` and `body` of the call, never its headers. The table and plain formats print it below the message.

You can switch output mode:

- `--format json` (default)
- `--format table` (for people: a row per item with the main fields, long values cut to one line)
- `--format plain`

Changes the API answers without data, such as `subscription remove`, `collection add`, `entry mark-read` or `list delete`, return the fields it sends: `{ "lastSyncId": 42 }` when the change was recorded for sync, otherwise `{}`. `subscription add` returns `feed`, `list`, `unread` and `lastSyncId`.

## Core Workflows

### 1. Timeline Reading

1. Fetch timeline:
   - `folo timeline --limit 10`
2. Get entry detail:
   - `folo entry get <entryId>`
3. Get readability content:
   - `folo entry read <entryId>`
   - `--format plain` prints the content itself, ready to pipe or save

### 2. Subscription Management

1. Discover:
   - `folo search discover <keyword>`
2. Add subscription:
   - `folo subscription add --feed <url>`
   - or `folo subscription add --list <listId>`
3. List subscriptions:
   - `folo subscription list`
4. Update or remove one by the feed ID, list ID or feed URL it lists:
   - `folo subscription update <id> --category <name>`
   - `folo subscription remove <id>`
   - Both fail with `NOT_FOUND` for anything you don't follow, without changing anything.
   - Feeds of RSSHub instances are listed with `rsshub://` URLs; `remove <url> --target url` and `feed get <url>` take that URL or the one the feed was followed with.

### 3. Unread Processing

1. Check unread total:
   - `folo unread count`
2. List unread subscriptions:
   - `folo unread list`
   - A list counts the unread entries of all its feeds, as the app shows it, so a feed you also follow directly counts in both rows; `total` counts each entry once.
   - `total` also counts the unread entries of inboxes, which `unread count` leaves out.
3. Read unread entries:
   - `folo timeline --unread-only --limit 20`
4. Mark read:
   - `folo entry mark-read <entryId>`
   - or batch: `folo entry mark-all-read --view articles`

### 4. Collection Operations

- Add: `folo collection add <entryId>`
- Remove: `folo collection remove <entryId>`
  - Fails with `NOT_FOUND` for an entry that isn't collected, without changing anything.
- List: `folo collection list --limit 20`

### 5. OPML Import / Export

- Export:
  - `folo opml export --output backup.opml`
  - A directory as `--output` gets `folo.opml` inside it.
  - Without `--output`, `data.content` holds the OPML document; `--format plain` prints the document itself.
- Import:
  - `folo opml import feeds.opml`

## Pagination Pattern

`folo timeline` returns:

- `entries`
- `nextCursor`
- `hasNext`

Loop until `hasNext` is `false`:

1. `folo timeline --limit 20`
2. Read `nextCursor`
3. `folo timeline --limit 20 --cursor <nextCursor>`
4. Repeat

A page can hold fewer entries than `--limit` while more follow, so keep going until `hasNext` is `false`; only the last page is empty. It can also hold more when several entries share the time of its last one, so that the next page misses none of them. `--limit` is at most 100. `collection list` pages the same way.

## Command Reference

- `folo login [--timeout <seconds>] [--token <token>]`
- `folo logout`
- `folo whoami`
- `folo auth login [--timeout <seconds>] [--token <token>]`
- `folo auth logout`
- `folo auth whoami`

- `folo timeline [--view <type>] [--limit <n>] [--unread-only] [--cursor <datetime>]`
- `folo timeline --feed <feedId> [--limit <n>] [--cursor <datetime>]`
- `folo timeline --list <listId> [--limit <n>] [--cursor <datetime>]`
- `folo timeline --category <name> [--view <type>] [--limit <n>]`

- `folo subscription list [--view <type>] [--category <name>]`
- `folo subscription add --feed <url> [--category <name>] [--view <type>] [--private]`
- `folo subscription add --list <listId> [--category <name>] [--view <type>]`
- `folo subscription remove <id> [--target feed|list|url]`
- `folo subscription update <id> [--target feed|list] [--category <name>] [--title <title>] [--view <type>] [--private|--public]`

- `folo entry get <entryId>`
- `folo entry read <entryId>`
- `folo entry mark-read <entryId>`
- `folo entry mark-unread <entryId>`
- `folo entry mark-all-read [--feed <feedId>] [--list <listId>] [--view <type>]`

- `folo feed get <feedId|feedUrl>`
- `folo feed refresh <feedId>`
- `folo feed analytics <feedId>`

- `folo list ls`
- `folo list get <listId>`
- `folo list create --title <title> [--description <desc>] [--view <type>] [--fee <n>]`
- `folo list update <listId> [--title <title>] [--description <desc>] [--view <type>] [--fee <n>]`
- `folo list delete <listId>`
- `folo list add-feed <listId> --feed <feedId>`
- `folo list remove-feed <listId> --feed <feedId>`

- `folo search discover <keyword> [--type feeds|lists]`
- `folo search rsshub <keyword> [--lang <lang>]`
- `folo search trending [--range 1d|3d|7d|30d] [--view <type>] [--limit <n>] [--language eng|cmn] [--category <keyword>]`

- `folo collection list [--limit <n>] [--cursor <datetime>]`
- `folo collection add <entryId> [--view <type>]`
- `folo collection remove <entryId>`

- `folo opml export [--output <file>]`
- `folo opml import <file> [--items <url1,url2,...>]`

- `folo unread count`
- `folo unread list [--view <type>]`

## Error Recovery

- `UNAUTHORIZED`
  - Re-login: `folo login`
  - or `folo login --token <token>`
  - Or set `FOLO_TOKEN`
- `HTTP_4xx` / `HTTP_5xx`
  - Retry with `--verbose`: `error.request` says what the call sent
  - Verify `--api-url` if using non-default endpoint
- `NETWORK_ERROR`
  - The API could not be reached; the message names its URL and the reason, such as `ECONNREFUSED`
  - Check the network connection and `--api-url`, then retry
- `TIMEOUT_ERROR`
  - The API did not answer within 30 seconds; the request may still have been carried out
  - Retry; check with the matching `list` or `get` command before repeating a change
- `INVALID_RESPONSE`
  - The server at the API URL answered as the Folo API never does, such as with a web page; the token is not to blame
  - Check `--api-url`, or leave it out to use the default API
- `INVALID_ARGUMENT`
  - Run `folo <command> --help` to inspect accepted options
- `NOT_FOUND`
  - The id or URL names nothing the API knows; check it with the matching `list`, `get` or `search` command
