export async function assertElectronSandbox(app) {
  const bypass = await app.evaluate(({ app }) => ['no-sandbox', 'disable-setuid-sandbox', 'disable-namespace-sandbox']
    .filter((flag) => app.commandLine.hasSwitch(flag)));
  if (!Array.isArray(bypass)) throw new Error('Could not verify Electron sandbox switches');
  if (bypass.length) throw new Error('Electron sandbox bypass detected: ' + bypass.join(', '));
}
