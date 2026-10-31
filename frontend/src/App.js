import React, { useState, useEffect, useCallback } from 'react';
import SubmitForm from './SubmitForm';
import StatsPanel from './StatsPanel';

// ---------------------------------------------------------------------------
// API_BASE is set at build time via an environment variable.
// During local development, add REACT_APP_API_BASE=http://localhost:3001 to
// a .env.local file in the frontend/ folder.
// For production, set REACT_APP_API_BASE to your API Gateway URL before
// running `npm run build`.
// ---------------------------------------------------------------------------
const API_BASE = process.env.REACT_APP_API_BASE || '';

function App() {
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setStatsError('Could not load stats. Please try again later.');
      console.error('Stats fetch error:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="app">
      <header className="site-header">
        <h1>Smithfield 22nd Ward Temple Relay</h1>
        <p>Rejoice with the Lord in the House of the Lord</p>
      </header>

      <main>
        {/* Stats panel — loads from the Google Sheet */}
        <StatsPanel
          stats={stats}
          loading={statsLoading}
          error={statsError}
          onRefresh={fetchStats}
        />

        {/* Submission form */}
        <SubmitForm
          apiBase={API_BASE}
          onSuccess={fetchStats}
        />
      </main>

      <footer className="site-footer">
        <p>Smithfield 22nd Ward Temple Relay &mdash; Family History Ordinance Tracker</p>
      </footer>
    </div>
  );
}

export default App;
