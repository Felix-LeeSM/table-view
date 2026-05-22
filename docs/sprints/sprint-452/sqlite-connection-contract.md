# SQLite DBMS Connection Contract

Sprint 452 separates user-managed SQLite database files from the app's
internal SQLite state store.

## User DBMS Profile

- `sqlite` remains a file-backed RDBMS profile.
- Connection fields are `database` as an absolute file path, `readOnly` as the
  optional read-only flag, and blank `host`, `port=0`, blank `user`, and no
  password.
- The SQLite profile exposes file picker and read-only capabilities. It does
  not promise row-edit or DDL parity in this sprint.
- The contract is file-source oriented so DuckDB can reuse the same
  connection-kind model later without sharing SQLite adapter behavior.

## Internal App State Isolation

- Internal app state lives at `storage::local::db_path()` (`state.db`) and is
  not a valid user SQLite connection target.
- SQLite user connection validation rejects that internal path before adapter
  connect/test work proceeds.

## Fixture Strategy

- Fixture SQLite files are local user DBMS fixtures under the app-data
  fixtures/sqlite directory.
- Fixture profile YAML stores only the file name; `scripts/fixtures` resolves
  it under the active app-data directory, including `TABLE_VIEW_TEST_DATA_DIR`.
- The canonical SQLite seed SQL is the e2e fixture seed. Creating and
  populating SQLite fixture files stays outside this sprint's scope.
