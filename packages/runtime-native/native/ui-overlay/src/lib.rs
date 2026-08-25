//! The desktop half of PRD-217's UI layer.
//!
//! `wry` attaches a web view to a window someone else owns; this crate supplies the two things
//! `wry`'s Linux backend does not — a container the game can be seen through, and an input shape
//! that lets a click reach the game where the UI is not.

pub mod abi;
pub mod argb;
