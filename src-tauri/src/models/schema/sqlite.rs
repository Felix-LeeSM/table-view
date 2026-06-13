use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteCapabilityInventory {
    pub json1: bool,
    pub fts5: bool,
    pub rtree: bool,
}
