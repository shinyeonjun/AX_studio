export {
  getLocalFolderConnectionStatus,
  parseLocalFolderConnectionConfig,
  removeLocalFolder,
  upsertLocalFolder,
  type LocalFolderConnectionConfig,
  type LocalFolderConnectionStatus,
  type LocalFolderEntry,
} from '../../platform/local-folder-config.js';
export { LocalFolderConnector } from './connector.js';
export {
  scanFolder,
  scanFolderChecked,
  type ScannedFile,
  type ScanFolderResult,
} from '../../platform/local-folder-scan.js';
export {
  scanFolderCheckedAsync,
} from '../../platform/local-folder-scan-async.js';
