export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { claudeWatcher } = await import('./lib/claude-watcher');
    claudeWatcher.start();
  }
}
