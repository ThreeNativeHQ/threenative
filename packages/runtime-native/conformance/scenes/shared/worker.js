import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "worker", async () => {
    const script = new Blob(["self.onmessage = (event) => postMessage(event.data * 2);"], {
      type: "text/javascript",
    });
    const url = URL.createObjectURL(script);
    const worker = new Worker(url);
    const value = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker response timed out")), 2000);
      worker.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data);
      };
      worker.postMessage(21);
    });
    worker.terminate();
    URL.revokeObjectURL(url);
    assertCondition(value === 42, "Worker must deliver asynchronous messages");
    return { value };
  });
}
