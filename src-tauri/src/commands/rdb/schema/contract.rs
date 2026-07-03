macro_rules! with_rdb_schema_contract {
    (
        $state:expr,
        $connection_id:expr,
        $expected_database:expr,
        |$adapter:ident| $dispatch:expr
    ) => {{
        async {
            // Issue #1087 — clone the `Arc` handle under a short lock and
            // drop the guard before probing / dispatching, so a long schema
            // query never serialises other commands on this or any other
            // connection.
            let active = $state
                .active_adapter($connection_id)
                .await
                .ok_or_else(|| not_connected($connection_id))?;
            let $adapter = active.as_rdb()?;
            ensure_expected_db($adapter, $expected_database).await?;
            $dispatch.await
        }
    }};
}
