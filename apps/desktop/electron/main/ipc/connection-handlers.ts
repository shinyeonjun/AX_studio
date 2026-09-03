import { registerGmailConnectionHandlers } from './connection-handlers/gmail.js';
import { registerHttpConnectionHandlers } from './connection-handlers/http.js';
import { registerLocalFolderConnectionHandlers } from './connection-handlers/local-folder.js';
import { registerMcpConnectionHandlers } from './connection-handlers/mcp.js';
import { registerOpenApiConnectionHandlers } from './connection-handlers/openapi.js';
import { registerRdbConnectionHandlers } from './connection-handlers/rdb.js';
import { registerSlackConnectionHandlers } from './connection-handlers/slack.js';
import { registerWebhookConnectionHandlers } from './connection-handlers/webhook.js';

export function registerConnectionHandlers() {
  registerSlackConnectionHandlers();
  registerGmailConnectionHandlers();
  registerLocalFolderConnectionHandlers();
  registerHttpConnectionHandlers();
  registerWebhookConnectionHandlers();
  registerRdbConnectionHandlers();
  registerOpenApiConnectionHandlers();
  registerMcpConnectionHandlers();
}
