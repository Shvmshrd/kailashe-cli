/**
 * FakeLLM — replays scripted transcripts for tests.
 *
 * Usage:
 *   const llm = new FakeLLM([textResponse("hello"), textResponse("world")]);
 *   await llm.respond({ input: "hi" }); // -> "hello"
 *   await llm.respond({ input: "hi" }); // -> "world"
 *
 * Supports errors in the script, call recording, and custom matchers.
 */

import type { LLMRequest, LLMResponse } from "./types.js";
import type { LLMClient } from "./client.js";

export type FakeEntry = LLMResponse | Error;

export interface FakeLLMOptions {
  /** Throw if respond() is called more times than entries. Default true. */
  strict?: boolean;
}

export class FakeLLM implements LLMClient {
  private readonly entries: FakeEntry[];
  private index = 0;
  private _calls: LLMRequest[] = [];
  private readonly strict: boolean;

  constructor(entries: FakeEntry[], opts: FakeLLMOptions = {}) {
    this.entries = [...entries];
    this.strict = opts.strict ?? true;
  }

  /** All requests received so far. */
  get calls(): readonly LLMRequest[] {
    return this._calls;
  }

  /** Number of calls made. */
  get callCount(): number {
    return this._calls.length;
  }

  /** Whether all scripted entries have been consumed. */
  get exhausted(): boolean {
    return this.index >= this.entries.length;
  }

  /** Remaining scripted entries. */
  get remaining(): number {
    return Math.max(0, this.entries.length - this.index);
  }

  async respond(input: LLMRequest): Promise<LLMResponse> {
    this._calls.push(input);

    if (this.index >= this.entries.length) {
      if (this.strict) {
        throw new Error(`FakeLLM: no more scripted responses (call #${this._calls.length}, ${this.entries.length} scripted)`);
      }
      // Non-strict: repeat last entry
      const last = this.entries[this.entries.length - 1];
      if (!last) throw new Error("FakeLLM: no scripted responses at all");
      if (last instanceof Error) throw last;
      return last;
    }

    const entry = this.entries[this.index++]!;
    if (entry instanceof Error) throw entry;
    return entry;
  }

  /** Reset call history and replay index. */
  reset(): void {
    this._calls = [];
    this.index = 0;
  }

  /** Push additional entries to the end of the script. */
  enqueue(...entries: FakeEntry[]): void {
    this.entries.push(...entries);
  }
}
