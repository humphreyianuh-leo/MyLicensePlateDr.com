function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function citationCard(row, jurisdiction, opts = {}) {
  const unknown = !!opts.statusUnknown;
  const cardBorder = unknown ? 'border-brand-500/20 bg-brand-50' : 'border-alert-500/20 bg-alert-100/40';
  const badgeClass = unknown ? 'bg-white text-brand-600' : 'bg-alert-100 text-alert-600';
  const badgeDot = unknown ? 'bg-brand-500' : 'bg-alert-500';
  const badgeText = unknown ? 'Citation record found' : 'Citation found';
  const amountDueDisplay = unknown ? 'Unknown' : `$${escapeHtml(row.amountDue ?? '0')}`;
  return `
    <div class="rounded-xl border ${cardBorder} px-5 py-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <span class="inline-flex items-center gap-1.5 rounded-full ${badgeClass} text-xs font-semibold px-3 py-1">
          <span class="h-1.5 w-1.5 rounded-full ${badgeDot}"></span>
          ${badgeText}
        </span>
        <span class="text-xs text-navy-600">Summons #${escapeHtml(row.summonsNumber || '—')}</span>
      </div>
      <p class="mt-3 font-semibold text-navy-900">${escapeHtml(row.violation || 'Violation')}</p>
      <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div><p class="text-navy-600">Issued</p><p class="font-medium text-navy-900">${escapeHtml(row.issueDate || '—')}</p></div>
        <div><p class="text-navy-600">Fine amount</p><p class="font-medium text-navy-900">$${escapeHtml(row.fineAmount ?? '0')}</p></div>
        <div><p class="text-navy-600">Amount due</p><p class="font-medium text-navy-900">${amountDueDisplay}</p></div>
      </div>
      <a href="${escapeHtml(jurisdiction.payUrl)}" target="_blank" rel="noopener"
        class="btn-primary ease-spring duration-300 mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white font-semibold text-sm">
        ${escapeHtml(jurisdiction.payLabel)}
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
      </a>
    </div>`;
}

// Runs a REAL checkup against the live jurisdiction API and returns HTML to render.
// Returns null (not HTML) when the state isn't covered, so callers can show
// their own "coming soon" message rather than duplicate it here.
async function fetchCheckupResultHtml(plateNumberRaw, stateAbbr) {
  const jurisdiction = LIVE_JURISDICTIONS[stateAbbr];
  if (!jurisdiction) return null;

  const plate = plateNumberRaw.trim().toUpperCase();
  const rows = await jurisdiction.fetchCitations(plate);
  const balanceKnown = jurisdiction.supportsBalance !== false;
  const open = balanceKnown ? rows.filter((r) => parseFloat(r.amountDue || '0') > 0) : rows;

  if (rows.length === 0) {
    return `
      <div class="mt-4 rounded-xl bg-ok-100 border border-ok-600/20 px-5 py-4 flex items-start gap-3">
        <svg class="h-5 w-5 shrink-0 text-ok-600 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
        <div>
          <p class="font-semibold text-ok-700">Clean bill of health</p>
          <p class="mt-1 text-sm text-navy-600">No parking or camera violations found for this plate in ${escapeHtml(jurisdiction.label)}'s public records.</p>
        </div>
      </div>`;
  }

  if (balanceKnown && open.length === 0) {
    return `
      <div class="mt-4 rounded-xl bg-ok-100 border border-ok-600/20 px-5 py-4 text-sm text-ok-700">
        <span class="font-semibold">No open balance.</span> Found ${rows.length} past violation(s) in ${escapeHtml(jurisdiction.label)} records, all paid in full.
      </div>`;
  }

  return `
    ${balanceKnown ? '' : `
      <div class="mt-4 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-xs text-navy-700">
        ${escapeHtml(jurisdiction.label)}'s public data doesn't report current payment status — only the fine amount at issuance. Confirm what's actually still owed directly with the city before assuming these are unpaid.
      </div>`}
    <div class="mt-3 space-y-3">
      ${open.map((row) => citationCard(row, jurisdiction, { statusUnknown: !balanceKnown })).join('')}
    </div>`;
}

function comingSoonHtml(stateAbbr) {
  const stateName = STATES.find(([abbr]) => abbr === stateAbbr)?.[1] || stateAbbr;
  const covered = Object.values(LIVE_JURISDICTIONS).map((j) => j.label).join(', ');
  return `
    <div class="mt-4 rounded-xl bg-brand-50 border border-brand-100 px-5 py-4 text-sm text-navy-700">
      Live coverage for <span class="font-semibold">${escapeHtml(stateName)}</span> is coming soon. We're currently piloting real-time checkups in ${escapeHtml(covered)} only.
    </div>`;
}
