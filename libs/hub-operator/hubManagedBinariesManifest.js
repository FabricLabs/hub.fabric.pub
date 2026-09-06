'use strict';

/**
 * Pinned Bitcoin Core + Core Lightning release artifacts for Hub managed nodes.
 * URLs and SHA-256 digests are operator-facing pins — do not accept client-supplied
 * download locations. Refresh pins when bumping versions (verify against official
 * SHA256SUMS / SHA256SUMS-v* from the publishers).
 *
 * Bitcoin Core **29.4** is the latest 29.x (released 2026-07-13). Do not bump to
 * 30/31 until the owner asks.
 */

const BITCOIN_CORE_VERSION = '29.4';
const CORE_LIGHTNING_VERSION = '26.06.6';

const DOWNLOAD_USER_AGENT =
  'FabricHub/0.1.0-RC1 (managed-node-binaries; +https://hub.fabric.pub)';

/**
 * @typedef {Object} ManagedBinaryArtifact
 * @property {string} url
 * @property {string} sha256
 * @property {string} file
 * @property {'bitcoin'|'lightning'} kind
 */

/** @type {Record<string, { bitcoin: ManagedBinaryArtifact, lightning?: ManagedBinaryArtifact }>} */
const PLATFORM_ARTIFACTS = Object.freeze({
  'darwin-arm64': {
    bitcoin: {
      kind: 'bitcoin',
      file: `bitcoin-${BITCOIN_CORE_VERSION}-arm64-apple-darwin.tar.gz`,
      url: `https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_CORE_VERSION}/bitcoin-${BITCOIN_CORE_VERSION}-arm64-apple-darwin.tar.gz`,
      sha256: 'ab9d71a1fe9b32a284b3456fd62e209c7d5d08ddfa2534d048c3f6e610cdb37a'
    }
  },
  'darwin-x64': {
    bitcoin: {
      kind: 'bitcoin',
      file: `bitcoin-${BITCOIN_CORE_VERSION}-x86_64-apple-darwin.tar.gz`,
      url: `https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_CORE_VERSION}/bitcoin-${BITCOIN_CORE_VERSION}-x86_64-apple-darwin.tar.gz`,
      sha256: 'b2e13a7f4f430c52ca96a4fca8f041b0a23ea8ea97267357751cdd9de7606cf2'
    }
  },
  'linux-x64': {
    bitcoin: {
      kind: 'bitcoin',
      file: `bitcoin-${BITCOIN_CORE_VERSION}-x86_64-linux-gnu.tar.gz`,
      url: `https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_CORE_VERSION}/bitcoin-${BITCOIN_CORE_VERSION}-x86_64-linux-gnu.tar.gz`,
      sha256: 'e15bff6f6d21a315c4af25d2e8ae933a22bd51e924e0e90ab0474e1e11516331'
    },
    lightning: {
      kind: 'lightning',
      file: `clightning-v${CORE_LIGHTNING_VERSION}-Ubuntu-22.04-amd64.tar.xz`,
      url: `https://github.com/ElementsProject/lightning/releases/download/v${CORE_LIGHTNING_VERSION}/clightning-v${CORE_LIGHTNING_VERSION}-Ubuntu-22.04-amd64.tar.xz`,
      sha256: 'b38b0bcf535d925e37c9b465a0ce6aa580e3f66be36bada860599f3a8e1efc8e'
    }
  },
  'linux-arm64': {
    bitcoin: {
      kind: 'bitcoin',
      file: `bitcoin-${BITCOIN_CORE_VERSION}-aarch64-linux-gnu.tar.gz`,
      url: `https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_CORE_VERSION}/bitcoin-${BITCOIN_CORE_VERSION}-aarch64-linux-gnu.tar.gz`,
      sha256: 'bc5353b3cda4a32c4ab7e46feed7fdb6ad68f23430743fee2e1fe0718df78db9'
    }
  },
  'win32-x64': {
    bitcoin: {
      kind: 'bitcoin',
      file: `bitcoin-${BITCOIN_CORE_VERSION}-win64.zip`,
      url: `https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_CORE_VERSION}/bitcoin-${BITCOIN_CORE_VERSION}-win64.zip`,
      sha256: '31e03b841bf2bbe711cf0179d3466678989fcbd46e5ef9bef957a20fa32e0e42'
    }
  }
});

const INSTALLER_PLATFORM_IDS = Object.freeze(Object.keys(PLATFORM_ARTIFACTS));

/**
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {string}
 */
function managedBinaryPlatformId (platform, arch) {
  const plat = String(platform || process.platform || '');
  const cpu = String(arch || process.arch || '');
  return `${plat}-${cpu}`;
}

/**
 * @param {string} [platformId]
 * @returns {{ bitcoin?: ManagedBinaryArtifact, lightning?: ManagedBinaryArtifact }|null}
 */
function artifactsForPlatform (platformId) {
  const id = String(platformId || managedBinaryPlatformId());
  return PLATFORM_ARTIFACTS[id] || null;
}

/**
 * Official CLN tarballs are Linux x86_64. macOS can use Homebrew; Windows has no lightningd.
 * @param {string} [platformId]
 * @returns {{ supported: boolean, source: string, reason?: string }}
 */
function lightningSupportForPlatform (platformId) {
  const id = String(platformId || managedBinaryPlatformId());
  if (PLATFORM_ARTIFACTS[id] && PLATFORM_ARTIFACTS[id].lightning) {
    return { supported: true, source: 'release-tarball' };
  }
  if (id.startsWith('darwin-')) {
    return {
      supported: true,
      source: 'homebrew',
      reason: 'Core Lightning does not publish macOS binaries; Hub uses Homebrew (brew install core-lightning) when brew is available.'
    };
  }
  if (id.startsWith('win32-')) {
    return {
      supported: false,
      source: 'none',
      reason: 'Core Lightning does not ship Windows binaries. Run Bitcoin only, or Lightning on Linux/macOS.'
    };
  }
  if (id === 'linux-arm64') {
    return {
      supported: false,
      source: 'none',
      reason: `Core Lightning v${CORE_LIGHTNING_VERSION} has no official aarch64 Linux tarball.`
    };
  }
  return {
    supported: false,
    source: 'none',
    reason: `No Core Lightning artifact is pinned for ${id}.`
  };
}

module.exports = {
  BITCOIN_CORE_VERSION,
  CORE_LIGHTNING_VERSION,
  DOWNLOAD_USER_AGENT,
  PLATFORM_ARTIFACTS,
  INSTALLER_PLATFORM_IDS,
  managedBinaryPlatformId,
  artifactsForPlatform,
  lightningSupportForPlatform
};
