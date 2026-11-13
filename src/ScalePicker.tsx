import { useRef } from 'react';
import { parseKbm, parseScala } from './engine/scala';
import { KEYS, SCALES, keyOf, type Scale } from './engine/tuning';
import { useSettings } from './settings';
import { Select, type SelectGroup } from './ui/Select';
import { toast } from './ui/Toast';

const IMPORT = '__import';
const REMOVE = '__remove';
const CUSTOM = '__custom';

// Most .scl files are ASCII, but older ones are often Latin-1.
async function readText(file: File) {
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  return text.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : text;
}

/** A hidden file input, and a way to open it. */
function useFilePicker(accept: string, onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

interface Props {
  value: string;
  label: string;
  onChange: (scaleId: string) => void;
  /** Adds an imported scale to the piece; it is then picked here. */
  onImport: (scale: Scale) => void;
  /** Takes an imported scale out of the piece. */
  onRemove: (scaleId: string) => void;
}

export function ScalePicker({ value, label, onChange, onImport, onRemove }: Props) {
  const { scales } = useSettings();
  const imported = scales.filter((s) => !SCALES.includes(s));
  const current = imported.find((s) => s.id === value);

  const file = useFilePicker('.scl', async (f) => {
    try {
      const scale = parseScala(await readText(f), f.name.replace(/\.scl$/i, ''));
      onImport(scale);
      onChange(scale.id);
      toast('success', `Imported ${f.name}`, scale.name);
    } catch (err) {
      toast('error', `Couldn't import ${f.name}`, (err as Error).message);
    }
  });

  const groups: SelectGroup[] = [
    { options: SCALES.map((s) => ({ value: s.id, label: s.name })) },
    ...(imported.length > 0 ? [{ label: 'Imported', options: imported.map((s) => ({ value: s.id, label: s.name })) }] : []),
    {
      options: [
        { value: IMPORT, label: 'Import .scl file…', action: file.open },
        ...(current ? [{ value: REMOVE, label: `Remove “${current.name}”…`, action: () => onRemove(current.id) }] : []),
      ],
    },
  ];

  return (
    <>
      <Select value={value} groups={groups} ariaLabel={label} onChange={onChange} />
      {file.input}
    </>
  );
}

// The root is the frequency of degree 0. The menu offers the twelve keys; a
// .kbm file can pin it anywhere else (A = 432 Hz, say), shown as a frequency.
export function RootPicker({ value, scale, label, onChange }: { value: number; scale: Scale; label: string; onChange: (hz: number) => void }) {
  const key = keyOf(value);

  const file = useFilePicker('.kbm', async (f) => {
    try {
      const hz = parseKbm(await readText(f), scale);
      onChange(hz);
      toast('success', `Root set from ${f.name}`, `Degree 0 of ${scale.name} is now ${hz.toFixed(2)} Hz.`);
    } catch (err) {
      toast('error', `Couldn't read ${f.name}`, (err as Error).message);
    }
  });

  const groups: SelectGroup[] = [
    { options: KEYS.map((k) => ({ value: k.name, label: k.name })) },
    ...(key ? [] : [{ options: [{ value: CUSTOM, label: `${value.toFixed(1)} Hz` }] }]),
    { options: [{ value: IMPORT, label: 'Set from .kbm file…', action: file.open }] },
  ];

  return (
    <>
      <Select
        value={key?.name ?? CUSTOM}
        groups={groups}
        ariaLabel={label}
        onChange={(name) => {
          const k = KEYS.find((x) => x.name === name);
          if (k) onChange(k.hz);
        }}
      />
      {file.input}
    </>
  );
}
