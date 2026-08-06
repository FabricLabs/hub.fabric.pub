# Sensemaker → Hub / `@fabric/http` / `@fabric/core`

Align downstream forks with Hub imports instead of duplicating.

## SPA routes (match Hub)

| Path | Component |
|------|-----------|
| `/settings` | `SettingsHome` |
| `/settings/security` | `SecurityHome` |
| `/sessions/:sessionId` | `SecuritySessionHome` |
| `/sessions`, `/security` | Redirect → `/settings/security` |

REST **`/sessions`** is unchanged. See **`package.json` → `exports`**.

## Layers

- **`@fabric/hub`** — `HubInterface`, `DelegationSigningModal`, `SettingsHome`, `SecurityHome`, `SecuritySessionHome`; `fabricDelegation`, `fabricDesktopAuth`; Electron `main` / `preload`.
- **`@fabric/http`** — SPA fallback + route order vs JSON APIs; **`POST /services/rpc`**.
- **`@fabric/core`** — Key/Identity; follow **`functions/fabricMessageRegistry.js`** for message strings.
