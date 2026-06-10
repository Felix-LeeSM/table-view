use table_view_lib::{
    db::{NamespaceLabel, RdbAdapter},
    error::AppError,
    models::{get_data_source_profile, BackendAdapterCapability, CatalogModelKind, DatabaseType},
};

pub enum NamespaceLabelContract {
    Schema,
    Single(&'static str),
}

pub struct ColumnContract<'a> {
    pub name: &'a str,
    pub data_type: &'a str,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub fk_reference: Option<&'a str>,
}

pub struct ViewContract<'a> {
    pub name: &'a str,
    pub definition_contains: &'a str,
    pub columns: &'a [&'a str],
}

pub enum IndexDelta<'a> {
    Contains {
        name: &'a str,
        columns: &'a [&'a str],
        is_unique: bool,
        is_primary: bool,
    },
    Empty {
        reason: &'a str,
    },
}

pub enum ConstraintDelta<'a> {
    Empty { reason: &'a str },
}

pub struct RdbCatalogContract<'a> {
    pub db_type: DatabaseType,
    pub namespace_label: NamespaceLabelContract,
    pub namespace: &'a str,
    pub tables: &'a [&'a str],
    pub table: &'a str,
    pub columns: &'a [ColumnContract<'a>],
    pub view: ViewContract<'a>,
    pub index_delta: IndexDelta<'a>,
    pub constraint_delta: ConstraintDelta<'a>,
}

pub struct RdbExplainUnsupportedContract<'a> {
    pub select_sql: &'a str,
    pub mutation_sql: &'a str,
    pub verify_unchanged_sql: &'a str,
    pub unsupported_message_fragment: &'a str,
}

pub async fn assert_rdb_catalog_contract<A>(adapter: &A, contract: &RdbCatalogContract<'_>)
where
    A: RdbAdapter + Sync,
{
    let profile = get_data_source_profile(&contract.db_type);
    assert_eq!(
        profile.catalog_model,
        CatalogModelKind::Rdb,
        "{:?} catalog contract must start from declared model kind",
        contract.db_type
    );
    assert!(
        profile.has_backend_capability(BackendAdapterCapability::RelationalCatalog),
        "{:?} must expose RelationalCatalog before catalog metadata is asserted",
        contract.db_type
    );

    assert_namespace_label(adapter.namespace_label(), &contract.namespace_label);

    let namespaces = adapter.list_namespaces().await.unwrap();
    assert!(
        namespaces
            .iter()
            .any(|namespace| namespace.name == contract.namespace),
        "{:?} namespace {:?} missing from {:?}",
        contract.db_type,
        contract.namespace,
        namespaces
    );

    let tables = adapter.list_tables(contract.namespace).await.unwrap();
    assert_eq!(
        tables
            .iter()
            .map(|table| table.name.as_str())
            .collect::<Vec<_>>(),
        contract.tables,
        "{:?} table catalog delta changed",
        contract.db_type
    );

    let columns = adapter
        .get_columns(contract.namespace, contract.table, None)
        .await
        .unwrap();
    for expected in contract.columns {
        let actual = columns
            .iter()
            .find(|column| column.name == expected.name)
            .unwrap_or_else(|| {
                panic!(
                    "{:?}.{}.{} missing from columns {:?}",
                    contract.db_type, contract.namespace, expected.name, columns
                )
            });
        assert_eq!(actual.data_type, expected.data_type);
        assert_eq!(actual.nullable, expected.nullable);
        assert_eq!(actual.is_primary_key, expected.is_primary_key);
        assert_eq!(actual.is_foreign_key, expected.is_foreign_key);
        assert_eq!(actual.fk_reference.as_deref(), expected.fk_reference);
    }

    let views = adapter.list_views(contract.namespace).await.unwrap();
    let view = views
        .iter()
        .find(|view| view.name == contract.view.name)
        .unwrap_or_else(|| {
            panic!(
                "{:?}.{}.{} missing from views {:?}",
                contract.db_type, contract.namespace, contract.view.name, views
            )
        });
    assert_eq!(view.schema, contract.namespace);
    assert!(
        view.definition
            .as_deref()
            .is_some_and(|definition| definition.contains(contract.view.definition_contains)),
        "{:?}.{}.{} view definition mismatch: {:?}",
        contract.db_type,
        contract.namespace,
        contract.view.name,
        view.definition
    );

    let view_columns = adapter
        .get_view_columns(contract.namespace, contract.view.name)
        .await
        .unwrap();
    assert_eq!(
        view_columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        contract.view.columns,
        "{:?}.{}.{} view columns changed",
        contract.db_type,
        contract.namespace,
        contract.view.name
    );

    assert_index_delta(adapter, contract).await;
    assert_constraint_delta(adapter, contract).await;
}

pub async fn assert_rdb_explain_unsupported_contract<A>(
    adapter: &A,
    contract: &RdbExplainUnsupportedContract<'_>,
) where
    A: RdbAdapter + Sync,
{
    assert_unsupported_explain(adapter, contract.select_sql, contract).await;

    let before = adapter
        .execute_sql(contract.verify_unchanged_sql, None)
        .await
        .unwrap()
        .rows;
    assert!(
        !before.is_empty(),
        "explain no-mutation verifier must read fixture rows"
    );

    assert_unsupported_explain(adapter, contract.mutation_sql, contract).await;

    let after = adapter
        .execute_sql(contract.verify_unchanged_sql, None)
        .await
        .unwrap()
        .rows;
    assert_eq!(
        after, before,
        "unsupported explain must not execute mutation SQL"
    );
}

fn assert_namespace_label(actual: NamespaceLabel, expected: &NamespaceLabelContract) {
    match (actual, expected) {
        (NamespaceLabel::Schema, NamespaceLabelContract::Schema) => {}
        (NamespaceLabel::Single { name: actual }, NamespaceLabelContract::Single(expected)) => {
            assert_eq!(actual, *expected);
        }
        (actual, _) => panic!("unexpected namespace label: {:?}", actual),
    }
}

async fn assert_index_delta<A>(adapter: &A, contract: &RdbCatalogContract<'_>)
where
    A: RdbAdapter + Sync,
{
    let indexes = adapter
        .get_table_indexes(contract.namespace, contract.table, None)
        .await
        .unwrap();
    match &contract.index_delta {
        IndexDelta::Contains {
            name,
            columns,
            is_unique,
            is_primary,
        } => {
            let index = indexes
                .iter()
                .find(|index| index.name == *name)
                .unwrap_or_else(|| {
                    panic!(
                        "{:?}.{}.{} index {:?} missing from {:?}",
                        contract.db_type, contract.namespace, contract.table, name, indexes
                    )
                });
            assert_eq!(index.columns, columns.to_vec());
            assert_eq!(index.is_unique, *is_unique);
            assert_eq!(index.is_primary, *is_primary);
        }
        IndexDelta::Empty { reason } => {
            assert!(indexes.is_empty(), "{reason}: {indexes:?}");
        }
    }
}

async fn assert_constraint_delta<A>(adapter: &A, contract: &RdbCatalogContract<'_>)
where
    A: RdbAdapter + Sync,
{
    let constraints = adapter
        .get_table_constraints(contract.namespace, contract.table, None)
        .await
        .unwrap();
    match &contract.constraint_delta {
        ConstraintDelta::Empty { reason } => {
            assert!(constraints.is_empty(), "{reason}: {constraints:?}");
        }
    }
}

async fn assert_unsupported_explain<A>(
    adapter: &A,
    sql: &str,
    contract: &RdbExplainUnsupportedContract<'_>,
) where
    A: RdbAdapter + Sync,
{
    match RdbAdapter::explain_query(adapter, sql).await {
        Err(AppError::Unsupported(message)) => assert!(
            message.contains(contract.unsupported_message_fragment),
            "unsupported explain message changed: {message}"
        ),
        other => panic!("expected unsupported explain for {sql:?}, got {other:?}"),
    }
}
