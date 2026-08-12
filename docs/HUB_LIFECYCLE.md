# Hub.start lifecycle phases

Hub subclasses (downstream Hub apps, GoonVC) and operators should treat `Hub.start()` as a **named phase pipeline**, not a monolithic override target. Light peers (LiveRelay / `FabricNetwork`) stay **compose-only** and do not use these phases.

## Phases

Defined in [`functions/hubLifecycle.js`](../functions/hubLifecycle.js) as `HUB_START_PHASES` (also `Hub.START_PHASES`):

| Phase | Responsibility |
|-------|----------------|
| `diagnostics` | Agent / HTTP error and onion listeners |
| `filesystem` | Filesystem + federation bootstrap + chain |
| `bitcoin` | Bitcoin start (required when configured), early Beacon, Lightning |
| `services` | Payjoin, email, peering attach |
| `state` | STATE restore, migrations, challenge, genesis, contract deploy |
| `shell` | In-memory `applicationString` / developer docs |
| `routes` | REST mounts, identity HTTP, `_addAllRoutes()` |
| `rpc` | Trust bindings + JSON-RPC / agent listeners |
| `listen` | `agent.start()` + `http.start()` |
| `runtime` | WebRTC rebind, work queue, Beacon, `STARTED` + alert |

Order is intentional (including Bitcoin before full STATE and dual Beacon). Do not reorder without coverage.

## Subclass hooks

For each phase `name`, Hub invokes (when present):

1. Instance method `beforeName` / `afterName` (e.g. `beforeRoutes`, `afterRuntime`)
2. `settings.startHooks.beforeName` / `afterName` (async functions receiving `hub`)
3. Emits `hub:start:phase` with `{ phase, status: 'begin'|'end' }` around the body

### GoonVC-style (preferred)

Register Star Citizen (or other) HTTP routes **before** the listen phase:

```js
class App extends Hub {
  async beforeRoutes () {
    await this._prepareStarCitizen(); // must run before http.start()
  }

  async afterRuntime () {
    this._attachStarCitizenFabricRelay();
    await this._startDiscordGroupTracking();
  }

  // Prefer hooks + super.start() over reimplementing start()
}
```

Equivalent via settings:

```js
new Hub({
  startHooks: {
    beforeRoutes: async (hub) => { /* mount app routes */ },
    afterRuntime: async (hub) => { /* sidechain sync, etc. */ }
  }
});
```

### Skipping phases

- `settings.skipStartPhases: ['bitcoin']` — omit listed phases
- `settings.startPhases: ['filesystem', 'state', 'routes', 'listen']` — replace the full list (advanced / tests)

## Downstream Hub subclass migration note

Some downstream Hub subclasses currently **replace** `start()` and do not call `super.start()`. Prefer gradually:

1. Move app-only setup into `afterFilesystem` / `afterState` / `afterRoutes`
2. Call `await super.start()` for Hub identity HTTP, peering, RPC, listen, Beacon
3. Keep domain services (trainer, Discord, MySQL) in subclass hooks rather than a full Hub fork

Until that lands, those apps remain a parallel start path; do not assume Hub phase hooks run inside them.

## Tests

- `tests/hubLifecycle.test.js` — phase list, hooks, Hub prototypes
- Existing Hub HTTP / E2E suites exercise the full phased `start()`
