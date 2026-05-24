use std::mem;

use crate::error::AppError;
use crate::models::{
    DataSourceDialectFamily, DataSourceProfile, DatabaseType, FileConnectionPrivacyPolicyId,
    Paradigm,
};

use super::{ActiveAdapter, SearchEngineAdapter};

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
    pub required_capabilities: Vec<FixtureCapabilityLabel>,
}

impl FixtureRequest {
    pub fn by_profile(profile: DatabaseType) -> Self {
        Self {
            selector: FixtureSelector::Profile(profile),
            require_local_first: false,
            required_capabilities: Vec::new(),
        }
    }

    pub fn by_family(family: DataSourceDialectFamily) -> Self {
        Self {
            selector: FixtureSelector::Family(family),
            require_local_first: false,
            required_capabilities: Vec::new(),
        }
    }

    pub fn by_paradigm(paradigm: Paradigm) -> Self {
        Self {
            selector: FixtureSelector::Paradigm(paradigm),
            require_local_first: false,
            required_capabilities: Vec::new(),
        }
    }

    pub fn require_local_first(mut self) -> Self {
        self.require_local_first = true;
        self
    }

    pub fn require_capability(mut self, capability: FixtureCapabilityLabel) -> Self {
        self.required_capabilities.push(capability);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixtureCapabilityLabel {
    Lifecycle,
    SeedData,
    Cleanup,
    Catalog,
    Query,
    SafetyPlan,
    NoNetwork,
    LocalFirst,
}

impl FixtureCapabilityLabel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Lifecycle => "lifecycle",
            Self::SeedData => "seed-data",
            Self::Cleanup => "cleanup",
            Self::Catalog => "catalog",
            Self::Query => "query",
            Self::SafetyPlan => "safety-plan",
            Self::NoNetwork => "no-network",
            Self::LocalFirst => "local-first",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixtureLifecycleKind {
    EmbeddedStatic,
    MockAdapter,
    LocalFile,
    LocalContainer,
}

impl FixtureLifecycleKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::EmbeddedStatic => "embedded-static",
            Self::MockAdapter => "mock-adapter",
            Self::LocalFile => "local-file",
            Self::LocalContainer => "local-container",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixtureCleanupPolicy {
    Noop,
    DropTempResources,
    StopContainer,
}

impl FixtureCleanupPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Noop => "noop",
            Self::DropTempResources => "drop-temp-resources",
            Self::StopContainer => "stop-container",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixtureLifecycle {
    pub kind: FixtureLifecycleKind,
    pub seed: &'static str,
    pub cleanup: FixtureCleanupPolicy,
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
    pub lifecycle: FixtureLifecycle,
    pub capabilities: &'static [FixtureCapabilityLabel],
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
    #[error("{diagnostic}")]
    PrivacyViolation { diagnostic: String },
    #[error("{diagnostic}")]
    CleanupFailed { diagnostic: String },
    #[error(transparent)]
    Adapter(#[from] AppError),
}

pub struct FixtureHarness;

impl FixtureHarness {
    pub fn local() -> Self {
        Self
    }

    pub fn request(&self, request: FixtureRequest) -> Result<AdapterFixture, FixtureHarnessError> {
        let registration = REGISTERED_FIXTURES
            .iter()
            .find(|fixture| matches_selector(&fixture.profile, &request.selector))
            .filter(|fixture| {
                request.required_capabilities.iter().all(|required| {
                    fixture
                        .capabilities
                        .iter()
                        .any(|capability| capability == required)
                })
            })
            .ok_or_else(|| FixtureHarnessError::NoFixture {
                diagnostic: missing_fixture_diagnostic(&request),
            })?;

        let definition = registration.definition();
        if request.require_local_first && !definition.privacy.satisfies_local_first() {
            return Err(FixtureHarnessError::PrivacyViolation {
                diagnostic: format!(
                    "fixture '{}' matched {:?} but does not satisfy local-first privacy \
                     assumptions: local_first={}, network_access_forbidden={}, persists_secrets={}",
                    definition.id,
                    request.selector,
                    definition.privacy.local_first,
                    definition.privacy.network_access_forbidden,
                    definition.privacy.persists_secrets
                ),
            });
        }

        Ok(AdapterFixture {
            definition,
            adapter: (registration.factory)(),
        })
    }
}

impl AdapterFixture {
    pub fn cleanup(self) -> Result<(), FixtureHarnessError> {
        match self.definition.lifecycle.cleanup {
            FixtureCleanupPolicy::Noop => Ok(()),
            policy => Err(FixtureHarnessError::CleanupFailed {
                diagnostic: format!(
                    "fixture '{}' declares cleanup policy '{}' but no cleanup handler is registered",
                    self.definition.id,
                    policy.as_str()
                ),
            }),
        }
    }
}

impl FixturePrivacy {
    fn satisfies_local_first(&self) -> bool {
        self.local_first && self.network_access_forbidden && !self.persists_secrets
    }
}

struct RegisteredFixture {
    id: &'static str,
    profile: DatabaseType,
    lifecycle: FixtureLifecycle,
    capabilities: &'static [FixtureCapabilityLabel],
    privacy: FixturePrivacy,
    factory: fn() -> ActiveAdapter,
}

impl RegisteredFixture {
    fn definition(&self) -> FixtureDefinition {
        FixtureDefinition {
            id: self.id,
            profile: self.profile.data_source_profile(),
            lifecycle: self.lifecycle.clone(),
            capabilities: self.capabilities,
            privacy: self.privacy.clone(),
        }
    }

    fn summary(&self) -> String {
        let profile = self.profile.data_source_profile();
        let capability_labels = self
            .capabilities
            .iter()
            .map(|capability| capability.as_str())
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{} [profile={:?} family={:?} paradigm={:?} lifecycle={} seed={} cleanup={} \
             capabilities={}]",
            self.id,
            self.profile,
            profile.dialect.family,
            profile.paradigm,
            self.lifecycle.kind.as_str(),
            self.lifecycle.seed,
            self.lifecycle.cleanup.as_str(),
            capability_labels
        )
    }
}

const LOCAL_FIRST_EMBEDDED_PRIVACY: FixturePrivacy = FixturePrivacy {
    local_first: true,
    network_access_forbidden: true,
    persists_secrets: false,
    file_privacy_policy: None,
};

const SEARCH_CAPABILITIES: &[FixtureCapabilityLabel] = &[
    FixtureCapabilityLabel::Lifecycle,
    FixtureCapabilityLabel::SeedData,
    FixtureCapabilityLabel::Cleanup,
    FixtureCapabilityLabel::Catalog,
    FixtureCapabilityLabel::Query,
    FixtureCapabilityLabel::SafetyPlan,
    FixtureCapabilityLabel::NoNetwork,
    FixtureCapabilityLabel::LocalFirst,
];

const REGISTERED_FIXTURES: &[RegisteredFixture] = &[
    RegisteredFixture {
        id: "search.elasticsearch.sample",
        profile: DatabaseType::Elasticsearch,
        lifecycle: FixtureLifecycle {
            kind: FixtureLifecycleKind::EmbeddedStatic,
            seed: "SearchCatalogFixture::sample(Elasticsearch)",
            cleanup: FixtureCleanupPolicy::Noop,
        },
        capabilities: SEARCH_CAPABILITIES,
        privacy: LOCAL_FIRST_EMBEDDED_PRIVACY,
        factory: || ActiveAdapter::Search(Box::new(SearchEngineAdapter::fixture_elasticsearch())),
    },
    RegisteredFixture {
        id: "search.opensearch.sample",
        profile: DatabaseType::Opensearch,
        lifecycle: FixtureLifecycle {
            kind: FixtureLifecycleKind::EmbeddedStatic,
            seed: "SearchCatalogFixture::sample(OpenSearch)",
            cleanup: FixtureCleanupPolicy::Noop,
        },
        capabilities: SEARCH_CAPABILITIES,
        privacy: LOCAL_FIRST_EMBEDDED_PRIVACY,
        factory: || ActiveAdapter::Search(Box::new(SearchEngineAdapter::fixture_opensearch())),
    },
];

fn matches_selector(profile: &DatabaseType, selector: &FixtureSelector) -> bool {
    let data_source_profile = profile.data_source_profile();
    match selector {
        FixtureSelector::Profile(requested) => {
            mem::discriminant(profile) == mem::discriminant(requested)
        }
        FixtureSelector::Family(family) => data_source_profile.dialect.family == *family,
        FixtureSelector::Paradigm(paradigm) => data_source_profile.paradigm == *paradigm,
    }
}

fn missing_fixture_diagnostic(request: &FixtureRequest) -> String {
    let mut diagnostic = format!(
        "No fixture matched {:?}. Adapter tests can request an existing fixture by \
         data-source profile, dialect family, or paradigm.",
        request.selector
    );

    if !request.required_capabilities.is_empty() {
        let required = request
            .required_capabilities
            .iter()
            .map(|capability| capability.as_str())
            .collect::<Vec<_>>()
            .join(",");
        diagnostic.push_str(&format!(" Required capabilities: {required}."));
    }

    let available = REGISTERED_FIXTURES
        .iter()
        .map(RegisteredFixture::summary)
        .collect::<Vec<_>>()
        .join("; ");
    diagnostic.push_str(&format!(" available fixtures: {available}"));
    diagnostic
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_names_required_capability_filter() {
        let request = FixtureRequest::by_paradigm(Paradigm::Rdb)
            .require_capability(FixtureCapabilityLabel::LocalFirst);
        let diagnostic = missing_fixture_diagnostic(&request);

        assert!(diagnostic.contains("Paradigm(Rdb)"));
        assert!(diagnostic.contains("Required capabilities: local-first"));
        assert!(diagnostic.contains("available fixtures"));
    }
}
