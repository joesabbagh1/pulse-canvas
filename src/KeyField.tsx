import { useState } from 'react';

interface Props {
  value?: string;
  /** What pressing the key does, e.g. "fires this block". */
  does: string;
  /** Keys already given to something else, with what they belong to. */
  taken: ReadonlyMap<string, string>;
  onChange: (key: string | undefined) => void;
}

// One letter or digit to play the canvas from the keyboard. Other keys are
// the app's own shortcuts (Space, ?, Backspace…), so they're not offered.
export function KeyField({ value, does, taken, onChange }: Props) {
  const [error, setError] = useState('');
  const pick = (raw: string) => {
    const key = raw.slice(-1).toLowerCase();
    if (!key) {
      setError('');
      return onChange(undefined);
    }
    if (!/^[a-z0-9]$/.test(key)) return setError('Use a letter or a digit.');
    const owner = taken.get(key);
    if (owner) return setError(`${key.toUpperCase()} already ${owner}.`);
    setError('');
    onChange(key);
  };

  return (
    <div className="field">
      <span className="field-label">Performance key</span>
      <div className="row">
        <input
          type="text"
          className="key-input"
          aria-label="Performance key"
          placeholder="–"
          value={value?.toUpperCase() ?? ''}
          onChange={(e) => pick(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        {value && (
          <button onClick={() => pick('')} title="Remove the key">
            Clear
          </button>
        )}
      </div>
      {error ? (
        <span className="warn">{error}</span>
      ) : (
        <span className="muted">{value ? `Pressing ${value.toUpperCase()} ${does}.` : `A letter or digit that ${does}, for playing live.`}</span>
      )}
    </div>
  );
}
