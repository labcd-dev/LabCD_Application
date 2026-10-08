# Telegram daily analytics digest

LabCD can post a once-per-day product analytics summary to a Telegram channel. Bot token, channel ID, schedule, and enable/disable are managed in **Admin → Analytics** (requires `admin:analytics`). The token is written to the API process environment and root `.env`, same pattern as provider API keys.

## What is sent

HTML-formatted Telegram message (`parse_mode: HTML`) with section icons, including:

- UTC date
- Users: total accounts, new registrations today, DAU, MAU (30d), successful logins today, D7/D30 retention
- Projects: total and created today
- Module run counts for today (always lists every known module, including zeros, plus a total):
  Regularizer, Plant Model, SILO, Recommender, Trimmer, MULO, MPC, Adaptive
- LLM usage for today and all-time (top model plus per-model counts; falls back to project/plant-chat model choices when no `llm` analytics events exist yet)
- Credits spent today (usage debits)
- Health: errors, bug reports, and feedback surveys recorded today

MPC and Adaptive counts come from job-start events (`record_module_use` when a job begins). Plant Model is recorded when a chat run starts. Classic pipeline modules are recorded as before.

Timezone for the schedule and “today” is **UTC**.

## Setup

### 1. Create a bot and channel

1. In Telegram, open [@BotFather](https://t.me/BotFather), create a bot, and copy the bot token.
2. Create a channel (or use an existing one).
3. Add the bot as an **administrator** of the channel (it needs permission to post messages).
4. Get the channel chat ID (often a negative number like `-100xxxxxxxxxx`). Common approaches:
   - Forward a channel message to a helper bot such as `@userinfobot`, or
   - Call `https://api.telegram.org/bot<TOKEN>/getUpdates` after posting in a group the bot is in and read `chat.id`.

### 2. Configure in Admin → Analytics

1. Open **Administration → Analytics**.
2. Under **Telegram daily report**:
   - Paste the **Bot token** (stored as `TELEGRAM_BOT_TOKEN` in `.env`)
   - Set **Channel / chat ID**
   - Set **Send hour (UTC)** (0–23; default `8`)
   - Enable the digest
3. Click **Save settings**.
4. Click **Send test now** to verify delivery (saves unsaved drafts first).

Leave the bot token unset (or clear it) to **log** digests to the API console instead of calling Telegram (dev fallback).

You may also seed `TELEGRAM_BOT_TOKEN` in `.env` before first boot; the Analytics page can overwrite it later. No API container recreate is required after saving from the admin UI (process env is updated immediately).

## How scheduling works

- A background thread in the API process wakes about every 60 seconds.
- After the configured UTC hour, if the digest is enabled and has not already been sent for today’s UTC date, it sends once and stores `last_sent_date`.
- **Send test now** bypasses the enable flag and the once-per-day dedupe, then updates `last_sent_date`.

Production compose runs a **single API replica**. If you ever run multiple API processes, the `last_sent_date` setting reduces duplicate sends but is not a distributed lock.

## Admin API

All routes require `admin:analytics`:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/admin/analytics/telegram` | Read settings (token is masked) |
| `PATCH` | `/api/v1/admin/analytics/telegram` | Update `enabled`, `chat_id`, `send_hour_utc`, `bot_token` |
| `POST` | `/api/v1/admin/analytics/telegram/test` | Send digest immediately |

`bot_token` on PATCH is write-only: omit to leave unchanged; empty string clears.

Settings keys in `app_settings`:

- `analytics.telegram.enabled`
- `analytics.telegram.chat_id`
- `analytics.telegram.send_hour_utc`
- `analytics.telegram.last_sent_date`

Secret:

- `TELEGRAM_BOT_TOKEN` in process env + root `.env`

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Test fails with “chat ID is not configured” | Save a non-empty chat ID first |
| Message only appears in API logs | Bot token not set (or cleared) |
| Failed to write `.env` | Root `.env` missing or not writable by the API process |
| Telegram API error / 403 | Bot not admin on the channel, or wrong chat ID |
| No automatic send | Feature disabled, send hour not reached yet (UTC), or already sent today |
| Duplicate sends after scaling API | Prefer a single API replica; see scheduling note above |

Also see [DEPLOY.md](./DEPLOY.md) for production `.env` setup.
