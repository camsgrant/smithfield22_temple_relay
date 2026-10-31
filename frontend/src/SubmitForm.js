import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// SubmitForm
// Fields:
//   - Name (required)
//   - Gender (required) — used to pick random male/female in StatsPanel
//   - Ordinance (required dropdown)
//   - Date (required)
//   - FamilySearch ID (optional)
// ---------------------------------------------------------------------------

const ORDINANCES = [
  'Baptism & Confirmation',
  'Initiatory',
  'Endowment',
  'Sealing to Spouse',
  'Sealing to Parents',
];

const EMPTY_FORM = {
  name: '',
  gender: '',
  ordinance: '',
  date: '',
  familySearchId: '',
};

function validate(fields) {
  const errors = {};
  if (!fields.name.trim()) errors.name = 'Name is required.';
  if (!fields.gender) errors.gender = 'Please select a gender.';
  if (!fields.ordinance) errors.ordinance = 'Please select an ordinance.';
  if (!fields.date) errors.date = 'Date is required.';
  // Optional: basic FamilySearch ID format check (e.g. LZXX-XXX)
  if (fields.familySearchId && !/^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/i.test(fields.familySearchId.trim())) {
    errors.familySearchId = 'ID format should look like LZXX-XXX (or leave blank).';
  }
  return errors;
}

function SubmitForm({ apiBase, onSuccess }) {
  const [fields, setFields] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState(null); // { type: 'success'|'error', message }

  function handleChange(e) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    // Clear the error for this field as the user types
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBanner(null);

    const validationErrors = validate(fields);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: fields.name.trim(),
        gender: fields.gender,
        ordinance: fields.ordinance,
        date: fields.date,
        familySearchId: fields.familySearchId.trim() || null,
      };

      const res = await fetch(`${apiBase}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error (${res.status})`);
      }

      setBanner({ type: 'success', message: 'Ordinance recorded successfully! Thank you.' });
      setFields(EMPTY_FORM);
      setErrors({});
      // Refresh the stats panel
      if (onSuccess) onSuccess();
    } catch (err) {
      setBanner({
        type: 'error',
        message: `Submission failed: ${err.message}. Please try again.`,
      });
      console.error('Submit error:', err);
    } finally {
      setSubmitting(false);
    }
  }

  // Today's date in YYYY-MM-DD format for the date input max attribute
  const today = new Date().toISOString().split('T')[0];

  return (
    <section className="card">
      <h2>Record an Ordinance</h2>

      {banner && (
        <div className={`banner ${banner.type}`} role="alert">
          {banner.message}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Name */}
        <div className="form-group">
          <label htmlFor="name">Ancestor's Name</label>
          <input
            id="name"
            name="name"
            type="text"
            value={fields.name}
            onChange={handleChange}
            placeholder="e.g. John Smith"
            className={errors.name ? 'error' : ''}
            autoComplete="off"
          />
          {errors.name && <p className="field-error">{errors.name}</p>}
        </div>

        {/* Gender + Ordinance side by side */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="gender">Gender</label>
            <select
              id="gender"
              name="gender"
              value={fields.gender}
              onChange={handleChange}
              className={errors.gender ? 'error' : ''}
            >
              <option value="">Select gender…</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            {errors.gender && <p className="field-error">{errors.gender}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="ordinance">Ordinance</label>
            <select
              id="ordinance"
              name="ordinance"
              value={fields.ordinance}
              onChange={handleChange}
              className={errors.ordinance ? 'error' : ''}
            >
              <option value="">Select ordinance…</option>
              {ORDINANCES.map((ord) => (
                <option key={ord} value={ord}>
                  {ord}
                </option>
              ))}
            </select>
            {errors.ordinance && <p className="field-error">{errors.ordinance}</p>}
          </div>
        </div>

        {/* Date + FamilySearch ID side by side */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="date">Date Completed</label>
            <input
              id="date"
              name="date"
              type="date"
              value={fields.date}
              onChange={handleChange}
              max={today}
              className={errors.date ? 'error' : ''}
            />
            {errors.date && <p className="field-error">{errors.date}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="familySearchId">
              FamilySearch ID
              <span className="optional-tag">(optional)</span>
            </label>
            <input
              id="familySearchId"
              name="familySearchId"
              type="text"
              value={fields.familySearchId}
              onChange={handleChange}
              placeholder="e.g. LZXX-XXX"
              className={errors.familySearchId ? 'error' : ''}
              autoComplete="off"
            />
            {errors.familySearchId && (
              <p className="field-error">{errors.familySearchId}</p>
            )}
          </div>
        </div>

        <button type="submit" className="submit-btn" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Record Ordinance'}
        </button>
      </form>
    </section>
  );
}

export default SubmitForm;
