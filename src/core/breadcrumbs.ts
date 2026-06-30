/**
 * Fixed-size ring buffer of recent actions, attached to `app.crash` as the
 * JSON-stringified `crash.breadcrumbs` (last N, oldest evicted first). See #28.
 */
export class BreadcrumbBuffer {
  private items: any[] = [];

  constructor(private max = 20) {}

  add(item: any): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.shift();
  }

  list(): any[] {
    return [...this.items];
  }

  toJSON(): string {
    return JSON.stringify(this.items);
  }
}
