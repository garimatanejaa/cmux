# @brb/protocol

TypeScript client for the BRB relay. No runtime dependencies; works in React Native, Node 22+ and browsers.

    cd brb/protocol
    npm install
    npm test        # builds and runs 32 tests against a fake relay

What it covers:

- `register(baseUrl, code)` pairs with the one-time code from `brb-relay pair`; `getMe`, `getState`, `getPush`, `tokenIsValid`, `unpair`.
- `RelayClient` keeps one WebSocket open (hello, ping/pong, reconnect with backoff, re-subscribe), lists workspaces and surfaces, subscribes to terminals, sends text and keys, lists and answers agent prompts, and reports notifications.
- Screens: `screen.full` and `screen.diff` are applied for you and checked against `screen.checksum`; a mismatch asks for a fresh full screen.
- `parseAnsi` turns a terminal row into styled spans.

The wire format is the relay's existing one (subprotocol `cmuxremote.v1`, protocol version 1, bearer token in the WebSocket subprotocol list).
