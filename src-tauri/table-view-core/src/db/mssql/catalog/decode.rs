use tiberius::{Client, Row, ToSql};
use tokio::net::TcpStream;
use tokio_util::compat::Compat;

use crate::error::AppError;
use crate::models::ColumnCategory;

use super::super::mssql_connection_error;

pub(super) type MssqlClient = Client<Compat<TcpStream>>;

pub(super) async fn query_rows(
    client: &mut MssqlClient,
    context: &'static str,
    sql: &str,
    params: &[&dyn ToSql],
) -> Result<Vec<Row>, AppError> {
    client
        .query(sql, params)
        .await
        .map_err(|err| mssql_connection_error(context, err))?
        .into_first_result()
        .await
        .map_err(|err| mssql_connection_error(context, err))
}

pub(super) async fn query_rows_or_empty_on_metadata_denied(
    client: &mut MssqlClient,
    context: &'static str,
    sql: &str,
    params: &[&dyn ToSql],
) -> Result<Vec<Row>, AppError> {
    match client.query(sql, params).await {
        Ok(stream) => match stream.into_first_result().await {
            Ok(rows) => Ok(rows),
            Err(err) if is_metadata_permission_error(&err.to_string()) => Ok(Vec::new()),
            Err(err) => Err(mssql_connection_error(context, err)),
        },
        Err(err) if is_metadata_permission_error(&err.to_string()) => Ok(Vec::new()),
        Err(err) => Err(mssql_connection_error(context, err)),
    }
}

pub(super) fn row_string(row: &Row, idx: usize, label: &'static str) -> Result<String, AppError> {
    Ok(row_optional_string(row, idx, label)?.unwrap_or_default())
}

pub(super) fn row_optional_string(
    row: &Row,
    idx: usize,
    label: &'static str,
) -> Result<Option<String>, AppError> {
    row.try_get::<&str, _>(idx)
        .map(|value| value.map(str::to_string))
        .map_err(|err| AppError::Database(format!("SQL Server {label} decode failed: {err}")))
}

pub(super) fn row_i64(row: &Row, idx: usize, label: &'static str) -> Result<Option<i64>, AppError> {
    row.try_get::<i64, _>(idx)
        .map_err(|err| AppError::Database(format!("SQL Server {label} decode failed: {err}")))
}

pub(super) fn row_bool(row: &Row, idx: usize, label: &'static str) -> Result<bool, AppError> {
    row.try_get::<bool, _>(idx)
        .map(|value| value.unwrap_or(false))
        .map_err(|err| AppError::Database(format!("SQL Server {label} decode failed: {err}")))
}

pub(super) fn format_fk_reference(schema: &str, table: &str, column: &str) -> String {
    format!("{schema}.{table}({column})")
}

pub(super) fn map_mssql_data_type(data_type: &str) -> ColumnCategory {
    match data_type.trim().to_ascii_lowercase().as_str() {
        "bit" => ColumnCategory::Bool,
        "tinyint" | "smallint" | "int" | "bigint" => ColumnCategory::Int,
        "decimal" | "numeric" | "money" | "smallmoney" | "float" | "real" => ColumnCategory::Float,
        "date" | "time" | "datetime" | "datetime2" | "datetimeoffset" | "smalldatetime" => {
            ColumnCategory::Datetime
        }
        "uniqueidentifier" => ColumnCategory::Uuid,
        "binary" | "varbinary" | "image" | "timestamp" | "rowversion" => ColumnCategory::Binary,
        "xml" | "sql_variant" | "hierarchyid" | "geography" | "geometry" => ColumnCategory::Object,
        "char" | "varchar" | "nchar" | "nvarchar" | "text" | "ntext" | "sysname" => {
            ColumnCategory::Text
        }
        _ => ColumnCategory::Unknown,
    }
}

pub(super) fn is_metadata_permission_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("permission was denied")
        || lower.contains("view definition")
        || lower.contains("metadata")
        || lower.contains("not authorized")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_mssql_data_type_classifies_datagrid_categories() {
        assert_eq!(map_mssql_data_type("int"), ColumnCategory::Int);
        assert_eq!(map_mssql_data_type("bigint"), ColumnCategory::Int);
        assert_eq!(map_mssql_data_type("decimal"), ColumnCategory::Float);
        assert_eq!(map_mssql_data_type("bit"), ColumnCategory::Bool);
        assert_eq!(map_mssql_data_type("datetime2"), ColumnCategory::Datetime);
        assert_eq!(
            map_mssql_data_type("uniqueidentifier"),
            ColumnCategory::Uuid
        );
        assert_eq!(map_mssql_data_type("varbinary"), ColumnCategory::Binary);
        assert_eq!(map_mssql_data_type("nvarchar"), ColumnCategory::Text);
        assert_eq!(map_mssql_data_type("xml"), ColumnCategory::Object);
        assert_eq!(map_mssql_data_type("mystery"), ColumnCategory::Unknown);
    }

    #[test]
    fn map_mssql_data_type_covers_sql_server_aliases() {
        for data_type in [" TINYINT ", "smallint"] {
            assert_eq!(map_mssql_data_type(data_type), ColumnCategory::Int);
        }
        for data_type in ["numeric", "money", "smallmoney", "float", "real"] {
            assert_eq!(map_mssql_data_type(data_type), ColumnCategory::Float);
        }
        for data_type in [
            "date",
            "time",
            "datetime",
            "datetimeoffset",
            "smalldatetime",
        ] {
            assert_eq!(map_mssql_data_type(data_type), ColumnCategory::Datetime);
        }
        for data_type in ["binary", "image", "timestamp", "rowversion"] {
            assert_eq!(map_mssql_data_type(data_type), ColumnCategory::Binary);
        }
        for data_type in ["sql_variant", "hierarchyid", "geography", "geometry"] {
            assert_eq!(map_mssql_data_type(data_type), ColumnCategory::Object);
        }
        for data_type in ["char", "varchar", "nchar", "text", "ntext", "sysname"] {
            assert_eq!(map_mssql_data_type(data_type), ColumnCategory::Text);
        }
    }

    #[test]
    fn format_fk_reference_matches_datagrid_contract() {
        assert_eq!(format_fk_reference("dbo", "users", "id"), "dbo.users(id)");
    }

    #[test]
    fn permission_errors_are_safe_empty_metadata_candidates() {
        assert!(is_metadata_permission_error(
            "The SELECT permission was denied on the object 'objects'"
        ));
        assert!(is_metadata_permission_error(
            "The user does not have permission to perform this action. VIEW DEFINITION required."
        ));
        assert!(is_metadata_permission_error(
            "The user is not authorized to read metadata."
        ));
        assert!(!is_metadata_permission_error(
            "SQL Server login failed: timed out after 1s"
        ));
    }
}
