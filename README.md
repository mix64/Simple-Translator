# Simple Translator

A small web app for translating between Japanese and English, or Japanese and Simplified Chinese.
Conversations are split into sessions, and every translation is sent to the LLM together with the session's earlier exchanges,
so proper nouns and domain terms stay consistent within a session.

Translation is done by any LLM server that exposes an OpenAI-compatible API (`/v1/models` and `/v1/chat/completions`),
such as a local model served with vLLM or llama.cpp, or by the DeepSeek API.
Each provider keeps its own URL, API key and model, so switching between them in the Settings dialog needs no retyping.

## Features

- Pick the other party's language (English or Chinese) when creating a session
- Post Japanese to get it translated into the session's language, or post in that language to get Japanese (the direction is detected automatically and can be pinned from the composer)
- Switch a message bubble between the original and the translation with one click, and copy whichever is shown
- See the model's reasoning stream in while it translates; it collapses once the translation starts
- Keep a per-session glossary that the model must follow
- Edit a message's original text and translate it again, retranslate it, retranslate it in the opposite direction, or delete it
- History is stored on the server, so every device sees the same sessions

The UI is in Japanese.

## Requirements

- Node.js 22 or later (no npm dependencies)
- An LLM server with an OpenAI-compatible API, or a DeepSeek API key

## Getting started

```bash
cp config.example.json config.json
npm start
```

Open `http://localhost:8787`, then use 設定 (Settings) in the bottom-left corner to pick a provider, enter its URL (and API key for DeepSeek), run the connection test, and save.
Without a `config.json` the server starts with the defaults below and creates the file the first time settings are saved.

## Configuration

Per-environment values go in `config.json`.
Both this file and the translation history (`data/`) are ignored by git.

| Key | Default | Description |
| --- | --- | --- |
| `host` | `0.0.0.0` | Address to listen on |
| `port` | `8787` | Port to listen on |
| `dataFile` | `data/db.json` | Where sessions and history are stored |
| `settings.provider` | `local` | Provider used for translation: `local` or `deepseek` |
| `settings.providers.<id>.baseUrl` | `http://localhost:8000/v1` (`local`), `https://api.deepseek.com` (`deepseek`) | Base URL of the API, up to `/v1` for a local server |
| `settings.providers.<id>.apiKey` | empty | Required for DeepSeek, optional for a local server; never sent to the browser |
| `settings.providers.<id>.model` | empty (`local`), `deepseek-flash` (`deepseek`) | When empty, the first model from `/models` is used |
| `settings.temperature` | `0.3` | Ignored by DeepSeek while thinking is on |
| `settings.enableThinking` | `true` | Sent as `chat_template_kwargs.enable_thinking` to a local server and as `thinking.type` to DeepSeek |
| `settings.reasoningEffort` | empty | `low`, `medium`, `high` or `max`; not sent when empty or when thinking is off |
| `settings.contextMessages` | `30` | Number of recent messages passed as context |

`settings` can also be changed from the Settings dialog, which writes the values back to `config.json`.
A `config.json` from an earlier version with flat `settings.baseUrl`, `apiKey` and `model` keys is read as the `local` provider and rewritten in the new shape on the next save.
Changes to `host`, `port` and `dataFile` take effect after a restart.

## Project layout

```
server/index.js             HTTP server, API and static files
server/config.js            Reading and writing config.json
server/store.js             Session and history storage
server/translate.js         Prompt building and streaming LLM calls
public/                     UI (plain HTML, CSS and JavaScript; no build step)
public/shared/lang.js       Language definitions and detection, shared by server and UI
public/shared/providers.js  LLM provider definitions (defaults and thinking parameters), shared by server and UI
```

Earlier exchanges are sent as alternating user (original) and assistant (translation) turns, followed by the new text.
The glossary goes into the system prompt.

## Notes

- There is no authentication. Do not expose the server to the internet; restrict access with a VPN or similar.
- Over plain `http://` on a host other than localhost the Clipboard API is unavailable, so copying falls back to `document.execCommand('copy')`.

## License

[MIT](LICENSE)
