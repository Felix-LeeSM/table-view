/**
 * `featuresMisc` 네임스페이스 — catalog / query / workspace feature 공용 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 리터럴을 바이트 그대로 미러한다.
 */

export const en = {
  mongo: {
    crossDbNotSupported:
      "Cross-database shell navigation (`db.getSiblingDB(...)`) is not supported. Select the target database from the toolbar chip, then run one `db.<collection>...` expression.",
    transactionsNotSupported:
      "Transactions are not supported for mongosh expressions in Table View. Use explicit single-document writes; standalone MongoDB servers do not support multi-document transactions.",
    adminCommandsDispatcher:
      "Admin commands are handled by the runCommand dispatcher.",
    unsupportedMethod:
      "Unsupported method '{{method}}'. Supported methods: {{whitelist}}.",
    invalidCursorChainMethod:
      "Cursor method '{{name}}' is not supported. Supported cursor methods: {{supported}}.",
    cursorChainFindOrAggregate:
      "Cursor method '{{name}}' is only supported after find() or aggregate().",
    missingDbPrefix: "mongosh expressions must start with `db.`",
    bsonObjectId: "ObjectId(...) expects a 24-character hex string",
    bsonIsoDate: "ISODate(...) expects a valid timestamp string",
    bsonNumberLong: "NumberLong(...) expects a 64-bit integer string",
    bsonNumberDecimal: "NumberDecimal(...) expects a decimal string",
    bsonUuid: "UUID(...) expects a UUID string",
    bsonBinData: "BinData(...) payload is malformed",
    bulkWritePartialCommitWarning:
      "MongoDB bulkWrite executes ordered operations but is not transactional in this app. If a later operation fails, earlier operations may already be committed; review the current collection state before retry.",
  },
} as const;

export const ko = {
  mongo: {
    crossDbNotSupported:
      "크로스 데이터베이스 셸 탐색(`db.getSiblingDB(...)`)은 지원되지 않습니다. 툴바 칩에서 대상 데이터베이스를 선택한 후 `db.<collection>...` 표현식을 실행하세요.",
    transactionsNotSupported:
      "Table View의 mongosh 표현식에서는 트랜잭션을 지원하지 않습니다. 단일 도큐먼트 쓰기를 직접 사용하세요. 독립 실행형 MongoDB 서버는 다중 도큐먼트 트랜잭션을 지원하지 않습니다.",
    adminCommandsDispatcher:
      "관리자 명령은 runCommand 디스패처에서 처리됩니다.",
    unsupportedMethod:
      "지원하지 않는 메서드 '{{method}}'입니다. 지원 메서드: {{whitelist}}.",
    invalidCursorChainMethod:
      "커서 메서드 '{{name}}'은 지원되지 않습니다. 지원 커서 메서드: {{supported}}.",
    cursorChainFindOrAggregate:
      "커서 메서드 '{{name}}'은 find() 또는 aggregate() 이후에만 사용할 수 있습니다.",
    missingDbPrefix: "mongosh 표현식은 `db.`로 시작해야 합니다.",
    bsonObjectId: "ObjectId(...)는 24자 16진수 문자열을 기대합니다.",
    bsonIsoDate: "ISODate(...)는 유효한 타임스탬프 문자열을 기대합니다.",
    bsonNumberLong: "NumberLong(...)은 64비트 정수 문자열을 기대합니다.",
    bsonNumberDecimal: "NumberDecimal(...)은 소수 문자열을 기대합니다.",
    bsonUuid: "UUID(...)는 UUID 문자열을 기대합니다.",
    bsonBinData: "BinData(...) 페이로드가 잘못되었습니다.",
    bulkWritePartialCommitWarning:
      "MongoDB bulkWrite는 순서대로 작업을 실행하지만 이 앱에서는 트랜잭션이 아닙니다. 이후 작업이 실패하면 이전 작업은 이미 커밋되었을 수 있습니다. 재시도 전에 현재 컬렉션 상태를 확인하세요.",
  },
} as const;
