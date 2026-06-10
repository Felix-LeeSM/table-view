export const MONGOSH_METHOD_WHITELIST = [
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "createIndex",
  "dropIndex",
  "bulkWrite",
] as const;

export type MongoshMethod = (typeof MONGOSH_METHOD_WHITELIST)[number];

const MONGOSH_METHODS: ReadonlySet<string> = new Set(MONGOSH_METHOD_WHITELIST);

export function isMongoshMethod(name: string): name is MongoshMethod {
  return MONGOSH_METHODS.has(name);
}
