import * as Tone from 'tone';

// Recording taps the master output with an AudioWorklet and writes a WAV file:
// 16-bit stereo PCM, which every audio editor and DAW opens (the browser's own
// MediaRecorder only makes WebM or MP4). Audio arrives in batches and is
// converted to 16-bit straight away, so a minute of stereo at 48 kHz holds
// about 11 MB.

export const MAX_RECORD_SECONDS = 10 * 60;
const TAP = 'pulse-canvas-tap';

// Runs on the audio thread. It copies its input into batches of BATCH frames
// and posts each one, transferring the buffers rather than copying them again.
const TAP_SOURCE = `
const BATCH = 8192;
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.filled = 0;
    this.buffers = null;
    this.port.onmessage = () => {
      this.flush();
      this.on = false;
      this.port.postMessage('done');
    };
  }
  flush() {
    if (!this.buffers || !this.filled) return;
    const out = this.buffers.map((b) => b.slice(0, this.filled));
    this.port.postMessage(out, out.map((b) => b.buffer));
    this.filled = 0;
  }
  process(inputs) {
    if (!this.on) return false;
    const input = inputs[0];
    if (input && input.length) {
      if (!this.buffers) this.buffers = [new Float32Array(BATCH), new Float32Array(BATCH)];
      const n = input[0].length;
      if (this.filled + n > BATCH) this.flush();
      this.buffers[0].set(input[0], this.filled);
      this.buffers[1].set(input[1] || input[0], this.filled);
      this.filled += n;
    }
    return true;
  }
}
registerProcessor('${TAP}', Tap);
`;

/** Interleaves channels into 16-bit samples, clipping anything past full scale. */
export function toPcm16(channels: Float32Array[]): Int16Array {
  const frames = channels[0]?.length ?? 0;
  const out = new Int16Array(frames * channels.length);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels.length; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      out[i * channels.length + c] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
  }
  return out;
}

/** A WAV file from interleaved 16-bit chunks. */
export function wavFile(chunks: Int16Array[], channels: number, sampleRate: number): Blob {
  const dataBytes = chunks.reduce((n, c) => n + c.byteLength, 0);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => header.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, true); // fmt chunk size
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * channels * 2, true); // bytes per second
  header.setUint16(32, channels * 2, true); // bytes per frame
  header.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  header.setUint32(40, dataBytes, true);
  return new Blob([header.buffer, ...chunks.map((c) => c.buffer as ArrayBuffer)], { type: 'audio/wav' });
}

export class WavRecorder {
  private static loaded: Promise<void> | null = null;
  private chunks: Int16Array[] = [];
  private frames = 0;
  private finished: Promise<void>;
  private finish = () => {};

  private constructor(
    private source: Tone.ToneAudioNode,
    private node: AudioWorkletNode,
  ) {
    this.finished = new Promise((resolve) => (this.finish = resolve));
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'done') return this.finish();
      if (this.frames >= MAX_RECORD_SECONDS * Tone.getContext().sampleRate) return;
      this.chunks.push(toPcm16(e.data as Float32Array[]));
      this.frames += (e.data as Float32Array[])[0].length;
    };
  }

  /** Starts recording everything `source` puts out. */
  static async start(source: Tone.ToneAudioNode): Promise<WavRecorder> {
    const context = Tone.getContext();
    WavRecorder.loaded ??= context.addAudioWorkletModule(
      URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'application/javascript' })),
    );
    await WavRecorder.loaded;
    const node = context.createAudioWorkletNode(TAP, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    Tone.connect(source, node);
    return new WavRecorder(source, node);
  }

  get seconds() {
    return this.frames / Tone.getContext().sampleRate;
  }

  async stop(): Promise<Blob> {
    this.node.port.postMessage('stop');
    await this.finished;
    this.source.disconnect(this.node);
    return wavFile(this.chunks, 2, Tone.getContext().sampleRate);
  }
}
