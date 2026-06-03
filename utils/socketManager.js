/**
 * utils/socketManager.js
 * ─────────────────────────────────────────────────────────────
 * Simple socket.io instance manager to avoid circular dependencies
 * ─────────────────────────────────────────────────────────────
 */

let io = null;

function setSocketInstance(socketIo) {
  io = socketIo;
}

function getSocketInstance() {
  return io;
}

function emitToAll(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

module.exports = {
  setSocketInstance,
  getSocketInstance,
  emitToAll
};