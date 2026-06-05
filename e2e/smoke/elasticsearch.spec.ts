import { createElasticsearchConnection } from "./_helpers";
import { runSearchRuntimeSmoke } from "./search-runtime-smoke";

const CONNECTION_NAME = "E2E Elasticsearch";
const INDEX =
  process.env.E2E_ELASTICSEARCH_INDEX ?? "table-view-elastic-2026.05.24";

runSearchRuntimeSmoke({
  productLabel: "Elasticsearch",
  connectionName: CONNECTION_NAME,
  index: INDEX,
  createConnection: createElasticsearchConnection,
});
