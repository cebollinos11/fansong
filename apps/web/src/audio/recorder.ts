/**
 * The recording booth's microphone: one stream held open for the whole session,
 * its raw samples gathered for whichever cue is being recorded.
 */

/** A recording longer than this is cut off (an ambience loop is the longest thing asked for). */
const MAX_SECONDS = 90;
/** Ignored at the start of a cue: the key that brought it up is still clacking. */
const LEAD_SKIP_MS = 250;
/** Dropped from the end of a cue: the key that ends it. */
export const TAIL_SKIP_MS = 150;

const TAP = `
class FansongTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice());
    return true;
  }
}
registerProcessor('fansong-tap', FansongTap);
`;

export class MicRecorder {
  /** Loudness of the latest moment heard, 0..1 (for the meter). */
  level = 0;
  /** While set, nothing is gathered (the booth is playing something back). */
  paused = false;
  private chunks: Float32Array[] = [];
  private length = 0;
  private skip = 0;

  private constructor(
    readonly rate: number,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
    private readonly source: MediaStreamAudioSourceNode,
  ) {
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => this.hear(ev.data);
    this.restart();
  }

  /**
   * Ask for the microphone and start listening. The browser's own clean-up is
   * off: noise suppression takes a "fwsh" for noise and removes it.
   */
  static async open(ctx: AudioContext): Promise<MicRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    await ctx.resume();
    const url = URL.createObjectURL(new Blob([TAP], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, 'fansong-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    const source = ctx.createMediaStreamSource(stream);
    source.connect(node);
    return new MicRecorder(ctx.sampleRate, stream, node, source);
  }

  /** Forget what has been gathered and start a fresh cue. */
  restart(): void {
    this.chunks = [];
    this.length = 0;
    this.skip = Math.round((this.rate * LEAD_SKIP_MS) / 1000);
  }

  /** Everything gathered for this cue so far, less its last `tailMs`. */
  audio(tailMs = 0): Float32Array {
    const out = new Float32Array(Math.max(0, this.length - Math.round((this.rate * tailMs) / 1000)));
    let at = 0;
    for (const chunk of this.chunks) {
      if (at >= out.length) break;
      out.set(chunk.subarray(0, Math.min(chunk.length, out.length - at)), at);
      at += chunk.length;
    }
    return out;
  }

  close(): void {
    this.node.port.onmessage = null;
    this.source.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }

  private hear(chunk: Float32Array): void {
    let sum = 0;
    for (const s of chunk) sum += s * s;
    this.level = Math.sqrt(sum / Math.max(1, chunk.length));
    if (this.paused) return;
    if (this.skip > 0) {
      this.skip -= chunk.length;
      return;
    }
    if (this.length >= this.rate * MAX_SECONDS) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
}
