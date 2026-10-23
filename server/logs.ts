import {
  mkdirSync,
  appendFileSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
// Retiene únicamente un sufijo que podría ser el comienzo de un secreto.
export class Redactor {
  private pending = "";
  constructor(private secrets: string[]) {
    this.secrets = [...new Set(secrets.filter(Boolean))].sort(
      (a, b) => b.length - a.length,
    );
  }
  push(input: string, final = false): string {
    this.pending += input;
    let output = "";
    while (this.pending) {
      const exact = this.secrets.find((secret) =>
        this.pending.startsWith(secret),
      );
      const possible = this.secrets.some((secret) =>
        secret.startsWith(this.pending),
      );
      if (!final && possible) break;
      if (exact) {
        output += "[OCULTO]";
        this.pending = this.pending.slice(exact.length);
      } else {
        output += this.pending[0];
        this.pending = this.pending.slice(1);
      }
    }
    return output;
  }
}
export class LogWriter {
  private bytes = 0;
  private sequence = 0;
  private truncated = false;
  private channels = new Map<
    string,
    { redactor: Redactor; decoder: StringDecoder }
  >();
  readonly file: string;
  constructor(
    dir: string,
    id: string,
    private secrets: string[],
    private limit = 10 * 1024 * 1024,
  ) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, `${id}.jsonl`);
    appendFileSync(this.file, "", { mode: 0o600 });
  }
  private write(step: string, channel: string, text: string) {
    if (!text || this.truncated) return;
    // Acotar también el tamaño de cada registro y el tamaño real JSON en disco.
    for (let i = 0; i < text.length; i += 4096) {
      const line =
        JSON.stringify({
          seq: ++this.sequence,
          at: Date.now(),
          step,
          channel,
          text: text.slice(i, i + 4096),
        }) + "\n";
      const size = Buffer.byteLength(line);
      if (this.bytes + size > this.limit - 512) {
        this.truncated = true;
        appendFileSync(
          this.file,
          JSON.stringify({
            seq: ++this.sequence,
            at: Date.now(),
            step,
            channel: "system",
            text: "[Salida truncada: límite de captura alcanzado]",
          }) + "\n",
        );
        break;
      }
      appendFileSync(this.file, line);
      this.bytes += size;
    }
  }
  push(step: string, channel: string, chunk: Buffer) {
    const key = `${step}:${channel}`;
    let state = this.channels.get(key);
    if (!state) {
      state = {
        redactor: new Redactor(this.secrets),
        decoder: new StringDecoder("utf8"),
      };
      this.channels.set(key, state);
    }
    this.write(step, channel, state.redactor.push(state.decoder.write(chunk)));
  }
  finish(step: string) {
    for (const channel of ["stdout", "stderr"]) {
      const key = `${step}:${channel}`;
      const state = this.channels.get(key);
      if (state) {
        this.write(
          step,
          channel,
          state.redactor.push(state.decoder.end(), true),
        );
        this.channels.delete(key);
      }
    }
  }
}
export function readLogs(dir: string, id: string, cursor: number) {
  const file = path.join(dir, `${id}.jsonl`);
  if (!existsSync(file)) return { entries: [], cursor: 0 };
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(128 * 1024);
    const count = readSync(fd, buffer, 0, buffer.length, cursor);
    const end = buffer.subarray(0, count).lastIndexOf(10);
    if (end < 0) return { entries: [], cursor };
    const text = buffer.subarray(0, end).toString("utf8");
    return {
      entries: text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
      cursor: cursor + end + 1,
    };
  } finally {
    closeSync(fd);
  }
}
export function removeLogs(dir: string, id: string) {
  const file = path.join(dir, `${id}.jsonl`);
  if (existsSync(file)) unlinkSync(file);
}
