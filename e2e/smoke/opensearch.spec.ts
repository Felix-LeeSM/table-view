import { createOpenSearchConnection } from "./_helpers";
import { runSearchRuntimeSmoke } from "./search-runtime-smoke";

const CONNECTION_NAME = "E2E OpenSearch";
const INDEX =
  process.env.E2E_OPENSEARCH_INDEX ?? "table-view-opensearch-2026.05.24";

runSearchRuntimeSmoke({
  productLabel: "OpenSearch",
  connectionName: CONNECTION_NAME,
  index: INDEX,
  createConnection: createOpenSearchConnection,
});
