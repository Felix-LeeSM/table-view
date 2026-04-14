# Sprint 53 Handoff: BLOB Viewer & SQL Uglify & Format Selection

## What Changed
- BlobViewerDialog: hex dump + text 뷰 모달 (shadcn Dialog 기반)
- DataGridTable: BLOB 컬럼 감지 (bytea/binary/varbinary/image), Binary 아이콘 + "(BLOB)" 표시
- uglifySql: 공백/줄바꿈 압축, 문자열 리터럴 보존
- Cmd+Shift+I: SQL 단일 행 압축 단축키
- 선택 영역 포맷: Cmd+I 시 선택 텍스트만 formatSql 적용
- 41개 신규 테스트

## AC Status: 모두 PASS

## Next Sprint: Sprint 54 (완료)
