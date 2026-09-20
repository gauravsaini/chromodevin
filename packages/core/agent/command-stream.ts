/**
 * CommandStream: An async iterator for continuous agent command streaming.
 * Accepts push-based events (voice inputs, user actions) consumed sequentially via for-await.
 */

export interface CommandStreamOptions {
  onWait?: () => void;
  onYield?: () => void;
}

export class CommandStream<T = string> {
  private queue: T[];
  private resolvers: Array<(value: { value: T | undefined; done: boolean }) => void>;
  private closed: boolean;
  private onWait: (() => void) | null;
  private onYield: (() => void) | null;

  constructor(options: CommandStreamOptions = {}) {
    this.queue = [];
    this.resolvers = [];
    this.closed = false;
    this.onWait = options.onWait || null;
    this.onYield = options.onYield || null;
  }

  push(command: T | any): void {
    if (this.closed || command === undefined || command === null) return;
    const item = typeof command === 'string' ? (command.trim() as unknown as T) : command;

    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      if (resolver) resolver({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  close(): void {
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      if (resolver) resolver({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    while (true) {
      if (this.queue.length > 0) {
        if (this.onYield) this.onYield();
        const val = this.queue.shift();
        if (val !== undefined) yield val;
      } else if (this.closed) {
        return;
      } else {
        if (this.onWait) this.onWait();
        const next = await new Promise<{ value: T | undefined; done: boolean }>((resolve) =>
          this.resolvers.push(resolve)
        );
        if (next.done || next.value === undefined) return;
        if (this.onYield) this.onYield();
        yield next.value;
      }
    }
  }
}
