import { getMongoshCompletionVocabulary } from "./mongoshAst/index";
import { MONGOSH_METHOD_WHITELIST } from "./mongoshMethods";

export interface MongoshMethodCompletion {
  label: string;
  type: "function";
  detail: string;
  info: string;
}

export interface MongoAdminCommandCompletion {
  label: string;
  apply: string;
  detail: string;
  info: string;
}

export const MONGOSH_DB_METHODS: ReadonlyArray<MongoshMethodCompletion> = [
  {
    label: "find",
    type: "function",
    detail: "(filter?, options?)",
    info: "Return a cursor over documents matching the filter.",
  },
  {
    label: "findOne",
    type: "function",
    detail: "(filter, options?)",
    info: "Return the first document matching the filter, or null.",
  },
  {
    label: "aggregate",
    type: "function",
    detail: "(pipeline, options?)",
    info: "Run an aggregation pipeline and return the resulting cursor.",
  },
  {
    label: "countDocuments",
    type: "function",
    detail: "(filter?, options?)",
    info: "Exact count of documents matching the filter.",
  },
  {
    label: "estimatedDocumentCount",
    type: "function",
    detail: "(options?)",
    info: "Fast metadata-based count of all documents.",
  },
  {
    label: "distinct",
    type: "function",
    detail: "(field, filter?, options?)",
    info: "Distinct values of field for documents matching the filter.",
  },
  {
    label: "insertOne",
    type: "function",
    detail: "(doc, options?)",
    info: "Insert a single document.",
  },
  {
    label: "insertMany",
    type: "function",
    detail: "(docs[], options?)",
    info: "Insert multiple documents.",
  },
  {
    label: "updateOne",
    type: "function",
    detail: "(filter, update, options?)",
    info: "Update the first document matching the filter.",
  },
  {
    label: "updateMany",
    type: "function",
    detail: "(filter, update, options?)",
    info: "Update every document matching the filter.",
  },
  {
    label: "replaceOne",
    type: "function",
    detail: "(filter, replacement, options?)",
    info: "Replace the matched document wholesale.",
  },
  {
    label: "deleteOne",
    type: "function",
    detail: "(filter, options?)",
    info: "Delete the first document matching the filter.",
  },
  {
    label: "deleteMany",
    type: "function",
    detail: "(filter, options?)",
    info: "Delete every document matching the filter.",
  },
  {
    label: "createIndex",
    type: "function",
    detail: "(keys, options?)",
    info: "Create an index on the given key spec.",
  },
  {
    label: "dropIndex",
    type: "function",
    detail: "(indexName)",
    info: "Drop the named index from the collection.",
  },
  {
    label: "bulkWrite",
    type: "function",
    detail: "(operations, options?)",
    info: "Run multiple write operations in one batch.",
  },
];

const MONGOSH_DB_METHOD_LABELS = new Set(
  MONGOSH_DB_METHODS.map((method) => method.label),
);

for (const method of MONGOSH_METHOD_WHITELIST) {
  if (!MONGOSH_DB_METHOD_LABELS.has(method)) {
    throw new Error(
      `mongosh autocomplete missing whitelisted method: ${method}`,
    );
  }
}

export const MONGOSH_DB_LEVEL_METHODS: ReadonlyArray<MongoshMethodCompletion> =
  [
    {
      label: "runCommand",
      type: "function",
      detail: "({<cmd>: <arg>, ...})",
      info: "Run an allowlisted database command against the bound database.",
    },
    {
      label: "adminCommand",
      type: "function",
      detail: "({<cmd>: <arg>, ...})",
      info: "Run an allowlisted admin-database command.",
    },
    {
      label: "getCollection",
      type: "function",
      detail: "(name)",
      info: "Return a collection handle by name.",
    },
    {
      label: "getCollectionNames",
      type: "function",
      detail: "()",
      info: "List collection names in the current database.",
    },
    {
      label: "getCollectionInfos",
      type: "function",
      detail: "()",
      info: "List collection metadata in the current database.",
    },
    {
      label: "getProfilingStatus",
      type: "function",
      detail: "()",
      info: "Return the profiling level and slow-ms threshold.",
    },
    {
      label: "setProfilingLevel",
      type: "function",
      detail: "(level, slowms?)",
      info: "Enable or disable database profiling.",
    },
  ];

export const MONGO_ADMIN_COMMANDS: ReadonlyArray<MongoAdminCommandCompletion> =
  [
    {
      label: "ping",
      apply: "ping: 1",
      detail: "1",
      info: "No-op health check.",
    },
    {
      label: "serverStatus",
      apply: "serverStatus: 1",
      detail: "1",
      info: "Comprehensive runtime stats.",
    },
    {
      label: "hostInfo",
      apply: "hostInfo: 1",
      detail: "1",
      info: "OS, CPU, and memory information.",
    },
    {
      label: "buildInfo",
      apply: "buildInfo: 1",
      detail: "1",
      info: "Server version and build metadata.",
    },
    {
      label: "listDatabases",
      apply: "listDatabases: 1",
      detail: "1",
      info: "Enumerate visible databases.",
    },
    {
      label: "listCollections",
      apply: "listCollections: 1",
      detail: "1 | {filter, ...}",
      info: "Enumerate collections in the bound database.",
    },
    {
      label: "dbStats",
      apply: "dbStats: 1",
      detail: "1 | {scale}",
      info: "Database storage and index statistics.",
    },
    {
      label: "collStats",
      apply: 'collStats: "<collection>"',
      detail: '"<coll>"',
      info: "Storage and index stats for a collection.",
    },
    {
      label: "currentOp",
      apply: 'currentOp: 1, "$all": true',
      detail: "1",
      info: "List currently running operations.",
    },
    {
      label: "killOp",
      apply: "killOp: 1, op: <opid>",
      detail: "1, op",
      info: "Terminate a running operation by id.",
    },
    {
      label: "getCmdLineOpts",
      apply: "getCmdLineOpts: 1",
      detail: "1",
      info: "Server startup argv and parsed config.",
    },
    {
      label: "setProfilingLevel",
      apply: "profile: 1, slowms: 100",
      detail: "0|1|2",
      info: "Enable or disable the database profiler.",
    },
    {
      label: "getProfilingStatus",
      apply: "profile: -1",
      detail: "-1",
      info: "Return current profiling level.",
    },
    {
      label: "validate",
      apply: 'validate: "<collection>"',
      detail: '"<coll>"',
      info: "Validate collection data and indexes.",
    },
    {
      label: "create",
      apply: 'create: "<collection>"',
      detail: '"<coll>"',
      info: "Create a collection.",
    },
    {
      label: "drop",
      apply: 'drop: "<collection>"',
      detail: '"<coll>"',
      info: "Drop a collection.",
    },
    {
      label: "dropDatabase",
      apply: "dropDatabase: 1",
      detail: "1",
      info: "Drop the bound database.",
    },
    {
      label: "isMaster",
      apply: "isMaster: 1",
      detail: "1",
      info: "Legacy replica-set status probe.",
    },
    {
      label: "hello",
      apply: "hello: 1",
      detail: "1",
      info: "Modern topology metadata probe.",
    },
    {
      label: "replSetGetStatus",
      apply: "replSetGetStatus: 1",
      detail: "1",
      info: "Replica-set member health and oplog progress.",
    },
  ];

const MONGOSH_DB_METHOD_META = new Map(
  MONGOSH_DB_METHODS.map((method) => [method.label, method]),
);

const MONGOSH_DB_LEVEL_METHOD_META = new Map(
  MONGOSH_DB_LEVEL_METHODS.map((method) => [method.label, method]),
);

const MONGO_ADMIN_COMMAND_META = new Map(
  MONGO_ADMIN_COMMANDS.map((command) => [command.label, command]),
);

export function getMongoshCollectionMethodCompletions(): ReadonlyArray<MongoshMethodCompletion> {
  const labels = getMongoshCompletionVocabulary()?.mongoshCollectionMethods;
  return labels
    ? toMethodCompletions(labels, MONGOSH_DB_METHOD_META)
    : MONGOSH_DB_METHODS;
}

export function getMongoshDbLevelMethodCompletions(): ReadonlyArray<MongoshMethodCompletion> {
  const labels = getMongoshCompletionVocabulary()?.mongoshDbMethods;
  return labels
    ? toMethodCompletions(labels, MONGOSH_DB_LEVEL_METHOD_META)
    : MONGOSH_DB_LEVEL_METHODS;
}

export function getMongoAdminCommandCompletions(): ReadonlyArray<MongoAdminCommandCompletion> {
  const labels = getMongoshCompletionVocabulary()?.mongoAdminCommands;
  return labels
    ? labels.map(
        (label) =>
          MONGO_ADMIN_COMMAND_META.get(label) ?? {
            label,
            apply: `${label}: 1`,
            detail: "1",
            info: "MongoDB command.",
          },
      )
    : MONGO_ADMIN_COMMANDS;
}

function toMethodCompletions(
  labels: readonly string[],
  metadata: ReadonlyMap<string, MongoshMethodCompletion>,
): ReadonlyArray<MongoshMethodCompletion> {
  return labels.map(
    (label) =>
      metadata.get(label) ?? {
        label,
        type: "function",
        detail: "(...)",
        info: "mongosh method.",
      },
  );
}
