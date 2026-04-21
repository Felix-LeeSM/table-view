# Issue 8: Connection 연결 실패 시 schemas 전환 방지

## 현상

Connections 목록에서 connection을 더블클릭했을 때, 연결에 **실패**해도 sidebar가 schemas 모드로 전환됨. 연결 실패 시에는 connections 모드에 머물러야 함.

## 원인

### ConnectionItem의 handleDoubleClick

`src/components/connection/ConnectionItem.tsx` L113-126:

```tsx
const handleDoubleClick = async () => {
  if (!isConnected && !isConnecting) {
    try {
      await connectToDatabase(connection.id);
      onActivate?.(connection.id);  // ← 연결 실패해도 항상 실행됨
    } catch {
      // Error shown via store
    }
  } else if (isConnected) {
    onActivate?.(connection.id);
  }
};
```

### connectToDatabase가 에러를 re-throw하지 않음

`src/stores/connectionStore.ts` L103-126:

```tsx
connectToDatabase: async (id) => {
  set((state) => ({
    activeStatuses: { ...state.activeStatuses, [id]: { type: "connecting" } },
  }));
  try {
    await tauri.connectToDatabase(id);
    set((state) => ({
      activeStatuses: { ...state.activeStatuses, [id]: { type: "connected" } },
    }));
  } catch (e) {
    set((state) => ({
      activeStatuses: { ...state.activeStatuses, [id]: { type: "error", message: String(e) } },
    }));
    // ← re-throw 없음! Promise가 항상 resolve됨
  }
},
```

호출 흐름:
1. `handleDoubleClick`에서 `await connectToDatabase(id)` 호출
2. `connectToDatabase`가 내부에서 Tauri 호출 → 실패
3. `connectToDatabase`가 catch에서 상태를 `{ type: "error" }`로 설정
4. **에러를 re-throw하지 않음** → `await`가 정상 완료된 것처럼 반환
5. `onActivate?.(connection.id)`가 실행됨
6. Sidebar의 `onActivate` 핸들러가 `setMode("schemas")` 실행 → schemas로 전환

### Sidebar의 onActivate 핸들러

`src/components/layout/Sidebar.tsx` L234-237:

```tsx
onActivate={(id) => {
  setSelectedConnId(id);
  setMode("schemas");  // ← 무조건 schemas로 전환
}}
```

## 해결 방법

`handleDoubleClick`에서 `connectToDatabase` 호출 후 store의 상태를 직접 확인:

```tsx
const handleDoubleClick = async () => {
  if (!isConnected && !isConnecting) {
    await connectToDatabase(connection.id);
    // 연결 성공 시에만 activate
    const status = useConnectionStore.getState().activeStatuses[connection.id];
    if (status?.type === "connected") {
      onActivate?.(connection.id);
    }
  } else if (isConnected) {
    onActivate?.(connection.id);
  }
};
```

변경 사항:
- `try/catch` 제거 (store가 에러를 이미 처리함)
- `onActivate` 호출 전 `useConnectionStore.getState()`로 상태 확인
- 상태가 `"connected"`일 때만 `onActivate` 호출

### 대안: connectToDatabase에서 re-throw

`connectionStore.ts`의 catch 블록에서 `throw e`를 추가하면 기존 `try/catch` 패턴이 작동함. 하지만 이 접근은:
- `connectToDatabase`를 호출하는 다른 곳(ContextMenu의 Connect 버튼 등)에도 영향을 미침
- 모든 호출자가 try/catch를 가져야 함
- 부작용이 더 큼

따라서 `ConnectionItem`에서 상태를 확인하는 방식이 더 안전함.

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/connection/ConnectionItem.tsx` | L113-126 handleDoubleClick 수정 |

## 영향받는 테스트

- `src/components/connection/ConnectionItem.test.tsx`: 연결 실패 시 onActivate 미호출 테스트 추가

---

## 실제 구현 (완료)

**ConnectionItem.tsx** `handleDoubleClick`: `try/catch` 제거, `await connectToDatabase()` 후 `useConnectionStore.getState().activeStatuses[id]`를 직접 확인해 `"connected"`일 때만 `onActivate` 호출.

**ConnectionItem.test.tsx**: 기존 테스트 3개의 mock을 `mockRejectedValue` → `mockImplementation`으로 교체해 실제 store처럼 `activeStatuses`를 업데이트하도록 수정. 53개 통과.
