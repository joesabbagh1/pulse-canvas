import { useMemo } from 'react';
import { compile, type Target } from './engine/script';

/** Every command and condition, with what it does and, if only one, what it works on. */
export const CODE_REFERENCE: [string, string, Target?][] = [
  ['drop', 'the pulse stops here'],
  ['mute', 'pass the pulse on without sounding', 'block'],
  ['transpose +2', 'shift the pitch from here on, in scale degrees'],
  ['transpose to 0', 'set that shift outright, so loops don\'t climb'],
  ['velocity 60%', 'how loud this note is', 'block'],
  ['length 1/8', 'how long this note is, in beats', 'block'],
  ['delay 1/2', 'wait this many beats first'],
  ['route cycle', 'send down one link at a time: all, cycle or random', 'block'],
  ['every 3: …', 'only on the 3rd, 6th, 9th… pulse'],
  ['chance 50%: …', 'only sometimes'],
];

const PLACEHOLDER: Record<Target, string> = {
  block: 'every 4: transpose +7\nroute cycle',
  link: 'chance 25%: drop',
};

/** A script for a block or link, checked as you type. */
export function CodeField({ value, target, onChange }: { value: string; target: Target; onChange: (code: string) => void }) {
  const { errors } = useMemo(() => compile(value, target), [value, target]);

  return (
    <div className="field">
      <span className="field-label">Code</span>
      <textarea
        className="code"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        rows={Math.max(2, value.split('\n').length)}
        placeholder={PLACEHOLDER[target]}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Code for this ${target}`}
      />
      {errors.length > 0 ? (
        <div className="code-errors warn">
          {errors.map((e) => (
            <div key={e.line}>
              Line {e.line}: {e.message}
            </div>
          ))}
        </div>
      ) : (
        <details className="code-help">
          <summary className="muted">What can code do?</summary>
          <dl>
            {CODE_REFERENCE.filter(([, , only]) => !only || only === target).map(([cmd, what]) => (
              <div key={cmd}>
                <dt>
                  <code>{cmd}</code>
                </dt>
                <dd className="muted">{what}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">Each pulse runs the lines top to bottom. # starts a comment.</p>
        </details>
      )}
    </div>
  );
}
