/**
 * Head-to-head multiplayer over WebRTC with manual signalling.
 *
 * No backend is required (this runs from GitHub Pages): one player copies an
 * offer code to the other, and pastes back the answer code. Once connected the
 * two peers run the same deterministic simulation and exchange command batches
 * in a lockstep of TICKS_PER_TURN ticks, so both kingdoms always play by the
 * same rules and neither side can rewrite the other's state.
 */
const TICKS_PER_TURN = 4;

const enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const dec = (str) => JSON.parse(decodeURIComponent(escape(atob(str.trim()))));

export class PeerLink {
  constructor({ onStatus, onOpen, onMessage, onClose }) {
    this.onStatus = onStatus || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onMessage = onMessage || (() => {});
    this.onClose = onClose || (() => {});
    this.pc = null;
    this.dc = null;
    this.isHost = false;
  }

  createPeer() {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    });
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.onStatus(`connection: ${s}`);
      if (s === 'failed' || s === 'disconnected' || s === 'closed') this.onClose();
    };
    this.pc.onicecandidate = () => {};
    return this.pc;
  }

  waitForIce() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(() => resolve(), 4000);
      this.pc.onicegatheringstatechange = () => {
        if (this.pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
      };
    });
  }

  wireChannel(dc) {
    this.dc = dc;
    dc.onopen = () => {
      this.onStatus('connected');
      this.onOpen();
    };
    dc.onmessage = (ev) => {
      try { this.onMessage(JSON.parse(ev.data)); } catch (e) { /* ignore malformed */ }
    };
    dc.onclose = () => this.onClose();
  }

  async host() {
    this.isHost = true;
    const pc = this.createPeer();
    this.wireChannel(pc.createDataChannel('kingdom-assault', { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIce();
    return enc({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
  }

  async acceptAnswer(code) {
    const ans = dec(code);
    await this.pc.setRemoteDescription({ sdp: ans.sdp, type: ans.type });
  }

  async join(offerCode) {
    const offer = dec(offerCode);
    const pc = this.createPeer();
    pc.ondatachannel = (ev) => this.wireChannel(ev.channel);
    await pc.setRemoteDescription({ sdp: offer.sdp, type: offer.type });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.waitForIce();
    return enc({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
  }

  send(msg) {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  close() { try { this.pc && this.pc.close(); } catch (e) {} }
}

/**
 * Deterministic lockstep clock. Commands are stamped two turns into the future
 * and applied by both peers on the same simulation tick.
 */
export class Lockstep {
  constructor({ link, onCommands, onState }) {
    this.link = link;
    this.onCommands = onCommands;
    this.onState = onState || (() => {});
    this.turn = 0;
    this.localBuffer = [];
    this.localTurns = new Map();
    this.remoteTurns = new Map();
    this.sentTurns = new Set();
    this.waiting = false;
    this.stalled = false;
    this.stallSince = 0;
  }

  get ticksPerTurn() { return TICKS_PER_TURN; }

  queue(cmd) {
    this.localBuffer.push(cmd);
    return { ok: true, queued: true };
  }

  receive(msg) {
    if (msg.t === 'cmds') {
      this.remoteTurns.set(msg.turn, msg.cmds || []);
      if (this.waiting) this.tryAdvance();
    }
  }

  /** Called at the start of every turn. Returns the batches to apply this turn. */
  beginTurn() {
    const target = this.turn + 2;
    if (!this.sentTurns.has(target)) {
      this.sentTurns.add(target);
      this.localTurns.set(target, this.localBuffer.slice());
      this.link.send({ t: 'cmds', turn: target, cmds: this.localBuffer });
      this.localBuffer = [];
    }
    const ready = this.turn < 2 || this.remoteTurns.has(this.turn);
    if (!ready) {
      this.waiting = true;
      this.onState('waiting');
      return null;
    }
    this.waiting = false;
    const mine = this.localTurns.get(this.turn) || [];
    const theirs = this.remoteTurns.get(this.turn) || [];
    this.localTurns.delete(this.turn);
    this.remoteTurns.delete(this.turn);
    this.turn++;
    // stable ordering so both peers apply commands in the same sequence
    return [...mine, ...theirs].sort((a, b) => (a.owner - b.owner) || String(a.type).localeCompare(String(b.type)));
  }
}
