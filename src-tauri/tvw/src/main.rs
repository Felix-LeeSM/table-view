//! Process shim. Every decision lives in the lib (`src/lib.rs`) so that CI's
//! `cargo test --workspace --lib` covers it — including which sink is written
//! and what code survives a closed stdout, both of which are `tvw::emit`'s.

use std::io;
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    let outcome = tvw::run_argv(std::env::args_os()).await;
    ExitCode::from(tvw::emit(&outcome, io::stdout(), io::stderr()))
}
