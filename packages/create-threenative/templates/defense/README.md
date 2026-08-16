# Defense starter kit

This is a portable tower-defense board: attackers follow an authored route, towers scan and fire,
and income pays for placement. It deliberately does not use `@threenative/physics/navigation`.
That package carries a WASM navigation dependency, while the native host runs QuickJS, so this kit
keeps route following in generated game source and remains portable across desktop, Android, and
iOS targets. Platform readiness still depends on the host evidence for that target.

Press `B` to place a tower on a safe build slot. `X` tests route rejection, `O` tests overlap
rejection, and `R` restarts the wave. Survive ten waves to win; twenty leaks lose the game.
