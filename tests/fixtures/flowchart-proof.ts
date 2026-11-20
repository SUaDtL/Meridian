import { proveFlowchartEdit, type SourceIntent } from '../../src/lib/authoring/flowchart-proof';
import { createDocument } from '../../src/lib/storage';

async function prove(source: string, intent: SourceIntent) {
  const document = { ...createDocument(), source };
  const result = await proveFlowchartEdit(document, intent);
  return { source: result.source, sourceId: result.sourceId, original: document.source };
}

declare global {
  interface Window {
    proveFlowchartFixture: typeof prove;
  }
}

window.proveFlowchartFixture = prove;

type LegacyFixtureProject = ReturnType<typeof createDocument>;

declare global {
  interface Window {
    migrateLegacyFixture: (document: LegacyFixtureProject) => ReturnType<typeof import('../../src/lib/authoring/migrate-legacy-project').inspectLegacyProject>;
  }
}

window.migrateLegacyFixture = async document => {
  const { inspectLegacyProject } = await import('../../src/lib/authoring/migrate-legacy-project');
  return inspectLegacyProject(document);
};
