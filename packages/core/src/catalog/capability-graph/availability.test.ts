import { describe, expect, it } from 'vitest';
import { availableCapabilities, connectedConnectorIds, designCapabilities } from '../capability-graph.js';

describe('capability graph availability', () => {
  it('merges configured and built-in connectors using the shared runtime rule', () => {
    const connected = connectedConnectorIds([
      { connector: 'gmail', connected: true },
      { connector: 'gmail', connected: true },
      { connector: 'slack', connected: false },
    ]);

    expect(connected.filter((connector) => connector === 'gmail')).toHaveLength(1);
    expect(connected).not.toContain('slack');
    expect(connected).toContain('local_sheet');
    expect(new Set(connected).size).toBe(connected.length);
  });

  it('hides gmail nodes until connected, keeps builtin tools', () => {
    const none = availableCapabilities([]);
    expect(none.some((cap) => cap.connector === 'gmail')).toBe(false);
    expect(none.some((cap) => cap.id === 'local_sheet.read')).toBe(true);
    expect(none.some((cap) => cap.id === 'document.html.render')).toBe(true);

    const withGmail = availableCapabilities(['gmail']);
    expect(withGmail.some((cap) => cap.id === 'gmail.message.send')).toBe(true);
  });

  it('keeps packaged notification actions visible for design before connection', () => {
    const design = designCapabilities();
    expect(design.some((cap) => cap.id === 'gmail.message.send')).toBe(true);
    expect(design.some((cap) => cap.id === 'slack.message.send')).toBe(true);
  });
});
