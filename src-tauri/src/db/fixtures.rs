use crate::error::AppError;
use crate::models::{
    DataSourceDialectFamily, DataSourceProfile, DatabaseType, FileConnectionPrivacyPolicyId,
    Paradigm,
};

use super::ActiveAdapter;

#[derive(Debug, Clone)]
pub enum FixtureSelector {
    Profile(DatabaseType),
    Family(DataSourceDialectFamily),
    Paradigm(Paradigm),
}

#[derive(Debug, Clone)]
pub struct FixtureRequest {
    pub selector: FixtureSelector,
    pub require_local_first: bool,
}

impl FixtureRequest {
    pub fn by_profile(profile: DatabaseType) -> Self {
        Self {
            selector: FixtureSelector::Profile(profile),
            require_local_first: false,
        }
    }

    pub fn by_family(family: DataSourceDialectFamily) -> Self {
        Self {
            selector: FixtureSelector::Family(family),
            require_local_first: false,
        }
    }

    pub fn by_paradigm(paradigm: Paradigm) -> Self {
        Self {
            selector: FixtureSelector::Paradigm(paradigm),
            require_local_first: false,
        }
    }

    pub fn require_local_first(mut self) -> Self {
        self.require_local_first = true;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixturePrivacy {
    pub local_first: bool,
    pub network_access_forbidden: bool,
    pub persists_secrets: bool,
    pub file_privacy_policy: Option<FileConnectionPrivacyPolicyId>,
}

#[derive(Debug, Clone)]
pub struct FixtureDefinition {
    pub id: &'static str,
    pub profile: DataSourceProfile,
    pub privacy: FixturePrivacy,
}

pub struct AdapterFixture {
    pub definition: FixtureDefinition,
    pub adapter: ActiveAdapter,
}

#[derive(Debug, thiserror::Error)]
pub enum FixtureHarnessError {
    #[error("{diagnostic}")]
    NoFixture { diagnostic: String },
    #[error("fixture harness is not implemented yet")]
    NotImplemented,
    #[error(transparent)]
    Adapter(#[from] AppError),
}

pub struct FixtureHarness;

impl FixtureHarness {
    pub fn local() -> Self {
        Self
    }

    pub fn request(&self, _request: FixtureRequest) -> Result<AdapterFixture, FixtureHarnessError> {
        Err(FixtureHarnessError::NotImplemented)
    }
}
