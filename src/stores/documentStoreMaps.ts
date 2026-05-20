export type ByCollection<V> = Record<string, V>;
export type ByDb<V> = Record<string, V>;
export type ByConn<V> = Record<string, V>;

export function setNested2<V>(
  outer: ByConn<ByDb<V>>,
  connId: string,
  db: string,
  value: V,
): ByConn<ByDb<V>> {
  return {
    ...outer,
    [connId]: {
      ...(outer[connId] ?? {}),
      [db]: value,
    },
  };
}

export function setNested3<V>(
  outer: ByConn<ByDb<ByCollection<V>>>,
  connId: string,
  db: string,
  col: string,
  value: V,
): ByConn<ByDb<ByCollection<V>>> {
  return {
    ...outer,
    [connId]: {
      ...(outer[connId] ?? {}),
      [db]: {
        ...(outer[connId]?.[db] ?? {}),
        [col]: value,
      },
    },
  };
}

export function setNested4<V>(
  outer: ByConn<ByDb<ByCollection<Record<string, V>>>>,
  connId: string,
  db: string,
  col: string,
  innerKey: string,
  value: V,
): ByConn<ByDb<ByCollection<Record<string, V>>>> {
  return {
    ...outer,
    [connId]: {
      ...(outer[connId] ?? {}),
      [db]: {
        ...(outer[connId]?.[db] ?? {}),
        [col]: {
          ...(outer[connId]?.[db]?.[col] ?? {}),
          [innerKey]: value,
        },
      },
    },
  };
}

export function withoutConnection<V>(
  outer: ByConn<V>,
  connectionId: string,
): ByConn<V> {
  const next = { ...outer };
  delete next[connectionId];
  return next;
}
