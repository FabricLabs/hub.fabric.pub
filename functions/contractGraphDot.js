'use strict';

function escapeDotLabel (s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function shortLabel (s, left = 10, right = 6) {
  const t = String(s || '');
  if (t.length <= left + right + 1) return t;
  return `${t.slice(0, left)}…${t.slice(-right)}`;
}

/**
 * Build Graphviz DOT for a hub contract (storage or execution), for read-only preview.
 * @param {object} contract
 * @param {object} [hubRun] - optional RunExecutionContract result (adds trace hint)
 * @returns {string}
 */
function contractToDot (contract, hubRun) {
  if (!contract || typeof contract !== 'object') return '';

  const isExecution = contract.type === 'ExecutionContract' ||
    (contract.program && Array.isArray(contract.program.steps));

  if (isExecution) {
    const lines = [
      'digraph G {',
      '  rankdir=LR;',
      '  node [shape=box style="rounded,filled" fontname="Helvetica"];',
      '  edge [fontname="Helvetica" fontsize=10];'
    ];
    const cid = escapeDotLabel(shortLabel(contract.id || 'contract', 12, 8));
    lines.push(`  c0 [label="Execution contract\\n${cid}" fillcolor=lightcyan];`);

    const steps = contract.program && Array.isArray(contract.program.steps) ? contract.program.steps : [];
    let prev = 'c0';
    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx] || {};
      const op = step.op || step.fabricType || step.fabricOpcode || `step ${idx + 1}`;
      const nid = `s${idx}`;
      const lb = escapeDotLabel(shortLabel(String(op), 24, 0));
      lines.push(`  ${nid} [label="${lb}" fillcolor=lightyellow shape=ellipse];`);
      lines.push(`  ${prev} -> ${nid} [label="step ${idx + 1}"];`);
      prev = nid;
    }

    if (hubRun && Array.isArray(hubRun.trace) && hubRun.trace.length > 0 && steps.length === 0) {
      lines.push('  tr [label="(program steps unavailable)\\nhub trace present" fillcolor=whitesmoke];');
      lines.push('  c0 -> tr;');
    }

    lines.push('}');
    return lines.join('\n');
  }

  // Storage / other contracts
  const lines = [
    'digraph G {',
    '  rankdir=LR;',
    '  node [shape=box style="rounded,filled" fontname="Helvetica"];',
    '  edge [fontname="Helvetica" fontsize=10];',
    '  contract [label="Storage contract" fillcolor=thistle];'
  ];
  if (contract.document) {
    const d = escapeDotLabel(shortLabel(String(contract.document), 14, 8));
    lines.push(`  doc [label="Document\\n${d}" fillcolor=lightyellow];`);
    lines.push('  contract -> doc [label="covers"];');
  }
  if (contract.invoiceAddress) {
    const ia = escapeDotLabel(shortLabel(String(contract.invoiceAddress), 14, 8));
    lines.push(`  inv [label="Distribute invoice\\n${ia}" fillcolor=lightcyan];`);
    lines.push('  inv -> contract [label="expected payin"];');
  }
  if (contract.txid) {
    const tx = escapeDotLabel(shortLabel(String(contract.txid), 12, 8));
    lines.push(`  pay [label="L1 payment\\n${tx}" fillcolor=lightgreen];`);
    lines.push('  pay -> contract [label="bonds"];');
    if (contract.invoiceAddress) {
      lines.push('  inv -> pay [style=dashed label="tx"];');
    }
  }
  if (contract.desiredCopies != null && Number(contract.desiredCopies) > 1) {
    lines.push(`  meta [label="Replicas: ${escapeDotLabel(String(contract.desiredCopies))}" shape=note fillcolor=lightgrey];`);
    lines.push('  contract -> meta [style=dashed];');
  }
  lines.push('}');
  return lines.join('\n');
}

module.exports = { contractToDot, escapeDotLabel, shortLabel };
