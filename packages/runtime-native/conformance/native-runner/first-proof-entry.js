import { startFirstProofGame } from '../scenes/shared/first-proof-game.js';

startFirstProofGame(canvas, { width: canvas.width || 1280, height: canvas.height || 720 }).catch((error) => {
  console.error('[ThreeNative conformance] first proof failed:', error && error.stack ? error.stack : error);
});
