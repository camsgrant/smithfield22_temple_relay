import React from 'react';

// ---------------------------------------------------------------------------
// StatsPanel
// Displays:
//   - Total ordinances completed
//   - A random male and female from the sheet (with FamilySearch links)
//   - A link to view the full Google Sheet
// ---------------------------------------------------------------------------

function PersonBox({ label, person }) {
  if (!person) {
    return (
      <div className="person-box">
        <div className="person-label">{label}</div>
        <div className="person-name" style={{ color: '#aaa', fontStyle: 'italic' }}>
          No entries yet
        </div>
      </div>
    );
  }

  const fsUrl = person.familySearchId
    ? `https://www.familysearch.org/tree/person/ordinances/${person.familySearchId}`
    : null;

  return (
    <div className="person-box">
      <div className="person-label">{label}</div>
      <div className="person-name">{person.name}</div>
      {person.ordinance && (
        <div style={{ fontSize: '0.8rem', color: '#777', marginBottom: '0.4rem' }}>
          {person.ordinance} &bull; {person.date}
        </div>
      )}
      {fsUrl ? (
        <a href={fsUrl} target="_blank" rel="noopener noreferrer">
          View this person on FamilySearch ↗
        </a>
      ) : (
        <span style={{ fontSize: '0.8rem', color: '#aaa', fontStyle: 'italic' }}>
          No FamilySearch ID provided
        </span>
      )}
    </div>
  );
}

function StatsPanel({ stats, loading, error, onRefresh }) {
  return (
    <section className="card">
      <h2>
        Overview
        <button
          onClick={onRefresh}
          disabled={loading}
          title="Refresh stats"
          style={{
            float: 'right',
            background: 'none',
            border: '1px solid #ccc',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '0.75rem',
            padding: '0.2rem 0.6rem',
            color: '#666',
          }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </h2>

      {error && <p className="error-text">{error}</p>}

      {loading && !stats && (
        <p className="loading-text">Loading stats…</p>
      )}

      {stats && (
        <>
          {/* Total count */}
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            <div className="stat-box">
              <div className="stat-label">Total Ordinances Completed</div>
              <div className="stat-value">{stats.totalOrdinances ?? '—'}</div>
            </div>

            {/* Breakdown by ordinance type */}
            {stats.byOrdinance && Object.keys(stats.byOrdinance).length > 0 && (
              <div className="stat-box" style={{ textAlign: 'left', gridColumn: 'span 2' }}>
                <div className="stat-label" style={{ marginBottom: '0.5rem' }}>
                  Breakdown by Ordinance
                </div>
                {Object.entries(stats.byOrdinance).map(([type, count]) => (
                  <div
                    key={type}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.9rem',
                      padding: '0.2rem 0',
                      borderBottom: '1px solid #e8e0d0',
                    }}
                  >
                    <span>{type}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Random male & female */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
              marginBottom: '1rem',
            }}
          >
            <PersonBox label="✦ Recent Male Relative" person={stats.randomMale} />
            <PersonBox label="✦ Recent Female Relative" person={stats.randomFemale} />
          </div>

          {/* Link to full sheet */}
          {stats.sheetUrl && (
            <div className="sheet-link-box">
              <a href={stats.sheetUrl} target="_blank" rel="noopener noreferrer">
                📋 View Full Spreadsheet ↗
              </a>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default StatsPanel;
