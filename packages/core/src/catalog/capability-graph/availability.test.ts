import { describe, expect, it } from 'vitest';
import { availableCapabilities, designCapabilities } from '../capability-graph.js';

describe('capability graph availability', () => {
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
