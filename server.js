const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};

function broadcastRoomList() {
    const list = Object.values(rooms).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPassword: r.password !== "",
        status: r.players.length >= 2 ? "満員" : "募集中",
        timeLimit: r.settings.timeLimit
    }));
    io.emit("updateRoomList", list);
}

io.on("connection", (socket) => {
    socket.emit("updateRoomList", Object.values(rooms).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPassword: r.password !== "",
        status: r.players.length >= 2 ? "満員" : "募集中",
        timeLimit: r.settings.timeLimit
    })));

    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;
        if (rooms[roomId]) return socket.emit("error_msg", "既に存在するルーム名です");

        rooms[roomId] = {
            id: roomId,
            password: password || "",
            settings: settings,
            players: [socket.id],
            board: [],
            turn: 0,
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
            gameStarted: false,
            pairCounts: [0, 0]
        };

        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0 });
        broadcastRoomList();
    });

    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms[roomId];

        if (!room) return socket.emit("error_msg", "ルームがありません");
        if (room.players.length >= 2) return socket.emit("error_msg", "満員です");
        if (room.password !== "" && room.password !== password) return socket.emit("error_msg", "パスワード不一致");

        room.players.push(socket.id);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 1 });

        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        broadcastRoomList();
        startTimer(roomId);
    });

    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        room.board.push(piece);
        room.pairCounts = consecutivePairs;
        room.turn = 1 - room.turn; // ターン交代

        io.to(roomId).emit("moveMade", {
            piece,
            nextTurn: room.turn,
            consecutivePairs: room.pairCounts
        });

        startTimer(roomId);
    });

    socket.on("declareWin", (data) => {
        const { roomId, winner, reason } = data;
        const room = rooms[roomId];
        if (room) {
            if (room.timer) clearInterval(room.timer);
            room.gameStarted = false;
            io.to(roomId).emit("gameOver", { winner, reason: reason || "checkmate" });
        }
    });

    function startTimer(rid) {
        const room = rooms[rid];
        if (!room || room.settings.timeLimit === 'free') return;
        if (room.timer) clearInterval(room.timer);

        room.timeLeft = parseInt(room.settings.timeLimit);
        io.to(rid).emit("timerUpdate", room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(rid).emit("timerUpdate", room.timeLeft);
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                room.gameStarted = false;
                io.to(rid).emit("gameOver", { winner: 1 - room.turn, reason: "timeout" });
            }
        }, 1000);
    }

    socket.on("disconnect", () => {
        for (const rid in rooms) {
            if (rooms[rid].players.includes(socket.id)) {
                if (rooms[rid].timer) clearInterval(rooms[rid].timer);
                io.to(rid).emit("playerLeft");
                delete rooms[rid];
                broadcastRoomList();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));





