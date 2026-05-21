use crate::error::AppError;
use sqlparser::ast::{
    BinaryOperator, Expr, FunctionArg, FunctionArgExpr, FunctionArguments, GroupByExpr, Query,
    Select, SetExpr, Statement, UnaryOperator,
};
use sqlparser::dialect::{MySqlDialect, PostgreSqlDialect, SQLiteDialect};
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Token, Tokenizer, Whitespace};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RawWhereDialect {
    Postgres,
    Mysql,
    Sqlite,
}

pub(crate) fn validate_raw_where_clause(
    dialect: RawWhereDialect,
    raw_where: &str,
) -> Result<(), AppError> {
    if raw_where.contains(';') {
        return Err(AppError::Validation(
            "Raw WHERE clause must not contain semicolons".into(),
        ));
    }
    if contains_sql_comment(dialect, raw_where) {
        return Err(AppError::Validation(
            "Raw WHERE clause must not contain SQL comments".into(),
        ));
    }
    reject_dangerous_prefix(raw_where)?;

    let wrapped = format!("SELECT 1 FROM __tv_raw_where_probe WHERE {raw_where}");
    let statements = parse_sql(dialect, &wrapped).map_err(|error| {
        AppError::Validation(format!(
            "Raw WHERE clause must be a single boolean expression: {error}"
        ))
    })?;

    let [statement] = statements.as_slice() else {
        return Err(AppError::Validation(
            "Raw WHERE clause must be a single boolean expression".into(),
        ));
    };
    let Statement::Query(query) = statement else {
        return Err(AppError::Validation(
            "Raw WHERE clause must be a single boolean expression".into(),
        ));
    };

    let select = select_without_query_tail(query)?;
    if select_has_extra_clauses(select) {
        return Err(AppError::Validation(
            "Raw WHERE clause must not contain query clauses".into(),
        ));
    }

    let Some(selection) = &select.selection else {
        return Err(AppError::Validation(
            "Raw WHERE clause must be a boolean expression".into(),
        ));
    };
    if !is_predicate(selection) {
        return Err(AppError::Validation(
            "Raw WHERE clause must be a boolean expression".into(),
        ));
    }

    Ok(())
}

fn reject_dangerous_prefix(raw_where: &str) -> Result<(), AppError> {
    let upper = raw_where.trim_start().to_uppercase();
    for keyword in [
        "DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE",
    ] {
        if starts_with_keyword(&upper, keyword) {
            return Err(AppError::Validation(format!(
                "Raw WHERE clause must not start with {keyword}",
            )));
        }
    }
    Ok(())
}

fn starts_with_keyword(input: &str, keyword: &str) -> bool {
    input
        .strip_prefix(keyword)
        .is_some_and(|rest| rest.chars().next().is_none_or(|ch| !is_identifier_char(ch)))
}

fn is_identifier_char(ch: char) -> bool {
    ch == '_' || ch == '$' || ch.is_ascii_alphanumeric()
}

fn contains_sql_comment(dialect: RawWhereDialect, sql: &str) -> bool {
    tokenize_sql(dialect, sql).is_ok_and(|tokens| {
        tokens.iter().any(|token| {
            matches!(
                token,
                Token::Whitespace(
                    Whitespace::SingleLineComment { .. } | Whitespace::MultiLineComment(_)
                )
            )
        })
    })
}

fn tokenize_sql(
    dialect: RawWhereDialect,
    sql: &str,
) -> Result<Vec<Token>, sqlparser::tokenizer::TokenizerError> {
    match dialect {
        RawWhereDialect::Postgres => Tokenizer::new(&PostgreSqlDialect {}, sql).tokenize(),
        RawWhereDialect::Mysql => Tokenizer::new(&MySqlDialect {}, sql).tokenize(),
        RawWhereDialect::Sqlite => Tokenizer::new(&SQLiteDialect {}, sql).tokenize(),
    }
}

fn parse_sql(
    dialect: RawWhereDialect,
    sql: &str,
) -> Result<Vec<Statement>, sqlparser::parser::ParserError> {
    match dialect {
        RawWhereDialect::Postgres => Parser::parse_sql(&PostgreSqlDialect {}, sql),
        RawWhereDialect::Mysql => Parser::parse_sql(&MySqlDialect {}, sql),
        RawWhereDialect::Sqlite => Parser::parse_sql(&SQLiteDialect {}, sql),
    }
}

fn select_without_query_tail(query: &Query) -> Result<&Select, AppError> {
    if query.with.is_some()
        || query.order_by.is_some()
        || query.limit_clause.is_some()
        || query.fetch.is_some()
        || !query.locks.is_empty()
        || query.for_clause.is_some()
        || query.settings.is_some()
        || query.format_clause.is_some()
        || !query.pipe_operators.is_empty()
    {
        return Err(AppError::Validation(
            "Raw WHERE clause must not contain query clauses".into(),
        ));
    }

    match query.body.as_ref() {
        SetExpr::Select(select) => Ok(select),
        _ => Err(AppError::Validation(
            "Raw WHERE clause must be a single boolean expression".into(),
        )),
    }
}

fn select_has_extra_clauses(select: &Select) -> bool {
    select.distinct.is_some()
        || select.select_modifiers.is_some()
        || select.top.is_some()
        || select.into.is_some()
        || !select.lateral_views.is_empty()
        || select.prewhere.is_some()
        || !select.connect_by.is_empty()
        || !group_by_expr_is_empty(&select.group_by)
        || !select.cluster_by.is_empty()
        || !select.distribute_by.is_empty()
        || !select.sort_by.is_empty()
        || select.having.is_some()
        || !select.named_window.is_empty()
        || select.qualify.is_some()
        || select.value_table_mode.is_some()
}

fn is_predicate(expr: &Expr) -> bool {
    match expr {
        Expr::Nested(inner) => is_predicate(inner),
        Expr::UnaryOp {
            op: UnaryOperator::Not | UnaryOperator::BangNot,
            expr,
        } => is_predicate(expr),
        Expr::BinaryOp { left, op, right } => match op {
            BinaryOperator::And | BinaryOperator::Or | BinaryOperator::Xor => {
                is_predicate(left) && is_predicate(right)
            }
            BinaryOperator::Eq
            | BinaryOperator::NotEq
            | BinaryOperator::Gt
            | BinaryOperator::Lt
            | BinaryOperator::GtEq
            | BinaryOperator::LtEq
            | BinaryOperator::Spaceship
            | BinaryOperator::Match
            | BinaryOperator::Regexp
            | BinaryOperator::PGRegexMatch
            | BinaryOperator::PGRegexIMatch
            | BinaryOperator::PGRegexNotMatch
            | BinaryOperator::PGRegexNotIMatch
            | BinaryOperator::PGLikeMatch
            | BinaryOperator::PGILikeMatch
            | BinaryOperator::PGNotLikeMatch
            | BinaryOperator::PGNotILikeMatch
            | BinaryOperator::PGStartsWith
            | BinaryOperator::Custom(_) => is_safe_value_expr(left) && is_safe_value_expr(right),
            _ => false,
        },
        Expr::Between {
            expr, low, high, ..
        } => is_safe_value_expr(expr) && is_safe_value_expr(low) && is_safe_value_expr(high),
        Expr::InList { expr, list, .. } => {
            is_safe_value_expr(expr) && list.iter().all(is_safe_value_expr)
        }
        Expr::Like { expr, pattern, .. }
        | Expr::ILike { expr, pattern, .. }
        | Expr::SimilarTo { expr, pattern, .. }
        | Expr::RLike { expr, pattern, .. } => {
            is_safe_value_expr(expr) && is_safe_value_expr(pattern)
        }
        Expr::IsFalse(inner)
        | Expr::IsNotFalse(inner)
        | Expr::IsTrue(inner)
        | Expr::IsNotTrue(inner)
        | Expr::IsNull(inner)
        | Expr::IsNotNull(inner)
        | Expr::IsUnknown(inner)
        | Expr::IsNotUnknown(inner) => is_safe_value_expr(inner),
        Expr::IsDistinctFrom(left, right) | Expr::IsNotDistinctFrom(left, right) => {
            is_safe_value_expr(left) && is_safe_value_expr(right)
        }
        _ => is_safe_value_expr(expr),
    }
}

fn is_safe_value_expr(expr: &Expr) -> bool {
    match expr {
        Expr::InSubquery { .. }
        | Expr::Exists { .. }
        | Expr::Subquery(_)
        | Expr::AnyOp { .. }
        | Expr::AllOp { .. } => false,
        Expr::Nested(inner) => is_safe_value_expr(inner),
        Expr::UnaryOp { expr, .. } => is_safe_value_expr(expr),
        Expr::BinaryOp { left, right, .. }
        | Expr::IsDistinctFrom(left, right)
        | Expr::IsNotDistinctFrom(left, right) => {
            is_safe_value_expr(left) && is_safe_value_expr(right)
        }
        Expr::Between {
            expr, low, high, ..
        } => is_safe_value_expr(expr) && is_safe_value_expr(low) && is_safe_value_expr(high),
        Expr::InList { expr, list, .. } => {
            is_safe_value_expr(expr) && list.iter().all(is_safe_value_expr)
        }
        Expr::Like { expr, pattern, .. }
        | Expr::ILike { expr, pattern, .. }
        | Expr::SimilarTo { expr, pattern, .. }
        | Expr::RLike { expr, pattern, .. } => {
            is_safe_value_expr(expr) && is_safe_value_expr(pattern)
        }
        Expr::IsFalse(inner)
        | Expr::IsNotFalse(inner)
        | Expr::IsTrue(inner)
        | Expr::IsNotTrue(inner)
        | Expr::IsNull(inner)
        | Expr::IsNotNull(inner)
        | Expr::IsUnknown(inner)
        | Expr::IsNotUnknown(inner)
        | Expr::IsNormalized { expr: inner, .. }
        | Expr::Prior(inner)
        | Expr::OuterJoin(inner) => is_safe_value_expr(inner),
        Expr::Function(function) => {
            function_args_are_safe(&function.parameters)
                && function_args_are_safe(&function.args)
                && function.filter.as_deref().is_none_or(is_predicate)
                && function.null_treatment.is_none()
                && function.over.is_none()
                && function.within_group.is_empty()
        }
        Expr::Case {
            operand,
            conditions,
            else_result,
            ..
        } => {
            operand.as_deref().is_none_or(is_safe_value_expr)
                && conditions.iter().all(|condition| {
                    is_predicate(&condition.condition) && is_safe_value_expr(&condition.result)
                })
                && else_result.as_deref().is_none_or(is_safe_value_expr)
        }
        Expr::Cast { expr, .. }
        | Expr::Convert { expr, .. }
        | Expr::AtTimeZone {
            timestamp: expr, ..
        }
        | Expr::Extract { expr, .. }
        | Expr::Ceil { expr, .. }
        | Expr::Floor { expr, .. }
        | Expr::Substring { expr, .. }
        | Expr::Trim { expr, .. }
        | Expr::Overlay { expr, .. }
        | Expr::Collate { expr, .. }
        | Expr::Prefixed { value: expr, .. }
        | Expr::Position { expr, .. } => is_safe_value_expr(expr),
        Expr::Identifier(_)
        | Expr::CompoundIdentifier(_)
        | Expr::Value(_)
        | Expr::TypedString(_)
        | Expr::Wildcard(_)
        | Expr::QualifiedWildcard(_, _) => true,
        _ => false,
    }
}

fn group_by_expr_is_empty(group_by: &GroupByExpr) -> bool {
    match group_by {
        GroupByExpr::All(modifiers) => modifiers.is_empty(),
        GroupByExpr::Expressions(expressions, modifiers) => {
            expressions.is_empty() && modifiers.is_empty()
        }
    }
}

fn function_args_are_safe(args: &FunctionArguments) -> bool {
    match args {
        FunctionArguments::None => true,
        FunctionArguments::Subquery(_) => false,
        FunctionArguments::List(list) => {
            list.duplicate_treatment.is_none()
                && list.clauses.is_empty()
                && list.args.iter().all(function_arg_is_safe)
        }
    }
}

fn function_arg_is_safe(arg: &FunctionArg) -> bool {
    match arg {
        FunctionArg::Named { arg, .. } => function_arg_expr_is_safe(arg),
        FunctionArg::ExprNamed { name, arg, .. } => {
            is_safe_value_expr(name) && function_arg_expr_is_safe(arg)
        }
        FunctionArg::Unnamed(arg) => function_arg_expr_is_safe(arg),
    }
}

fn function_arg_expr_is_safe(arg: &FunctionArgExpr) -> bool {
    match arg {
        FunctionArgExpr::Expr(expr) => is_safe_value_expr(expr),
        FunctionArgExpr::QualifiedWildcard(_) | FunctionArgExpr::Wildcard => true,
        FunctionArgExpr::WildcardWithOptions(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_boolean_filter() {
        assert!(validate_raw_where_clause(
            RawWhereDialect::Sqlite,
            "status = 'active' AND age > 18",
        )
        .is_ok());
    }

    #[test]
    fn accepts_dialect_quoted_identifiers() {
        assert!(
            validate_raw_where_clause(RawWhereDialect::Postgres, r#""status" = 'active'"#,).is_ok()
        );
        assert!(validate_raw_where_clause(RawWhereDialect::Mysql, "`status` = 'active'",).is_ok());
    }

    #[test]
    fn accepts_booleanish_value_expressions() {
        assert!(validate_raw_where_clause(RawWhereDialect::Postgres, "is_active").is_ok());
        assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "json_valid(payload)").is_ok());
    }

    #[test]
    fn accepts_comment_marker_inside_string_literal() {
        assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "note = '--literal'").is_ok());
    }

    #[test]
    fn accepts_identifier_starting_with_dangerous_keyword() {
        assert!(
            validate_raw_where_clause(RawWhereDialect::Sqlite, "updated_at IS NOT NULL").is_ok()
        );
    }

    #[test]
    fn rejects_union_select_tail() {
        assert!(validate_raw_where_clause(
            RawWhereDialect::Sqlite,
            "active = 1 UNION SELECT password FROM users",
        )
        .is_err());
    }

    #[test]
    fn rejects_line_comment_smuggling() {
        assert!(validate_raw_where_clause(
            RawWhereDialect::Sqlite,
            "active = 1 -- hide the rest\n OR 1 = 1",
        )
        .is_err());
    }

    #[test]
    fn keeps_dangerous_prefix_error_copy() {
        let err = validate_raw_where_clause(RawWhereDialect::Mysql, "DROP TABLE users")
            .expect_err("dangerous prefix should be rejected");
        match err {
            AppError::Validation(message) => assert!(message.contains("DROP")),
            other => panic!("expected validation error, got {other:?}"),
        }
    }

    #[test]
    fn rejects_subqueries() {
        assert!(validate_raw_where_clause(
            RawWhereDialect::Sqlite,
            "id IN (SELECT id FROM admins)",
        )
        .is_err());
    }

    #[test]
    fn keeps_semicolon_error_copy() {
        let err = validate_raw_where_clause(RawWhereDialect::Sqlite, "a = 1; DROP TABLE users")
            .expect_err("semicolon should be rejected");
        match err {
            AppError::Validation(message) => assert!(message.contains("semicolons")),
            other => panic!("expected validation error, got {other:?}"),
        }
    }
}
