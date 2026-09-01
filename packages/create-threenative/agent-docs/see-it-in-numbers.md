## See the game without looking at it

**The playtest harness is your eyes.** A screenshot tells you something looks wrong; it cannot
tell you by how much, and reading one costs far more than reading a number. Measure first. Look
last, and say that you are doing it.

Three tools, in the order you should reach for them:

```sh
# 1. What is actually running: entities, world extents, scale, draw cost, the clip each entity
#    plays, console errors. Run this before forming any theory about a game that looks wrong.
npx @threenative/playtest doctor --url http://127.0.0.1:5173 --text

# 2. What a scenario can assert: movement, visibility, animation, resources, render chain.
npx @threenative/playtest playtests/<name>.playtest.json --browser-recipe webgpu --headed
```

3. **A scene probe, when the question is "where is this relative to that".** `doctor` reports
   entities; it does not know that a keyboard belongs under a pair of hands, or that a camera has
   ended up inside a shoulder. Publish the answer from your own scene and read it from a script:

```ts
// in your scene, web only
if (isWeb()) {
  (globalThis as Record<string, unknown>).__probe = () => ({
    hand: worldPosition(character.getObjectByName("hand_r")),
    keyboard: worldPosition(desk.keyboard),
    // Derive the verdict here, not in the reader: a dump makes you do arithmetic, a check tells
    // you the answer.
    checks: [{ name: "hands-on-keys", ok: Math.abs(hand.y - keyboard.y) < 0.03 }],
  });
}
```

Then drive it with Playwright and print the checks. To tune a value — a bone axis, an offset, a
threshold — set it from a global, re-read the probe, and sweep: five candidates measured in one
run beats five screenshots and a guess. Turn whatever you learn into a playtest assertion so it
stays fixed.

A game whose geometry is only ever checked by eye regresses silently the first time nobody looks.
