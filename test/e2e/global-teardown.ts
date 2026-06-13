export default async function globalTeardown() {
  const pid = process.env._PI_WEB_TEST_PID;
  if (pid) {
    try {
      process.kill(-Number(pid), 'SIGTERM');
      console.log('Killed test server (PID', pid, ')');
    } catch {
      // Server may have already exited
    }
  }
}
