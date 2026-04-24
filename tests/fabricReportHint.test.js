'use strict';

const assert = require('assert');
const { reportIssuesUrl, reportHintLine } = require('../functions/fabricReportHint');

describe('fabricReportHint', function () {
  it('defaults to hub.fabric.pub issues URL', function () {
    const prev = process.env.FABRIC_ISSUES_URL;
    delete process.env.FABRIC_ISSUES_URL;
    try {
      assert.ok(/github\.com\/FabricLabs\/hub\.fabric\.pub\/issues/.test(reportIssuesUrl()));
      assert.ok(reportHintLine().includes(reportIssuesUrl()));
    } finally {
      if (prev !== undefined) process.env.FABRIC_ISSUES_URL = prev;
      else delete process.env.FABRIC_ISSUES_URL;
    }
  });

  it('respects FABRIC_ISSUES_URL', function () {
    const prev = process.env.FABRIC_ISSUES_URL;
    process.env.FABRIC_ISSUES_URL = 'https://example.invalid/fabric-issues';
    try {
      assert.strictEqual(reportIssuesUrl(), 'https://example.invalid/fabric-issues');
    } finally {
      if (prev !== undefined) process.env.FABRIC_ISSUES_URL = prev;
      else delete process.env.FABRIC_ISSUES_URL;
    }
  });
});
