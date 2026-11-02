// The practice phone's recorder (step 55, development only), in the browser:
// the microphone's sound kept as numbers while the caller talks, then made
// into what the brain's Whisper reads (a WAV file: one channel, 16,000
// samples a second, 16 bits), as base64 for the server action. No outside
// library; the recording never leaves this computer (core hands it to the
// brain on the same computer).

// The brain hears 16 kHz mono speech.
export const SPEECH_RATE = 16_000;
// A turn longer than this stops by itself (about 2 MB of WAV).
export const LONGEST_TURN_SECONDS = 60;

export type Recorder = { stop: () => string; seconds: () => number };

// Starts listening to the microphone (the browser asks for permission first).
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessorNode is old but works in every browser without a module file.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let samples = 0;
  processor.onaudioprocess = (event) => {
    const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
    chunks.push(chunk);
    samples += chunk.length;
  };
  source.connect(processor);
  processor.connect(context.destination);
  return {
    seconds: () => samples / context.sampleRate,
    stop: () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      return toBase64(encodeWav(downsample(join(chunks), context.sampleRate, SPEECH_RATE), SPEECH_RATE));
    },
  };
}

// The chunks as one run of samples.
export function join(chunks: Float32Array[]): Float32Array {
  const all = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}

// The samples at `to` a second: each new sample is the average of the ones it covers.
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) {
    return samples;
  }
  const ratio = from / to;
  const result = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < result.length; index++) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let at = start; at < end; at++) {
      sum += samples[at];
    }
    result[index] = sum / (end - start);
  }
  return result;
}

// A WAV file: the 44-byte header, then each sample as a 16-bit number.
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((letter, index) => view.setUint8(at + index, letter.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  return bytes;
}

// Base64 for the server action (in pieces: a long recording is too big for one call).
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

// Says ansa's words with this computer's own voice; resolves when it has finished.
export function speak(words: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || words.length === 0) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(words.join(" "));
    utterance.lang = navigator.language;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}
