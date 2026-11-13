import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// PeoplePanel
//
// Displays each ancestor's ordinance progression as a 5-stage pipeline,
// and lets the user filter the list to "people ready for [stage]".
//
// Props:
//   people  — array from GET /people, each item:
//               { name, gender, familySearchId, completedStages[],
//                 reservedStages[], skippedStages[], readyFor }
//   loading — boolean
//   error   — string | null
//
// skippedStages contains ordinances marked "unavailable" in the sheet.
// Those stages are shown as a greyed-out N/A bubble in the pipeline and
// are excluded from the "ready for" logic — a person with all applicable
// stages done (or skipped) is treated as fully complete. reservedStages
// contains ordinances that are reserved by someone, so they aren't complete,
// don't advance "ready for", but the person isn't available to select for
// taking their name and ordinance to the temple.
// ---------------------------------------------------------------------------

const STAGES = [
  'Baptism & Confirmation',
  'Initiatory',
  'Endowment',
  'Sealing to Parents',
  'Sealing to Spouse',
];

// Short labels for the pipeline bubbles (keep them narrow)
const STAGE_SHORT = {
  'Baptism & Confirmation': 'Baptism',
  'Initiatory': 'Initiatory',
  'Endowment': 'Endowment',
  'Sealing to Parents': 'Sealing to Parents',
  'Sealing to Spouse': 'Sealing to Spouse',
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All people' },
  ...STAGES.map((s) => ({ value: s, label: `Ready for ${s}` })),
  { value: 'complete', label: 'All ordinances complete' },
];

// ---------------------------------------------------------------------------
// StagePipeline — the 5-bubble progress bar for one person
// ---------------------------------------------------------------------------
function StagePipeline({ completedStages, skippedStages = [], reservedStages = [], readyFor }) {
  return (
    <div className="pipeline" aria-label="Ordinance progression">
      {STAGES.map((stage, idx) => {
        const done      = completedStages.includes(stage);
        const skipped   = skippedStages.includes(stage);
        const reserved  = reservedStages.includes(stage);
        const next      = stage === readyFor;
        const isLast    = idx === STAGES.length - 1;

        // Determine CSS class and display content
        let bubbleClass = 'pipeline-bubble';
        let icon        = '';
        let label       = STAGE_SHORT[stage];
        let titleText   = stage;
        let ariaLabel   = stage;

        if (skipped) {
          bubbleClass += ' skipped';
          icon        = '—';
          label       = 'N/A';
          titleText   = `${stage} — not applicable`;
          ariaLabel   = `${stage} – not applicable`;
        } else if (done) {
          bubbleClass += ' done';
          icon        = '✓';
          titleText   = `${stage} ✓`;
          ariaLabel   = `${stage} completed`;
	} else if (reserved) {
          bubbleClass += ' reserved';
          icon        = '⏲';
          label       = 'Reserved';
          titleText   = `${stage} ⏲`;
          ariaLabel   = `${stage} reserved`;
        } else if (next) {
          bubbleClass += ' next';
          icon        = '→';
          titleText   = `Ready for ${stage}`;
          ariaLabel   = `${stage} – ready`;
        } else {
          ariaLabel   = `${stage} – not yet`;
        }

        return (
          <React.Fragment key={stage}>
            {/* Bubble */}
            <div
              className={bubbleClass}
              title={titleText}
              aria-label={ariaLabel}
            >
              <span className="pipeline-bubble-icon" aria-hidden="true">
                {icon}
              </span>
              <span className="pipeline-bubble-label">{label}</span>
            </div>

            {/* Connector line between bubbles */}
            {!isLast && (
              <div
                className={`pipeline-connector ${done ? 'done' : ''}`}
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersonRow — one person card
// ---------------------------------------------------------------------------
function PersonRow({ person }) {
  const { name, gender, familySearchId, completedStages, reservedStages = [], skippedStages = [], readyFor } = person;

  const fsUrl = familySearchId
    ? `https://www.familysearch.org/tree/person/ordinances/${familySearchId}`
    : null;

  const isComplete = readyFor === null;

  return (
    <div className={`person-row ${isComplete ? 'person-row--complete' : ''}`}>
      {/* Left: name + meta */}
      <div className="person-row-info">
        <div className="person-row-name">
          {name}
          <span className="person-row-gender">{gender}</span>
        </div>
        <div className="person-row-meta">
          {isComplete ? (
            <span className="badge badge--complete">All ordinances complete 🎉</span>
          ) : (
            <span className="badge badge--ready">Ready for: {readyFor}</span>
          )}
          {fsUrl && (
            <a
              href={fsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="person-row-fslink"
            >
              FamilySearch ↗
            </a>
          )}
        </div>
      </div>

      {/* Right: pipeline */}
      <StagePipeline
        completedStages={completedStages}
        skippedStages={skippedStages}
        reservedStages={reservedStages}
        readyFor={readyFor}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PeoplePanel — main exported component
// ---------------------------------------------------------------------------
function PeoplePanel({ people, loading, error }) {
  const [filter, setFilter] = useState('all');
  // Default to true so visitors start with the cleaner view (ID-linked people only)
  const [hideNoId, setHideNoId] = useState(true);

  // Apply filters: first the stage filter, then optionally strip no-ID people
  const filtered = (people || []).filter((p) => {
    // Stage filter
    if (filter === 'complete' && p.readyFor !== null) return false;
    if (filter !== 'all' && filter !== 'complete' && p.readyFor !== filter) return false;
    // FamilySearch ID filter
    if (hideNoId && !p.familySearchId) return false;
    return true;
  });

  // Count per filter option — counts respect the hideNoId toggle so the
  // numbers in the dropdown match what is actually visible.
  //
  // A person counts as "complete" when readyFor === null, which the backend
  // already computes correctly considering skippedStages.
  const baseList = hideNoId
    ? (people || []).filter((p) => p.familySearchId)
    : (people || []);

  const counts = {};
  baseList.forEach((p) => {
    counts['all'] = (counts['all'] || 0) + 1;
    if (p.readyFor === null) {
      counts['complete'] = (counts['complete'] || 0) + 1;
    } else {
      counts[p.readyFor] = (counts[p.readyFor] || 0) + 1;
    }
  });

  return (
    <section className="card">
      <h2>Ordinance Progression</h2>

      {/* Filter bar */}
      <div className="people-filter-bar">
        <label htmlFor="people-filter" className="people-filter-label">
          Filter by stage:
        </label>
        <select
          id="people-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="people-filter-select"
        >
          {FILTER_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
              {counts[value] !== undefined ? ` (${counts[value]})` : ' (0)'}
            </option>
          ))}
        </select>

        <label className="people-filter-toggle">
          <input
            type="checkbox"
            checked={hideNoId}
            onChange={(e) => setHideNoId(e.target.checked)}
          />
          Hide people without FamilySearch ID
        </label>
      </div>

      {/* Pipeline legend */}
      <div className="pipeline-legend" aria-hidden="true">
        <span className="legend-item legend-item--done">
          <span className="legend-dot done" /> Completed
        </span>
        <span className="legend-item legend-item--next">
          <span className="legend-dot next" /> Ready next
        </span>
        <span className="legend-item">
          <span className="legend-dot" /> Not yet started
        </span>
        <span className="legend-item legend-item--skipped">
          <span className="legend-dot skipped" /> Not applicable
        </span>
        <span className="legend-item legend-item--reserved">
          <span className="legend-dot reserved" /> Reserved
        </span>
      </div>

      {/* Content */}
      {error && <p className="error-text">{error}</p>}

      {loading && !people && (
        <p className="loading-text">Loading people…</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="loading-text" style={{ marginTop: '1rem' }}>
          {people && people.length > 0
            ? 'No people match this filter.'
            : 'No ordinance records found yet.'}
        </p>
      )}

      <div className="people-list">
        {filtered.map((person, idx) => (
          <PersonRow
            key={person.familySearchId || person.name + idx}
            person={person}
          />
        ))}
      </div>
    </section>
  );
}

export default PeoplePanel;
