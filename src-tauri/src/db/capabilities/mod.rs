//! Backend adapter capability/profile contract surface.
//!
//! The data-source registry in `models::data_source` remains the source of
//! truth. This module gives backend adapter code a stable `db::capabilities`
//! import path without duplicating capability definitions.

pub use crate::models::{
    BackendAdapterCapability, BackendAdapterCapabilitySource, BackendAdapterContract,
    BackendAdapterContractKind, BackendAdapterContractState, BackendAdapterId,
    BackendAdapterProfile,
};
