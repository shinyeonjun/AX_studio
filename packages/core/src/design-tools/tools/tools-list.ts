import { listDesignTools } from '../registry.js';
import type { DesignToolHandler } from '../types.js';

export const toolsList: DesignToolHandler = () =>
  listDesignTools().map(({ id, description, args }) => ({
    id,
    description,
    args,
  }));
