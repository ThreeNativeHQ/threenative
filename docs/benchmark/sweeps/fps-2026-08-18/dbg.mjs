import { chromium } from "playwright";
const b = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport:{width:1536,height:1024} });
p.on("pageerror", e=>console.log("[pageerror]",String(e)));
p.on("console", m=>{ if(m.type()==="error") console.log("[console]", m.text()); });
await p.goto("http://127.0.0.1:5183", { waitUntil:"load" });
await p.waitForTimeout(4000);
// 60 s soak: move, fire, reload, strafe
const keys=["KeyW","KeyA","KeyD","KeyS"];
for (let i=0;i<30;i++){
  const k = keys[i % keys.length];
  await p.keyboard.down(k); await p.keyboard.press("Space");
  await p.waitForTimeout(900); await p.keyboard.up(k);
  if (i%7===6) await p.keyboard.press("KeyR");
  await p.waitForTimeout(1000);
  if (i%10===9) console.log(i, JSON.stringify(await p.evaluate(() => {
    const g=window.__g,s=g.state, br=globalThis.__THREENATIVE_PLAYTEST_BRIDGE__;
    return {sc:s.score,hp:s.health,th:s.targetsHit,sh:s.shots,rl:s.reloads,dm:+s.distanceMoved.toFixed(1),tr:+s.timeRemaining.toFixed(0),ph:s.phase,
      geo:g.renderer.info.memory?.geometries, tex:g.renderer.info.memory?.textures, calls:g.renderer.info.render.drawCalls};
  })));
}
console.log("diag", JSON.stringify(await p.evaluate(async () => (await globalThis.__THREENATIVE_PLAYTEST_BRIDGE__.sample({})).diagnostics)));
await p.screenshot({path:"screenshots/soak-final.png"});
await b.close();
