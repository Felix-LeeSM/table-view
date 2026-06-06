use table_view_lib::{
    db::fixtures::{FixtureHarness, FixtureHarnessError, FixtureRequest},
    models::{DataSourceDialectFamily, DatabaseType, Paradigm},
};

#[test]
fn fixture_harness_resolves_search_fixture_by_profile_family_and_paradigm() {
    let harness = FixtureHarness::local();

    let by_profile = harness
        .request(FixtureRequest::by_profile(DatabaseType::Elasticsearch))
        .expect("elasticsearch profile fixture should resolve");
    assert_eq!(by_profile.definition.id, "search.elasticsearch.sample");
    assert!(by_profile.adapter.as_search().is_ok());

    let by_family = harness
        .request(FixtureRequest::by_family(
            DataSourceDialectFamily::Elasticsearch,
        ))
        .expect("elasticsearch family fixture should resolve");
    assert_eq!(by_family.definition.id, by_profile.definition.id);

    let by_paradigm = harness
        .request(FixtureRequest::by_paradigm(Paradigm::Search))
        .expect("search paradigm fixture should resolve");
    assert_eq!(by_paradigm.definition.id, by_profile.definition.id);
}

#[test]
fn fixture_harness_rejects_missing_fixture_with_actionable_diagnostics() {
    let harness = FixtureHarness::local();
    let error = match harness.request(FixtureRequest::by_profile(DatabaseType::Mssql)) {
        Ok(_) => panic!("mssql connection runtime should not imply a local fixture yet"),
        Err(error) => error,
    };

    match error {
        FixtureHarnessError::NoFixture { diagnostic } => {
            assert!(diagnostic.contains("Profile(Mssql)"));
            assert!(diagnostic.contains("available fixtures"));
            assert!(diagnostic.contains("search.elasticsearch.sample"));
        }
        other => panic!("expected NoFixture diagnostic, got {other:?}"),
    }
}

#[test]
fn fixture_harness_can_enforce_local_first_privacy_assumption() {
    let harness = FixtureHarness::local();
    let fixture = harness
        .request(FixtureRequest::by_profile(DatabaseType::Elasticsearch).require_local_first())
        .expect("embedded search fixture must satisfy local-first privacy");

    assert!(fixture.definition.privacy.network_access_forbidden);
    assert!(fixture.definition.privacy.local_first);
    assert!(!fixture.definition.privacy.persists_secrets);
}
