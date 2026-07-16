/**
 * `search` 네임스페이스 — Search(Elasticsearch 계열) 뷰 전용 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다.
 */

export const en = {
  /** SearchResultView */
  resultsAria: "Search results",
  idleHint: "Run a Search DSL request to inspect hits.",
  queryRunning: "Search query running",
  queryCancelled: "Search query cancelled",
  malformedHeader: "Malformed Search result payload",
  malformedTabular:
    "Search renderer received a tabular query result. Search hits must stay on the completedSearch state.",
  hitsAria: "Search hits",
  noHits: "No Search hits",
  hitsCount: "{{count}} hits",
  showingHits: "Showing {{count}} hits",
  timedOut: "timed out",
  copyAriaLabel: "Copy Search hits",
  copyDisabledReason: "No displayed Search hits to copy.",
  exportDisabledReason: "No displayed Search hits to export.",
  aggregations: "Aggregations",
  aggregationsAria: "Search aggregations",
  noAggregations: "No aggregations",
  explainPayload: "Explain payload",
  profilePayload: "Profile payload",
  hitExplainPayload: "Explain payload for {{id}}",
  hitAria: "Search hit {{id}}",
  largeSource: "Large _source",
  longHighlight: "Long highlight",
  shardMetric: "shards {{successful}}/{{total}}",
  shardFailed: ", {{count}} failed",
  shardFailuresHeader: "Shard failures: {{count}}",
  unsupportedAggregation: "Unsupported aggregation shape rendered as raw JSON.",
  bucketsCount: "{{count}} buckets",
  unsupportedShape: "unsupported shape",

  /** SearchIndexDetailPanel — tabs */
  tab: {
    overview: "Overview",
    mapping: "Mapping",
    settings: "Settings",
    templates: "Templates",
    samples: "Samples",
    fieldStats: "Field stats",
  },

  /** SearchIndexDetailPanel — layout */
  indexDetailAria: "Search index details for {{index}}",
  fixtureBackedIndex: "fixture-backed Search index",
  previewPlanButton: "Preview plan",
  previewPlanAria: "Preview delete-by-query plan",
  previewPlanUnsupportedTitle:
    "Delete-by-query preview unsupported by this connection",
  tablistAria: "Search index detail sections",

  /** SearchIndexDetailPanel — skeletons */
  loadingOverview: "Loading Search index overview",
  loadingMapping: "Loading Search mapping",
  loadingSettings: "Loading Search settings",
  loadingTemplates: "Loading Search templates",
  loadingSamples: "Loading Search sample documents",
  loadingFieldStats: "Loading Search field stats",

  /** SearchIndexDetailPanel — Overview */
  overviewGrid: {
    product: "Product",
    version: "Version",
    distribution: "Distribution",
    templateEndpoint: "Template endpoint",
    open: "Open",
    shards: "Shards",
    aliases: "Aliases",
  },
  openYes: "yes",
  openNo: "no",
  unknownDistribution: "unknown",
  indexNotInCatalog: "Index {{index}} is not in the catalog.",
  indexSummaryJson: "Index summary JSON",
  destructivePolicyPreviewOnly:
    "Delete-by-query runs live against this index behind a Safe Mode confirmation. Index and settings admin remain unsupported in this milestone.",
  destructivePolicyUnsupported:
    "Delete-by-query is unsupported by this connection. Index and settings admin remain unsupported in this milestone.",

  /** SearchIndexDetailPanel — Mapping */
  noMappingFields: "No mapping fields.",
  mappingFieldCount_one: "{{count}} field",
  mappingFieldCount_other: "{{count}} fields",
  fieldSearchable: "searchable",
  fieldNotSearchable: "not searchable",
  fieldAggregatable: "aggregatable",
  fieldNotAggregatable: "not aggregatable",
  fieldAnalyzer: "analyzer {{name}}",
  mappingJson: "Mapping JSON",

  /** SearchIndexDetailPanel — Settings */
  noAnalyzers: "No analyzers.",
  settingsJson: "Settings JSON",

  /** SearchIndexDetailPanel — Templates */
  noMatchingTemplates: "No matching templates.",
  templateJson: "Template JSON",

  /** SearchIndexDetailPanel — Stats */
  noFieldStats: "No field stats.",

  /** SearchDeleteByQueryPreviewDialog */
  deletePreview: {
    title: "Delete-by-query",
    description:
      "Preview the matched document count, then run a live _delete_by_query. Index and settings admin remain unsupported in this milestone.",
    labelTarget: "Target",
    labelCatalogDocs: "Catalog docs",
    unknownDocs: "unknown",
    labelQueryBody: "Query body",
    closeButton: "Close",
    generateButton: "Generate plan",
    errorUnsupported: "Delete-by-query is unsupported by this connection.",
    errorNotObject: "delete-by-query body must be a JSON object.",
    policyUnsupported:
      "Delete-by-query is unsupported by this Search connection.",
    policyLive:
      "Runs a live delete-by-query against this index. Deleted documents cannot be recovered.",
    planOutputIdle: "Plan output appears here.",
    planLoading: "Planning delete-by-query preview",
    planSectionAria: "Delete-by-query preview plan",
    planLabelOperation: "Operation",
    planLabelTarget: "Target",
    planLabelEstimatedDocs: "Estimated documents",
    planLabelExecution: "Execution",
    planExecutionLive: "Live (Safe Mode confirmation)",
    deleteButton_one: "Delete {{count}} document",
    deleteButton_other: "Delete {{count}} documents",
    deleteButtonUnknown: "Delete matched documents",
    confirmReason:
      "Delete-by-query will permanently remove {{count}} matched document(s) from {{target}}",
    confirmPreview:
      "_delete_by_query on {{target}} — {{count}} matched document(s)",
    executing: "Running delete-by-query",
    resultSectionAria: "Delete-by-query result",
    resultDeleted: "Deleted {{deleted}} of {{total}} matched document(s).",
    resultConflicts_one: "{{count}} version conflict.",
    resultConflicts_other: "{{count}} version conflicts.",
    resultFailures_one: "{{count}} document failed to delete.",
    resultFailures_other: "{{count}} documents failed to delete.",
  },
} as const;

export const ko = {
  /** SearchResultView */
  resultsAria: "검색 결과",
  idleHint: "Search DSL 요청을 실행하면 결과가 여기 표시됩니다.",
  queryRunning: "검색 쿼리 실행 중",
  queryCancelled: "검색 쿼리 취소됨",
  malformedHeader: "잘못된 Search 결과 페이로드",
  malformedTabular:
    "Search 렌더러가 테이블 형식 쿼리 결과를 받았습니다. Search 히트는 completedSearch 상태여야 합니다.",
  hitsAria: "검색 히트",
  noHits: "검색 히트 없음",
  hitsCount: "{{count}}건 히트",
  showingHits: "{{count}}건 표시 중",
  timedOut: "시간 초과",
  copyAriaLabel: "검색 히트 복사",
  copyDisabledReason: "복사할 검색 히트가 없습니다.",
  exportDisabledReason: "내보낼 검색 히트가 없습니다.",
  aggregations: "집계",
  aggregationsAria: "검색 집계",
  noAggregations: "집계 없음",
  explainPayload: "Explain 페이로드",
  profilePayload: "Profile 페이로드",
  hitExplainPayload: "{{id}} Explain 페이로드",
  hitAria: "검색 히트 {{id}}",
  largeSource: "대용량 _source",
  longHighlight: "긴 하이라이트",
  shardMetric: "샤드 {{successful}}/{{total}}",
  shardFailed: ", {{count}}개 실패",
  shardFailuresHeader: "샤드 실패: {{count}}건",
  unsupportedAggregation: "지원하지 않는 집계 형태로, raw JSON으로 표시됩니다.",
  bucketsCount: "{{count}}개 버킷",
  unsupportedShape: "지원하지 않는 형태",

  /** SearchIndexDetailPanel — tabs */
  tab: {
    overview: "개요",
    mapping: "매핑",
    settings: "설정",
    templates: "템플릿",
    samples: "샘플",
    fieldStats: "필드 통계",
  },

  /** SearchIndexDetailPanel — layout */
  indexDetailAria: "{{index}} 인덱스 상세",
  fixtureBackedIndex: "픽스처 기반 Search 인덱스",
  previewPlanButton: "플랜 미리보기",
  previewPlanAria: "delete-by-query 플랜 미리보기",
  previewPlanUnsupportedTitle:
    "이 연결은 delete-by-query 미리보기를 지원하지 않습니다",
  tablistAria: "Search 인덱스 상세 섹션",

  /** SearchIndexDetailPanel — skeletons */
  loadingOverview: "Search 인덱스 개요 로딩 중",
  loadingMapping: "Search 매핑 로딩 중",
  loadingSettings: "Search 설정 로딩 중",
  loadingTemplates: "Search 템플릿 로딩 중",
  loadingSamples: "Search 샘플 문서 로딩 중",
  loadingFieldStats: "Search 필드 통계 로딩 중",

  /** SearchIndexDetailPanel — Overview */
  overviewGrid: {
    product: "제품",
    version: "버전",
    distribution: "배포판",
    templateEndpoint: "템플릿 엔드포인트",
    open: "열림",
    shards: "샤드",
    aliases: "별칭",
  },
  openYes: "예",
  openNo: "아니오",
  unknownDistribution: "알 수 없음",
  indexNotInCatalog: "카탈로그에 {{index}} 인덱스가 없습니다.",
  indexSummaryJson: "인덱스 요약 JSON",
  destructivePolicyPreviewOnly:
    "Delete-by-query는 Safe Mode 확인을 거쳐 이 인덱스에 실제로 실행됩니다. 인덱스/설정 관리자는 이 마일스톤에서 지원되지 않습니다.",
  destructivePolicyUnsupported:
    "이 연결은 delete-by-query를 지원하지 않습니다. 인덱스/설정 관리자는 이 마일스톤에서 지원되지 않습니다.",

  /** SearchIndexDetailPanel — Mapping */
  noMappingFields: "매핑 필드 없음.",
  mappingFieldCount_one: "{{count}}개 필드",
  mappingFieldCount_other: "{{count}}개 필드",
  fieldSearchable: "검색 가능",
  fieldNotSearchable: "검색 불가",
  fieldAggregatable: "집계 가능",
  fieldNotAggregatable: "집계 불가",
  fieldAnalyzer: "분석기 {{name}}",
  mappingJson: "매핑 JSON",

  /** SearchIndexDetailPanel — Settings */
  noAnalyzers: "분석기 없음.",
  settingsJson: "설정 JSON",

  /** SearchIndexDetailPanel — Templates */
  noMatchingTemplates: "일치하는 템플릿 없음.",
  templateJson: "템플릿 JSON",

  /** SearchIndexDetailPanel — Stats */
  noFieldStats: "필드 통계 없음.",

  /** SearchDeleteByQueryPreviewDialog */
  deletePreview: {
    title: "Delete-by-query",
    description:
      "일치 문서 수를 미리 확인한 뒤 live _delete_by_query를 실행합니다. 인덱스/설정 관리자는 이 마일스톤에서 지원되지 않습니다.",
    labelTarget: "대상",
    labelCatalogDocs: "카탈로그 문서",
    unknownDocs: "알 수 없음",
    labelQueryBody: "쿼리 본문",
    closeButton: "닫기",
    generateButton: "플랜 생성",
    errorUnsupported: "이 연결은 delete-by-query를 지원하지 않습니다.",
    errorNotObject: "delete-by-query 본문은 JSON 객체여야 합니다.",
    policyUnsupported: "이 Search 연결은 delete-by-query를 지원하지 않습니다.",
    policyLive:
      "이 인덱스에 live delete-by-query를 실행합니다. 삭제된 문서는 복구할 수 없습니다.",
    planOutputIdle: "플랜 출력이 여기 표시됩니다.",
    planLoading: "delete-by-query 미리보기 플랜 생성 중",
    planSectionAria: "Delete-by-query 미리보기 플랜",
    planLabelOperation: "작업",
    planLabelTarget: "대상",
    planLabelEstimatedDocs: "예상 문서 수",
    planLabelExecution: "실행",
    planExecutionLive: "실제 실행 (Safe Mode 확인)",
    deleteButton_one: "{{count}}개 문서 삭제",
    deleteButton_other: "{{count}}개 문서 삭제",
    deleteButtonUnknown: "일치 문서 삭제",
    confirmReason:
      "Delete-by-query가 {{target}}에서 일치하는 {{count}}개 문서를 영구 삭제합니다",
    confirmPreview: "{{target}}에 _delete_by_query — 일치 {{count}}개 문서",
    executing: "delete-by-query 실행 중",
    resultSectionAria: "Delete-by-query 결과",
    resultDeleted: "일치 {{total}}개 중 {{deleted}}개 문서를 삭제했습니다.",
    resultConflicts_one: "버전 충돌 {{count}}건.",
    resultConflicts_other: "버전 충돌 {{count}}건.",
    resultFailures_one: "{{count}}개 문서 삭제 실패.",
    resultFailures_other: "{{count}}개 문서 삭제 실패.",
  },
} as const;
