const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function broadcastRooms() {
    const list = Array.from(rooms.values()).map(r => ({
        id: r.id,
        count: r.players.length,
        hasPw: r.password !== "",
        status: r.gameStarted ? "対局中" : "待機中",
        timeLimit: r.settings.timeLimit
    }));
    io.emit("updateRoomList", list);
}

io.on("connection", (socket) => {
    broadcastRooms();

    socket.on("createRoom", (data) => {
        if (!data.roomId || rooms.has(data.roomId)) return socket.emit("error_msg", "無効なルーム名です");
        const room = {
            id: data.roomId,
            password: data.password || "",
            settings: { timeLimit: data.timeLimit }, // "none"含む
            players: [socket.id],
            board: [],
            turn: 0,
            gameStarted: false,
            pairCounts: [0, 0],
            timeLeft: data.timeLimit === "none" ? null : parseInt(data.timeLimit),
            timer: null
        };
        rooms.set(data.roomId, room);
        socket.join(data.roomId);
        socket.emit("roomJoined", { roomId: data.roomId, playerIndex: 0, timeLimit: room.settings.timeLimit });
        broadcastRooms();
    });

    socket.on("joinRoom", (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.players.length < 2) {
            if (room.password !== "" && room.password !== data.password) return socket.emit("error_msg", "PW不一致");
            room.players.push(socket.id);
            socket.join(data.roomId);
            socket.emit("roomJoined", { roomId: data.roomId, playerIndex: 1, timeLimit: room.settings.timeLimit });
            room.gameStarted = true;
            io.to(data.roomId).emit("gameStart");
            if (room.settings.timeLimit !== "none") startTimer(data.roomId);
            broadcastRooms();
        }
    });

    function startTimer(roomId) {
        const room = rooms.get(roomId);
        if (!room || room.settings.timeLimit === "none") return;
        if (room.timer) clearInterval(room.timer);
        room.timeLeft = parseInt(room.settings.timeLimit);
        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit("timerUpdate", { timeLeft: room.timeLeft });
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                io.to(roomId).emit("gameOver", { winner: 1 - room.turn, reason: "TIMEOUT" });
                rooms.delete(roomId);
                broadcastRooms();
            }
        }, 1000);
    }

    socket.on("placePiece", (data) => {
        const room = rooms.get(data.roomId);
        if (!room || room.players[room.turn] !== socket.id) return;
        room.board.push(data.piece);
        room.pairCounts = data.consecutivePairs;
        room.turn = 1 - room.turn;
        if (room.settings.timeLimit !== "none") startTimer(data.roomId);
        io.to(data.roomId).emit("moveMade", { piece: data.piece, nextTurn: room.turn, consecutivePairs: room.pairCounts });
    });

    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                if (room.timer) clearInterval(room.timer);
                io.to(id).emit("playerLeft");
                rooms.delete(id);
                broadcastRooms();
                break;
            }
        }
    });
});

server.listen(3000);
