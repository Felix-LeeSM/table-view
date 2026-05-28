export type ByDb<V> = Record<string, V>;
export type ByConn<V> = Record<string, ByDb<V>>;
export type BySchema<V> = Record<string, V>;
export type ByTable<V> = Record<string, V>;

export function setConnDb<V>(
  outer: ByConn<V>,
  connId: string,
  db: string,
  value: V,
): ByConn<V> {
  return {
    ...outer,
    [connId]: { ...(outer[connId] ?? {}), [db]: value },
  };
}

export function setConnDbSchema<V>(
  outer: ByConn<BySchema<V>>,
  connId: string,
  db: string,
  schema: string,
  value: V,
): ByConn<BySchema<V>> {
  const connSlot = outer[connId] ?? {};
  const dbSlot = connSlot[db] ?? {};
  return {
    ...outer,
    [connId]: {
      ...connSlot,
      [db]: { ...dbSlot, [schema]: value },
    },
  };
}

export function setConnDbSchemaTable<V>(
  outer: ByConn<BySchema<ByTable<V>>>,
  connId: string,
  db: string,
  schema: string,
  table: string,
  value: V,
): ByConn<BySchema<ByTable<V>>> {
  const connSlot = outer[connId] ?? {};
  const dbSlot = connSlot[db] ?? {};
  const schemaSlot = dbSlot[schema] ?? {};
  return {
    ...outer,
    [connId]: {
      ...connSlot,
      [db]: {
        ...dbSlot,
        [schema]: { ...schemaSlot, [table]: value },
      },
    },
  };
}

export function deleteConn<V>(outer: ByConn<V>, connId: string): ByConn<V> {
  if (!(connId in outer)) return outer;
  const next = { ...outer };
  delete next[connId];
  return next;
}

export function deleteConnDb<V>(
  outer: ByConn<V>,
  connId: string,
  db: string,
): ByConn<V> {
  const connSlot = outer[connId];
  if (!connSlot || !(db in connSlot)) return outer;
  const nextConn = { ...connSlot };
  delete nextConn[db];
  return { ...outer, [connId]: nextConn };
}

export function deleteConnDbSchema<V>(
  outer: ByConn<BySchema<V>>,
  connId: string,
  db: string,
  schema: string,
): ByConn<BySchema<V>> {
  const connSlot = outer[connId];
  if (!connSlot) return outer;
  const dbSlot = connSlot[db];
  if (!dbSlot || !(schema in dbSlot)) return outer;
  const nextDb = { ...dbSlot };
  delete nextDb[schema];
  return {
    ...outer,
    [connId]: { ...connSlot, [db]: nextDb },
  };
}
