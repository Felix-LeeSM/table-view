#![allow(dead_code)]

#[path = "support/testcontainer_lifecycle.rs"]
mod testcontainer_lifecycle;

#[test]
fn container_removal_args_include_anonymous_volumes() {
    assert_eq!(
        testcontainer_lifecycle::remove_container_args("abc123"),
        ["rm", "-f", "-v", "abc123"]
    );
}

#[test]
fn process_exit_cleanup_removes_registered_containers_with_volumes() {
    let registry = testcontainer_lifecycle::ContainerCleanupRegistry::new();
    registry.register("abc123");
    registry.register("def456");

    let mut removed = Vec::new();
    registry.cleanup_with(|id| {
        removed.push(
            testcontainer_lifecycle::remove_container_args(id)
                .map(str::to_owned)
                .to_vec(),
        );
    });

    assert_eq!(
        removed,
        vec![
            vec!["rm", "-f", "-v", "abc123"],
            vec!["rm", "-f", "-v", "def456"],
        ]
    );

    let mut removed_after_drain = Vec::new();
    registry.cleanup_with(|id| {
        removed_after_drain.push(
            testcontainer_lifecycle::remove_container_args(id)
                .map(str::to_owned)
                .to_vec(),
        );
    });
    assert!(removed_after_drain.is_empty());
}
