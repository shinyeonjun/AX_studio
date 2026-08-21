import type { DocumentWriteFormatModule } from '../types.js';
import { htmlRender } from './render.js';

export const htmlWriteModule: DocumentWriteFormatModule = {
  format: 'html',
  actions: {
    render: htmlRender,
  },
};
