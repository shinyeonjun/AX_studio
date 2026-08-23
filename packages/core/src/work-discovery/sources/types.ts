export type {
  DiscoverySourceContext,
  DiscoverySourceDescriptor,
  DiscoverySourceProvider,
  ExplorationBudget,
  SourceProfileResult,
  WorkbookMaterializer,
} from '../../contracts/discovery-source.js';

export interface InputArtifactDiscoverySourceOptions {
  materializeWorkbook: import('../../contracts/discovery-source.js').WorkbookMaterializer['readWorkbookFromPath'];
}
