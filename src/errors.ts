/** User-facing setup problems (bad flags, unreadable directory, corrupt
 * journal). The CLI maps these to exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
