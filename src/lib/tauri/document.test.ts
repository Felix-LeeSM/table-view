import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkWriteOp, DocumentId } from "@/types/documentMutate";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  aggregateDocuments,
  bulkWriteDocuments,
  countDocuments,
  createCollection,
  createMongoIndex,
  deleteDocument,
  deleteMany,
  distinctDocuments,
  dropCollection,
  dropMongoDatabase,
  dropMongoIndex,
  estimatedDocumentCount,
  findDocuments,
  findOneDocument,
  getMongoValidator,
  inferCollectionFields,
  insertDocument,
  insertManyDocuments,
  listMongoCollections,
  listMongoDatabases,
  listMongoIndexes,
  renameCollection,
  runMongoCommand,
  setMongoValidator,
  updateDocument,
  updateMany,
} from "./document";

describe("document Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("normalizes document query results and wraps precision-sensitive cells", async () => {
    invokeMock.mockResolvedValueOnce({
      columns: [
        { name: "_id", data_type: "ObjectId", category: "text" },
        { name: "visits", data_type: "Int64", category: "number" },
        { name: "price", data_type: "Decimal128", category: "number" },
      ],
      rows: [["507f1f77bcf86cd799439011", "9007199254740993", "12.3400"]],
      raw_documents: [{ _id: { $oid: "507f1f77bcf86cd799439011" } }],
      total_count: 1,
      execution_time_ms: 4,
    });

    const result = await findDocuments("mongo-1", "shop", "orders");

    expect(invokeMock).toHaveBeenCalledWith("find_documents", {
      connectionId: "mongo-1",
      database: "shop",
      collection: "orders",
      body: null,
      queryId: null,
    });
    expect(result.columns[1]?.dataType).toBe("Int64");
    expect(result.rows[0]?.[1]).toBe(9007199254740993n);
    expect(result.rows[0]?.[2]).toBeInstanceOf(Decimal);
    expect((result.rows[0]?.[2] as Decimal).toString()).toBe("12.34");
    expect(result.rawDocuments[0]?._id).toEqual({
      $oid: "507f1f77bcf86cd799439011",
    });
  });

  it("forwards aggregate pipelines without rewriting the stage order", async () => {
    const pipeline = [
      { $match: { status: "paid" } },
      { $group: { _id: "$status", total: { $sum: 1 } } },
    ];
    invokeMock.mockResolvedValueOnce({
      columns: [{ name: "total", dataType: "Int64", category: "number" }],
      rows: [["2"]],
      rawDocuments: [],
      totalCount: 1,
      executionTimeMs: 5,
    });

    const result = await aggregateDocuments(
      "mongo-1",
      "shop",
      "orders",
      pipeline,
    );

    expect(invokeMock).toHaveBeenCalledWith("aggregate_documents", {
      connectionId: "mongo-1",
      database: "shop",
      collection: "orders",
      pipeline,
    });
    expect(result.rows[0]?.[0]).toBe(2n);
  });

  it("normalizes single-row and write id variants returned by the backend", async () => {
    invokeMock
      .mockResolvedValueOnce({
        columns: [{ name: "count", data_type: "Int64", category: "number" }],
        row: ["9007199254740993"],
        raw: { count: { $numberLong: "9007199254740993" } },
      })
      .mockResolvedValueOnce({ ObjectId: "507f1f77bcf86cd799439011" })
      .mockResolvedValueOnce([
        { Number: 42 },
        { Raw: { $oid: "507f1f77bcf86cd799439012" } },
      ]);

    const row = await findOneDocument("mongo-1", "shop", "orders");
    const inserted = await insertDocument("mongo-1", "shop", "orders", {
      email: "a@example.com",
    });
    const insertedMany = await insertManyDocuments(
      "mongo-1",
      "shop",
      "orders",
      [{ email: "a@example.com" }, { email: "b@example.com" }],
    );

    expect(row?.row[0]).toBe(9007199254740993n);
    expect(inserted).toEqual({ objectId: "507f1f77bcf86cd799439011" });
    expect(insertedMany).toEqual([
      { number: 42 },
      { raw: { $oid: "507f1f77bcf86cd799439012" } },
    ]);
    expect(invokeMock.mock.calls[0]).toEqual([
      "find_one_document",
      {
        connectionId: "mongo-1",
        database: "shop",
        collection: "orders",
        filter: null,
        queryId: null,
      },
    ]);
  });

  it("keeps mutation payloads tagged and propagates safety confirmations", async () => {
    const documentId: DocumentId = { objectId: "507f1f77bcf86cd799439011" };
    const operations: BulkWriteOp[] = [
      {
        op: "updateOne",
        filter: { status: "new" },
        update: { $set: { status: "paid" } },
      },
      { op: "deleteMany", filter: { archived: true } },
    ];
    invokeMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce({
        inserted_count: 0,
        matched_count: 1,
        modified_count: 1,
        deleted_count: 3,
        upserted_ids: [{ ObjectId: "507f1f77bcf86cd799439012" }],
      });

    await updateDocument("mongo-1", "shop", "orders", documentId, {
      status: "paid",
    });
    await deleteDocument("mongo-1", "shop", "orders", documentId);
    await deleteMany("mongo-1", "shop", "orders", { archived: true }, true);
    await updateMany(
      "mongo-1",
      "shop",
      "orders",
      { status: "new" },
      { status: "paid" },
    );
    const bulk = await bulkWriteDocuments(
      "mongo-1",
      "shop",
      "orders",
      operations,
      true,
    );

    expect(invokeMock.mock.calls).toEqual([
      [
        "update_document",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          documentId,
          patch: { status: "paid" },
        },
      ],
      [
        "delete_document",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          documentId,
        },
      ],
      [
        "delete_many",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          filter: { archived: true },
          safetyConfirmed: true,
        },
      ],
      [
        "update_many",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          filter: { status: "new" },
          patch: { status: "paid" },
          safetyConfirmed: false,
        },
      ],
      [
        "bulk_write_documents",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          operations,
          safetyConfirmed: true,
        },
      ],
    ]);
    expect(bulk.upserted_ids).toEqual([
      { objectId: "507f1f77bcf86cd799439012" },
    ]);
  });

  it("forwards catalog, index, validator, and collection DDL commands", async () => {
    invokeMock.mockResolvedValue(undefined);

    await listMongoDatabases("mongo-1");
    await listMongoCollections("mongo-1", "shop");
    await listMongoIndexes("mongo-1", "shop", "orders");
    await createMongoIndex("mongo-1", "shop", "orders", {
      fields: [{ name: "email", direction: "asc" }],
      unique: true,
    });
    await dropMongoIndex("mongo-1", "shop", "orders", "email_1", true);
    await getMongoValidator("mongo-1", "shop", "orders");
    await setMongoValidator(
      "mongo-1",
      "shop",
      "orders",
      { $jsonSchema: { bsonType: "object" } },
      "strict",
      "error",
    );
    await createCollection("mongo-1", "shop", "events", { capped: true });
    await renameCollection("mongo-1", "shop", "events", "events_archive");
    await dropCollection("mongo-1", "shop", "events_archive", true);
    await dropMongoDatabase("mongo-1", "shop", true);

    expect(invokeMock.mock.calls).toEqual([
      ["list_mongo_databases", { connectionId: "mongo-1" }],
      ["list_mongo_collections", { connectionId: "mongo-1", database: "shop" }],
      [
        "list_mongo_indexes",
        { connectionId: "mongo-1", database: "shop", collection: "orders" },
      ],
      [
        "create_mongo_index",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          request: {
            fields: [{ name: "email", direction: "asc" }],
            unique: true,
          },
        },
      ],
      [
        "drop_mongo_index",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          name: "email_1",
          safetyConfirmed: true,
        },
      ],
      [
        "get_mongo_validator",
        { connectionId: "mongo-1", database: "shop", collection: "orders" },
      ],
      [
        "set_mongo_validator",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          validator: { $jsonSchema: { bsonType: "object" } },
          validationLevel: "strict",
          validationAction: "error",
        },
      ],
      [
        "create_collection",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "events",
          options: { capped: true },
        },
      ],
      [
        "rename_collection",
        {
          connectionId: "mongo-1",
          database: "shop",
          from: "events",
          to: "events_archive",
        },
      ],
      [
        "drop_collection",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "events_archive",
          safetyConfirmed: true,
        },
      ],
      [
        "drop_mongo_database",
        { connectionId: "mongo-1", name: "shop", safetyConfirmed: true },
      ],
    ]);
  });

  it("forwards mongosh helper commands with null defaults for optional args", async () => {
    invokeMock.mockResolvedValue(undefined);

    await inferCollectionFields("mongo-1", "shop", "orders");
    await countDocuments("mongo-1", "shop", "orders");
    await estimatedDocumentCount("mongo-1", "shop", "orders");
    await distinctDocuments("mongo-1", "shop", "orders", "status");
    await runMongoCommand("mongo-1", null, { serverStatus: 1 }, true);

    expect(invokeMock.mock.calls).toEqual([
      [
        "infer_collection_fields",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          sampleSize: null,
        },
      ],
      [
        "count_documents",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          filter: null,
          queryId: null,
        },
      ],
      [
        "estimated_document_count",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          queryId: null,
        },
      ],
      [
        "distinct_documents",
        {
          connectionId: "mongo-1",
          database: "shop",
          collection: "orders",
          field: "status",
          filter: null,
          queryId: null,
        },
      ],
      [
        "run_mongo_command",
        {
          connectionId: "mongo-1",
          database: null,
          command: { serverStatus: 1 },
          safetyConfirmed: true,
        },
      ],
    ]);
  });
});
