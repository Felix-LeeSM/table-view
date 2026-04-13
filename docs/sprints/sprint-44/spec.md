# Feature Spec: shadcn/ui 도입 및 컴포넌트 리팩토링

## Description
19개 React 컴포넌트가 모두 Tailwind 유틸리티 클래스로 수작성되어 있어 컴포넌트 비대화, UI 패턴 중복, 일관성 부족 문제가 존재한다. shadcn/ui를 도입하여 공통 UI 기반(Button, Dialog, Input, Select 등)을 확립하고, 비대한 컴포넌트(StructurePanel 1757줄, DataGrid 1029줄, SchemaTree 795줄)를 기능별 서브 컴포넌트로 분해하여 유지보수성과 재사용성을 확보한다.

## Sprint Breakdown

### Sprint 44: shadcn/ui 기반 설정 및 테마 매핑
**Goal**: shadcn/ui를 설치하고, 기존 Slate/Indigo 팔레트를 shadcn CSS 변수 네이밍 컨벤션으로 매핑하여 모든 기존 UI가 동일하게 렌더링되도록 한다.
**Verification Profile**: command
**Acceptance Criteria**:
1. `components.json`이 프로젝트 루트에 존재하며, 경로가 올바르게 설정된다
2. `src/lib/utils.ts`에 `cn()` 유틸리티가 존재하며 `clsx` + `tailwind-merge`를 사용한다
3. `src/index.css`의 `:root` 및 `.dark` 블록이 shadcn 네이밍 컨벤션(`--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring` 등)으로 리매핑되고, 기존 Slate/Indigo 색상값이 동일하게 유지된다
4. shadcn Button, Dialog, Input, Select, Checkbox, Tooltip 컴포넌트가 `src/components/ui/` 디렉토리에 존재한다
5. `pnpm tsc --noEmit` 통과, `pnpm test` 기존 테스트 전부 통과, `pnpm build` 성공
**Components to Create/Modify**:
- `components.json`: shadcn/ui CLI 설정 파일 (신규)
- `src/lib/utils.ts`: `cn()` 유틸리티 (신규)
- `src/index.css`: CSS 변수를 shadcn 네이밍으로 리매핑 (수정)
- `src/components/ui/button.tsx`: shadcn Button 프리미티브 (신규)
- `src/components/ui/dialog.tsx`: shadcn Dialog 프리미티브 (신규)
- `src/components/ui/input.tsx`: shadcn Input 프리미티브 (신규)
- `src/components/ui/select.tsx`: shadcn Select 프리미티브 (신규)
- `src/components/ui/checkbox.tsx`: shadcn Checkbox 프리미티브 (신규)
- `src/components/ui/tooltip.tsx`: shadcn Tooltip 프리미티브 (신규)

### Sprint 45: 공통 유틸리티 & UI 프리미티브 추출
**Goal**: 여러 컴포넌트에 중복 정의된 유틸리티 함수(DB_TYPE_META, truncateCell)와 반복되는 리사이즈 로직을 공유 모듈로 추출한다.
**Verification Profile**: command
**Acceptance Criteria**:
1. `DB_TYPE_META`가 단일 위치에 정의되고 Sidebar.tsx와 ConnectionItem.tsx가 동일한 정의를 임포트하여 사용한다
2. `truncateCell`이 단일 위치에 정의되고 DataGrid.tsx와 QueryResultGrid.tsx가 동일한 정의를 임포트하여 사용한다
3. 패널 리사이즈 로직이 재사용 가능한 훅으로 추출되고, Sidebar, DataGrid, QueryTab에서 해당 훅을 사용한다
4. `pnpm test` 통과, `pnpm build` 성공

### Sprint 46: Dialog/Modal 통합
**Goal**: 프로젝트 전체에 걸쳐 수작성된 10개의 인라인 모달을 shadcn Dialog 프리미티브로 통합한다.
**Verification Profile**: command
**Acceptance Criteria**:
1. ConfirmDialog가 shadcn Dialog 기반으로 재구현되며 기존 인터페이스가 동일하게 동작한다
2. ConnectionDialog가 shadcn Dialog 기반으로 재구현되며 연결 생성/편집 플로우가 동일하게 동작한다
3. StructurePanel의 3개 인라인 모달이 shadcn Dialog를 사용하여 재구현된다
4. DataGrid의 SQL Preview 모달이 shadcn Dialog를 사용하여 재구현된다
5. SchemaTree의 인라인 모달이 shadcn Dialog를 사용하여 재구현된다
6. 모든 모달에서 Escape 키, 오버레이 클릭, 포커스 트랩이 shadcn Dialog 기본 동작으로 제공된다
7. `pnpm test` 통과

### Sprint 47: DataGrid 분해
**Goal**: 1029줄인 DataGrid 컴포넌트를 기능별 서브 컴포넌트로 분해한다.
**Verification Profile**: mixed
**Acceptance Criteria**:
1. DataGrid의 툴바 영역이 독립 컴포넌트로 분리되며 기존과 동일하게 동작한다
2. DataGrid의 SQL 생성 로직이 독립 유틸리티로 분리된다
3. DataGrid의 인라인 편집 상태 관리가 집중된 상태 관리 단위로 정리된다
4. DataGrid의 테이블 헤더 렌더링이 독립 컴포넌트로 분리된다
5. 분해 후 DataGrid 메인 파일이 상태 조율 및 서브 컴포넌트 조립만 담당한다
6. `pnpm test` 통과

### Sprint 48: StructurePanel 분해
**Goal**: 1757줄인 StructurePanel 컴포넌트를 3개 에디터 서브 컴포넌트로 분해한다.
**Verification Profile**: mixed
**Acceptance Criteria**:
1. Columns 에디터가 독립 컴포넌트로 분리된다
2. Indexes 에디터가 독립 컴포넌트로 분리된다
3. Constraints 에디터가 독립 컴포넌트로 분리된다
4. SqlPreviewModal이 독립 컴포넌트로 분리되어 공유 사용된다
5. StructurePanel 메인 파일이 서브탭 전환과 조립만 담당한다
6. `pnpm test` 통과

### Sprint 49: SchemaTree 정리 & 전체 폴리싱
**Goal**: SchemaTree 정리, 남은 컴포넌트에 shadcn 적용, 전체 일관성 확보.
**Verification Profile**: mixed
**Acceptance Criteria**:
1. SchemaTree의 테이블 검색 입력이 shadcn Input을 사용한다
2. 전체 컴포넌트에서 수작성 icon 버튼이 공통 변형으로 통일된다
3. 전체 컴포넌트에서 수작성 input이 shadcn Input으로 통일된다
4. `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint` 모두 통과
5. 다크/라이트 모드에서 모든 UI가 일관되게 렌더링된다

## Global Acceptance Criteria
1. `pnpm test` — 기존 테스트 전부 통과
2. `pnpm tsc --noEmit` — 타입 에러 0건
3. `pnpm lint` — ESLint 에러 0건
4. `pnpm build` — 프로덕션 빌드 성공
5. 기존 사용자 워크플로우가 단절 없이 동작

## Data Flow
- **테마 변수**: 기존 `--color-*` CSS 변수가 shadcn의 `--background`, `--foreground` 등으로 매핑
- **Dialog 상태**: 모달 열림 상태가 shadcn Dialog의 `open`/`onOpenChange`로 전달
- **공유 유틸리티**: DB_TYPE_META, truncateCell 등은 임포트 경로만 변경
- **리사이즈 훅**: 마우스 이벤트 기반 리사이즈 로직이 공유 훅으로 통합

## Edge Cases
- Tailwind v4 환경에서 shadcn/ui CLI 정상 동작 확인 필요
- 기존 `--color-*` 직접 참조와 shadcn 변수 공존 확인
- 수작성 모달의 `useEffect` 기반 핸들러와 shadcn Dialog 전환 시 이중 핸들러 방지
- 리사이즈 훅의 서로 다른 축/제약 파라미터화
- `DB_TYPE_META` 통합 시 형태 차이 수용
- StructurePanel의 `pendingIndexExecuteRef` 패턴 전달 확인

## Visual Direction
- 기존 Slate/Indigo 팔레트 유지, shadcn 변수로 매핑
- 모달: 기존 `rounded-lg` + 그림자 스타일 유지
- 버튼: 기존 패턴을 shadcn Button size 변형으로 수용
- 입력 필드: 기존 패턴을 shadcn Input size 변형으로 수용

## Verification Hints
- `pnpm vitest run` — 프론트엔드 단위 테스트
- `pnpm tsc --noEmit` — 타입 체크
- `pnpm build` — 프로덕션 빌드
- `grep -r "fixed inset-0 z-50" src/components/` — 수작성 모달 제거 확인
