import type { Action } from '@petarde/shared';
import type { InputSource } from './InputSource';

/** Several devices at once (a tablet with a keyboard): each reports its changes, the latest one wins. */
export class CombinedInput implements InputSource {
  constructor(private readonly sources: InputSource[]) {}

  poll(): Action[] {
    return this.sources.flatMap((source) => source.poll());
  }

  reset(): void {
    for (const source of this.sources) source.reset();
  }

  destroy(): void {
    for (const source of this.sources) source.destroy();
  }
}
