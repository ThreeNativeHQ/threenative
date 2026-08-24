//! The desktop half of PRD-217's UI layer.
//!
//! `wry` attaches a web view to a window someone else owns; this crate supplies the one thing
//! `wry`'s Linux backend does not — a container the game can actually be seen through.

pub mod argb;
