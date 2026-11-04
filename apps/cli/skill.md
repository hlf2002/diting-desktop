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
   cd diting-desktop/apps/cli && pnpm build   # 产物 dist/index.js，bin 名 diting-cli
   ```
2. Authentication is configured:
   - `diting-cli login` (recommended, opens browser and auto-logins)
   - or `diting-cli login --token <session-token>`
   - or set `DITING_TOKEN=<token>`
3. 默认 API 指向谛听生产 `https://diting.7373.com.cn`；可用 `--api-url` 覆盖。

## Execution Policy

- Prefer the locally built `diting-cli ...` binary for all agent runs.
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
   - `diting-cli timeline --limit 10`
2. Get entry detail:
   - `diting-cli entry get <entryId>`
3. Get readability content:
   - `diting-cli entry read <entryId>`
   - `--format plain` prints the content itself, ready to pipe or save

### 2. Subscription Management

1. Discover:
   - `diting-cli search discover <keyword>`
2. Add subscription:
   - `diting-cli subscription add --feed <url>`
   - or `diting-cli subscription add --list <listId>`
3. List subscriptions:
   - `diting-cli subscription list`
4. Update or remove one by the feed ID, list ID or feed URL it lists:
   - `diting-cli subscription update <id> --category <name>`
   - `diting-cli subscription remove <id>`
   - Both fail with `NOT_FOUND` for anything you don't follow, without changing anything.
   - Feeds of RSSHub instances are listed with `rsshub://` URLs; `remove <url> --target url` and `feed get <url>` take that URL or the one the feed was followed with.

### 3. Unread Processing

1. Check unread total:
   - `diting-cli unread count`
2. List unread subscriptions:
   - `diting-cli unread list`
   - A list counts the unread entries of all its feeds, as the app shows it, so a feed you also follow directly counts in both rows; `total` counts each entry once.
   - `total` also counts the unread entries of inboxes, which `unread count` leaves out.
3. Read unread entries:
   - `diting-cli timeline --unread-only --limit 20`
4. Mark read:
   - `diting-cli entry mark-read <entryId>`
   - or batch: `diting-cli entry mark-all-read --view articles`

### 4. Collection Operations

- Add: `diting-cli collection add <entryId>`
- Remove: `diting-cli collection remove <entryId>`
  - Fails with `NOT_FOUND` for an entry that isn't collected, without changing anything.
- List: `diting-cli collection list --limit 20`

### 5. OPML Import / Export

- Export:
  - `diting-cli opml export --output backup.opml`
  - A directory as `--output` gets `diting.opml` inside it.
  - Without `--output`, `data.content` holds the OPML document; `--format plain` prints the document itself.
- Import:
  - `diting-cli opml import feeds.opml`

## Pagination Pattern

`diting-cli timeline` returns:

- `entries`
- `nextCursor`
- `hasNext`

Loop until `hasNext` is `false`:

1. `diting-cli timeline --limit 20`
2. Read `nextCursor`
3. `diting-cli timeline --limit 20 --cursor <nextCursor>`
4. Repeat

A page can hold fewer entries than `--limit` while more follow, so keep going until `hasNext` is `false`; only the last page is empty. It can also hold more when several entries share the time of its last one, so that the next page misses none of them. `--limit` is at most 100. `collection list` pages the same way.

## Command Reference

- `diting-cli login [--timeout <seconds>] [--token <token>]`
- `diting-cli logout`
- `diting-cli whoami`
- `diting-cli auth login [--timeout <seconds>] [--token <token>]`
- `diting-cli auth logout`
- `diting-cli auth whoami`

- `diting-cli timeline [--view <type>] [--limit <n>] [--unread-only] [--cursor <datetime>]`
- `diting-cli timeline --feed <feedId> [--limit <n>] [--cursor <datetime>]`
- `diting-cli timeline --list <listId> [--limit <n>] [--cursor <datetime>]`
- `diting-cli timeline --category <name> [--view <type>] [--limit <n>]`

- `diting-cli subscription list [--view <type>] [--category <name>]`
- `diting-cli subscription add --feed <url> [--category <name>] [--view <type>] [--private]`
- `diting-cli subscription add --list <listId> [--category <name>] [--view <type>]`
- `diting-cli subscription remove <id> [--target feed|list|url]`
- `diting-cli subscription update <id> [--target feed|list] [--category <name>] [--title <title>] [--view <type>] [--private|--public]`

- `diting-cli entry get <entryId>`
- `diting-cli entry read <entryId>`
- `diting-cli entry mark-read <entryId>`
- `diting-cli entry mark-unread <entryId>`
- `diting-cli entry mark-all-read [--feed <feedId>] [--list <listId>] [--view <type>]`

- `diting-cli feed get <feedId|feedUrl>`
- `diting-cli feed refresh <feedId>`
- `diting-cli feed analytics <feedId>`

- `diting-cli list ls`
- `diting-cli list get <listId>`
- `diting-cli list create --title <title> [--description <desc>] [--view <type>] [--fee <n>]`
- `diting-cli list update <listId> [--title <title>] [--description <desc>] [--view <type>] [--fee <n>]`
- `diting-cli list delete <listId>`
- `diting-cli list add-feed <listId> --feed <feedId>`
- `diting-cli list remove-feed <listId> --feed <feedId>`

- `diting-cli search discover <keyword> [--type feeds|lists]`
- `diting-cli search rsshub <keyword> [--lang <lang>]`
- `diting-cli search trending [--range 1d|3d|7d|30d] [--view <type>] [--limit <n>] [--language eng|cmn] [--category <keyword>]`

- `diting-cli collection list [--limit <n>] [--cursor <datetime>]`
- `diting-cli collection add <entryId> [--view <type>]`
- `diting-cli collection remove <entryId>`

- `diting-cli opml export [--output <file>]`
- `diting-cli opml import <file> [--items <url1,url2,...>]`

- `diting-cli unread count`
- `diting-cli unread list [--view <type>]`

## Error Recovery

- `UNAUTHORIZED`
  - Re-login: `diting-cli login`
  - or `diting-cli login --token <token>`
  - Or set `DITING_TOKEN`
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
  - Run `diting-cli <command> --help` to inspect accepted options
- `NOT_FOUND`
  - The id or URL names nothing the API knows; check it with the matching `list`, `get` or `search` command
