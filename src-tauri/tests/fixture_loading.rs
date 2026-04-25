//! Sprint-88 AC-01: Rust-side proof that `tests/fixtures/fk_reference_samples.json`
//! is loadable via `include_str!` + `serde_json`.
//!
//! The companion vitest test (`tests/fixtures/fk_reference_samples.test.ts`)
//! proves the same file is also loadable from the TS side. sprint-89 (#FK-1)
//! will consume the parsed samples to drive parser/serializer round-trips
//! without duplicating fixture data.

use serde::Deserialize;

const FIXTURE_RAW: &str = include_str!("../../tests/fixtures/fk_reference_samples.json");

#[derive(Debug, Deserialize)]
struct FkReferenceSample {
    #[allow(dead_code)]
    name: String,
    schema: String,
    table: String,
    column: String,
    expected: String,
}

#[derive(Debug, Deserialize)]
struct FkReferenceFixture {
    #[serde(rename = "$schema")]
    schema_version: String,
    #[allow(dead_code)]
    description: String,
    format: String,
    samples: Vec<FkReferenceSample>,
}

fn load_fixture() -> FkReferenceFixture {
    serde_json::from_str(FIXTURE_RAW).expect("fixture must be valid JSON")
}

#[test]
fn fk_reference_fixture_loads_via_include_str() {
    let fixture = load_fixture();
    assert_eq!(fixture.schema_version, "fk_reference_samples@1");
    assert_eq!(fixture.format, "<schema>.<table>(<column>)");
}

#[test]
fn fk_reference_fixture_has_at_least_three_samples_with_consistent_serialization() {
    let fixture = load_fixture();
    assert!(
        fixture.samples.len() >= 3,
        "expected >= 3 fixture samples, got {}",
        fixture.samples.len()
    );
    for sample in &fixture.samples {
        let expected = format!("{}.{}({})", sample.schema, sample.table, sample.column);
        assert_eq!(
            sample.expected, expected,
            "sample.expected must match `<schema>.<table>(<column>)` derivation"
        );
    }
}

#[test]
fn fk_reference_fixture_includes_boundary_case() {
    let fixture = load_fixture();
    let has_boundary = fixture.samples.iter().any(|s| {
        s.schema.chars().any(|c| c == '-' || c == '_' || c == ' ')
            || s.table.chars().any(|c| c == '-' || c == '_' || c == ' ')
            || s.column.chars().any(|c| c == '-' || c == '_' || c == ' ')
    });
    assert!(
        has_boundary,
        "fixture must include at least one sample with a non-alphanumeric \
         character to exercise quoting/escaping in sprint-89"
    );
}
