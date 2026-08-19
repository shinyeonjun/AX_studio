import type { DocumentFormatModule } from '../types.js';
import { htmlRender } from './render.js';

export const htmlDocument: DocumentFormatModule = {
  format: 'html',
  actions: {
    render: htmlRender,
  },
};
