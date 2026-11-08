'use strict';

module.exports = {
  home: {
    title: 'Fabric messages',
    subheader: 'Every message this Hub has written to its log, newest first. Each one links to the message before it.',
    back: 'Activities',
    loading: 'Loading messages…',
    loadFailed: (reason) => `Could not load messages: ${reason}`,
    none: 'No messages match.',
    filters: {
      label: 'Filter messages',
      allTypes: 'All types',
      contract: 'Contract, federation, or document id',
      text: 'Search the message data',
      apply: 'Filter',
      clear: 'Clear filters'
    },
    count: (shown, total) => `Showing ${shown} of ${total}`,
    more: 'Show older',
    columns: {
      seq: '#',
      type: 'Type',
      refs: 'About',
      time: 'Time'
    }
  },
  record: {
    back: 'All messages',
    loading: 'Loading message…',
    notFound: 'This Hub has no message by that id that you can see.',
    loadFailed: (reason) => `Could not load this message: ${reason}`,
    seq: (n) => `Message #${n}`,
    mailbox: 'Federation mailbox',
    frameId: 'Frame id',
    logId: 'Log id',
    created: 'Written',
    author: 'Signed by',
    unsigned: 'Not signed',
    parent: 'Previous message',
    genesis: 'First in the chain',
    children: 'Next messages',
    noChildren: 'None yet.',
    chain: 'Earlier in the chain',
    about: 'About',
    data: 'Data',
    showData: 'Show data',
    hideData: 'Hide data',
    noData: 'No data on this message.',
    frame: 'Fabric frame',
    frameType: 'Type',
    frameBytes: (n) => `${n} bytes`,
    frameInvalid: (reason) => `Could not read the frame: ${reason}`,
    copy: 'Copy',
    copyFabric: 'Copy fabric: link',
    federation: 'Open federation',
    contract: 'Open contract',
    document: 'Open document'
  },
  collection: {
    loading: 'Loading…',
    notFound: 'Nothing by that id here, or you cannot see it.',
    links: 'Links',
    record: 'Record',
    back: 'Home'
  },
  application: {
    title: 'Application contract',
    help: 'This contract was published to the network and accepted by this Hub. Its state is sealed into the Hub statechain at the path below.',
    name: 'Name',
    version: 'Version',
    status: 'Status',
    signer: 'Publisher',
    definitionDigest: 'Definition digest',
    spendAddress: 'Spend address',
    clock: 'Statechain clock',
    stateDigest: 'State digest',
    sealPath: 'Seal path',
    counts: (messages, seals, queued) => `${messages} log messages · ${seals} seals · ${queued} queued`,
    allMessages: 'All messages about this contract',
    tracked: 'Tracked contracts'
  },
  journal: {
    title: 'Journal',
    help: 'What happened to this contract: Hub log messages that name it, the statechain patches that sealed it, and messages queued for it. Newest first.',
    none: 'Nothing recorded yet.',
    data: 'Data',
    hide: 'Hide',
    fabric: 'Fabric',
    fabricMissing: 'No Fabric message behind this row',
    sources: {
      log: 'Log',
      seal: 'Statechain',
      queue: 'Queued'
    }
  }
};
