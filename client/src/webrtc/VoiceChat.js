// Minimal full-mesh WebRTC voice chat. The server only relays signaling
// (see voice:* events in gameSocket.js) — audio never touches the server.
// This is entirely optional; nothing here is required for the game to work
// (spec §22).

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export class VoiceChat {
  constructor(socket, { onPeerAudioLevel, onPeerCountChange } = {}) {
    this.socket = socket;
    this.onPeerAudioLevel = onPeerAudioLevel || (() => {});
    this.onPeerCountChange = onPeerCountChange || (() => {});
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.audioEls = new Map(); // peerId -> HTMLAudioElement
    this.localStream = null;
    this.muted = false;
    this.deafened = false;
    this.active = false;

    socket.on("voice:existingPeers", ({ peers }) => {
      peers.forEach((id) => this._connectTo(id, true));
    });
    socket.on("voice:peerJoined", ({ peerId }) => this._connectTo(peerId, false));
    socket.on("voice:peerLeft", ({ peerId }) => this._removePeer(peerId));
    socket.on("voice:signal", ({ fromId, signal }) => this._handleSignal(fromId, signal));
  }

  async start() {
    if (this.active) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.active = true;
    this.socket.emit("voice:join");
    this._setupLocalVoiceActivity();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.socket.emit("voice:leave");
    this.localStream?.getTracks().forEach((t) => t.stop());
    for (const id of [...this.peers.keys()]) this._removePeer(id);
    this.localStream = null;
  }

  setMuted(muted) {
    this.muted = muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setDeafened(deafened) {
    this.deafened = deafened;
    this.audioEls.forEach((el) => (el.muted = deafened));
  }

  _connectTo(peerId, isInitiator) {
    if (this.peers.has(peerId)) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(peerId, pc);
    this.onPeerCountChange(this.peers.size);

    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit("voice:signal", { targetId: peerId, signal: { type: "ice", candidate: e.candidate } });
      }
    };
    pc.ontrack = (e) => {
      let audioEl = this.audioEls.get(peerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.muted = this.deafened;
        this.audioEls.set(peerId, audioEl);
      }
      audioEl.srcObject = e.streams[0];
      this._trackRemoteVoiceActivity(peerId, e.streams[0]);
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.socket.emit("voice:signal", { targetId: peerId, signal: { type: "offer", sdp: offer } });
      };
    }
  }

  async _handleSignal(fromId, signal) {
    if (!this.peers.has(fromId)) this._connectTo(fromId, false);
    const pc = this.peers.get(fromId);
    if (signal.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit("voice:signal", { targetId: fromId, signal: { type: "answer", sdp: answer } });
    } else if (signal.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === "ice") {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch { /* benign race between ICE candidates and remote description */ }
    }
  }

  _removePeer(peerId) {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    const el = this.audioEls.get(peerId);
    if (el) { el.srcObject = null; this.audioEls.delete(peerId); }
    this.onPeerCountChange(this.peers.size);
  }

  _setupLocalVoiceActivity() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(this.localStream);
      source.connect(analyser);
      analyser.fftSize = 512;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!this.active) return;
        analyser.getByteFrequencyData(data);
        const level = data.reduce((a, b) => a + b, 0) / data.length;
        this.onPeerAudioLevel("local", level);
        requestAnimationFrame(tick);
      };
      tick();
    } catch { /* voice-activity indicator is a nice-to-have, fail silently */ }
  }

  _trackRemoteVoiceActivity(peerId, stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 512;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!this.peers.has(peerId)) return;
        analyser.getByteFrequencyData(data);
        const level = data.reduce((a, b) => a + b, 0) / data.length;
        this.onPeerAudioLevel(peerId, level);
        requestAnimationFrame(tick);
      };
      tick();
    } catch { /* voice-activity indicator is a nice-to-have, fail silently */ }
  }
}
