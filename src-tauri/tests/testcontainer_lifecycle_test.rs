#![allow(dead_code)]

#[path = "support/testcontainer_lifecycle.rs"]
mod testcontainer_lifecycle;

#[test]
fn dead_owner_sweep_removes_container_owned_volumes() {
    assert_eq!(
        testcontainer_lifecycle::remove_dead_owner_args("abc123"),
        ["rm", "-f", "-v", "abc123"]
    );
}
