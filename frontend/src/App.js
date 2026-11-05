import React, { useState, useEffect, useCallback } from 'react';
import SubmitForm from './SubmitForm';
import StatsPanel from './StatsPanel';
import PeoplePanel from './PeoplePanel';

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

  const [people, setPeople] = useState(null);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState(null);

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

  const fetchPeople = useCallback(async () => {
    setPeopleLoading(true);
    setPeopleError(null);
    try {
      const res = await fetch(`${API_BASE}/people`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setPeople(data.people || []);
    } catch (err) {
      setPeopleError('Could not load ordinance progress. Please try again later.');
      console.error('People fetch error:', err);
    } finally {
      setPeopleLoading(false);
    }
  }, []);

  // Fetch both on mount
  useEffect(() => {
    fetchStats();
    fetchPeople();
  }, [fetchStats, fetchPeople]);

  // After a new submission, refresh both stats and the people list
  function handleSubmitSuccess() {
    fetchStats();
    fetchPeople();
  }

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

        {/* Ordinance progression panel */}
        <PeoplePanel
          people={people}
          loading={peopleLoading}
          error={peopleError}
        />

        {/* Submission form */}
        <SubmitForm
          apiBase={API_BASE}
          onSuccess={handleSubmitSuccess}
        />
      </main>

      <footer className="site-footer">
        <p>Smithfield 22nd Ward Temple Relay &mdash; Family History Ordinance Tracker</p>
      </footer>
    </div>
  );
}

export default App;
