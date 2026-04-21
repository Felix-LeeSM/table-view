# Issue 7: Edit 모드 셀 스타일 및 width 문제

## 현상

1. Edit 모드에서 input 태그의 border/bg가 보여서 view 모드와 레이아웃이 다름
2. Edit 모드 진입 시 셀 width가 늘어나면서 테이블 레이아웃이 깨짐

사용자 의견: "edit 모드인 것은 border와 bg로 알 수 있으니 input 태그의 스타일은 노출되지 않았으면 좋겠음"

## 원인

### DataGrid — input 자체 스타일이 셀 편집 표시와 중복

`src/components/datagrid/DataGridTable.tsx` L578-643:

**셀(`<td>`)의 편집 상태 스타일**:
```tsx
className={`overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground${
  isEditing
    ? " bg-primary/10 ring-2 ring-inset ring-primary"  // ← 편집 표시
    : hasPendingEdit
      ? " bg-yellow-500/20"
      : ""
}`}
style={{
  width: getColumnWidth(col.name, col.data_type),
  minWidth: MIN_COL_WIDTH,  // 60px
}}
```

**input의 스타일** (L616):
```tsx
<input
  className="w-full rounded-sm border-none bg-background px-1 py-0 text-xs text-foreground shadow-sm outline-none"
/>
```

문제:
- 셀에 이미 `bg-primary/10`(연한 보라 배경) + `ring-2 ring-primary`(보라 테두리)로 편집 상태가 표시됨
- 그 안에 input이 `bg-background`(다른 배경색) + `shadow-sm`(그림자) + `rounded-sm`(둥근 모서리)를 가짐
- → 셀 안에 별도의 "박스"가 보여 시각적 노이즈 발생

### ColumnsEditor — input이 view 모드와 다른 스타일 + width 재계산

`src/components/structure/ColumnsEditor.tsx`:

**inputClass** (L53-54):
```tsx
const inputClass =
  "w-full rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground outline-none focus:border-primary";
```

문제:
- input에 `border border-border`(테두리), `bg-background`(배경), `rounded`(둥근 모서리)가 있어 view 모드의 일반 텍스트와 시각적으로 다름
- edit 모드 구분은 셀 수준에서 해야 하지만, 현재는 input 자체에 스타일이 적용됨

**테이블** (L510):
```tsx
<table className="w-full border-collapse text-sm">
```

문제:
- `table-layout: fixed`가 없음 → 브라우저가 auto layout 사용
- view 모드: 텍스트 `<span>`의 크기에 따라 컬럼 width 결정
- edit 모드: `<input className="w-full">`의 크기에 따라 컬럼 width 재계산
- → 컬럼 width가 변하면서 전체 테이블 레이아웃이 흔들림

## 해결 방법

### DataGrid: input 스타일 최소화

```tsx
// Before:
className="w-full rounded-sm border-none bg-background px-1 py-0 text-xs text-foreground shadow-sm outline-none"

// After:
className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none"
```

제거: `rounded-sm`, `border-none`, `bg-background`, `shadow-sm`
추가: `bg-transparent` (셀의 배경이 그대로 보이도록)

### ColumnsEditor: input 스타일 투명화

```tsx
// Before:
"w-full rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground outline-none focus:border-primary"

// After:
"w-full bg-transparent px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
```

제거: `rounded`, `border border-border`, `bg-background`
변경: `focus:border-primary` → `focus:ring-1 focus:ring-primary` (테두리 대신 ring 사용)

### ColumnsEditor: table-layout 고정

```tsx
// Before:
<table className="w-full border-collapse text-sm">

// After:
<table className="w-full table-fixed border-collapse text-sm">
```

`table-fixed`를 추가하면 첫 행의 width 기준으로 컬럼 width가 고정되어, edit 모드 진입 시 width가 변하지 않음.

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/datagrid/DataGridTable.tsx` | L616 input className 변경 |
| `src/components/structure/ColumnsEditor.tsx` | L53-54 inputClass 변경, L215-216 NewColumnRow inputClass 변경, L510 table에 table-fixed 추가 |

## 영향받는 테스트

- `src/components/datagrid/DataGridTable.editing-visual.test.tsx`: input className assertion (`bg-background` → `bg-transparent`) 수정 필요

---

## 실제 구현 (완료)

**DataGridTable.tsx** L616: `rounded-sm border-none bg-background shadow-sm` 제거, `bg-transparent` 추가.

**ColumnsEditor.tsx**: EditableColumnRow(L53) + NewColumnRow(L215) 두 곳의 `inputClass`에서 `rounded border border-border bg-background` 제거, `focus:border-primary` → `focus:ring-1 focus:ring-primary`. `<table>` (L510)에 `table-fixed` 추가.

**DataGridTable.editing-visual.test.tsx**: `bg-background` → `bg-transparent` assertion 수정. 4개 통과.
