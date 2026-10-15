//! Request-local interruption of bounded holds, without polling.

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Condvar, Mutex};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use crate::Supervisor;

#[cfg(test)]
mod tests;

/// The request owns this signal; the supervisor keeps only a weak reference.
/// Cancellation and stop notifications take the same mutex as the waiter,
/// so a notification between checking state and sleeping cannot be lost.
pub struct HoldSignal {
    cancelled: Mutex<bool>,
    changed: Condvar,
    stop_epoch: u64,
}

impl HoldSignal {
    pub(crate) fn new(stop_epoch: u64) -> Arc<Self> {
        Arc::new(Self {
            cancelled: Mutex::new(false),
            changed: Condvar::new(),
            stop_epoch,
        })
    }

    /// Abandon the request, including a dropped waiter or an expired deadline.
    pub fn cancel(&self) {
        *self.cancelled.lock() = true;
        self.changed.notify_all();
    }

    pub(crate) fn stopped(&self) {
        let _state = self.cancelled.lock();
        self.changed.notify_all();
    }

    /// Suspension takes precedence over cancellation, even after a quick reset.
    ///
    /// # Errors
    /// `Suspended` after a safety stop, otherwise `Cancelled` after abandonment.
    pub fn check(&self, supervisor: &Supervisor) -> CoreResult<()> {
        self.check_state(supervisor, *self.cancelled.lock())
    }

    fn check_state(&self, supervisor: &Supervisor, cancelled: bool) -> CoreResult<()> {
        if supervisor.is_suspended() || supervisor.stop_epoch() != self.stop_epoch {
            Err(DesktopError::new(ErrorCode::Suspended, "input was suspended during the hold"))
        } else if cancelled {
            Err(DesktopError::new(ErrorCode::Cancelled, "the hold request was cancelled"))
        } else {
            Ok(())
        }
    }

    /// Wait for the hold duration or interruption. Spurious wakeups recheck
    /// state and the original deadline, rather than restarting the duration.
    ///
    /// # Errors
    /// See [`Self::check`].
    pub fn wait(&self, supervisor: &Supervisor, duration: Duration) -> CoreResult<()> {
        let deadline = Instant::now() + duration;
        let mut cancelled = self.cancelled.lock();
        loop {
            self.check_state(supervisor, *cancelled)?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(());
            }
            self.changed.wait_for(&mut cancelled, remaining);
        }
    }
}
