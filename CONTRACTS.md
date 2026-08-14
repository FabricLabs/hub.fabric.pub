# Contracts: Fabric vision and Bitcoin layers
This document ties together **what Fabric is for**, how **Hub “contracts”** are named in software, and **which Bitcoin transaction patterns** those flows use—including **classic P2SH** outputs where they still matter in the wider ecosystem.

For distributed execution, federation, and Beacon epochs, see **[docs/DISTRIBUTED_CONTRACT_EXECUTION.md](docs/DISTRIBUTED_CONTRACT_EXECUTION.md)** and **[docs/SIDECHAIN_AND_EXECUTION_INDEX.md](docs/SIDECHAIN_AND_EXECUTION_INDEX.md)**. For payment mechanics and roadmap, see **[PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md)**.

---

## 1. Fabric vision (why “contracts” show up at all)
**Fabric** is a peer-to-peer stack for **identity**, **typed messages**, and **shared state**: operators run nodes that connect to each other, exchange `Message` frames, publish documents, and coordinate work without assuming a single central server. The **Hub** (`hub.fabric.pub`) is a **rendezvous and gateway**: it runs a Fabric peer, exposes HTTP/WebSocket JSON-RPC to browsers, and (when configured) attaches **Bitcoin** as a **settlement and anchoring layer**.

At the product level, “contract” can mean two different things—both are valid:

| Meaning | What it is | Where it lives |
|--------|------------|----------------|
| **Fabric / Hub contract records** | Typed **application state** the Hub stores and exposes over RPC (storage replication, execution programs, crowdfund campaigns, etc.). A contract advertises **interfaces** (capabilities)—not a single exclusive `kind`. | Hub collections / **registry**, JSON-RPC methods, UI under **Contracts**, **Documents**, **Bitcoin** flows. The **Hub contract is published first** on the public network; other published contracts hang from that registry. |
| **Bitcoin script contracts** | **On-chain** locking conditions: who can spend an output, after what delay, with what witness. | Bitcoin blocks; verified by the Hub’s `bitcoind` when proving payments. |

Core model (interfaces, registry, Hub-first publish): **`@fabric/core` [docs/CONTRACTS.md](https://github.com/FabricLabs/fabric/blob/master/docs/CONTRACTS.md)** (local sibling `../fabric-clean/docs/CONTRACTS.md` when developing against a linked core).

The long-term **vision** is that **many operators** agree on **known programs** (execution traces, manifests, federation policy) and **only accept messages that match** those rules—while **Bitcoin** provides **finality for value** (invoices, bonds, HTLCs, optional OP_RETURN commitments) and **Lightning** can provide **fast off-chain settlement** where enabled. The Hub today implements **concrete slices** of that vision (registry fees, storage bonds, purchase paths, Taproot crowdfunds, Payjoin); deeper **federation-wide** enforcement is described in the distributed execution doc above.

---

## 2. Bitcoin outputs: a quick map (including P2SH)

Bitcoin locks coins to **addresses** that imply **script types**. Implementations and wallets evolve, but these patterns remain part of the landscape:

| Pattern | Role | Notes |
|--------|------|--------|
| **P2PKH** | Pay to pubkey hash (legacy `1…`). | Early single-sig; still valid. |
| **P2SH** | Pay to **script hash**—the spender reveals a **redeem script** whose hash matches the output. | Historically used for **multisig**, complex conditions, and **backward compatibility** (e.g. P2SH-wrapped SegWit). Many **multisig treasuries** and **older services** still route through P2SH-style scripts even as default wallets move to native SegWit / Taproot. |
| **P2WPKH / P2WSH** | Native SegWit v0 (`bc1q…`). | Common today for single-sig and script paths; lower weight than legacy. |
| **P2TR** | Taproot (SegWit v1, `bc1p…`). | Key-path or script-path spends; **Merkleized scripts**, Schnorr signatures—used by Hub flows that need **hashlocks**, **CLTV**, or **shared control** in a compact tree. |

**Why P2SH still matters:** any serious description of “Bitcoin contracts” should acknowledge **P2SH** as the **generic script-hash container** used for **multisig**, **legacy Timelock/HTLC compositions**, and interoperability with wallets that only understood “send to a script hash.” Fabric Hub does **not** require users to hand-craft P2SH for the built-in document and storage flows (those use **standard invoices** and, where scripts are explicit, **Taproot** metadata in-repo). But **operators** may still hold or receive **P2SH-wrapped or multisig** outputs from **external** wallets; Hub **L1 verification** is built on **address + amount + txid** (see §4), not on a single script template.

---

## 3. Hub “contract” types and their Bitcoin character

The following are the **main value-bearing or commitment-bearing** flows in this repository, with how they relate to **on-chain** patterns.

### 3.1 Storage contracts (pay-to-distribute)

- **Purpose:** Long-term **replication / bonding** for a published document: operator pays a **distribute invoice**, Hub verifies the **L1 payment**, then records a **StorageContract** linked to the document.
- **Bitcoin:** Typically a **simple payment** to a Hub-generated invoice address (today commonly **native SegWit** or **Taproot** from the node wallet—not a custom P2SH template in-app). The security story is **invoice + proof**, not on-chain covenant logic inside Fabric.
- **RPC / UI:** `CreateDistributeInvoice`, `CreateStorageContract`; **Contracts → Storage**.

### 3.2 Execution contracts (deterministic programs + optional L1 registry)

- **Purpose:** Store a **sandboxed program**, **run** it on the Hub, optionally **register** it against an L1 **registry fee** when Bitcoin is enabled, and optionally **anchor** a run commitment (e.g. **OP_RETURN** on regtest with admin token).
- **Bitcoin:** Registry fee = **plain L1 spend** to an invoice address; anchor = **OP_RETURN** carrying a digest. Neither requires the buyer to publish a **P2SH redeem script**—the chain sees normal vout patterns from Core.
- **RPC / UI:** `CreateExecutionContract`, `RunExecutionContract`, `AnchorExecutionRunCommitment` (anchor policy as implemented); **Contracts → Execution**.

### 3.3 Document purchase (invoice + claim)

- **Purpose:** **Priced publication**: buyer pays a **purchase invoice** derived from the document’s published envelope; **ClaimPurchase** ties content to payment via **`publishedDocumentEnvelope`** hashing (`@fabric/core`).
- **Bitcoin:** **Standard L1 payment** to hub-generated addresses; binding is **cryptographic** (hash of Fabric message bytes), not necessarily a visible **P2SH** on the buyer’s side.
- **RPC / UI:** `CreatePurchaseInvoice`, `ClaimPurchase`, **Documents** purchase UX.

### 3.4 Inventory HTLC (P2TR script paths)

- **Purpose:** **Peer inventory** with an on-chain **hashlock + timelock** path for claim/refund, plus **off-chain** encrypted delivery after `ConfirmInventoryHtlcPayment`.
- **Bitcoin:** **Taproot** output with **NUMS** internal key and **tapleaves** (seller claim with preimage + signature; buyer refund with **CLTV**). This is the primary place the Hub **documents explicit Taproot script contracts** for user-facing sales.
- **Reference:** **[INVENTORY_HTLC_ONCHAIN.md](INVENTORY_HTLC_ONCHAIN.md)**.

### 3.5 Taproot crowdfunds (campaign vaults)

- **Purpose:** **Fundraising** with vault UTXOs, **ACP** (SIGHASH_ANYONECANPAY) PSBT flows, optional **Payjoin** to the same vault, then **payout / refund** paths coordinated with the Hub.
- **Bitcoin:** **Taproot-heavy** workflow (vault addresses, PSBTs); not legacy P2SH-by-default, but **external** participants may still fund from **any** output type.
- **UI:** **Bitcoin → Crowdfunds** (feature-flagged).

### 3.6 Payjoin (BIP77)

- **Purpose:** **Collaborative** transaction formation between payer and receiver (privacy and fee bumping semantics per BIP77).
- **Bitcoin:** Spends and creates outputs according to negotiated **PSBT** proposals—may involve **SegWit** inputs/outputs of several kinds; not a separate “Fabric contract type” but a **first-class L1 payment mode** in the Hub when enabled.
- **Service:** `services/payjoin.js`, HTTP under `/services/payjoin`, mirrored RPCs in **[AGENTS.md](AGENTS.md)**.

### 3.7 Lightning channels

- **Purpose:** **Fast** off-chain payments via **Core Lightning** integration where configured.
- **Bitcoin:** **Channel** outputs follow **BOLT** rules on L1 when channels open/close; this is **not** the same object as inventory **L1** HTLCs, though both may use modern script features.
- **Type:** `types/lightningChannel.js` (Hub extension of Fabric channel types).

### 3.8 “Ordinary” wallet traffic

- **Purpose:** **Send**, **receive**, **faucet** (regtest), **block generation**—operator tooling.
- **Bitcoin:** Whatever **`bitcoind`** and the wallet produce (**P2WPKH**, **P2TR** change, etc.). **P2SH** may appear when receiving from older senders or multisig counterparties; the Hub’s **verification APIs** remain **address- and amount-oriented**.

---

## 4. How verification relates to script types

For **invoice-style** flows, the Hub checks that a transaction **pays at least `amountSats` to `address`** (mempool or confirmed, depending on caller). That logic is **agnostic** to whether the paying wallet used **P2PKH**, **P2SH**, **SegWit**, or **Taproot** internally—as long as the **resulting tx** credits the invoice address.

For **script-specific** flows (inventory HTLC, crowdfund vaults), **construction and PSBT** paths are documented in the dedicated files above; **P2SH** is most relevant as **external** compatibility and **historical multisig**, not as the default script Hub generates for those Taproot-first features.

---

## 5. Related reading

| Topic | Doc |
|--------|-----|
| Payment roadmap and inventory phases | [PAYMENTS_PROTOCOL.md](PAYMENTS_PROTOCOL.md) |
| P2TR inventory HTLC on-chain detail | [INVENTORY_HTLC_ONCHAIN.md](INVENTORY_HTLC_ONCHAIN.md) |
| Distributed execution, federation, Beacon | [docs/DISTRIBUTED_CONTRACT_EXECUTION.md](docs/DISTRIBUTED_CONTRACT_EXECUTION.md) |
| Sidechain scan, execution index | [docs/SIDECHAIN_AND_EXECUTION_INDEX.md](docs/SIDECHAIN_AND_EXECUTION_INDEX.md) |
| Bitcoin networks / RPC | [BITCOIN_NETWORKS.md](BITCOIN_NETWORKS.md) |
| Operator / agent surface | [AGENTS.md](AGENTS.md) |

---

*This file is descriptive documentation for operators and contributors; it is not a consensus spec. On-chain behavior is ultimately defined by Bitcoin Core and the wallet policies configured on your Hub.*
