//! Sprint 359 (Phase 2 Q5.4) — sidebar / autocomplete / prefetch
//! **introspection pool**.
//!
//! Rationale (strategy doc lines 478–480):
//!
//! > Sidebar / autocomplete / prefetch run on a **separate** idle pool so
//! > a long user query in the tab pool never starves schema introspection.
//! > The pool is small (max_K=5) and lent out round-robin across the
//! > sidebar's parallel fetches.
//!
//! This sprint stands up the structural surface: an `IntrospectionPool`
//! handle with a round-robin index counter + `max_size` cap. Schema
//! command sites continue to call `pool.acquire()` against the per-
//! connection ActiveAdapter pool today; rewiring every sidebar fetch
//! onto this layer is a follow-up commit because the call sites are
//! plumbed through 14+ files and the affinity work in this sprint is
//! the necessary precursor.
//!
//! The trait-level affordance is what callers will start consuming in
//! sprint-360+: `acquire()` increments the next-index and returns the
//! current slot. Tests assert the round-robin ordering + cap.

use std::sync::atomic::{AtomicUsize, Ordering};

/// Sprint 359 — sidebar's idle-connection round-robin selector.
///
/// `max_size` is the cap (strategy doc fixes max_K = 5). `next_idx`
/// advances on every acquire and wraps modulo `max_size`.
#[derive(Debug)]
pub struct IntrospectionPool {
    next_idx: AtomicUsize,
    max_size: usize,
}

impl IntrospectionPool {
    /// Build a pool selector with the strategy-doc default cap (5).
    pub fn new() -> Self {
        Self::with_capacity(5)
    }

    /// Build with an explicit cap — tests use a smaller cap to exercise
    /// the wrap-around behaviour quickly.
    pub fn with_capacity(max_size: usize) -> Self {
        Self {
            next_idx: AtomicUsize::new(0),
            max_size: max_size.max(1),
        }
    }

    /// Number of idle slots this pool will round-robin across (max_K).
    pub fn max_size(&self) -> usize {
        self.max_size
    }

    /// Pick the next idle-slot index and advance the round-robin
    /// counter. The returned index is in `0..max_size`.
    ///
    /// This is the *selector*, not a `PoolConnection` itself. The real
    /// sqlx pool stays on `ActiveAdapter`; the selector decides which
    /// of the `max_K` idle connections the next sidebar fetch should
    /// borrow against. Wiring the actual `pool.acquire()` call site to
    /// this slot index is the follow-up step.
    pub fn acquire_slot(&self) -> usize {
        let raw = self.next_idx.fetch_add(1, Ordering::Relaxed);
        raw % self.max_size
    }
}

impl Default for IntrospectionPool {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-16, sprint-359):
    //! AC-359-02b — sidebar 격리 introspection pool 의 round-robin 동작
    //! 을 unit-level 에서 고정한다. capacity=5 가 strategy doc 의 max_K.

    use super::*;

    #[test]
    fn default_capacity_is_five() {
        // strategy line 465 의 max_K=5 정합.
        let p = IntrospectionPool::new();
        assert_eq!(p.max_size(), 5);
    }

    #[test]
    fn acquire_slot_round_robin_wraps_modulo_capacity() {
        // 5 capacity 에서 0,1,2,3,4,0,1,... 순서.
        let p = IntrospectionPool::with_capacity(5);
        let slots: Vec<usize> = (0..7).map(|_| p.acquire_slot()).collect();
        assert_eq!(slots, vec![0, 1, 2, 3, 4, 0, 1]);
    }

    #[test]
    fn capacity_one_always_returns_zero() {
        let p = IntrospectionPool::with_capacity(1);
        for _ in 0..3 {
            assert_eq!(p.acquire_slot(), 0);
        }
    }

    #[test]
    fn zero_capacity_is_clamped_to_one() {
        // user 가 0 을 지정하면 안전하게 1 로 clamp — div-by-zero 방어.
        let p = IntrospectionPool::with_capacity(0);
        assert_eq!(p.max_size(), 1);
        assert_eq!(p.acquire_slot(), 0);
    }

    #[test]
    fn acquire_slot_concurrent_safety() {
        // 같은 pool 에 동시에 8 thread 가 100 회씩 acquire 해도 총 횟수
        // 가 800. AtomicUsize 의 fetch_add 가 race-free 임을 단언.
        use std::sync::Arc;
        use std::thread;

        let p = Arc::new(IntrospectionPool::with_capacity(5));
        let mut handles = Vec::new();
        for _ in 0..8 {
            let pc = Arc::clone(&p);
            handles.push(thread::spawn(move || {
                for _ in 0..100 {
                    let _ = pc.acquire_slot();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        // raw counter 는 800.
        assert_eq!(p.next_idx.load(Ordering::Relaxed), 800);
    }
}
