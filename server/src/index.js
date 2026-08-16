const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");
const { attachGameSocket } = require("./socket/gameSocket");
const authRoutes = require("./routes/authRoutes");

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

// Serve the client statically for the MVP (single-deploy convenience).
app.use(express.static(path.join(__dirname, "../../client")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

attachGameSocket(io);

server.listen(PORT, () => {
  console.log(`Doodl server listening on :${PORT}`);
});
