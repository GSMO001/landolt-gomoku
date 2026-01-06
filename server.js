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
        id: r.id, playerCount: r.players.length,
        hasPw: r.password !== "", status: r.gameStarted ? "PLAYING" : "OPEN"
    }));
    io.emit("updateRoomList", list);
}

io.on("connection", (socket) => {
    socket.emit("updateRoomList", Array.from(rooms.values()).map(r => ({
        id: r.id, playerCount: r.players.length, hasPw: r.password !== "", status: r.gameStarted ? "PLAYING" : "OPEN"
    })));

    socket.on("createRoom", (data) => {
        if (!data.roomId || rooms.has(data.roomId)) return socket.emit("error_msg", "ルーム名が重複または無効です");
        const room = {
            id: data.roomId, password: data.password || "",
            settings: data.settings, players: [socket.id],
            board: [], turn: 0, gameStarted: false, pairCounts: [0, 0]
        };
        rooms.set(data.roomId, room);
        socket.join(data.roomId);
        socket.emit("roomJoined", { roomId: data.roomId, playerIndex: 0 });
        broadcastRooms();
    });

    socket.on("joinRoom", (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.players.length < 2) {
            if (room.password !== "" && room.password !== data.password) return socket.emit("error_msg", "PWが違います");
            room.players.push(socket.id);
            socket.join(data.roomId);
            socket.emit("roomJoined", { roomId: data.roomId, playerIndex: 1 });
            room.gameStarted = true;
            io.to(data.roomId).emit("gameStart");
            broadcastRooms();
        } else {
            socket.emit("error_msg", "入室できません");
        }
    });

    socket.on("placePiece", (data) => {
        const room = rooms.get(data.roomId);
        if (!room || room.players[room.turn] !== socket.id) return;
        room.board.push(data.piece);
        room.pairCounts = data.consecutivePairs;
        room.turn = 1 - room.turn;
        io.to(data.roomId).emit("moveMade", { piece: data.piece, nextTurn: room.turn, consecutivePairs: room.pairCounts });
    });

    socket.on("declareWin", (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            room.gameStarted = false;
            io.to(data.roomId).emit("gameOver", { winner: data.winner });
            rooms.delete(data.roomId);
            broadcastRooms();
        }
    });

    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                io.to(id).emit("playerLeft");
                rooms.delete(id);
                broadcastRooms();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));









