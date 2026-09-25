//! Q5.4 — sidebar / autocomplete / prefetch **introspection pool**.
//!
//! Rationale (strategy doc lines 478–480):
//!
//! > Sidebar / autocomplete / prefetch run on a **separate** idle pool so
//! > a long user query in the tab pool never starves schema introspection.
//! > The pool is small (max_K=5) and lent out round-robin across the
//! > sidebar's parallel fetches.
//!
//! What lives here is the structural surface: an `IntrospectionPool`
//! handle with a round-robin index counter + `max_size` cap. Schema
//! command sites call `pool.acquire()` against the per-connection
//! ActiveAdapter pool instead. `AppState.introspection_pools` is only
//! declared and initialised in `AppState` — no schema command resolves a
//! pool through it, so this layer has no production reader.
//!
//! `acquire_slot()` increments the next-index and returns the current
//! slot. The tests below assert the round-robin ordering + cap.

use std::sync::atomic::{AtomicUsize, Ordering};

/// Sidebar's idle-connection round-robin selector.
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
    /// of the `max_K` idle connections a sidebar fetch would borrow
    /// against. No `pool.acquire()` call site is wired to this slot
    /// index.
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
    //! Reason (2026-05-16):
    //! AC-359-02b — pins the round-robin behaviour of the isolated sidebar
    //! introspection pool at the unit level. capacity=5 is the strategy
    //! doc's max_K.

    use super::*;

    #[test]
    fn default_capacity_is_five() {
        // Matches max_K=5 from strategy line 465.
        let p = IntrospectionPool::new();
        assert_eq!(p.max_size(), 5);
    }

    #[test]
    fn acquire_slot_round_robin_wraps_modulo_capacity() {
        // With capacity 5 the order is 0,1,2,3,4,0,1,...
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
        // A user-supplied 0 clamps to 1 — guards against div-by-zero.
        let p = IntrospectionPool::with_capacity(0);
        assert_eq!(p.max_size(), 1);
        assert_eq!(p.acquire_slot(), 0);
    }

    #[test]
    fn acquire_slot_concurrent_safety() {
        // 8 threads acquiring 100 times each on the same pool still total
        // 800. Asserts that `AtomicUsize::fetch_add` is race-free.
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
        // The raw counter is 800.
        assert_eq!(p.next_idx.load(Ordering::Relaxed), 800);
    }
}
