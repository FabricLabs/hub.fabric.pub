# Final release — UI consistency & polish plan
Living document for **hub.fabric.pub** / **Fabric Hub** desktop and web shell. It aggregates manual UI review (browser + Electron), accessibility snapshots, and operator feedback. Use with [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before tagging an RC.

**Last reviewed:** 2026-03-29 (**twelfth pass**: **`npm run build:browser`**, **`http://127.0.0.1:8080`**; **UI-56** SPA **`/services/payjoin` → Navigate** to Payments (`#wealth-payjoin-board`) or Bitcoin dashboard Payjoin anchor; **UI-90** **Treasury** link on **404** when Payments/Lightning flags on; **UI-92** / **UI-95** bootstrap copy — **“Checking hub configuration…”** + session **“Loading session…”**; **§2.16**. Eleventh pass: Identity modal + **§2.15**; tenth: **§8**, **UI-100–UI-103**.)

---

## 1. Goals for RC UI
- **One coherent story** for connection state (bridge, WebSocket, Bitcoin RPC) without contradictory badges.
- **Predictable navigation**: primary destinations appear once per viewport region; deep links match page titles.
- **Empty / locked / loading** states use plain language and a single primary action where possible.
- **Library and activity feeds** sort and label consistently (newest-first or documented order).

---

## 2. Findings (backlog)
Severity is **release-blocking (P0)**, **should fix for RC (P1)**, or **post-RC (P2)**.

### 2.1 Connection & status copy
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-01 | P1 | Bridge strip shows **green “Online”** while **state reads “PAUSED”**. Operators read that as a bug. | Unify into one status model, e.g. “Connected · idle” vs “Connected · syncing”, or hide “Online” when paused. |
| UI-02 | P1 | Copy like **“Loading … WebSocket connected — waiting for network status”** (home, documents) mixes two ideas. | Split: transport line vs data line, or show a single progress step until `GetNetworkStatus` returns. |
| UI-03 | P1 | With **Bitcoin disabled** or **Core down**, health / reachability panels can imply RPC is fine (stale probe vs reality). | Gate probes on `services.bitcoin.available`; show “Bitcoin off” or “Unreachable” explicitly. |
| UI-04 | P2 | **Operator health**: short uptime next to **high load averages** reads inconsistent; macOS load semantics confuse users. | Tooltip or doc link; or label load as “system (1/5/15 m)”. |

### 2.2 Navigation & information architecture
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-10 | P1 | **Two dense shortcut rows** (top nav + gray bar): Peers, Documents, Contracts, Activities, Bitcoin, Settings, etc. appear twice. | Collapse into top nav + **More** only, or demote the bar to “context shortcuts” with a label. |
| UI-11 | P1 | **404 / not-found** route shows **duplicate Home, Peers, Documents, Contracts** (top nav + “Suggested pages”). | Deduplicate: one nav; 404 body only suggests less-common destinations. |
| UI-12 | P2 | **Settings** hub lists **“Bitcoin wallet & derivation”** twice and **Beacon Federation** adjacent to duplicate federation links; cards feel repetitive. | Merge cards or use subheadings inside one card. |
| UI-13 | P2 | **`/peers` without admin token** redirects to **`/settings/admin`** but banners still say “you opened `/peers`” while the page title is **Admin**. | Align copy: “Peers require an admin token” as the H1, or preserve `/peers` with a locked overlay. |

### 2.3 Wallet, identity, and warnings
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-20 | P1 | Balance chip shows **“…”** or **“0 sats”** with a **warning** affordance while identity is **Locked** — easy to read as a fault. | When locked: “Unlock to show balance” without alarm icon; reserve warning for real errors. |
| UI-21 | P2 | **Admin token missing**: multiple **yellow/blue banners** repeat the same requirement. | One primary banner + link to token field; collapse secondary hints. |
| UI-22 | P2 | **Documents** page: two headings named **“Documents”** (section + list); hierarchy is unclear. | Rename inner block (e.g. “Catalog” / “Your files”). |

### 2.4 Library, activities, and feeds
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-30 | P1 | **Home library** list: **Bitcoin block** documents appear with **inconsistent sort** (height not monotonic in the visible window). | Sort by published time or block height with one rule; document in UI. |
| UI-31 | P2 | **Activities** exposes **purge** next to every row; visually heavy for non-admins (buttons may no-op or error). | Hide or collapse until admin token present; use overflow menu. |
| UI-32 | P2 | Duplicate **“Activities”** links on **`/`**: **`Home.js`** exposes **(1)** **Go to → Activities** button, **(2)** inline **`<Link to="/activities">Activities</Link>`** in the **Delegation** paragraph when **`uf.activities`**, and **(3)** the **Activities** section below (plus top nav / bell) — screen readers can see **multiple** consecutive **“Activities”** links. | Keep one in-body path to **`/activities`** or differentiate **accessible names** (e.g. “Open full activity feed”). |

### 2.5 Visual & a11y
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-40 | P2 | **“Open activities”** / footer actions can sit **flush to viewport bottom** and feel clipped. | Bottom padding / safe-area for desktop window. |
| UI-41 | P2 | **Semantic structure**: multiple `heading` nodes share the same accessible name as following body text in snapshots. | Prefer `aria-describedby` or paragraph under one heading. |
| UI-42 | P2 | **Iconography**: some toolbar icons read as **placeholders** (e.g. square before “Connect to ID…”). | Confirm Semantic-UI icon font loading in Electron. |

### 2.6 Developer workflow (not end-user UI)
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| DEV-01 | P2 | **`npm link @fabric/core`** drops hoisted deps; hub now uses **`patchLinkedFabricNodePath`**, **webpack `resolve.modules`**, and **`link-fabric.sh`** follow-up installs. | Document in README/AGENTS; run **`npm run link:fabric`** after **`npm install`**. |

### 2.7 Extended pass — settings, Bitcoin deep links, detail routes
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-43 | P1 | **`/settings/admin` → Feature visibility**: many **checkboxes** appear in the a11y tree **without names** (only one listbox labeled). Screen readers cannot tell which toggle is which. | Wire each toggle to visible label + `id`/`htmlFor` or `aria-labelledby`. |
| UI-44 | P2 | **`/settings/admin/beacon-federation`**: **duplicate links** to the same endpoints (e.g. GET epoch, vault, UTXOs, Sidechain & demo) in the shortcut strip. | Deduplicate link groups or collapse into one “API” menu. |
| UI-45 | P2 | **`/settings/federation`**: **Liquid (liquidv1)** reference block shares **accessible names** with the main form (“Validator pubkeys…”, “Threshold”) in snapshots — fields may be conflated in SR navigation. | Isolate reference cards in `<fieldset aria-label="Liquid reference">` with non-interactive summaries only. |
| UI-46 | P2 | **`/settings/bitcoin-wallet`**: **Payments** appears **twice** in the related-links row. | Single link or “Payments · Resources” grouped once. |
| UI-47 | P2 | **`/services/bitcoin/blocks` (Explorer)**: **“No block data yet”** while the home library may still show Bitcoin-linked documents — operators may think the explorer is broken. | Explain data source (RPC vs explorer URL), add refresh affordance copy, or align empty state with `GetBitcoinStatus`. |
| UI-48 | P2 | **Amount / fee fields** often read as the **current numeric value** in the a11y tree, not the field purpose: **faucet** (“10000”), **Lightning** create-invoice (“500”), **Payments** Make Payment (“1000”). **Sidechains** L1 escrow section: **two distinct fee inputs** can both expose the same accessible name when values match (e.g. **“2000”**). | Stable `aria-labelledby` / labels; never use the value as the accessible name. |
| UI-49 | P2 | **`/documents/:id`**: **H2** is the **raw document id** (hex) while “Loading document…” — human title missing until load completes. | Show “Document” + subtitle id, or skeleton title from list cache. |
| UI-50 | P2 | **`/features`**: snapshot showed **duplicate “Locked”** controls (same role/name repeated). | One lock control; dedupe toolbar markup. |
| UI-51 | P2 | **`/sidechains`**: many **textboxes without names** in the operator/demo form region. | Label every control; group under `fieldset` per workflow step. |
| UI-52 | P2 | **`/services/bitcoin/resources`**: **quick-open** actions embed **long wallet-specific paths** in the visible/accessibility label. | Short label + `aria-describedby` for full path, or copy path on demand. |
| UI-53 | P2 | **`/services/bitcoin/crowdfunds`**: **duplicate spinbutton names** (e.g. two “0”) in the a11y tree. | Distinct labels per field (goal, raised, min, etc.). |
| UI-54 | P2 | **`/contracts`** and **`/contracts/:id`**: snapshots often show **only the H2** (“Contracts” / “Contract”) with **little or no body** — unclear if **loading**, **empty**, or **mount timing**. | Skeleton rows, empty-state copy, and ensure list/detail mount after contract RPCs complete. |
| UI-55 | P2 | **Bitcoin sub-pages** (**Invoices**, **Payments**): **Faucet** / cross-links repeat across nav and in-page strips (overlaps **UI-12**). | One canonical strip per sub-area. |
| UI-56 | P2 | **`/services/payjoin`** in the **SPA**: **“Page not found”** (“No hub UI for /services/payjoin”) while the **REST** service lives on the same path for JSON clients. | Redirect to **Payments** / Payjoin workflow, or render a small **capabilities** panel for HTML. |
| UI-57 | P2 | **`/peers/:id`**: **H2** repeats the **same fabric id** multiple times plus **“Resolving…”** in one long accessible name. | Single id in title; move status to a **status line** or `aria-live` region. |
| UI-58 | P1 | **`normalizeFlags`** in [`functions/hubUiFeatureFlags.js`](../functions/hubUiFeatureFlags.js) **does not persist “off”** for **`peers`** (only promotes `true` from raw over defaults, so **`peers: false` is ignored** and stays **true**). It also **forces** **`activities`**, **`features`**, **`bitcoinExplorer`**, and **`bitcoinInvoices`** to **`true`** after every load/save. **Admin → Feature visibility** toggles for those keys **cannot hide** their routes; **`UiFlagRoute` / `featureFlagBlocked` paths for those flags are effectively unreachable** from saved state. | Treat explicit **`false`** in stored flags for applicable keys, or **remove/disable** toggles that are intentionally always-on and align copy with code. |
| UI-59 | P2 | **`/services/bitcoin/payments` → Wallet Controls**: **Payjoin / plain address** (and related) **checkboxes** lack **programmatic names** in accessibility snapshots. | `aria-label` or `label`+`htmlFor` matching the visible caption. |

### 2.8 Verification notes (feature flags)
- **Runtime check** (2026-03-29): `saveHubUiFeatureFlags({ peers: false })` then `loadHubUiFeatureFlags().peers` → **`true`**. Same save including `features: false` → loaded **`features` / `activities` / `bitcoinExplorer` still `true`**.
- **Browser profile**: operators who previously turned **sidechain** or **bitcoinPayments** **on** in `localStorage` will still reach those routes; **default** profiles have **bitcoinPayments** off until enabled (then **UiFlagRoute** redirect to **`/settings/admin`** with **`routeBlockedHint`** works for those keys).
- **Redirect UX** when a flag works: Admin shows **“That page is hidden in this browser”** with **`blockedPath`** and the **UI_FLAG_LABELS** name — copy is clear (**AdminHome.js**).

### 2.9 Identity management — modals, lock state, Bridge
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-60 | P1 | **Identity modal / shell flicker**: **`IdentityManager`** used **`key` switching `open`/`closed`**, forcing a **full remount** on every open/close. **`HubInterface.onLocalIdentityChange`** **blocked** merging **xprv cleared** for the **same** user, so **`IdentityManager`’s 30m auto re-lock** fought **`currentIdentity` sync** (child dropped **xprv**, parent still had it → sync **re-injected** **xprv**). Repeated **`onRequireUnlock`** could call **`setState({ uiIdentityOpen: true })`** many times per second (chat/peer paths). | **Mitigations in tree (2026-03-29):** stable **`key="fabric-identity-manager"`**; allow **same id+xpub** to drop **xprv**; set **`uiHasLockedIdentity`** from **`!xprv && passwordProtected`**; **600ms** cooldown **`openIdentityModalFromGatedAction`** for Bridge/Home/Activities/DocumentView; **`_handleLockIdentity`** sets **`uiHasLockedIdentity`** only when **`passwordProtected`**. **Still validate** under password-protected identity + rapid WS traffic. |
| UI-61 | P2 | **“Locked”** in the top bar was used for **xpub-only / watch-only** users (not the same as **password encryption**). | **Shipped:** **Watch-only** label + **`eye`** icon + tooltips (**TopPanel**). Sweep **DocumentView** / **Bridge** strings that still imply password lock only. |
| UI-62 | P2 | **`Bridge`** `componentDidUpdate`: **`prevProps.auth !== this.props.auth`** — if **`effectiveAuth`** is a **new object** each parent render, **`signingKey`** may be rebuilt **every frame** (wasted work; theoretical edge cases). | Stable identity reference in **`HubInterface`** (e.g. **`useMemo`**-style merge) or **field-wise** compare before `new Key(auth)`. |
| UI-63 | P2 | **Stacked modals**: **Forget identity** confirm is a **Modal** inside the **IdentityManager** **Modal** — **ESC** / focus trap can behave inconsistently. | Test in Chrome + Electron; consider **Dialog** layering or single modal with steps. |

### 2.10 Additional routes, shortcuts, and copy drift
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-64 | P2 | **Two SPA URLs** render the same **`LightningHome`**: **`/services/lightning`** and **`/services/bitcoin/lightning`**. Nav, docs, and resources mix both; bookmarks and “canonical” links diverge. | **`Navigate`** from one path to the other (pick **`/services/bitcoin/lightning`** for consistency with other Bitcoin sub-pages) or document one as legacy. |
| UI-65 | P2 | **`UnknownRouteShell` (404)** always offers **Admin**, **Faucet**, and other shortcuts **without** matching **UiFlagRoute** / **admin token** gates used elsewhere — same duplication issue as **UI-11**, plus **Admin** for users with no token. | Gate **Admin** / **Peers** like **TopPanel**; hide **Faucet** / Bitcoin sub-shortcuts when the corresponding feature flags are off. |
| UI-66 | P2 | **Path collision clarity**: SPA **`GET /sessions`** (no id) **`Navigate`s** to **`/settings/security`**, while the Hub **REST** API uses **`/sessions`** for delegation. Operators reading docs can confuse **browser URL** vs **JSON API**. | In **Settings** / **Security** copy, state explicitly: “Browser path `/sessions` redirects here; REST delegation API remains **`/sessions`**.” |
| UI-67 | P2 | **`LoginGate`** (**HubInterface**) is titled **“Log in required”** and pushes the full **create/restore** narrative — users with **watch-only** identity still need signing, not first-time login. **Note:** **`LoginGate` is not mounted** in the shipping **`HubInterface`** router (**UI-71**); treat this as **future gating** or **copy to mirror** if similar text appears on live surfaces. | If wired: detect **local identity without xprv** and show **“Full key required”** / link to **Fabric identity** (align with **UI-61**). Otherwise remove dead component or document intent. |
| UI-68 | P2 | **`BottomPanel`** runs **`setInterval(..., 1000)`** to update the clock, **`setState` every second** on every page — unnecessary React churn for a footer timestamp. | Render time via **`requestAnimationFrame`**, update once per minute, or a small **DOM** text node outside React. |
| UI-69 | P2 | **Bookmark `/wallet`** redirects to **`/services/bitcoin/transactions`** (tx list), not the **Bitcoin dashboard** or **settings → Bitcoin wallet** — the name suggests balance/overview. | Redirect to **`/services/bitcoin`** with **`#`** to wallet section, or rename shortcut to **“Transactions”** in docs. |
| UI-70 | P2 | **`FeaturesPage`**: (1) Primary blue button **`to="/settings/security"`** but **`identityButtonLabel`** shows **Log in / Locked / xpub** — reads as **identity** but opens **Security**. (2) **`refreshIdentityButtonLabel`** sets **“Locked”** for **any** `fabric.identity.local` with id/xpub/**including xpub-only** — inconsistent with **TopPanel** **Watch-only** (**UI-61**). (3) Body copy says Activities / Features / explorer are **“always on”** while **UI-58** documents **misleading / forced-on** toggles. | Point identity CTA at **`fabricOpenIdentityManager`** or **`/settings`** identity card; mirror **TopPanel** lock vs watch-only rules; soften or fix **“always on”** wording. |

### 2.11 Dead code, onboarding gate, latent marketing shell
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-71 | P2 | **Unwired UI**: **`LoginGate`** is defined in **`HubInterface`** but **never** rendered in the route tree. **`Splash.js` / `FrontPage.js`**, **`Dashboard.js`**, and **`AccountCreator.js`** are **not** imported from **`HubInterface`** or **`scripts/browser.js`** — default web/desktop shell never loads them. **`contracts/ux.dot`** still routes **DocumentView** / **ActivityStream** through **LoginGate** (diagram ≠ code). | Delete or register routes; update **ux.dot**; if **Splash** ships, fix **FrontPage** (**UI-73**) and **`constants` exports** (**UI-88**). |
| UI-72 | P2 | **`Onboarding`**: first-run **`Modal`** uses **`onClose={() => {}}`** and **`closeIcon={false}`** — **no dismiss** except completing setup or **full page refresh** (ESC/dimmer ineffective). | Confirm intentional; if yes, state in copy; if no, allow cancel with warning or “skip later” path. |
| UI-73 | P2 | **`FrontPage`** (inside **`Splash`**) hero **“Log In”** links **`/settings/security`**, not identity onboarding — same **identity vs security** confusion as **UI-70**. **Latent** while **Splash** is unwired (**UI-71**). | When marketing shell is mounted, align CTA with **`/settings`** identity card or **open identity manager**. |
| UI-74 | P2 | **`DelegationSigningModal`**: desktop path uses **`setInterval(..., 2000)`** to poll loopback **`/sessions`** while the modal is open — periodic work in background (**same theme** as **UI-68**). | Back off interval, **single-flight** fetch, or event-driven updates when session state changes. |
| UI-75 | P2 | **`InvoiceListHome`**: sticky back control shows **Explorer** and **`aria-label="Back to Bitcoin explorer"`** but **`to="/services/bitcoin"`** (Bitcoin **dashboard**, not **`/services/bitcoin/blocks`**). | Rename to **Bitcoin** / **Dashboard** or link to the explorer route if that is the intent. |
| UI-76 | P2 | **`FeaturesPage.js`** header comment references **Splash** **FrontPage** **“Learn more”** grid alignment — **Splash** is not mounted in the default shell (**UI-71**), so maintainers may chase a **non-runtime** coupling. | Update comment to “if Splash is re-enabled” or remove until **Splash** is wired. |
| UI-77 | P2 | **`BitcoinTransactionsHome`**: every **`refresh()`** begins with **`setState({ loading: true, … })`**; **`componentDidMount`** schedules **`setInterval(refresh, 10000)`**. On **`/services/bitcoin/transactions`** (and **`/wallet`** redirect), the table **re-enters the loading state** on each poll — jarring flicker while the page stays open. | **Silent** background refresh (keep prior rows visible + small “Updating…” affordance), or set **`loading: true`** only on **first** mount / identity change. |
| UI-78 | P2 | **Legacy path aliases** (**`HubInterface`**): **`/tx/:txhash`** with a **missing** hash redirects to **`/services/bitcoin`** (top of page); **`/block/:blockhash`** with a **missing** hash redirects to **`/services/bitcoin#bitcoin-explorer`**. Inconsistent “empty bookmark” behavior. | Align both to the same target (dashboard vs explorer anchor). |
| UI-79 | P2 | **Browser extension** (**`extension/scripts/popup.js`**) renders the **full `HubInterface`** (same Redux + routes as the main site) inside the **extension popup** — top bar, shortcut rows, and wide tables are **not** tuned for a **narrow / short** viewport; operators may see **clipping**, **overflow scroll**, or **unusable** modals. | Dedicated **compact** layout for the extension build, or prominent **“Open Hub in tab”** with popup as launcher-only. |

### 2.12 Full component / copy sweep (sixth pass)
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-80 | P2 | **“Locked”** copy still assumes **password-encrypted** identity in several **live** surfaces, after **TopPanel** introduced **Watch-only** (**UI-61**): **`ActivityStream`** (chat disabled reason + footer line), **`DocumentView`**, **`DocumentList`**, **`BitcoinPaymentsHome`** error text, **`SidechainHome`** toast, **`Bridge`** `IDENTITY_UI_UNLOCK_SUFFIX`, **`SettingsBitcoinWallet`** (no-xpub warning). **Watch-only** users are told to use the **Locked** control / password flow. | Mirror **TopPanel** rules: **Watch-only** → import full key / desktop signing; **Locked** → password unlock only. |
| UI-81 | P2 | **`ChatInput`**: Semantic **`Input`** wraps a bare **`<input />`** with **no** `aria-label` / associated `<label>`; accessible name may rely only on **placeholder** (weak for SR). **`ActivityStream`** passes **`title`** but it may not map to the inner input. | `aria-labelledby` / `id`+`htmlFor` or `aria-label` aligned with **Send message** button. |
| UI-82 | P2 | **Unregistered custom elements** wrap major regions: **`<fabric-interface>`**, **`<fabric-container>`**, **`<fabric-react-component>`** (**`HubInterface.js`** shell), **`<fabric-hub-home>`** (**`Home.js`**), **`<fabric-activity-stream>`** (**`ActivityStream.js`**), **`<fabric-hub-splash>`** / **`<fabric-component>`** (**`Splash.js`**), **`<fabric-hub-front-page>`** (**`FrontPage.js`**), **`<fabric-hub-header>`** (**`HeaderBar.js`**). **`browser.js`** does not call **`customElements.define`** — browsers treat them as **unknown** elements (semantics / some assistive tech / styling edge cases). | Register no-op classes, replace with **`div`** + `role`/`data-testid`, or document intentional use. |
| UI-83 | P2 | **Delegation OPSEC**: **`/sessions/:sessionId`** puts the **full bearer token** in the **URL path** ( **`SecuritySessionHome`**, links from **`SecurityHome`**). **History**, bookmarks, and screen shares can leak it; **SecurityHome** also lists **token previews** for all loopback-visible sessions. | Operator docs: do not share URLs; consider **fragment** / in-memory state for new flows; warn on copy-paste. |
| UI-84 | P2 | **`UnknownRouteShell`** (**extends UI-65**): **Faucet** is **always** linked (no **`hubUiFeatureFlags`** gate) while **Payments**, **Invoices**, **Explorer**, etc. are conditional. **Lightning** shortcut points to **`/services/lightning`**, not **`/services/bitcoin/lightning`**, diverging from other Bitcoin sub-nav (**UI-64**). | Gate **Faucet** like other Bitcoin affordances; align Lightning shortcut with canonical path. |
| UI-85 | P2 | **Sidechain** UI is reachable from **three** SPA paths that **`Navigate`** into the same experience: **`/services/sidechain`**, **`/sidechain`**, **`/sidechains`** — triple bookmarks / docs drift (parallel issue to **UI-64** Lightning). | **`Navigate`** aliases to one canonical path or document **one** official URL. |
| UI-86 | P2 | **`ChannelView`**: HTTP helpers use **`upstream.lightningBaseUrl || '/services/lightning'`** — another default on the **`/services/lightning`** leg of the **Lightning** URL split (**UI-64**). | Same as **UI-64**: one canonical service base in UI + client config. |
| UI-87 | P2 | **Crowdfunding** naming split: **REST** JSON lives under **`/services/bitcoin/crowdfunding/...`** (see **`BitcoinResourcesHome`**, **`bitcoinClient`**), while the **operator SPA** is **`/services/bitcoin/crowdfunds`** (and **`/crowdfunds`** redirect). Easy to paste the wrong path when debugging. | Glossary in operator docs; optional redirect from one spelling to the other for HTML clients only. |
| UI-88 | P2 | **Marketing shell fragility**: **`Splash.js`** destructures **`BRAND_NAME`**, **`ENABLE_LOGIN`**, **`ENABLE_REGISTRATION`** from **[`constants.js`](../constants.js)**, which **does not export** those keys — imports are **`undefined`** (silent). **`HeaderBar.js`** imports **`ENABLE_LOGIN`** similarly and is mostly **commented-out** UI (only **`<fabric-hub-header>`** + spacer) — little value on **`FrontPage`** if wired. | Export real constants or remove destructuring; finish or delete **HeaderBar** chrome. |
| UI-89 | P2 | **`/services/bitcoin/faucet`** (**`HubInterface`**): **`FaucetHome`** is mounted on a **bare `Route`** — **not** behind **`UiFlagRoute`**, unlike **`bitcoinExplorer`** / **`bitcoinPayments`** neighbors. Operators on **non-regtest** still get the full faucet UI (likely **errors on submit** rather than a clear **“regtest only”** gate at the route level). **Extends** the **404 always shows Faucet** issue (**UI-84**). | Wrap with a flag, or **`Navigate`** away when `bitcoin.network !== 'regtest'`, or prominent **network** banner at top of **`FaucetHome`**. |

### 2.13 Nav parity, bootstrap copy, incomplete systems (eighth pass)
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-90 | P2 | **Treasury** (Payjoin/Lightning anchor on **`/services/bitcoin`**) appears only on the **Home** “Go to” strip (**`Home.js`**) — not in **`TopPanel`** **More** menu, not in **`UnknownRouteShell`**. Operators who rely on the header never see the **Treasury** label; **Payments** / **Lightning** are separate entries elsewhere. | Add **Treasury** to **More** + 404 (flag-gated like Payments/Lightning) or drop the label and use **Payments** / **Lightning** only. |
| UI-91 | P2 | **`TopPanel`** **More** menu always includes **Faucet** (**no** `hubUiFeatureFlags` check), same pattern as **404** (**UI-84**) and unlike **Payments** / **Explorer** / **Invoices**. | Gate **Faucet** with a flag or regtest-only affordance. |
| UI-92 | P2 | **`HubInterface`**: while **`!setupChecked`**, the shell shows **“Connecting to Hub…”** — that state is really **fetching setup / settings bootstrap**, not proof the TCP/WebSocket path is up. Misleading when the hub is slow or **CORS/settings** fail. | Copy like **“Checking hub configuration…”**; align with **R-05**. |
| UI-93 | P2 | **`UnknownRouteShell`** and **`ActivitiesHome`**: shortcut to **`/settings/security`** uses visible **“Security & delegation”** but **`aria-label`** differs — **404** uses **“Security and delegation”**; **Activities** strip uses **“Security, delegation tokens, and session audit”**. Accessible name ≠ visible text in both places. | Match **`aria-label`** to visible string (or **`aria-labelledby`**). |
| UI-94 | P2 | **`AdminHome`**: heading **Feature visibility (this browser)** can read as **local-only**; body text explains **`localStorage`** + optional **disk** persist via admin token. Other browsers still start from **their** cached flags until they reload settings — **multi-operator drift**. | Rename heading (e.g. “Feature visibility”) and add one line: “Each browser merges local cache with hub-stored defaults when loaded.” |
| UI-95 | P2 | **`HubInterface`**: when **`props.auth.loading`** (Redux), the UI is a **full-viewport `Loader` only** — **no** caption. The next branch uses **Loader + “Connecting to Hub…”**. **Inconsistent** first-run / auth-hydration experience. | Add a short shared caption for both loading gates. |
| UI-96 | P2 | **Incomplete product surface**: **`scripts/browser.js`** keeps **`fabric-chat-bar`** commented out (**TODO** restore); **`AGENTS.md`** still references it. No in-shell chat bar despite peer/chat elsewhere (**ActivityStream**). | Remove doc references or ship a minimal bar; avoid “coming soon” drift. |
| UI-97 | P2 | **i18n not started**: **`Splash.js`**, **`FrontPage.js`**, **`HeaderBar.js`** carry **`TODO: use i18n`**; strings are hard-coded English. | Track as post-RC unless i18n is in scope for RC. |
| UI-98 | P2 | **`components/Dashboard.js`**: still contains **`TODO: review and determine what to do with this function`** on the refresh/timer path — file is **unwired** (**UI-71**) but signals **unfinished** refactor. | Delete file or wire; clear TODO. |
| UI-99 | P2 | **`components/AccountCreator.js`**: **no** imports from **`HubInterface`** / **`browser.js`** — parallel to **Dashboard** / **Splash**; **account-creation** story may be duplicated in **`IdentityManager`** only. | Remove dead module or document as sample. |

### 2.14 Route gating & a11y (tenth pass — code audit)
| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-100 | P2 | **`/services/bitcoin/transactions`** (**list**, hub **Send Payment**, live stream) is **not** behind **`UiFlagRoute`**, but **`/services/bitcoin/transactions/:txhash`**, legacy **`/tx/:txhash`**, and **`/services/bitcoin/blocks/:blockhash`** **are** gated by **`bitcoinExplorer`**. **`/wallet`** always redirects into the **ungated** list. Operators with **Explorer** “off” still see wallet/send UI but hit **Admin** when opening a **tx** detail — splits one mental model across two flags. | Gate the list with **`bitcoinExplorer`**, split a dedicated **wallet** flag, or document that **Explorer** means “lookup/detail” only; align **`/wallet`**. |
| UI-102 | P2 | **`UnknownRouteShell`**: **Sidechain** suggestion uses **`aria-label="Sidechain and demo"`** while the button text is **“Sidechain”** — SR/visible mismatch. | Align **`aria-label`** with visible label or **`aria-labelledby`**. |
| UI-103 | P2 | **`/sessions/:sessionId`** (**`SecuritySessionHome`**) is **not** wrapped in **`UiFlagRoute`** (contrast **`/sidechains`**, **`/peers`**). Session audit UI is reachable by URL whenever the route matches (token-in-path concerns remain **UI-83**). | Optional **`UiFlagRoute`** / “security” umbrella flag, or explicit copy that this path is **session-scoped** not **feature-scoped**. |

### 2.15 Eleventh pass — shell + identity smoke (pre-implementation freeze)
Manual run after **`npm run build`**; hub **`http://127.0.0.1:18080`**. **Identity** changes kept: **Restore with recovery phrase**, **Import mnemonic (hub / dev)**, generate-flow **backup acknowledgment** checkbox, **Import Backup** mnemonic-in-JSON, **`fabricBrowserIdentityDev`** session snapshot fix.

| ID | Severity | Finding | Suggested direction |
|----|----------|---------|---------------------|
| UI-104 | P2 | **`IdentityManager`** intro **`Message`**: bold inline **“restore recovery phrase”** immediately before a comma produced awkward screen-reader phrasing (“phrase , hub”). | **Shipped (2026-03-29):** plain wording *restore from recovery phrase* in the list (no bold before comma). |
| UI-105 | P2 | **Restore / dev mnemonic** **`Form.Checkbox`** (“Replace identity…”) and **generate** backup **`Form.Checkbox`** could surface as **unnamed** checkbox in a11y snapshots. | **Shipped (2026-03-29):** **`aria-label`** on those checkboxes. |

**Reconfirmed (unchanged backlog):** **`/`** with populated library: **two** **Activities** links (**UI-32** / **R-14**); **UI-41**-style heading+body name collisions on **Delegation** / **Activities** regions; **UI-02** loading copy when status still pending.

### 2.16 Twelfth pass — Payjoin deep link, 404 Treasury, bootstrap copy (2026-03-29)
| ID | Severity | Change |
|----|----------|--------|
| UI-56 / R-01 | P2 | **Shipped:** **`HubInterface`** registers **`Route path="/services/payjoin"`** → **`NavigatePayjoinSpaAlias`** (Payments **`#wealth-payjoin-board`** when **`bitcoinPayments`**, else Bitcoin **`#fabric-bitcoin-payjoin`**). REST **`GET /services/payjoin`** with **`Accept: application/json`** unchanged on the server. |
| UI-90 | P2 | **Shipped (404 parity):** **`UnknownRouteShell`** adds **Treasury (Payjoin / Lightning)** when **`bitcoinPayments` || `bitcoinLightning`**. (**TopPanel** **More** already had Treasury — plan row was stale.) |
| UI-92 | P2 | **Shipped:** **`!setupChecked`** shell copy **“Checking hub configuration…”** + subline clarifying setup fetch vs WebSocket. |
| UI-95 | P2 | **Shipped:** **`auth.loading`** full-screen loader + **“Loading session…”** caption (matches setup gate style). |

---

## 3. Release criteria (UI)
Before calling the RC “done” from a product perspective:

1. **UI-01** resolved or explicitly accepted with operator-facing note in CHANGELOG.
2. **UI-10** addressed or reduced (no triple repetition of the same four primary tabs on common pages).
3. **UI-20** does not show a **warning** state for normal “locked identity”.
4. **404** view (**UI-11**) does not duplicate the full primary nav twice.
5. Spot-check: **Peers**, **Documents**, **Activities**, **Settings**, **Bitcoin** (or disabled Bitcoin), **Admin** — each has a clear **H1** matching the route purpose.
6. **Admin feature toggles** (**UI-43**): each visibility checkbox has a **programmatic name** (P1 for WCAG-minded RC; otherwise document exception).
7. **Feature visibility semantics** (**UI-58**): either **honor** “off” for **peers** / optional routes, or **remove misleading toggles** and document which areas are always on (P1 for honest operator UX).

Automated checks (existing): `npm run test:browser`, `HUB_E2E=1` flows per [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

**Manual route matrix:** [§6](#6-route-coverage-matrix). **Exhaustive router table** (every **`HubInterface`** path): [§8](#8-exhaustive-spa-route-catalog-hubinterface).

---

## 4. Suggested implementation order
1. **Status model** (UI-01, UI-02, UI-03) — single source of truth from Bridge + `GetNetworkStatus` + bitcoin status cache.
2. **404 + nav dedupe** (UI-11) — quick win, high visibility.
3. **Library sort** (UI-30) — data ordering in hub state or UI sort.
4. **Wallet chip** (UI-20) — conditional styling when locked.
5. **Settings / admin banners** (UI-21, UI-13) — copy and layout pass.
6. **Shortcut row** (UI-10) — larger IA change; schedule post-RC if needed.
7. **Admin a11y** (UI-43) and **Beacon Federation link dedupe** (UI-44) — operator-facing polish.
8. **`hubUiFeatureFlags` normalization** (UI-58) — before more route-gating work.
9. **Identity shell** (UI-60–63) — confirm flicker gone; **Bridge** `auth` reference stability (UI-62).
10. **404 shortcuts** (**UI-65**) and **Features / Login copy** (**UI-67**, **UI-70**) — reduce misleading CTAs before RC if time allows.
11. **Dead routes / diagrams** (**UI-71**) and **onboarding escape hatch** (**UI-72**) — avoid contributor confusion and stuck first-run operators.
12. **Locked vs Watch-only copy sweep** (**UI-80**) and **404 shortcut parity** (**UI-84**) — align with **UI-61** / **UI-65**.
13. **Delegation URL OPSEC** (**UI-83**) and **custom element semantics** (**UI-82**) — document or fix before encouraging wide use of session links.
14. Re-run **§7** smoke (Payjoin 404, home bridge status, documents sort, peers redirect, port match) after each **desktop** / bundle release candidate.
15. **Treasury / Faucet / Security** parity (**UI-90**, **UI-91**, **UI-93**) and bootstrap copy (**UI-92**, **UI-95**) — quick IA + trust fixes.
16. **Transaction list vs Explorer flag** (**UI-100**) and **session route policy** (**UI-103**) — align gating with operator mental models.

---

## 5. References
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — CI, pins, tagging, deploy.
- [PRODUCTION.md](PRODUCTION.md) — runtime configuration.
- [PEER_MANAGEMENT_AND_LINK.md](../PEER_MANAGEMENT_AND_LINK.md) — Fabric peer UX context.

When items are fixed, move them to a **“Resolved (version)”** subsection or delete rows and note the version in CHANGELOG.

---

## 6. Route coverage matrix
Status key: **Y** = opened in this or prior audit pass; **—** = not exercised in latest pass (still validate before RC).

| Route | Latest pass | Notes |
|-------|-------------|--------|
| `/` | Y | Library sort **UI-30**; connection copy **UI-01–02**; runtime **R-02**, **R-08**, **R-19**; **Treasury** shortcut **UI-90**; duplicate **Activities** **R-14** |
| `/features` | Y | **UI-50** duplicate Locked; page lists **Admin** among shortcuts without token gate (**UI-65**); first paint can show **Connecting to Hub…** briefly (**R-05**) |
| `/activities` | Y | Purge affordance **UI-31**; **ActivityStream** + **ChatInput** **UI-80** / **UI-81**; chat field a11y name may fall back to placeholder **“Type a message…”** (**UI-81**); **Security** strip button **aria-label** vs visible text **UI-93** |
| `/sidechains` | Y | Unnamed inputs **UI-51**; duplicate numeric names **UI-48**; aliases **`/sidechain`**, **`/services/sidechain`** — **UI-85**; with **sidechain** flag off, **`Navigate`s** to **`/settings/admin`** + **`routeBlockedHint`** (**R-16**) |
| `/peers` | Y | Admin token redirect **UI-13**; runtime **R-04**, **R-07** |
| `/peers/:id` | Y | Noisy H2 **UI-57**; empty-state copy OK |
| `/documents` | Y | **UI-22**; **UI-80** unlock copy (**DocumentList**); published list can surface **many** **Bitcoin block** rows alongside files — ordering **UI-30** / **R-03**; a11y snapshots can list **hundreds** of block links when the catalog is large |
| `/documents/:id` | Y | **UI-49**; **UI-80** unlock copy (**DocumentView**) |
| `/contracts` | Y | Sparse list **UI-54** |
| `/contracts/:id` | Y | Sparse body **UI-54** |
| `/settings` (overview) | Y | Card duplication **UI-12**; snapshot shows **two** **“Bitcoin wallet & derivation”** links (**e15**/card + **e16**/long description) |
| `/settings/security` | Y | Delegation sessions; **UI-66** vs REST **`/sessions`**; **UI-83** list UX |
| `/settings/bitcoin-wallet` | Y | **UI-46** (duplicate **Payments** links in related row — runtime); **Locked**-only warning copy **UI-80** |
| `/settings/federation` | Y | **UI-45** |
| `/settings/admin` | Y | **UI-43** toggles |
| `/settings/admin/beacon-federation` | Y | **UI-44** |
| `/services/bitcoin` | Y | Health + toggles **UI-03** |
| `/services/bitcoin/payments` | Y | Cross-links **UI-55**; Wallet Controls **UI-48** / **UI-59**; with **`bitcoinPayments`** off → **`/settings/admin`** + banner (**R-16**) |
| `/services/bitcoin/invoices` | Y | **UI-55** |
| `/services/bitcoin/resources` | Y | **UI-52**; with **`bitcoinResources`** off → **`/settings/admin`** + banner (**R-16**) |
| `/services/bitcoin/blocks` | Y | Explorer empty **UI-47**; **`bitcoinExplorer`** gate (**UI-100** contrasts **transactions** list) |
| `/services/bitcoin/transactions` | Y | **UI-77** interval + **loading** flicker; overlaps **UI-69** **`/wallet`**; **no** **`UiFlagRoute`** vs tx detail — **UI-100** |
| `/services/bitcoin/faucet` | Y | **UI-48**; route not **`UiFlagRoute`** — **UI-89** |
| `/services/bitcoin/crowdfunds` | Y | **UI-53** |
| `/services/bitcoin/lightning` | Y | Default amount spinbutton **UI-48**; with **`bitcoinLightning`** off → **`/settings/admin`** + banner (**R-16**) |
| `/services/lightning` | Y | Same UI as above — **UI-64** duplicate path; **404** shortcut uses this path — **UI-84**; flag-off → admin + hint (**R-16**) |
| `/services/bitcoin/channels/:id` | Y (code) | **ChannelView**; Lightning API default base **UI-86** |
| `/services/payjoin` | Y | **Navigate** to Payments / Bitcoin Payjoin (**UI-56**); REST JSON unchanged |
| `/sessions` (exact) | Y | Redirects to **`/settings/security`** — **UI-66** |
| `/sessions/:id` | Y (code) | Token in path — **UI-83**; **SecuritySessionHome**; not **`UiFlagRoute`** — **UI-103** |
| `/wallet` | Y | Code: redirect to **`/services/bitcoin/transactions`** — **UI-69** |
| Onboarding (`needsSetup`) | Y (code) | Non-dismissible modal **UI-72** |
| **Identity modal** (`IdentityManager`) | Y | **Eleventh pass** post-build: chooser, **Restore with recovery phrase**, **hub/dev** mnemonic; **UI-104** / **UI-105** mitigations |
| Marketing shell (`Splash` / `FrontPage`) | — | **Not** in **HubInterface** — **UI-71**; **UI-73** Log In target; **`constants` drift** **UI-88** |
| `/tx/:txid`, `/block/:hash` | Y | Redirect to `/services/bitcoin/transactions/…` and `/blocks/…`; empty param targets differ — **UI-78** |
| Unknown path / 404 | Y | **UI-11**; **UI-65** / **UI-84** (Faucet; Lightning path); **UI-93** Security **`aria-label`** (**R-15**); Sidechain **`aria-label`** **UI-102**; **Treasury** link when flags on — **UI-90** (twelfth pass) |
| `UiFlagRoute` / `PeersAdminRoute` block | Y | **Admin hint** copy verified in code; **`peers` / `features` / `activities` / `bitcoinExplorer` off** not reachable via saved flags — **UI-58**; **`peersAdmin`** (no token) still works; **R-16** live redirect when flags off |
| Extension popup (`extension/`) | — (code) | Same **`HubInterface`** as web — viewport / density **UI-79** |
| `/activity` (redirect) | Y | **`NavigateActivityToActivities`** — respects **`activities`** flag (would hit **Admin** if **`activities`** false and **UI-58** fixed) |
| `/home`, `/document`, `/document/:id`, `/peer`, `/peer/:id` | Y (code) | Legacy aliases — **`HubInterface.js`** |
| `/bitcoin`, `/admin`, `/admin/beacon-federation` | Y (code) | Redirects to **`/services/bitcoin`**, **`/settings/admin`**, **`/settings/admin/beacon-federation`** |
| `/payments`, `/invoices`, `/resources`, `/crowdfunds` | Y (code) | Shortcuts behind **`UiFlagRoute`** → canonical Bitcoin paths |
| `/services/sidechain`, `/sidechain` | Y (code) | Redirect to **`/sidechains`** when **sidechain** flag on |

### Routes needing consolidation
| `/wallet` | Y | Code: redirect to **`/services/bitcoin/transactions`** — **UI-69** |
| `/tx/:txid`, `/block/:hash` | Y | Redirect to `/services/bitcoin/transactions/…` and `/blocks/…`; empty param targets differ — **UI-78** |
| `/services/bitcoin/lightning` | Y | Default amount spinbutton **UI-48** |

---

## 7. Runtime verification — broken / degraded UI (living list)
Manual checks after a fresh **browser bundle** + **desktop** restart. **Hub:** `http://127.0.0.1:18080` (this run matched a CLI hub on **18080**; default settings often use **8080** — see **R-08**).

| ID | Class | Symptom | Backlog / note |
|----|--------|---------|----------------|
| R-01 | **Missing feature** | ~~**`GET /services/payjoin`** in the SPA showed **Page not found**~~ **Mitigated (2026-03-29):** SPA **`/services/payjoin`** **Navigate**s to Payments or Bitcoin Payjoin section (**UI-56**). JSON clients still use **`Accept: application/json`** on the same path for REST. | **UI-56** |
| R-02 | **Contradictory status** | Home **Bridge** card: green **Online** with **State: PAUSED** at the same time. | **UI-01** |
| R-03 | **Data / ordering** | **`/documents`** published list: **Bitcoin block** rows appear with **out-of-order block heights** in the visible window (not monotonic). | **UI-30** |
| R-04 | **IA / copy** | **`/peers`** without admin token **redirects** to **`/settings/admin`** while body copy says you opened **`/peers`** — page title/URL are **Admin**. | **UI-13** |
| R-05 | **Loading shell** | Hard navigation often shows a minimal **“Connecting to Hub…”** state (single line, almost no chrome) for a short interval before **`HubInterface`** mounts. Feels like a hang on slow devices. | **UI-92** (copy while `setupChecked`); skeleton chrome |
| R-06 | **Env: Bitcoin off** | With **`FABRIC_BITCOIN_ENABLE=false`**, Bitcoin dashboard sections show **unavailable / empty RPC** (peers, chain stats, etc.). **Not a bundle bug** — expected degradation; still reads as “broken” if operators forget the flag. | **UI-03**; ops doc |
| R-07 | **Console: peer graph** | On **`/peers`**, **graphviz-wasm** can log: *“Warning: no value for width of non-ASCII character 226…”* (topology **DOT** / Unicode labels). | Sanitize labels or suppress; not previously ID’d |
| R-08 | **Wrong origin / port** | Loading the UI at **`http://127.0.0.1:8080`** while the running hub listens on **another port** (e.g. **18080**) can leave **Home** stuck on **“Loading network status… WebSocket connected — waiting for network status”** with an **empty** main column — looks like a failed app. | Electron / env must match **`FABRIC_HUB_PORT`**; operator setup |
| R-09 | **Console noise** | **`fabric/ecc` self-test** prints **`[object Object]`** arrays in the console every load. | Swap for structured `JSON.stringify` or `debug` flag; not previously ID’d |
| R-10 | **Pervasive (known)** | **Admin feature toggles** that **cannot turn off** persisted **`peers` / `features` / `activities` / `bitcoinExplorer`** (**UI-58**) — “broken settings” from an operator’s perspective. | **UI-58** |
| R-11 | **Pervasive (known)** | **404** shortcuts: **Faucet** always offered; **Admin** without token; **Lightning** uses **`/services/lightning`** — **UI-65**, **UI-84**, **UI-89**. | Prior rows |
| R-12 | **Nav inconsistency** | **Treasury** shortcut only on **Home** “Go to” — not in **TopPanel** / **404**. | **UI-90** (code review) |
| R-13 | **Misleading bootstrap** | **“Connecting to Hub…”** during **`setupChecked`** wait; Redux **`auth.loading`** shows a **silent** full-screen spinner. | **UI-92**, **UI-95** |
| R-14 | **Duplicate nav / a11y** | On **`/`**, accessibility tree shows **two** adjacent **“Activities”** links (home quick links / library footer area) in addition to the bell — matches **UI-32**. | **UI-32** |
| R-15 | **a11y ≠ visible text** | **404** / **`UnknownRouteShell`**: Security shortcut **`aria-label`** uses **“Security and delegation”** vs visible **“Security & delegation”**. **`/activities`** strip: visible **“Security & delegation”** but **`aria-label`** **“Security, delegation tokens, and session audit”** (**`ActivitiesHome.js`**). | **UI-93** |
| R-16 | **Gated-route redirect** | With **`bitcoinPayments`**, **`bitcoinLightning`**, **`bitcoinResources`**, or **sidechain** off in **this browser**, opening the matching path **`Navigate`s** to **`/settings/admin`** with **`routeBlockedHint`**. **Without** an admin token, the user must parse **Admin** chrome + **paste token** + **enable feature** — two hurdles in one screen (**same pattern** as **`/peers`** — **UI-13**). | **UI-13**; consider **Settings**-only gate or clearer stepped copy |
| R-17 | **Dead deep link vs CTA** | ~~**`/services/payjoin`** SPA 404~~ **Mitigated** with **`NavigatePayjoinSpaAlias`** (**UI-56**). | **UI-56** |
| R-18 | **Explorer vs wallet routes** | **`/services/bitcoin/transactions`** (and **`/wallet`**) are **not** gated by **`bitcoinExplorer`**; **tx detail** and **`/tx/:hash`** **are** — easy to land on list/send UI but fail on drill-down when Explorer is off (**UI-58** currently masks this by forcing Explorer on). | **UI-100** |
| R-19 | **Home DOM / a11y noise** | When the library is populated, **`/`** accessibility tree lists **very many** **Bitcoin block** links before **Delegation** / **Activities** sections — same catalog noise as **`/documents`** (**UI-30** / **R-03**). | **UI-30**; consider sectioning or collapsing block rows on home |

**Worked in this run (smoke):** **`/`** after status + library load ( **More** shortcuts; duplicate **Activities** links **R-14**); **Login** → **Identity** chooser with **Restore with recovery phrase** + **Import mnemonic (hub / dev)**; **Restore** subform (**Recovery phrase** / **Extension passphrase** fields); prior ninth-pass routes; **`npm run build`** before pass.

---

## 8. Exhaustive SPA route catalog (`HubInterface`)
Every path registered under **`<Routes>`** in [`components/HubInterface.js`](../components/HubInterface.js) (plus inline **`UnknownRouteShell`**). **Not listed:** HTTP-only JSON/resources (**`/services/distributed/*`**, etc.). **`/services/payjoin`**: SPA **`Navigate`** (**UI-56**); same path remains **REST** for JSON **`Accept`** (**server**).

**Flag column** uses keys from **`hubUiFeatureFlags`** / **`UiFlagRoute`**. **`PeersAdminRoute`** = **`peers`** flag **and** hub **admin token** in browser. **“—”** = no feature gate in router (page may still show empty/error states).

| Path | Kind | Flag / guard | Screen / behavior |
|------|------|----------------|-------------------|
| `/` | Page | — | **`Home`** |
| `/features` | Page | **`features`** | **`FeaturesPage`** |
| `/activities` | Page | **`activities`** | **`ActivitiesHome`** |
| `/services/bitcoin` | Page | — | **`BitcoinHomeWithNav`** (dashboard) |
| `/services/payjoin` | Redirect | — | **`NavigatePayjoinSpaAlias`** → Payments **`#wealth-payjoin-board`** or Bitcoin **`#fabric-bitcoin-payjoin`** (**UI-56**) |
| `/services/bitcoin/blocks` | Page | **`bitcoinExplorer`** | **`BitcoinBlockList`** |
| `/services/bitcoin/blocks/:blockhash` | Page | **`bitcoinExplorer`** | **`BitcoinBlockView`** |
| `/services/bitcoin/faucet` | Page | — | **`FaucetHome`** (**UI-89**) |
| `/services/bitcoin/transactions` | Page | — | **`BitcoinTransactionsHome`** (**UI-100**) |
| `/services/bitcoin/transactions/:txhash` | Page | **`bitcoinExplorer`** | **`BitcoinTransactionView`** (**UI-100**) |
| `/services/bitcoin/resources` | Page | **`bitcoinResources`** | **`BitcoinResourcesHome`** |
| `/services/bitcoin/payments` | Page | **`bitcoinPayments`** | **`BitcoinPaymentsHomeRoute`** |
| `/services/bitcoin/crowdfunds` | Page | **`bitcoinCrowdfund`** | **`CrowdfundingHome`** |
| `/services/bitcoin/invoices` | Page | **`bitcoinInvoices`** | **`InvoiceListHomeRoute`** |
| `/services/bitcoin/lightning` | Page | **`bitcoinLightning`** | **`LightningHome`** (**UI-64**) |
| `/services/lightning` | Page | **`bitcoinLightning`** | **`LightningHome`** (**UI-64**) |
| `/services/bitcoin/channels/:id` | Page | **`bitcoinLightning`** | **`ChannelView`** |
| `/services/sidechain` | Redirect | **`sidechain`** | **`Navigate`** → **`/sidechains`** |
| `/sidechain` | Redirect | **`sidechain`** | **`Navigate`** → **`/sidechains`** |
| `/sidechains` | Page | **`sidechain`** | **`SidechainHome`** |
| `/peers` | Page | **`PeersAdminRoute`** | **`PeerList`** |
| `/peers/:id` | Page | **`PeersAdminRoute`** | **`PeerView`** |
| `/documents` | Page | — | **`DocumentList`** |
| `/documents/:id` | Page | — | **`DocumentView`** |
| `/contracts` | Page | — | **`ContractList`** |
| `/contracts/:id` | Page | — | **`ContractView`** |
| `/settings` | Page | — | **`SettingsHome`** |
| `/settings/security` | Page | — | **`SecurityHome`** |
| `/settings/bitcoin-wallet` | Page | — | **`SettingsBitcoinWallet`** |
| `/settings/federation` | Page | **`sidechain`** | **`SettingsFederationHome`** |
| `/settings/admin` | Page | — | **`AdminHome`** (token unlocks panels) |
| `/settings/admin/beacon-federation` | Page | **`sidechain`** | **`BeaconFederationHome`** |
| `/admin` | Redirect | — | **`Navigate`** → **`/settings/admin`** |
| `/admin/beacon-federation` | Redirect | **`sidechain`** | **`Navigate`** → **`/settings/admin/beacon-federation`** |
| `/sessions` | Redirect | — | **`Navigate`** → **`/settings/security`** (**UI-66**) |
| `/sessions/:sessionId` | Page | — | **`SecuritySessionHome`** (**UI-83**, **UI-103**) |
| `/security` | Redirect | — | **`Navigate`** → **`/settings/security`** |
| `/activity` | Redirect | **`activities`** | **`NavigateActivityToActivities`** → **`/activities`** or **Admin** |
| `/home` | Redirect | — | **`Navigate`** → **`/`** |
| `/wallet` | Redirect | — | **`Navigate`** → **`/services/bitcoin/transactions`** (**UI-69**, **UI-100**) |
| `/bitcoin` | Redirect | — | **`Navigate`** → **`/services/bitcoin`** |
| `/payments` | Redirect | **`bitcoinPayments`** | **`Navigate`** → **`/services/bitcoin/payments`** |
| `/invoices` | Redirect | **`bitcoinInvoices`** | **`Navigate`** → **`/services/bitcoin/invoices#fabric-invoices-tab-demo`** |
| `/resources` | Redirect | **`bitcoinResources`** | **`Navigate`** → **`/services/bitcoin/resources`** |
| `/crowdfunds` | Redirect | **`bitcoinCrowdfund`** | **`Navigate`** → **`/services/bitcoin/crowdfunds`** |
| `/tx/:txhash` | Redirect | **`bitcoinExplorer`** | **`NavigateLegacyBitcoinTxAlias`** (**UI-78**, **UI-100**) |
| `/block/:blockhash` | Redirect | **`bitcoinExplorer`** | **`NavigateLegacyBitcoinBlockAlias`** (**UI-78**) |
| `/document` | Redirect | — | **`Navigate`** → **`/documents`** |
| `/document/:id` | Redirect | — | **`NavigateDocumentsDetailAlias`** |
| `/peer` | Redirect | **`peers`** | **`NavigatePeerRootAlias`** |
| `/peer/:id` | Redirect | **`peers`** | **`NavigatePeerDetailAlias`** |
| `*` | Page | — | **`UnknownRouteShell`** (**UI-11**, **UI-65**, **UI-84**, **UI-93**, **UI-102**) |

### Completeness (what “all UI shortcomings” cannot mean)
- **§2** is the **actionable backlog** (IDs **UI-01**–**UI-105**, **DEV-01**). It is built from code review, prior passes, and spot-checks — not from formal UX research on every modal. **§2.15** marks **UI-104** / **UI-105** as addressed in-tree (identity polish).
- **§8** is **router-complete** for the **shipping** shell; it does **not** enumerate every **toast**, **Bridge** event UI, **Semantic-UI** quirk, or **Electron**-only window chrome.
- **§7** (**R-***) is **runtime-regressed** behavior; extend it when a new build introduces a visible bug.
- **Unwired** surfaces (**Splash**, **Dashboard**, **LoginGate**, etc.) are covered under **UI-71**–**UI-73**, **UI-88**, **UI-98**–**UI-99** — they are shortcomings of **product completeness**, not missing rows above.

When you add a **`Route`** to **`HubInterface`**, update **§8** and add a **§6** matrix row.
