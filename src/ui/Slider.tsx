interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Double-clicking the slider puts it back here. */
  reset: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

/** A labeled range with a readout. Double-click resets. Shared by the region and synth patch editors. */
export function Slider({ label, value, min, max, step, reset, format, onChange }: SliderProps) {
  return (
    <label className="slider" title="Double-click to reset">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(reset)}
      />
      <span className="value">{format(value)}</span>
    </label>
  );
}
