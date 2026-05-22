use table_view_lib::models::DatabaseType;

#[test]
fn backend_adapter_contract_profiles_are_encoded() {
    let _ = DatabaseType::Postgresql;

    panic!(
        "RED: expected backend profile/capability helpers keyed by DatabaseType \
         to encode the current adapter contract"
    );
}
