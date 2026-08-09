import { startFirstProofGame } from '../scenes/shared/first-proof-game.js';

const canvas = document.getElementById('c');
startFirstProofGame(canvas, { width: canvas.width, height: canvas.height }).catch((error) => {
  console.error('[ThreeNative conformance] browser first proof failed:', error);
});
